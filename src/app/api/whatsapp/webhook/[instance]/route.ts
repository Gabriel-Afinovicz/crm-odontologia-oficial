import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jidToPhone } from "@/lib/evolution/phone";
import type {
  WhatsAppMessageMediaType,
  WhatsAppMessageStatus,
} from "@/lib/types/database";

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
    const remoteJid = data.key.remoteJid;
    const evoMsgId = data.key.id ?? null;
    const fromMe = Boolean(data.key.fromMe);
    if (!remoteJid) {
      return NextResponse.json({ ok: true });
    }
    if (!remoteJid.endsWith("@s.whatsapp.net") && !remoteJid.endsWith("@c.us")) {
      // ignora grupos por ora
      return NextResponse.json({ ok: true, ignored: "non-individual" });
    }

    // Achar/criar chat
    let chatId: string | null = null;
    {
      const { data: existingChat } = await supabaseAdmin
        .from("whatsapp_chats")
        .select("id")
        .eq("company_id", instanceRow.company_id)
        .eq("remote_jid", remoteJid)
        .maybeSingle();
      const existing = existingChat as { id: string } | null;
      if (existing) {
        chatId = existing.id;
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
    const extracted = extractMessage(data.message);
    const ts = data.messageTimestamp;
    const tsIso =
      typeof ts === "number"
        ? new Date(ts * 1000).toISOString()
        : typeof ts === "string"
          ? new Date(Number(ts) * 1000).toISOString()
          : new Date().toISOString();

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
    const remoteJid = data.remoteJid ?? data.key?.remoteJid;
    if (!remoteJid) return NextResponse.json({ ok: true });
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
