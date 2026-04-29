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

  // Insere mensagem em pending para feedback rapido na UI via realtime
  const { data: pending, error: insertErr } = await supabaseAdmin
    .from("whatsapp_messages")
    .insert({
      company_id: companyId,
      chat_id: chatRow.id,
      direction: "out",
      from_me: true,
      body: text,
      status: "pending",
      sender_user_id: profileRow.id,
    })
    .select("id")
    .single();
  if (insertErr || !pending) {
    return NextResponse.json(
      { error: `Erro ao registrar mensagem: ${insertErr?.message}` },
      { status: 500 }
    );
  }
  const pendingId = (pending as { id: string }).id;

  try {
    const sendRes = await evolution.sendText(
      instanceRow.instance_name,
      targetJid,
      text
    );

    await supabaseAdmin
      .from("whatsapp_messages")
      .update({
        evolution_message_id: sendRes.key?.id ?? null,
        status: "sent",
        sent_at: new Date().toISOString(),
      })
      .eq("id", pendingId);

    await supabaseAdmin
      .from("whatsapp_chats")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: text.slice(0, 120),
      })
      .eq("id", chatRow.id);

    return NextResponse.json({
      ok: true,
      chatId: chatRow.id,
      messageId: pendingId,
      remoteJid: targetJid,
      phone: targetPhone,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    await supabaseAdmin
      .from("whatsapp_messages")
      .update({ status: "failed", error_message: message })
      .eq("id", pendingId);
    return NextResponse.json(
      { error: `Falha ao enviar via Evolution: ${message}` },
      { status: 502 }
    );
  }
}
