import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminForDomain } from "@/lib/supabase/require-admin-for-domain";
import { evolution } from "@/lib/evolution/client";
import { jidToPhone, siblingJid } from "@/lib/evolution/phone";

interface SyncPayload {
  domain?: string;
}

interface InstanceRow {
  id: string;
  instance_name: string;
}

interface ExistingChatRow {
  id: string;
  remote_jid: string;
  name: string | null;
  profile_picture_url: string | null;
}

const NUMBERS_BATCH_SIZE = 25;
// Delay aleatorio entre batches consecutivos de whatsappNumbers para
// distribuir as chamadas a Evolution e evitar padrao de rajada que possa
// flagar o numero. Pulado no ultimo batch (nao ha proxima chamada).
const BATCH_DELAY_MIN_MS = 500;
const BATCH_DELAY_MAX_MS = 900;

async function chunked<T>(arr: T[], size: number): Promise<T[][]> {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  if (!evolution.isConfigured()) {
    return NextResponse.json(
      { error: "Evolution API nao configurada." },
      { status: 503 }
    );
  }

  let body: SyncPayload;
  try {
    body = (await req.json()) as SyncPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const domain = body.domain?.trim().toLowerCase();
  if (!domain) {
    return NextResponse.json({ error: "Dominio obrigatorio." }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireAdminForDomain(domain);
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNAUTHORIZED";
    const status =
      code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : 401;
    return NextResponse.json({ error: code }, { status });
  }

  const supabaseAdmin = createAdminClient();

  const { data: row } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, instance_name")
    .eq("company_id", ctx.companyId)
    .maybeSingle();

  const instance = row as InstanceRow | null;
  if (!instance) {
    return NextResponse.json(
      { error: "Instancia nao encontrada." },
      { status: 404 }
    );
  }

  // Resolve nome real da instancia no Evolution (case-insensitive)
  let realInstanceName = instance.instance_name;
  try {
    const evoInstances = await evolution.fetchInstances();
    const exact = evoInstances.find((i) => i.name === instance.instance_name);
    if (!exact) {
      const ci = evoInstances.find(
        (i) => i.name.toLowerCase() === instance.instance_name.toLowerCase()
      );
      if (ci) {
        realInstanceName = ci.name;
        await supabaseAdmin
          .from("whatsapp_instances")
          .update({ instance_name: ci.name })
          .eq("id", instance.id);
      }
    }
  } catch {
    /* segue */
  }

  // Garante que o webhook esta configurado na instancia (idempotente).
  // Como esta instancia pode ter sido criada manualmente no Evolution,
  // o webhook pode nao estar registrado.
  const webhookBase = process.env.EVOLUTION_WEBHOOK_BASE_URL;
  if (webhookBase) {
    const webhookUrl = `${webhookBase.replace(/\/$/, "")}/api/whatsapp/webhook/${encodeURIComponent(realInstanceName)}`;
    await evolution.setWebhook(realInstanceName, webhookUrl);
  }

  let evoChats;
  try {
    evoChats = await evolution.findChats(realInstanceName);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json(
      { error: `Falha ao buscar conversas: ${message}` },
      { status: 502 }
    );
  }

  const individualChats = evoChats.filter(
    (c) =>
      typeof c.remoteJid === "string" &&
      (c.remoteJid.endsWith("@s.whatsapp.net") || c.remoteJid.endsWith("@c.us"))
  );

  if (individualChats.length === 0) {
    return NextResponse.json({
      synced: 0,
      updated: 0,
      total: evoChats.length,
      individual: 0,
    });
  }

  // Enriquecer com nome salvo na agenda do dono via whatsappNumbers em lote
  const numbersToCheck = individualChats.map((c) => jidToPhone(c.remoteJid));
  const savedNameByJid = new Map<string, string>();
  const batches = await chunked(numbersToCheck, NUMBERS_BATCH_SIZE);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const infos = await evolution.whatsappNumbers(realInstanceName, batch);
      for (const info of infos) {
        if (info?.name && info.jid) {
          savedNameByJid.set(info.jid, info.name);
        }
      }
    } catch {
      // segue mesmo se um lote falhar
    }
    // Pequeno delay entre batches; pula apos o ultimo para nao atrasar
    // a resposta a toa.
    if (i < batches.length - 1) {
      await sleep(randInt(BATCH_DELAY_MIN_MS, BATCH_DELAY_MAX_MS));
    }
  }

  // Buscar chats existentes (para decidir entre insert e update)
  const { data: existingChats } = await supabaseAdmin
    .from("whatsapp_chats")
    .select("id, remote_jid, name, profile_picture_url")
    .eq("company_id", ctx.companyId);

  const existingByJid = new Map<string, ExistingChatRow>();
  for (const c of (existingChats ?? []) as ExistingChatRow[]) {
    existingByJid.set(c.remote_jid, c);
  }

  let inserted = 0;
  let updated = 0;

  // Processar inserts e updates
  const toInsert: Record<string, unknown>[] = [];

  for (const c of individualChats) {
    const lastTs = c.lastMessage?.messageTimestamp;
    const lastMsgAt =
      lastTs != null
        ? new Date(
            typeof lastTs === "number" ? lastTs * 1000 : Number(lastTs) * 1000
          ).toISOString()
        : c.updatedAt
          ? new Date(c.updatedAt).toISOString()
          : null;

    const lastConv =
      (c.lastMessage?.message as { conversation?: string } | undefined)
        ?.conversation ?? null;
    const preview = lastConv ? lastConv.slice(0, 120) : null;

    const phone = jidToPhone(c.remoteJid);
    const savedName = savedNameByJid.get(c.remoteJid) ?? null;
    const resolvedName =
      savedName ?? c.pushName ?? c.name ?? phone ?? null;

    // Tenta JID exato; se nao existir, tenta o irmao com nono digito BR para
    // nao criar duplicata da mesma conversa.
    const sibling = siblingJid(c.remoteJid);
    const existing =
      existingByJid.get(c.remoteJid) ??
      (sibling ? existingByJid.get(sibling) : undefined);
    if (existing) {
      // Atualiza apenas campos nao vazios para nao sobrescrever dados melhores
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
      if (lastMsgAt) {
        updates.last_message_at = lastMsgAt;
      }
      if (preview) {
        updates.last_message_preview = preview;
      }
      if (Object.keys(updates).length > 0) {
        const { error } = await supabaseAdmin
          .from("whatsapp_chats")
          .update(updates)
          .eq("id", existing.id);
        if (!error) updated++;
      }
    } else {
      toInsert.push({
        company_id: ctx.companyId,
        instance_id: instance.id,
        remote_jid: c.remoteJid,
        name: resolvedName,
        profile_picture_url: c.profilePicUrl ?? null,
        last_message_at: lastMsgAt,
        last_message_preview: preview,
        unread_count: c.unreadCount ?? 0,
      });
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabaseAdmin
      .from("whatsapp_chats")
      .insert(toInsert);
    if (error) {
      return NextResponse.json(
        { error: `Erro ao inserir chats: ${error.message}` },
        { status: 500 }
      );
    }
    inserted = toInsert.length;
  }

  return NextResponse.json({
    synced: inserted,
    updated,
    total: evoChats.length,
    individual: individualChats.length,
  });
}
