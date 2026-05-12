import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canonicalRemoteJid,
  isIndividualJid,
  jidToPhone,
  siblingJid,
} from "@/lib/evolution/phone";
import type {
  WhatsAppMessageMediaType,
  WhatsAppMessageStatus,
} from "@/lib/types/database";
import {
  mergeReactions,
  normalizeReactions,
} from "@/lib/whatsapp/reactions";

interface RouteParams {
  params: Promise<{ instance: string }>;
}

interface WebhookPayload {
  event?: string;
  instance?: string;
  data?: WebhookData;
  apikey?: string;
}

interface WebhookData {
  key?: {
    id?: string;
    remoteJid?: string;
    fromMe?: boolean;
    /**
     * JID alternativo entregue pela Evolution quando `remoteJid` esta em
     * `@lid` (privacidade do WhatsApp). Tipicamente o `@s.whatsapp.net`
     * real do contato — preferimos ele como `remote_jid` canonico do chat
     * para manter o historico unificado com o que o CRM ja guardava.
     */
    remoteJidAlt?: string;
    addressingMode?: string;
  };
  pushName?: string;
  message?: Record<string, unknown>;
  messageType?: string;
  messageTimestamp?: number | string;
  status?: string;
  state?: string;
  ownerJid?: string;
  remoteJid?: string;
  id?: string;
  contact?: { name?: string };
  profilePicUrl?: string;
  /**
   * `contextInfo` top-level (fora de `message`) usado pelas mensagens do
   * tipo `conversation` (texto curto) para carregar dados do reply
   * (`stanzaId`, `quotedMessage`, `participant`). Repassado ao
   * `extractQuoted` como fonte alternativa.
   */
  contextInfo?: Record<string, unknown>;
}

function normalizeEvent(raw: string | undefined): string {
  if (!raw) return "";
  return raw.toLowerCase().replace(/_/g, ".");
}

interface ExtractedMessage {
  body: string | null;
  mediaType: WhatsAppMessageMediaType;
  mediaUrl: string | null;
  mediaMimeType: string | null;
}

interface ExtractedQuote {
  evolutionMessageId: string | null;
  body: string | null;
  fromMe: boolean | null;
}

// Constroi a citacao a partir de um `contextInfo` ja localizado.
// Compartilhada entre os dois caminhos: `contextInfo` top-level (mensagens
// `conversation`) e `contextInfo` dentro de sub-objeto (`extendedTextMessage`,
// `imageMessage`, etc).
function buildQuoteFromContext(
  ctx: Record<string, unknown>,
  remoteJid: string | null | undefined
): ExtractedQuote | null {
  const stanzaId =
    typeof ctx["stanzaId"] === "string" ? (ctx["stanzaId"] as string) : null;
  if (!stanzaId) return null;
  const quotedMsg = ctx["quotedMessage"] as
    | Record<string, unknown>
    | undefined;
  const quotedExtract = extractMessage(quotedMsg);
  const participant =
    typeof ctx["participant"] === "string"
      ? (ctx["participant"] as string)
      : null;
  let fromMe: boolean | null = null;
  if (participant && remoteJid) {
    fromMe = participant !== remoteJid;
  }
  return {
    evolutionMessageId: stanzaId,
    body:
      quotedExtract.body && quotedExtract.body.trim().length > 0
        ? quotedExtract.body.slice(0, 240)
        : quotedExtract.mediaType !== "text" &&
            quotedExtract.mediaType !== "unknown"
          ? `[${quotedExtract.mediaType}]`
          : null,
    fromMe,
  };
}

