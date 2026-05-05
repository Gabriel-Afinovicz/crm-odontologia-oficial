import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evolution } from "@/lib/evolution/client";
import { phoneToJid, jidToPhone, onlyDigits } from "@/lib/evolution/phone";

interface SendPayload {
  domain?: string;
  text?: string;
  chatId?: string;
  phone?: string;
  leadId?: string;
  /**
   * Solicita explicitamente preview de link na Evolution. Quando ausente,
   * habilitamos automaticamente caso o texto contenha uma URL https — assim
   * lembretes/confirmacoes que carregam links viram tocaveis no WhatsApp.
   */
  linkPreview?: boolean;
  /**
   * Quando presente, a mensagem e enviada como reply (citacao estilo WhatsApp)
   * a esta mensagem. Aceita o uuid local de whatsapp_messages.id; o backend
   * resolve o evolution_message_id e o body para passar a Evolution e gravar
   * o snapshot junto com a nova mensagem.
   */
  replyToMessageId?: string;
}

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

interface LeadRow {
  id: string;
  company_id: string;
  phone: string | null;
  name: string;
}

export async function POST(req: NextRequest) {
  let body: SendPayload;
  try {
    body = (await req.json()) as SendPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json(
      { error: "Texto da mensagem obrigatorio." },
      { status: 400 }
    );
  }

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

  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, company_id, instance_name, status")
    .eq("company_id", companyId)
    .maybeSingle();
  const instanceRow = instance as InstanceRow | null;
  if (!instanceRow) {
    return NextResponse.json(
      {
        error: "WhatsApp ainda nao conectado para esta clinica.",
        code: "NOT_CONNECTED",
      },
      { status: 409 }
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

  let chatId = body.chatId ?? null;
  let chatRow: ChatRow | null = null;
  let targetJid: string | null = null;
  let targetPhone: string | null = null;
  let leadId: string | null = null;

  if (chatId) {
    const { data } = await supabaseAdmin
      .from("whatsapp_chats")
      .select("id, company_id, instance_id, remote_jid, lead_id")
      .eq("id", chatId)
      .single();
    chatRow = data as ChatRow | null;
    if (!chatRow || chatRow.company_id !== companyId) {
      return NextResponse.json({ error: "Chat nao encontrado." }, { status: 404 });
    }
    targetJid = chatRow.remote_jid;
    targetPhone = jidToPhone(chatRow.remote_jid);
    leadId = chatRow.lead_id;
  } else if (body.leadId) {
    const { data } = await supabaseAdmin
      .from("leads")
      .select("id, company_id, phone, name")
      .eq("id", body.leadId)
      .single();
    const lead = data as LeadRow | null;
    if (!lead || lead.company_id !== companyId) {
      return NextResponse.json({ error: "Lead nao encontrado." }, { status: 404 });
    }
    leadId = lead.id;
    targetJid = phoneToJid(lead.phone);
    if (!targetJid) {
      return NextResponse.json(
        { error: "Lead sem telefone valido cadastrado.", code: "NO_PHONE" },
        { status: 400 }
      );
    }
    targetPhone = onlyDigits(lead.phone);
  } else if (body.phone) {
    targetJid = phoneToJid(body.phone);
    if (!targetJid) {
      return NextResponse.json(
        { error: "Telefone invalido.", code: "NO_PHONE" },
        { status: 400 }
      );
    }
    targetPhone = onlyDigits(body.phone);
  } else {
    return NextResponse.json(
      { error: "Informe chatId, leadId ou phone." },
      { status: 400 }
    );
  }

  if (!chatRow && targetJid) {
    const { data: existingChat } = await supabaseAdmin
      .from("whatsapp_chats")
      .select("id, company_id, instance_id, remote_jid, lead_id")
      .eq("company_id", companyId)
      .eq("remote_jid", targetJid)
      .maybeSingle();
    chatRow = existingChat as ChatRow | null;

    if (!chatRow) {
      const { data: created, error: chatErr } = await supabaseAdmin
        .from("whatsapp_chats")
        .insert({
          company_id: companyId,
          instance_id: instanceRow.id,
          remote_jid: targetJid,
          lead_id: leadId,
          last_message_at: new Date().toISOString(),
          last_message_preview: text.slice(0, 120),
        })
        .select("id, company_id, instance_id, remote_jid, lead_id")
        .single();
      if (chatErr || !created) {
        return NextResponse.json(
          { error: `Erro ao criar chat: ${chatErr?.message}` },
          { status: 500 }
        );
      }
      chatRow = created as ChatRow;
    }
    chatId = chatRow.id;
  }

  if (!chatRow || !targetJid) {
    return NextResponse.json(
      { error: "Falha ao resolver destino." },
      { status: 500 }
    );
  }

  // Resolve a mensagem citada (reply) ANTES de enviar. Precisamos do
  // evolution_message_id da mensagem original para que o WhatsApp do
  // destinatario consiga renderizar o quote ligado a mensagem real (e nao
  // como uma string solta). Tambem guardamos snapshot para nossa UI.
  let quotedSnapshot: {
    evolutionMessageId: string;
    fromMe: boolean;
    body: string | null;
    mediaType: string;
  } | null = null;
  if (body.replyToMessageId) {
    const { data: original } = await supabaseAdmin
      .from("whatsapp_messages")
      .select(
        "id, company_id, chat_id, evolution_message_id, from_me, body, media_type"
      )
      .eq("id", body.replyToMessageId)
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
    // Se a mensagem citada nao foi encontrada/elegivel, seguimos sem reply
    // em vez de falhar o envio: a mensagem ainda chega, so nao vai com quote.
  }

  // Envia via Evolution PRIMEIRO para obter evolution_message_id, e so depois
  // insere no banco (ja com o id). Isso elimina o race condition em que o
  // webhook chegava antes da update e inseria uma duplicata.
  let evoMessageId: string | null = null;
  // Decide linkPreview: respeita explicito; senao, ativa quando texto contem
  // URL https (lembretes/confirmacoes). Outros fluxos sem link nao pagam custo.
  const wantsLinkPreview =
    typeof body.linkPreview === "boolean"
      ? body.linkPreview
      : /https:\/\/\S+/i.test(text);
  try {
    const sendRes = await evolution.sendText(
      instanceRow.instance_name,
      targetJid,
      text,
      {
        linkPreview: wantsLinkPreview,
        quoted: quotedSnapshot
          ? {
              evolutionMessageId: quotedSnapshot.evolutionMessageId,
              fromMe: quotedSnapshot.fromMe,
              remoteJid: targetJid,
              body: quotedSnapshot.body,
            }
          : undefined,
      }
    );
    evoMessageId = sendRes.key?.id ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json(
      { error: `Falha ao enviar via Evolution: ${message}` },
      { status: 502 }
    );
  }

  const sentAt = new Date().toISOString();

  // Idempotencia: pode ser que o webhook tenha sido mais rapido e ja inseriu
  // a mensagem com este evolution_message_id. Se for o caso, apenas pega o id.
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

  // Snapshot do quote para UI: corpo curto (preview) e flag se era nossa.
  // Para midias sem caption guardamos um placeholder do tipo, igual o que
  // mostramos na lista lateral, para o quote nunca ficar vazio.
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
        body: text,
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
    // Webhook ja inseriu; complementa com sender_user_id que ele nao tem.
    // Tambem completa o quote (o webhook ja extrai do contextInfo, mas pode
    // chegar antes ou nao trazer o snapshot completo dependendo do payload).
    const update: Record<string, unknown> = { sender_user_id: profileRow.id };
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
      last_message_preview: text.slice(0, 120),
    })
    .eq("id", chatRow.id);

  return NextResponse.json({
    ok: true,
    chatId: chatRow.id,
    messageId,
    remoteJid: targetJid,
    phone: targetPhone,
  });
}
