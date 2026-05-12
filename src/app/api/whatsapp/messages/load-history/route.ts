import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  evolution,
  EvolutionConfigError,
  type EvolutionMessageRecord,
} from "@/lib/evolution/client";
import type {
  WhatsAppMessage,
  WhatsAppMessageMediaType,
  WhatsAppMessageStatus,
} from "@/lib/types/database";
import {
  mergeReactions,
  normalizeReactions,
} from "@/lib/whatsapp/reactions";

interface LoadHistoryPayload {
  chatId?: string;
  /** Quantidade de mensagens a buscar; default 30, hard cap 50 anti-rajada. */
  limit?: number;
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
}

interface ExtractedMessage {
  body: string | null;
  mediaType: WhatsAppMessageMediaType;
  mediaUrl: string | null;
  mediaMimeType: string | null;
}

// Mesma logica do webhook: extrai body/midia de variantes do Baileys.
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

interface ExtractedQuote {
  evolutionMessageId: string | null;
  body: string | null;
  fromMe: boolean | null;
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

// Mesma logica do webhook: o contextInfo do reply pode aparecer top-level
// no record (mensagens `conversation`, formato comum em chats `@lid`) ou
// dentro de cada sub-objeto de `message` (extendedTextMessage etc, formato
// classico para midia/texto longo). Mantida em paralelo com o webhook de
// proposito — extrair pra util compartilhado pediria refactor maior e os
// codigos sao curtos e estaveis.
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

// Detecta reactionMessage no record da Evolution. Estrutura igual ao webhook;
// duplicada em paralelo aqui para manter os 3 caminhos (webhook, load-history,
// post-login-sync) auto-contidos. Veja webhook/[instance]/route.ts para os
// detalhes do payload.
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

export async function POST(req: NextRequest) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[load-history] uncaught:", err);
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json(
      { error: `Falha interna ao carregar historico: ${message}` },
      { status: 500 }
    );
  }
}