// Extrai a citacao (reply) de uma mensagem Baileys/Evolution. O `contextInfo`
// pode aparecer em dois lugares dependendo do tipo da mensagem:
//   1) Top-level no record (`record.contextInfo`) para `messageType:
//      "conversation"` (texto curto). E o caso comum hoje, sobretudo apos
//      a migracao do WhatsApp para chats `@lid`.
//   2) Dentro de cada sub-objeto de `message` (`extendedTextMessage`,
//      `imageMessage`, `videoMessage`, etc) — formato classico, ainda usado
//      para midia e textos longos.
//
// O Baileys identifica a mensagem citada por `stanzaId` e replica o conteudo
// em `quotedMessage`. Para chats individuais, `participant` traz o JID do
// autor original da mensagem citada — comparando com o `remoteJid` (canonico)
// do chat sabemos se era nossa (out) ou do contato (in).
function extractQuoted(
  message: Record<string, unknown> | undefined | null,
  remoteJid: string | null | undefined,
  topLevelContextInfo?: Record<string, unknown> | null
): ExtractedQuote {
  const empty: ExtractedQuote = {
    evolutionMessageId: null,
    body: null,
    fromMe: null,
  };
  if (topLevelContextInfo) {
    const built = buildQuoteFromContext(topLevelContextInfo, remoteJid);
    if (built) return built;
  }
  if (!message) return empty;
  const candidates = [
    "extendedTextMessage",
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "documentMessage",
    "stickerMessage",
  ];
  for (const k of candidates) {
    const sub = message[k] as
      | { contextInfo?: Record<string, unknown> }
      | undefined;
    const ctx = sub?.contextInfo;
    if (!ctx) continue;
    const built = buildQuoteFromContext(ctx, remoteJid);
    if (built) return built;
  }
  return empty;
}

interface ExtractedReaction {
  targetEvolutionMessageId: string;
  targetFromMe: boolean | null;
  emoji: string;
  ts: string;
  reactorJid: string | null;
}

// Detecta `message.reactionMessage` no payload Baileys/Evolution. Estrutura:
//   { reactionMessage: {
//       key: { id, fromMe, remoteJid, participant? },
//       text: "<emoji>" | "",         // string vazia = remocao
//       senderTimestampMs: <ms> | string
//     } }
// Retorna `null` quando a mensagem nao e uma reacao — chamadores caem para
// o fluxo normal de inserir mensagem.
function extractReaction(
  message: Record<string, unknown> | undefined | null,
  outerReactorJid: string | null
): ExtractedReaction | null {
  if (!message) return null;
  const reaction = message["reactionMessage"] as
    | {
        key?: {
          id?: string | null;
          fromMe?: boolean | null;
          remoteJid?: string | null;
          participant?: string | null;
        } | null;
        text?: string | null;
        senderTimestampMs?: number | string | null;
      }
    | undefined;
  if (!reaction || typeof reaction !== "object") return null;
  const targetId =
    typeof reaction.key?.id === "string" ? reaction.key.id : null;
  if (!targetId) return null;
  const targetFromMe =
    typeof reaction.key?.fromMe === "boolean" ? reaction.key.fromMe : null;
  const emoji =
    typeof reaction.text === "string" ? reaction.text : "";
  // Baileys envia o `senderTimestampMs` ja em ms (alguns servers em segundos
  // como string). Best-effort: se nao parseia, cai pra now().
  let ts = new Date().toISOString();
  const rawTs = reaction.senderTimestampMs;
  if (rawTs != null) {
    const num = typeof rawTs === "number" ? rawTs : Number(rawTs);
    if (Number.isFinite(num) && num > 0) {
      // Heuristica: ms se > 10^12, segundos caso contrario.
      const ms = num > 1e12 ? num : num * 1000;
      ts = new Date(ms).toISOString();
    }
  }
  return {
    targetEvolutionMessageId: targetId,
    targetFromMe,
    emoji,
    ts,
    reactorJid: outerReactorJid,
  };
}

function extractMessage(message: Record<string, unknown> | undefined): ExtractedMessage {
  if (!message) {
    return { body: null, mediaType: "unknown", mediaUrl: null, mediaMimeType: null };
  }
  const conv = message["conversation"];
  if (typeof conv === "string" && conv) {
    return { body: conv, mediaType: "text", mediaUrl: null, mediaMimeType: null };
  }
  const ext = message["extendedTextMessage"] as { text?: string } | undefined;
  if (ext?.text) {
    return { body: ext.text, mediaType: "text", mediaUrl: null, mediaMimeType: null };
  }
  const image = message["imageMessage"] as
    | { caption?: string; url?: string; mimetype?: string }
    | undefined;
  if (image) {
    return {
      body: image.caption ?? null,
      mediaType: "image",
      mediaUrl: image.url ?? null,
      mediaMimeType: image.mimetype ?? null,
    };
  }
  const audio = message["audioMessage"] as
    | { url?: string; mimetype?: string }
    | undefined;
  if (audio) {
    return {
      body: null,
      mediaType: "audio",
      mediaUrl: audio.url ?? null,
      mediaMimeType: audio.mimetype ?? null,
    };
  }
  const doc = message["documentMessage"] as
    | { caption?: string; url?: string; mimetype?: string; fileName?: string }
    | undefined;
  if (doc) {
    return {
      body: doc.caption ?? doc.fileName ?? null,
      mediaType: "document",
      mediaUrl: doc.url ?? null,
      mediaMimeType: doc.mimetype ?? null,
    };
  }
  const sticker = message["stickerMessage"] as
    | { url?: string; mimetype?: string }
    | undefined;
  if (sticker) {
    return {
      body: null,
      mediaType: "sticker",
      mediaUrl: sticker.url ?? null,
      mediaMimeType: sticker.mimetype ?? null,
    };
  }
  const video = message["videoMessage"] as
    | { caption?: string; url?: string; mimetype?: string }
    | undefined;
  if (video) {
    return {
      body: video.caption ?? null,
      mediaType: "video",
      mediaUrl: video.url ?? null,
      mediaMimeType: video.mimetype ?? null,
    };
  }
  return { body: null, mediaType: "unknown", mediaUrl: null, mediaMimeType: null };
}

