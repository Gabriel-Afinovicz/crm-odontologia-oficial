import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evolution } from "@/lib/evolution/client";
import { jidToPhone } from "@/lib/evolution/phone";
import type { WhatsAppMessageMediaType } from "@/lib/types/database";

// Limite estrito de 4MB por arquivo. O transporte cliente -> servidor usa
// multipart/form-data, entao o body cabe em ~4MB. A Vercel default rejeita
// requests > 4.5MB; deixamos 500KB de folga para headers/boundary do multipart.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

interface InstanceRow {
  id: string;
  company_id: string;
  instance_name: string;
  status: "disconnected" | "connecting" | "connected";
}

interface ChatRow {
  id: string;
  company_id: string;
  instance_id: string;
  remote_jid: string;
  lead_id: string | null;
}

// Decide o `mediatype` que sera passado ao /message/sendMedia da Evolution
// e que tambem vai parar em `whatsapp_messages.media_type`. WhatsApp Web/
// celular renderiza diferente cada um: image vai inline, video tem player,
// document e um anexo clicavel. Audio nao e suportado neste fluxo (precisa
// de /message/sendWhatsAppAudio dedicado — fora do escopo desta leva).
function detectMediaType(
  mimetype: string
): "image" | "video" | "document" {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  return "document";
}

