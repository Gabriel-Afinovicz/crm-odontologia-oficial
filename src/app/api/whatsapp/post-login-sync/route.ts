import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  evolution,
  EvolutionConfigError,
  type EvolutionChatItem,
  type EvolutionMessageRecord,
} from "@/lib/evolution/client";
import {
  canonicalRemoteJid,
  isIndividualJid,
} from "@/lib/evolution/phone";
import type {
  WhatsAppMessage,
  WhatsAppMessageMediaType,
  WhatsAppMessageStatus,
} from "@/lib/types/database";
import {
  mergeReactions,
  normalizeReactions,
} from "@/lib/whatsapp/reactions";

// Cooldown server-side. Multiplos operadores podem logar/recarregar quase ao
// mesmo tempo; sem isso a Evolution levaria varias rajadas iguais. 60s e
// curto o bastante para nao prejudicar o "abriu o sistema, ja sincronizou"
// e longo o bastante para absorver o cluster de logins simultaneos.
const COOLDOWN_MS = 60_000;

// Quantos chats mais recentes recebem pull de mensagens. Cobre o caso comum
// (operador retomar conversas das ultimas horas) sem virar rajada longa.
const TOP_CHATS_TO_REFRESH = 20;
// Mensagens por chat; suficiente para o operador ter contexto recente sem
// puxar historico antigo. /load-history continua disponivel sob demanda.
const MESSAGES_PER_CHAT = 20;
// Concorrencia para chamadas paralelas a Evolution. 5 distribui o tempo total
// (~2s para 20 chats) sem virar rajada que possa sinalizar o numero.
const EVOLUTION_CONCURRENCY = 5;

interface PostLoginSyncResponse {
  ok: boolean;
  skipped?: boolean;
  reason?: "not_connected" | "cooldown" | "no_instance";
  chatsTotal?: number;
  chatsInserted?: number;
  chatsUpdated?: number;
  messagesInserted?: number;
  messagesScanned?: number;
  topChatsRefreshed?: number;
  durationMs?: number;
  /** Para diagnostico em dev quando algumas chamadas a Evolution falharam. */
  errors?: string[];
}

interface InstanceRow {
  id: string;
  company_id: string;
  instance_name: string;
  status: "disconnected" | "connecting" | "connected";
  last_post_login_sync_at: string | null;
}

interface ExistingChatRow {
  id: string;
  remote_jid: string;
  name: string | null;
  profile_picture_url: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
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

// Mantida em paralelo com /webhook e /load-history. Extrair pra util compartilhado
// pediria refactor maior; o codigo e curto e estavel.
function extractMessage(
  message: Record<string, unknown> | null | undefined
): ExtractedMessage {
  if (!message) {
    return {
      body: null,
      mediaType: "unknown",
      mediaUrl: null,
      mediaMimeType: null,
    };
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
  return {
    body: null,
    mediaType: "unknown",
    mediaUrl: null,
    mediaMimeType: null,
  };
}

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
  emoji: string;
  ts: string;
  reactorJid: string | null;
}

// Mesma logica do webhook/load-history para detectar reactionMessage.
// Mantida em paralelo para manter os 3 caminhos auto-contidos.
function extractReaction(
  message: Record<string, unknown> | undefined | null,
  outerReactorJid: string | null
): ExtractedReaction | null {
  if (!message) return null;
  const reaction = message["reactionMessage"] as
    | {
        key?: { id?: string | null } | null;
        text?: string | null;
        senderTimestampMs?: number | string | null;
      }
    | undefined;
  if (!reaction || typeof reaction !== "object") return null;
  const targetId =
    typeof reaction.key?.id === "string" ? reaction.key.id : null;
  if (!targetId) return null;
  const emoji =
    typeof reaction.text === "string" ? reaction.text : "";
  let ts = new Date().toISOString();
  const rawTs = reaction.senderTimestampMs;
  if (rawTs != null) {
    const num = typeof rawTs === "number" ? rawTs : Number(rawTs);
    if (Number.isFinite(num) && num > 0) {
      const ms = num > 1e12 ? num : num * 1000;
      ts = new Date(ms).toISOString();
    }
  }
  return {
    targetEvolutionMessageId: targetId,
    emoji,
    ts,
    reactorJid: outerReactorJid,
  };
}

function mapStatus(raw: string | null | undefined): WhatsAppMessageStatus {
  if (!raw) return "delivered";
  const s = String(raw).toLowerCase();
  if (s.includes("read")) return "read";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("server_ack") || s === "sent") return "sent";
  if (s.includes("error") || s.includes("fail")) return "failed";
  return "delivered";
}