async function handlePost(req: NextRequest) {
  if (!evolution.isConfigured()) {
    return NextResponse.json(
      { error: "Evolution API nao configurada no servidor." },
      { status: 503 }
    );
  }

  let body: LoadHistoryPayload;
  try {
    body = (await req.json()) as LoadHistoryPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const chatId = body.chatId?.trim();
  if (!chatId) {
    return NextResponse.json(
      { error: "chatId obrigatorio." },
      { status: 400 }
    );
  }

  // Hard cap em 50 para nao virar gatilho de rajada se o frontend for alterado
  // por engano. Default 30 conforme requisito do produto.
  const requested = Math.max(1, Math.min(50, body.limit ?? 30));

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

  const supabaseAdmin = createAdminClient();
  const companyId = profileRow.company_id;

  const { data: chatData } = await supabaseAdmin
    .from("whatsapp_chats")
    .select("id, company_id, instance_id, remote_jid")
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

  let records: EvolutionMessageRecord[];
  try {
    records = await evolution.findMessages(
      instanceRow.instance_name,
      chatRow.remote_jid,
      requested
    );
  } catch (err) {
    if (err instanceof EvolutionConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("[load-history] evolution.findMessages failed:", {
      instance: instanceRow.instance_name,
      remoteJid: chatRow.remote_jid,
      error: err,
    });
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    const payload =
      err && typeof err === "object" && "payload" in err
        ? (err as { payload?: unknown }).payload
        : undefined;
    return NextResponse.json(
      {
        error: `Falha ao buscar historico: ${message}`,
        evolutionPayload: payload ?? null,
      },
      { status: 502 }
    );
  }

  // === Fallback @lid ===
  // Quando o chat esta no formato classico (`@s.whatsapp.net`/`@c.us`), parte
  // do historico recente pode estar armazenada pela Evolution num JID `@lid`
  // correspondente — quando o WhatsApp passou a usar o modo de privacidade
  // para esse contato. O `findMessages` no JID classico nao retorna essas
  // mensagens (Evolution filtra por remoteJid exato). Resolvemos cruzando
  // com o cache local de chats: procuramos um item `@lid` cujo
  // `lastMessage.key.remoteJidAlt` aponta para o nosso chat e fazemos um
  // segundo `findMessages` ali. E dado de cache local — zero impacto em
  // banimento. Dedup acontece pelo select de existing logo abaixo.
  const isClassicJid =
    chatRow.remote_jid.endsWith("@s.whatsapp.net") ||
    chatRow.remote_jid.endsWith("@c.us");
  let lidJidUsed: string | null = null;
  if (isClassicJid) {
    try {
      const cachedChats = await evolution.findChats(instanceRow.instance_name);
      const matchingLid = cachedChats.find((ec) => {
        if (typeof ec.remoteJid !== "string" || !ec.remoteJid.endsWith("@lid")) {
          return false;
        }
        return ec.lastMessage?.key?.remoteJidAlt === chatRow.remote_jid;
      });
      if (matchingLid?.remoteJid) {
        lidJidUsed = matchingLid.remoteJid;
        const lidRecords = await evolution.findMessages(
          instanceRow.instance_name,
          matchingLid.remoteJid,
          requested
        );
        if (lidRecords.length > 0) {
          records = [...records, ...lidRecords];
        }
      }
    } catch (err) {
      // Best-effort: nao quebra o refresh principal se o fallback falhar.
      console.warn("[load-history] @lid fallback failed:", {
        remoteJid: chatRow.remote_jid,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  // Calcula o range de timestamps retornados para diagnostico. Se o range
  // estiver "congelado" entre chamadas (mesmo newest_ts), e sinal de que
  // o cache local Baileys da Evolution nao esta recebendo mensagens novas
  // — situacao tipica quando o webhook nao esta sendo entregue ao app.
  let oldestTs: string | null = null;
  let newestTs: string | null = null;
  for (const r of records) {
    const ts = tsToIso(r.messageTimestamp);
    if (!oldestTs || ts < oldestTs) oldestTs = ts;
    if (!newestTs || ts > newestTs) newestTs = ts;
  }

  console.info("[load-history] records fetched:", {
    instance: instanceRow.instance_name,
    remoteJid: chatRow.remote_jid,
    count: records.length,
    oldest_ts: oldestTs,
    newest_ts: newestTs,
    lid_fallback: lidJidUsed,
  });

  if (records.length === 0) {
    return NextResponse.json({ loaded: 0, total: 0 });
  }

  // Para idempotencia: verificar quais evolution_message_id ja existem no
  // banco e inserir apenas os novos. Evita duplicacao caso o usuario clique
  // varias vezes ou o webhook ja tenha entregue alguma das mensagens.
  const evoIds = records
    .map((r) => r.key?.id ?? r.id ?? null)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  // A constraint unica do banco e (company_id, evolution_message_id) — nao
  // inclui chat_id. Filtrar por chat aqui faria com que mensagens ja
  // entregues pelo webhook em outro contexto fossem ignoradas e o INSERT
  // em lote falhasse com 23505. Filtramos apenas pelos dois campos da
  // constraint para casar com o que o banco realmente impede.
  let existingIds = new Set<string>();
  if (evoIds.length > 0) {
    const { data: existing, error: selectErr } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("evolution_message_id")
      .eq("company_id", companyId)
      .in("evolution_message_id", evoIds);
    if (selectErr) {
      console.error("[load-history] select existing failed:", selectErr);
    }
    existingIds = new Set(
      ((existing as { evolution_message_id: string | null }[] | null) ?? [])
        .map((m) => m.evolution_message_id)
        .filter((id): id is string => Boolean(id))
    );
  }

  const toInsert: Record<string, unknown>[] = [];
  // Acompanha a mensagem mais recente do batch para atualizar o chat depois.
  let latestTs: string | null = null;
  let latestPreview: string | null = null;
  let latestFromMe = false;
  // Conta apenas mensagens NOVAS (nao-existentes) e IN para o badge de
  // nao-lidas. Mensagens que ja estavam no banco entraram pelo webhook
  // anteriormente e ja contabilizaram (ou nao) no unread_count daquela vez.
  let newIncomingCount = 0;
  // Reactions agregadas por mensagem alvo (evolution_message_id da original).
  // Aplicadas em batch APOS o INSERT das mensagens novas — necessario porque
  // o records pode trazer a mensagem alvo + a reacao no mesmo lote (chat
  // que migrou para `@lid`, primeira sync etc.).
  type ReactionEvent = {
    from_me: boolean;
    reactor_jid: string | null;
    emoji: string;
    ts: string;
  };
  const reactionsByTarget = new Map<string, ReactionEvent[]>();

  for (const r of records) {
    const evoId = r.key?.id ?? r.id ?? null;
    if (!evoId || existingIds.has(evoId)) continue;
    const fromMe = Boolean(r.key?.fromMe);

    // Reacao: nao gera linha nova; agrega para UPDATE em batch depois.
    const reaction = extractReaction(r.message ?? undefined, chatRow.remote_jid);
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
    // Mensagens nao mapeadas (protocolMessage, locationMessage, contactMessage,
    // etc) caem em unknown+body null no extractMessage. Antes essas linhas
    // viravam bolhas vazias `[unknown]` no chat. Como nenhuma carrega texto
    // que o operador possa ler, pulamos no historico tambem.
    if (extracted.mediaType === "unknown" && !extracted.body) continue;

    const quoted = extractQuoted(
      r.message ?? undefined,
      chatRow.remote_jid,
      r.contextInfo
    );
    const ts = tsToIso(r.messageTimestamp);
    toInsert.push({
      company_id: companyId,
      chat_id: chatRow.id,
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
      // Forca created_at para o timestamp real da mensagem. Sem isso, todas
      // as 50 mensagens do historico viriam com created_at = NOW(), e a UI
      // (que ordena por created_at ASC) as exibiria todas amontoadas no
      // final, fora da ordem cronologica real.
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

  console.info("[load-history] preparing insert:", {
    candidates: records.length,
    alreadyExisting: existingIds.size,
    toInsertCount: toInsert.length,
    sample: toInsert[0] ?? null,
  });

  let inserted = 0;
  if (toInsert.length > 0) {
    // INSERT em lote. Como o filtro acima ja casa com a constraint real
    // (company_id, evolution_message_id), o caso comum nao gera duplicatas.
    const { error: insertErr } = await supabaseAdmin
      .from("whatsapp_messages")
      .insert(toInsert);

    if (!insertErr) {
      inserted = toInsert.length;
    } else if (insertErr.code === "23505") {
      // Race condition: o webhook entregou algo entre nosso select e este
      // insert. Faz fallback um-a-um ignorando 23505 individual; demais
      // erros sao reportados normalmente.
      console.warn(
        "[load-history] batch insert hit 23505, falling back to per-row:",
        { sample: toInsert[0] ?? null }
      );
      for (const m of toInsert) {
        const { error } = await supabaseAdmin
          .from("whatsapp_messages")
          .insert(m);
        if (!error) {
          inserted++;
        } else if (error.code !== "23505") {
          console.error("[load-history] per-row insert failed:", {
            error,
            row: m,
          });
          return NextResponse.json(
            {
              error: `Erro ao gravar historico: ${error.message}`,
              code: error.code ?? null,
              details: error.details ?? null,
              hint: error.hint ?? null,
            },
            { status: 500 }
          );
        }
      }
    } else {
      console.error("[load-history] insert failed:", {
        error: insertErr,
        toInsertCount: toInsert.length,
        sample: toInsert[0] ?? null,
      });
      return NextResponse.json(
        {
          error: `Erro ao gravar historico: ${insertErr.message}`,
          code: insertErr.code ?? null,
          details: insertErr.details ?? null,
          hint: insertErr.hint ?? null,
        },
        { status: 500 }
      );
    }
  }

  // Aplica reactions agregadas. Faz um SELECT batch para descobrir quais
  // targets existem no banco (alguns podem ser de mensagens muito antigas
  // nao sincronizadas — ignoramos) e um UPDATE por mensagem alvo afetada.
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
        // Ordena por ts asc para aplicar na ordem real dos eventos. Um
        // reator que reagiu 2x em rajada acaba com o emoji mais recente.
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

  // Atualiza preview/timestamp/unread do chat se o historico trouxe alguma
  // mensagem mais recente do que o que estava registrado em whatsapp_chats. O
  // sync inicial pode ter deixado o preview com a "lastMessage" do findChats
  // da Evolution, que nem sempre corresponde a ultima mensagem real da conversa.
  //
  // unread_count: e o caminho equivalente ao webhook quando o tunnel esta
  // inacessivel (dev sem cloudflared). Sem isso, mensagens recebidas via
  // polling jamais marcariam o chat como tendo notificacao na lista lateral,
  // contrariando o comportamento esperado tipo WhatsApp. Se a mensagem mais
  // recente do batch e from_me (operador respondeu), zera; caso contrario,
  // soma as IN inseridas neste batch ao contador atual.
  if (latestTs) {
    const { data: chatNow } = await supabaseAdmin
      .from("whatsapp_chats")
      .select("last_message_at, unread_count")
      .eq("id", chatRow.id)
      .single();
    const chatNowRow =
      (chatNow as { last_message_at: string | null; unread_count: number } | null) ??
      null;
    const currentTs = chatNowRow?.last_message_at ?? null;
    if (!currentTs || latestTs > currentTs) {
      const currentUnread = chatNowRow?.unread_count ?? 0;
      const newUnread = latestFromMe
        ? 0
        : currentUnread + newIncomingCount;
      await supabaseAdmin
        .from("whatsapp_chats")
        .update({
          last_message_at: latestTs,
          last_message_preview: latestPreview ?? "[mensagem]",
          unread_count: newUnread,
        })
        .eq("id", chatRow.id);
    }
  }

  return NextResponse.json({
    loaded: inserted,
    total: records.length,
    skipped: records.length - inserted,
  });
}