// Preview curto para a lista lateral. Igual ao webhook/load-history quando
// nao ha caption: mostra [imagem] / [video] / [documento] entre colchetes
// — mesma convencao do app oficial WhatsApp.
function previewForType(type: WhatsAppMessageMediaType, caption: string | null): string {
  if (caption && caption.trim().length > 0) return caption.slice(0, 120);
  if (type === "image") return "[imagem]";
  if (type === "video") return "[video]";
  if (type === "document") return "[documento]";
  return "[midia]";
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Conteudo invalido (esperado multipart/form-data)." },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "Arquivo obrigatorio." },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      {
        error: `Arquivo muito grande. Limite: ${Math.floor(
          MAX_FILE_BYTES / (1024 * 1024)
        )} MB.`,
        code: "TOO_LARGE",
      },
      { status: 413 }
    );
  }

  const chatIdRaw = form.get("chatId");
  const chatId =
    typeof chatIdRaw === "string" ? chatIdRaw.trim() : "";
  if (!chatId) {
    return NextResponse.json(
      { error: "chatId obrigatorio." },
      { status: 400 }
    );
  }

  const captionRaw = form.get("caption");
  const caption =
    typeof captionRaw === "string" && captionRaw.trim().length > 0
      ? captionRaw.trim()
      : null;

  const replyRaw = form.get("replyToMessageId");
  const replyToMessageId =
    typeof replyRaw === "string" && replyRaw.trim().length > 0
      ? replyRaw.trim()
      : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id, company_id, role")
    .eq("auth_id", user.id)
    .single();
  const profileRow = profile as
    | { id: string; company_id: string; role: string }
    | null;
  if (!profileRow) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const companyId = profileRow.company_id;
  const supabaseAdmin = createAdminClient();

  const { data: chatData } = await supabaseAdmin
    .from("whatsapp_chats")
    .select("id, company_id, instance_id, remote_jid, lead_id")
    .eq("id", chatId)
    .single();
  const chatRow = chatData as ChatRow | null;
  if (!chatRow || chatRow.company_id !== companyId) {
    return NextResponse.json(
      { error: "Chat nao encontrado." },
      { status: 404 }
    );
  }

  const { data: instanceData } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, company_id, instance_name, status")
    .eq("id", chatRow.instance_id)
    .single();
  const instanceRow = instanceData as InstanceRow | null;
  if (!instanceRow || instanceRow.company_id !== companyId) {
    return NextResponse.json(
      { error: "Instancia nao encontrada." },
      { status: 404 }
    );
  }
  if (instanceRow.status !== "connected") {
    return NextResponse.json(
      {
        error: "WhatsApp desconectado. Reconecte em Configuracoes.",
        code: "NOT_CONNECTED",
      },
      { status: 409 }
    );
  }

  // Resolve a citacao (reply) antes de enviar. Mesma logica do /send: precisa
  // do evolution_message_id da mensagem original pra que o WhatsApp do
  // destinatario vincule o quote. Se a mensagem nao for elegivel, seguimos
  // sem reply em vez de falhar — a midia ainda chega, so sem o quote.
  let quotedSnapshot: {
    evolutionMessageId: string;
    fromMe: boolean;
    body: string | null;
    mediaType: string;
  } | null = null;
  if (replyToMessageId) {
    const { data: original } = await supabaseAdmin
      .from("whatsapp_messages")
      .select(
        "id, company_id, chat_id, evolution_message_id, from_me, body, media_type"
      )
      .eq("id", replyToMessageId)
      .maybeSingle();
    const originalRow = original as {
      id: string;
      company_id: string;
      chat_id: string;
      evolution_message_id: string | null;
      from_me: boolean;
      body: string | null;
      media_type: string;
    } | null;
    if (
      originalRow &&
      originalRow.company_id === companyId &&
      originalRow.chat_id === chatRow.id &&
      originalRow.evolution_message_id
    ) {
      quotedSnapshot = {
        evolutionMessageId: originalRow.evolution_message_id,
        fromMe: originalRow.from_me,
        body: originalRow.body,
        mediaType: originalRow.media_type,
      };
    }
  }

  // Le binario do FormData e converte para base64 puro. A Evolution v2 aceita
  // base64 direto no campo `media`. Custo extra de memoria: ~33% sobre o
  // tamanho do arquivo — para 4MB de input, ~5.3MB de base64 em RAM no Node.
  const mimetype = file.type || "application/octet-stream";
  const mediaType = detectMediaType(mimetype);
  const fileName = file.name || `arquivo-${Date.now()}`;

  let base64: string;
  try {
    const arrayBuffer = await file.arrayBuffer();
    base64 = Buffer.from(arrayBuffer).toString("base64");
  } catch (err) {
    console.error("[send-media] erro ao ler arquivo:", err);
    return NextResponse.json(
      { error: "Erro ao processar arquivo." },
      { status: 500 }
    );
  }

  let evoMessageId: string | null = null;
  try {
    const sendRes = await evolution.sendMedia(
      instanceRow.instance_name,
      chatRow.remote_jid,
      {
        mediatype: mediaType,
        mimetype,
        media: base64,
        fileName,
        caption: caption ?? undefined,
        // Caption pode conter URLs; mantemos linkPreview ligado quando ha
        // https no caption (mesmo criterio do /send para texto puro).
        linkPreview: caption ? /https:\/\/\S+/i.test(caption) : false,
        quoted: quotedSnapshot
          ? {
              evolutionMessageId: quotedSnapshot.evolutionMessageId,
              fromMe: quotedSnapshot.fromMe,
              remoteJid: chatRow.remote_jid,
              body: quotedSnapshot.body,
            }
          : undefined,
      }
    );
    evoMessageId = sendRes.key?.id ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[send-media] evolution.sendMedia failed:", {
      instance: instanceRow.instance_name,
      remoteJid: chatRow.remote_jid,
      mediaType,
      fileSize: file.size,
      error: message,
    });
    return NextResponse.json(
      { error: `Falha ao enviar midia via Evolution: ${message}` },
      { status: 502 }
    );
  }

  const sentAt = new Date().toISOString();

  // Idempotencia: webhook pode ter entregue antes do insert local — checa
  // (mesmo padrao do /send para texto).
  let messageId: string | null = null;
  if (evoMessageId) {
    const { data: existing } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id")
      .eq("company_id", companyId)
      .eq("evolution_message_id", evoMessageId)
      .maybeSingle();
    messageId = (existing as { id: string } | null)?.id ?? null;
  }

  const quotedBodyForDb = quotedSnapshot
    ? quotedSnapshot.body && quotedSnapshot.body.trim().length > 0
      ? quotedSnapshot.body.slice(0, 240)
      : `[${quotedSnapshot.mediaType}]`
    : null;

  if (!messageId) {
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("whatsapp_messages")
      .insert({
        company_id: companyId,
        chat_id: chatRow.id,
        evolution_message_id: evoMessageId,
        direction: "out",
        from_me: true,
        body: caption,
        media_type: mediaType,
        media_mime_type: mimetype,
        status: "sent",
        sent_at: sentAt,
        sender_user_id: profileRow.id,
        quoted_evolution_message_id:
          quotedSnapshot?.evolutionMessageId ?? null,
        quoted_body: quotedBodyForDb,
        quoted_from_me: quotedSnapshot?.fromMe ?? null,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      return NextResponse.json(
        { error: `Erro ao registrar mensagem: ${insertErr?.message}` },
        { status: 500 }
      );
    }
    messageId = (inserted as { id: string }).id;
  } else {
    // Webhook foi mais rapido; complementa com sender_user_id + media_type
    // (o webhook pode nao ter o caption se o evento chegou antes do nosso
    // insert; aqui sobrescrevemos pra garantir consistencia).
    const update: Record<string, unknown> = {
      sender_user_id: profileRow.id,
      media_type: mediaType,
      media_mime_type: mimetype,
    };
    if (caption !== null) update.body = caption;
    if (quotedSnapshot) {
      update.quoted_evolution_message_id = quotedSnapshot.evolutionMessageId;
      update.quoted_body = quotedBodyForDb;
      update.quoted_from_me = quotedSnapshot.fromMe;
    }
    await supabaseAdmin
      .from("whatsapp_messages")
      .update(update)
      .eq("id", messageId);
  }

  await supabaseAdmin
    .from("whatsapp_chats")
    .update({
      last_message_at: sentAt,
      last_message_preview: previewForType(mediaType, caption),
      last_message_from_me: true,
      last_message_status: "sent",
    })
    .eq("id", chatRow.id);

  return NextResponse.json({
    ok: true,
    chatId: chatRow.id,
    messageId,
    remoteJid: chatRow.remote_jid,
    phone: jidToPhone(chatRow.remote_jid),
    mediaType,
  });
}