function tsToIso(ts: number | string | null | undefined): string {
  if (ts == null) return new Date().toISOString();
  const num = typeof ts === "number" ? ts : Number(ts);
  if (!Number.isFinite(num)) return new Date().toISOString();
  return new Date(num * 1000).toISOString();
}

// Roda fetchers em paralelo controlado. Mantem ordem do array original
// (resultado[i] corresponde a items[i]) — facilita correlacionar com chats.
async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, idx: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = next++;
          if (idx >= items.length) return;
          result[idx] = await worker(items[idx], idx);
        }
      })()
    );
  }
  await Promise.all(workers);
  return result;
}

export async function POST(req: NextRequest): Promise<NextResponse<PostLoginSyncResponse>> {
  const started = Date.now();
  try {
    return await handle(req, started);
  } catch (err) {
    console.error("[post-login-sync] uncaught:", err);
    return NextResponse.json(
      { ok: false, durationMs: Date.now() - started },
      { status: 500 }
    );
  }
}

async function handle(
  _req: NextRequest,
  started: number
): Promise<NextResponse<PostLoginSyncResponse>> {
  if (!evolution.isConfigured()) {
    return NextResponse.json(
      { ok: false, skipped: true, reason: "not_connected" },
      { status: 503 }
    );
  }

  // Auth: qualquer usuario do tenant pode disparar (e nao apenas admin).
  // O dispatcher fica no client e roda automaticamente apos login.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id, company_id")
    .eq("auth_id", user.id)
    .single();
  const profileRow = profile as { id: string; company_id: string } | null;
  if (!profileRow) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const companyId = profileRow.company_id;

  const { data: instanceData } = await supabaseAdmin
    .from("whatsapp_instances")
    .select(
      "id, company_id, instance_name, status, last_post_login_sync_at"
    )
    .eq("company_id", companyId)
    .maybeSingle();
  const instanceRow = instanceData as InstanceRow | null;

  if (!instanceRow) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "no_instance",
      durationMs: Date.now() - started,
    });
  }
  if (instanceRow.status !== "connected") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "not_connected",
      durationMs: Date.now() - started,
    });
  }

  // Cooldown: evita que multiplos operadores logando ao mesmo tempo (ou
  // refresh seguidos) gerem rajadas de chamadas a Evolution. Marcamos o
  // timestamp ANTES do trabalho — assim requests paralelas com a mesma
  // company veem o novo timestamp e saem com skipped=cooldown.
  if (instanceRow.last_post_login_sync_at) {
    const lastMs = Date.parse(instanceRow.last_post_login_sync_at);
    if (Number.isFinite(lastMs) && Date.now() - lastMs < COOLDOWN_MS) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "cooldown",
        durationMs: Date.now() - started,
      });
    }
  }

  await supabaseAdmin
    .from("whatsapp_instances")
    .update({ last_post_login_sync_at: new Date().toISOString() })
    .eq("id", instanceRow.id);

  const errors: string[] = [];

  // === 1) Atualiza chats (lightweight) ===
  let evoChats: EvolutionChatItem[] = [];
  try {
    evoChats = await evolution.findChats(instanceRow.instance_name);
  } catch (err) {
    if (err instanceof EvolutionConfigError) {
      return NextResponse.json(
        { ok: false, skipped: true, reason: "not_connected" },
        { status: 503 }
      );
    }
    const m = err instanceof Error ? err.message : "Erro desconhecido";
    errors.push(`findChats: ${m}`);
    console.error("[post-login-sync] findChats failed:", err);
    // Sem chats, nao adianta seguir.
    return NextResponse.json({
      ok: false,
      durationMs: Date.now() - started,
      errors,
    });
  }

  // Normaliza @lid -> @s.whatsapp.net via lastMessage.key.remoteJidAlt antes
  // de prosseguir. Mesmo caminho de /instance/sync e do webhook: preserva o
  // historico unificado quando o WhatsApp expoe o telefone real do contato
  // como `remoteJidAlt`. Sem alt o chat segue como `@lid` mesmo.
  const individualChats = evoChats
    .filter((c): c is typeof c & { remoteJid: string } =>
      typeof c.remoteJid === "string"
    )
    .map((c) => {
      const altFromLast = c.lastMessage?.key?.remoteJidAlt ?? null;
      const canonical = canonicalRemoteJid(c.remoteJid, altFromLast);
      return canonical && canonical !== c.remoteJid
        ? { ...c, remoteJid: canonical }
        : c;
    })
    .filter((c) => isIndividualJid(c.remoteJid));

  // Chats existentes da company para distinguir insert de update.
  const { data: existingChatsData } = await supabaseAdmin
    .from("whatsapp_chats")
    .select(
      "id, remote_jid, name, profile_picture_url, last_message_at, last_message_preview, unread_count"
    )
    .eq("company_id", companyId);
  const existingChats =
    (existingChatsData as ExistingChatRow[] | null) ?? [];
  const existingByJid = new Map<string, ExistingChatRow>();
  for (const c of existingChats) {
    existingByJid.set(c.remote_jid, c);
  }

  let chatsInserted = 0;
  let chatsUpdated = 0;
  const toInsertChats: Record<string, unknown>[] = [];
  // Para cada chat individual conhecido, decide: insert (novo) ou update
  // (mudou alguma coisa de relevancia). Nao chamamos whatsappNumbers aqui
  // de proposito: e custoso e o /instance/sync manual ja faz esse passo
  // pesado quando o admin pede.
  for (const c of individualChats) {
    const lastTs = c.lastMessage?.messageTimestamp;
    const lastMsgAt =
      lastTs != null
        ? new Date(
            typeof lastTs === "number"
              ? lastTs * 1000
              : Number(lastTs) * 1000
          ).toISOString()
        : c.updatedAt
          ? new Date(c.updatedAt).toISOString()
          : null;
    const lastConv =
      (c.lastMessage?.message as { conversation?: string } | undefined)
        ?.conversation ?? null;
    const preview = lastConv ? lastConv.slice(0, 120) : null;
    const resolvedName = c.pushName ?? c.name ?? null;

    const existing = existingByJid.get(c.remoteJid);
    if (existing) {
      const updates: Record<string, unknown> = {};
      if (resolvedName && resolvedName !== existing.name) {
        updates.name = resolvedName;
      }
      if (
        c.profilePicUrl &&
        c.profilePicUrl !== existing.profile_picture_url
      ) {
        updates.profile_picture_url = c.profilePicUrl;
      }
      // Avanca last_message_at/preview apenas se a Evolution conhece um
      // timestamp mais novo do que o nosso. Sem isso poderiamos sobrescrever
      // valores frescos vindos do webhook por payload "atrasado" do findChats.
      if (
        lastMsgAt &&
        (!existing.last_message_at || lastMsgAt > existing.last_message_at)
      ) {
        updates.last_message_at = lastMsgAt;
        if (preview) updates.last_message_preview = preview;
      }
      if (Object.keys(updates).length > 0) {
        const { error } = await supabaseAdmin
          .from("whatsapp_chats")
          .update(updates)
          .eq("id", existing.id);
        if (!error) {
          chatsUpdated++;
          // Reflete no map em memoria pra reusar na fase de mensagens.
          Object.assign(existing, updates);
        }
      }
    } else {
      toInsertChats.push({
        company_id: companyId,
        instance_id: instanceRow.id,
        remote_jid: c.remoteJid,
        name: resolvedName,
        profile_picture_url: c.profilePicUrl ?? null,
        last_message_at: lastMsgAt,
        last_message_preview: preview,
        unread_count: c.unreadCount ?? 0,
      });
    }
  }

  if (toInsertChats.length > 0) {
    const { data: insertedRows, error: insertErr } = await supabaseAdmin
      .from("whatsapp_chats")
      .insert(toInsertChats)
      .select(
        "id, remote_jid, name, profile_picture_url, last_message_at, last_message_preview, unread_count"
      );
    if (insertErr) {
      errors.push(`insertChats: ${insertErr.message}`);
      console.error("[post-login-sync] insert chats failed:", insertErr);
    } else if (insertedRows) {
      const inserted = insertedRows as ExistingChatRow[];
      for (const c of inserted) {
        existingByJid.set(c.remote_jid, c);
      }
      chatsInserted = inserted.length;
    }
  }

  // === 2) Pull de mensagens dos top N chats por last_message_at ===
  // Reusa o mapa em memoria atualizado, garantindo que chats novos do passo
  // 1 tambem entrem no top N quando aplicavel (ex: primeira sync). Inclui
  // `@lid` para nao deixar contatos no formato novo de fora do refresh.
  const allChatRows = Array.from(existingByJid.values()).filter((c) =>
    isIndividualJid(c.remote_jid)
  );
  allChatRows.sort((a, b) => {
    const at = a.last_message_at;
    const bt = b.last_message_at;
    if (!at && !bt) return 0;
    if (!at) return 1;
    if (!bt) return -1;
    return bt.localeCompare(at);
  });
  const topChats = allChatRows.slice(0, TOP_CHATS_TO_REFRESH);

  type ChatFetch = {
    chat: ExistingChatRow;
    records: EvolutionMessageRecord[];
  };

  const fetched = await runWithConcurrency<ExistingChatRow, ChatFetch>(
    topChats,
    async (chat) => {
      try {
        const records = await evolution.findMessages(
          instanceRow.instance_name,
          chat.remote_jid,
          MESSAGES_PER_CHAT
        );
        return { chat, records };
      } catch (err) {
        const m = err instanceof Error ? err.message : "Erro desconhecido";
        errors.push(`findMessages(${chat.remote_jid}): ${m}`);
        return { chat, records: [] };
      }
    },
    EVOLUTION_CONCURRENCY
  );

  // Agrega TODOS os ids candidatos para um unico select de "ja existe" — em
  // vez de N queries (uma por chat). Ganho real de latencia em redes lentas.
  const allEvoIds: string[] = [];
  for (const f of fetched) {
    for (const r of f.records) {
      const id = r.key?.id ?? r.id ?? null;
      if (typeof id === "string" && id.length > 0) {
        allEvoIds.push(id);
      }
    }
  }

  let existingIds = new Set<string>();
  if (allEvoIds.length > 0) {
    // Limita a query ao que vai entrar na constraint (company_id, evolution_message_id)
    // — bate com o que o banco realmente impede.
    const { data: existingMsgs, error: selectErr } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("evolution_message_id")
      .eq("company_id", companyId)
      .in("evolution_message_id", allEvoIds);
    if (selectErr) {
      console.error("[post-login-sync] select existing messages failed:", selectErr);
      errors.push(`selectExisting: ${selectErr.message}`);
    } else {
      existingIds = new Set(
        ((existingMsgs as { evolution_message_id: string | null }[] | null) ?? [])
          .map((m) => m.evolution_message_id)
          .filter((id): id is string => Boolean(id))
      );
    }
  }

  // Para cada chat: monta linhas a inserir e calcula a update do chat
  // (last_message_at/preview/unread_count) com a mesma logica do load-history.
  const messagesToInsert: Record<string, unknown>[] = [];
  const chatUpdates: {
    chatId: string;
    latestTs: string;
    latestPreview: string;
    latestFromMe: boolean;
    newIncomingCount: number;
    currentLastTs: string | null;
    currentUnread: number;
  }[] = [];
  let messagesScanned = 0;
  // Reactions agregadas globalmente por target. evolution_message_id e unico
  // por company; aplicamos em batch apos o INSERT das mensagens novas.
  type ReactionEvent = {
    from_me: boolean;
    reactor_jid: string | null;
    emoji: string;
    ts: string;
  };
  const reactionsByTarget = new Map<string, ReactionEvent[]>();

  for (const f of fetched) {
    let latestTs: string | null = null;
    let latestPreview: string | null = null;
    let latestFromMe = false;
    let newIncomingCount = 0;
    for (const r of f.records) {
      messagesScanned++;
      const evoId = r.key?.id ?? r.id ?? null;
      if (!evoId || existingIds.has(evoId)) continue;
      const fromMe = Boolean(r.key?.fromMe);

      // Reacao: agrega para UPDATE em batch depois; nao gera linha.
      const reaction = extractReaction(
        r.message ?? undefined,
        f.chat.remote_jid
      );
      if (reaction) {
        const list =
          reactionsByTarget.get(reaction.targetEvolutionMessageId) ?? [];
        list.push({
          from_me: fromMe,
          reactor_jid: reaction.reactorJid,
          emoji: reaction.emoji,
          ts: reaction.ts,
        });
        reactionsByTarget.set(reaction.targetEvolutionMessageId, list);
        continue;
      }

      const extracted = extractMessage(r.message ?? undefined);
      // Mensagens nao mapeadas (protocolMessage/location/contact): pulamos,
      // ja que viram bolha vazia '[unknown]' inutil no chat.
      if (extracted.mediaType === "unknown" && !extracted.body) continue;

      const quoted = extractQuoted(
        r.message ?? undefined,
        f.chat.remote_jid,
        r.contextInfo
      );
      const ts = tsToIso(r.messageTimestamp);
      messagesToInsert.push({
        company_id: companyId,
        chat_id: f.chat.id,
        evolution_message_id: evoId,
        direction: fromMe ? "out" : "in",
        from_me: fromMe,
        body: extracted.body,
        media_type: extracted.mediaType,
        media_url: extracted.mediaUrl,
        media_mime_type: extracted.mediaMimeType,
        status: fromMe ? mapStatus(r.status) : "delivered",
        sent_at: fromMe ? ts : null,
        received_at: fromMe ? null : ts,
        // Forca created_at para o timestamp real do evento — caso contrario
        // a UI (ordena por timestamp do evento, mas o select inicial filtra
        // por created_at em alguns lugares) bagunca a ordem cronologica.
        created_at: ts,
        quoted_evolution_message_id: quoted.evolutionMessageId,
        quoted_body: quoted.body,
        quoted_from_me: quoted.fromMe,
      });

      if (!fromMe) newIncomingCount += 1;
      if (!latestTs || ts > latestTs) {
        latestTs = ts;
        latestPreview = extracted.body
          ? extracted.body.slice(0, 120)
          : `[${extracted.mediaType}]`;
        latestFromMe = fromMe;
      }
    }
    if (latestTs && latestPreview != null) {
      chatUpdates.push({
        chatId: f.chat.id,
        latestTs,
        latestPreview,
        latestFromMe,
        newIncomingCount,
        currentLastTs: f.chat.last_message_at,
        currentUnread: f.chat.unread_count ?? 0,
      });
    }
  }

  let messagesInserted = 0;
  if (messagesToInsert.length > 0) {
    const { error: insertErr } = await supabaseAdmin
      .from("whatsapp_messages")
      .insert(messagesToInsert);
    if (!insertErr) {
      messagesInserted = messagesToInsert.length;
    } else if (insertErr.code === "23505") {
      // Race com webhook entre nosso select e o insert: cai pro modo
      // linha-a-linha ignorando duplicatas individuais. Outros erros
      // sao reportados em errors[] mas nao quebram o sync inteiro.
      console.warn(
        "[post-login-sync] batch insert hit 23505, falling back to per-row"
      );
      for (const m of messagesToInsert) {
        const { error } = await supabaseAdmin
          .from("whatsapp_messages")
          .insert(m);
        if (!error) {
          messagesInserted++;
        } else if (error.code !== "23505") {
          errors.push(`insertMsg: ${error.message}`);
        }
      }
    } else {
      console.error("[post-login-sync] bulk insert failed:", insertErr);
      errors.push(`insertBulk: ${insertErr.message}`);
    }
  }

  // Reactions agregadas: UPDATE em batch nas mensagens-alvo afetadas.
  if (reactionsByTarget.size > 0) {
    const targetIds = Array.from(reactionsByTarget.keys());
    const { data: targets } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, evolution_message_id, reactions")
      .eq("company_id", companyId)
      .in("evolution_message_id", targetIds);
    const targetRows =
      (targets as
        | Pick<WhatsAppMessage, "id" | "evolution_message_id" | "reactions">[]
        | null) ?? [];
    await Promise.all(
      targetRows.map((row) => {
        const incoming =
          reactionsByTarget.get(row.evolution_message_id ?? "") ?? [];
        if (incoming.length === 0) return Promise.resolve();
        incoming.sort((a, b) => (a.ts < b.ts ? -1 : 1));
        let merged = normalizeReactions(row.reactions);
        for (const ev of incoming) {
          merged = mergeReactions(merged, ev);
        }
        return supabaseAdmin
          .from("whatsapp_messages")
          .update({ reactions: merged })
          .eq("id", row.id)
          .then(() => undefined);
      })
    );
  }

  // Atualiza chats afetados em paralelo: cada update e independente.
  // Mantem a mesma logica de unread_count do load-history (zera se ultima
  // mensagem do batch e from_me; soma IN novas ao contador atual caso contrario).
  await Promise.all(
    chatUpdates
      .filter(
        (u) => !u.currentLastTs || u.latestTs > u.currentLastTs
      )
      .map((u) => {
        const newUnread = u.latestFromMe
          ? 0
          : u.currentUnread + u.newIncomingCount;
        return supabaseAdmin
          .from("whatsapp_chats")
          .update({
            last_message_at: u.latestTs,
            last_message_preview: u.latestPreview,
            unread_count: newUnread,
          })
          .eq("id", u.chatId);
      })
  );

  return NextResponse.json({
    ok: true,
    chatsTotal: individualChats.length,
    chatsInserted,
    chatsUpdated,
    messagesInserted,
    messagesScanned,
    topChatsRefreshed: topChats.length,
    durationMs: Date.now() - started,
    errors: errors.length > 0 ? errors : undefined,
  });
}