function mapStatus(raw: string | undefined): WhatsAppMessageStatus | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes("read")) return "read";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("server_ack") || s === "sent") return "sent";
  if (s.includes("error") || s.includes("fail")) return "failed";
  return null;
}

interface InstanceRow {
  id: string;
  company_id: string;
  evolution_token: string | null;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { instance: instanceName } = await params;
  const expectedApiKey = process.env.EVOLUTION_API_KEY;

  let body: WebhookPayload;
  try {
    body = (await req.json()) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Valida apikey: aceita header global OU corpo (instance token)
  const headerApiKey = req.headers.get("apikey");
  const bodyApiKey = body.apikey;

  // Log de diagnostico: serve para confirmar que a Evolution efetivamente
  // chamou o endpoint, independente de a validacao de apikey passar.
  // Util quando o polling a Evolution esta funcionando mas o webhook nao —
  // sintoma classico de EVOLUTION_WEBHOOK_BASE_URL inalcancavel a partir
  // do servidor da Evolution (ex: localhost em dev sem tunnel).
  console.info("[webhook] received", {
    instance: instanceName,
    event: body.event ?? "(sem event)",
    hasHeaderApiKey: Boolean(headerApiKey),
    hasBodyApiKey: Boolean(bodyApiKey),
  });

  const supabaseAdmin = createAdminClient();
  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, company_id, evolution_token")
    .ilike("instance_name", instanceName)
    .maybeSingle();
  const instanceRow = instance as InstanceRow | null;

  if (!instanceRow) {
    return NextResponse.json({ ok: true, ignored: "unknown instance" });
  }

  const tokensValid =
    (expectedApiKey && (headerApiKey === expectedApiKey || bodyApiKey === expectedApiKey)) ||
    (instanceRow.evolution_token &&
      (headerApiKey === instanceRow.evolution_token ||
        bodyApiKey === instanceRow.evolution_token));

  if (!tokensValid) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const event = normalizeEvent(body.event);
  const data = body.data;

  if (!event) {
    return NextResponse.json({ ok: true, ignored: "no event" });
  }

  // Connection update
  if (event.startsWith("connection.update") && data) {
    const state = data.state ?? data.status;
    const mapped =
      state === "open"
        ? "connected"
        : state === "connecting"
          ? "connecting"
          : "disconnected";
    const phoneFromOwner = data.ownerJid ? jidToPhone(data.ownerJid) : null;
    await supabaseAdmin
      .from("whatsapp_instances")
      .update({
        status: mapped,
        phone_number: phoneFromOwner ?? null,
        connected_at:
          mapped === "connected" ? new Date().toISOString() : null,
      })
      .eq("id", instanceRow.id);
    return NextResponse.json({ ok: true });
  }

  if ((event.startsWith("messages.upsert") || event.startsWith("messages.update")) && data?.key) {
    const rawRemoteJid = data.key.remoteJid;
    const evoMsgId = data.key.id ?? null;
    const fromMe = Boolean(data.key.fromMe);
    if (!rawRemoteJid) {
      return NextResponse.json({ ok: true });
    }
    // Normaliza @lid -> @s.whatsapp.net via remoteJidAlt quando a Evolution
    // entrega. Mantem o historico unificado com o que ja existia em
    // `whatsapp_chats.remote_jid`. Sem alt, mantemos o proprio @lid.
    const remoteJid =
      canonicalRemoteJid(rawRemoteJid, data.key.remoteJidAlt) ?? rawRemoteJid;
    if (!isIndividualJid(remoteJid)) {
      // ignora grupos (`@g.us`) e outros formatos nao-individuais
      return NextResponse.json({ ok: true, ignored: "non-individual" });
    }

    // Achar/criar chat. WhatsApp BR pode entregar a mesma conversa em duas
    // formas (com e sem o nono digito); tratamos os dois JIDs como o mesmo
    // contato para nao duplicar o chat na lista.
    let chatId: string | null = null;
    {
      const candidateJids = [remoteJid];
      const sibling = siblingJid(remoteJid);
      if (sibling && sibling !== remoteJid) candidateJids.push(sibling);

      const { data: existingChats } = await supabaseAdmin
        .from("whatsapp_chats")
        .select("id, remote_jid")
        .eq("company_id", instanceRow.company_id)
        .in("remote_jid", candidateJids);

      const existingList =
        (existingChats as { id: string; remote_jid: string }[] | null) ?? [];
      // Prefere o registro cujo JID bate exatamente; se so existir o irmao,
      // usa-o (nao reescrevemos o remote_jid: a conversa continua referindo
      // o numero como o WhatsApp originalmente entregou daquele lado).
      const exact = existingList.find((c) => c.remote_jid === remoteJid);
      const sibling_match = existingList.find(
        (c) => c.remote_jid !== remoteJid
      );
      const matched = exact ?? sibling_match ?? null;

      if (matched) {
        chatId = matched.id;
      } else {
        const name = data.contact?.name ?? data.pushName ?? null;
        const { data: createdChat } = await supabaseAdmin
          .from("whatsapp_chats")
          .insert({
            company_id: instanceRow.company_id,
            instance_id: instanceRow.id,
            remote_jid: remoteJid,
            name,
            profile_picture_url: data.profilePicUrl ?? null,
          })
          .select("id")
          .single();
        chatId = (createdChat as { id: string } | null)?.id ?? null;
      }
    }

    if (!chatId) {
      return NextResponse.json({ ok: true });
    }

    if (event.startsWith("messages.update")) {
      const status = mapStatus(data.status);
      if (status && evoMsgId) {
        await supabaseAdmin
          .from("whatsapp_messages")
          .update({ status })
          .eq("company_id", instanceRow.company_id)
          .eq("evolution_message_id", evoMsgId);
      }
      return NextResponse.json({ ok: true });
    }

    // messages.upsert

    // === Reacao (reactionMessage) ===
    // Reactions chegam como uma "mensagem" no payload do Evolution mas nao
    // devem virar uma linha nova em whatsapp_messages — viram update do array
    // `reactions` da mensagem alvo. Sem este tratamento, o webhook caia no
    // fluxo generico e gravava uma bolha vazia `[unknown]` no chat.
    const reaction = extractReaction(data.message, remoteJid);
    if (reaction) {
      const { data: targetMsg } = await supabaseAdmin
        .from("whatsapp_messages")
        .select("id, reactions")
        .eq("company_id", instanceRow.company_id)
        .eq("evolution_message_id", reaction.targetEvolutionMessageId)
        .maybeSingle();
      const targetRow =
        (targetMsg as { id: string; reactions: unknown } | null) ?? null;
      if (!targetRow) {
        // Mensagem original ainda nao foi gravada no banco — pode acontecer
        // se a reacao chegar antes da mensagem (race) ou se a mensagem e
        // muito antiga e nunca foi sincronizada. Best-effort: ignora.
        return NextResponse.json({ ok: true, ignored: "reaction_target_missing" });
      }
      const current = normalizeReactions(targetRow.reactions);
      const merged = mergeReactions(current, {
        emoji: reaction.emoji,
        from_me: fromMe,
        reactor_jid: reaction.reactorJid,
        ts: reaction.ts,
      });
      await supabaseAdmin
        .from("whatsapp_messages")
        .update({ reactions: merged })
        .eq("id", targetRow.id);
      return NextResponse.json({ ok: true, reaction: true });
    }

    const extracted = extractMessage(data.message);
    const quoted = extractQuoted(data.message, remoteJid, data.contextInfo);
    const ts = data.messageTimestamp;
    const tsIso =
      typeof ts === "number"
        ? new Date(ts * 1000).toISOString()
        : typeof ts === "string"
          ? new Date(Number(ts) * 1000).toISOString()
          : new Date().toISOString();

    // Mensagens nao mapeadas (protocolMessage, locationMessage, contactMessage,
    // etc) caem em `unknown` + body null no extractMessage. Antes essas linhas
    // viravam bolhas '[unknown]' inuteis no chat. Como nenhuma carrega texto
    // que o operador possa ler, ignoramos: nao gravamos, nao atualizamos
    // last_message_at, nao incrementamos unread. Reactions ja foram tratadas
    // acima; chegamos aqui apenas para tipos sem renderizacao util.
    if (extracted.mediaType === "unknown" && !extracted.body) {
      return NextResponse.json({ ok: true, ignored: "unsupported_message_type" });
    }

    // Idempotencia: se ja existe mensagem com este evolution_message_id, ignora
    if (evoMsgId) {
      const { data: existingMsg } = await supabaseAdmin
        .from("whatsapp_messages")
        .select("id")
        .eq("company_id", instanceRow.company_id)
        .eq("evolution_message_id", evoMsgId)
        .maybeSingle();
      if (existingMsg) {
        return NextResponse.json({ ok: true, idempotent: true });
      }
    }

    await supabaseAdmin.from("whatsapp_messages").insert({
      company_id: instanceRow.company_id,
      chat_id: chatId,
      evolution_message_id: evoMsgId,
      direction: fromMe ? "out" : "in",
      from_me: fromMe,
      body: extracted.body,
      media_type: extracted.mediaType,
      media_url: extracted.mediaUrl,
      media_mime_type: extracted.mediaMimeType,
      status: fromMe ? "sent" : "delivered",
      sent_at: fromMe ? tsIso : null,
      received_at: fromMe ? null : tsIso,
      // Forca created_at para o timestamp real da mensagem. Sem isso, mensagens
      // recebidas em rajada (p.ex. backlog ao reconectar) entram todas com
      // created_at = NOW() e a UI (que ordena por timestamp do evento) joga as
      // antigas para fora de ordem cronologica.
      created_at: tsIso,
      quoted_evolution_message_id: quoted.evolutionMessageId,
      quoted_body: quoted.body,
      quoted_from_me: quoted.fromMe,
    });

    const preview = extracted.body
      ? extracted.body.slice(0, 120)
      : extracted.mediaType === "image"
        ? "[imagem]"
        : extracted.mediaType === "audio"
          ? "[audio]"
          : extracted.mediaType === "document"
            ? "[documento]"
            : extracted.mediaType === "video"
              ? "[video]"
              : extracted.mediaType === "sticker"
                ? "[sticker]"
                : "[mensagem]";

    const { data: chatBefore } = await supabaseAdmin
      .from("whatsapp_chats")
      .select("unread_count, name")
      .eq("id", chatId)
      .single();
    const chatBeforeRow =
      (chatBefore as { unread_count: number; name: string | null } | null) ?? null;
    const newUnread = fromMe
      ? 0
      : (chatBeforeRow?.unread_count ?? 0) + 1;

    const updateChat: Record<string, unknown> = {
      last_message_at: tsIso,
      last_message_preview: preview,
      unread_count: newUnread,
    };
    if (!chatBeforeRow?.name && data.pushName) {
      updateChat.name = data.pushName;
    }
    await supabaseAdmin.from("whatsapp_chats").update(updateChat).eq("id", chatId);

    return NextResponse.json({ ok: true });
  }

  if (event.startsWith("chats.upsert") && data) {
    const rawRemoteJid = data.remoteJid ?? data.key?.remoteJid;
    if (!rawRemoteJid) return NextResponse.json({ ok: true });
    // Mesma normalizacao @lid -> @s.whatsapp.net usada nas mensagens; sem
    // isso, atualizacoes de nome/foto de contatos `@lid` nao chegariam ao
    // chat unificado armazenado pelo `@s.whatsapp.net` real.
    const remoteJid =
      canonicalRemoteJid(rawRemoteJid, data.key?.remoteJidAlt) ?? rawRemoteJid;
    if (!isIndividualJid(remoteJid)) {
      return NextResponse.json({ ok: true, ignored: "non-individual" });
    }
    const name = data.contact?.name ?? data.pushName ?? null;
    if (name || data.profilePicUrl) {
      await supabaseAdmin
        .from("whatsapp_chats")
        .update({
          ...(name ? { name } : {}),
          ...(data.profilePicUrl
            ? { profile_picture_url: data.profilePicUrl }
            : {}),
        })
        .eq("company_id", instanceRow.company_id)
        .eq("remote_jid", remoteJid);
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, ignored: event });
}
