import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evolution, EvolutionConfigError } from "@/lib/evolution/client";
import { jidToPhone } from "@/lib/evolution/phone";

interface EditPayload {
  /** Novo corpo da mensagem (texto). Sera trimado; vazio rejeitado. */
  body?: string;
}

interface MessageRow {
  id: string;
  company_id: string;
  chat_id: string;
  evolution_message_id: string | null;
  from_me: boolean;
  body: string | null;
  original_body: string | null;
  edit_count: number;
  media_type: string;
  /**
   * Timestamp do envio. WhatsApp limita edicao a 15 minutos a partir do
   * `sent_at` (mensagens recebidas nao podem ser editadas, entao essa
   * coluna nunca e null para o caso de uso desta rota — mas mantemos
   * fallback em `created_at` por defesa).
   */
  sent_at: string | null;
  created_at: string;
}

interface ChatRow {
  id: string;
  company_id: string;
  instance_id: string;
  remote_jid: string;
}

interface InstanceRow {
  id: string;
  company_id: string;
  instance_name: string;
  status: "disconnected" | "connecting" | "connected";
}

// Janela maxima de edicao do WhatsApp em milissegundos (15 minutos).
// O servidor da Meta rejeita edicoes apos esse prazo; validamos antes
// para devolver erro claro ao operador em vez de um 4xx generico do
// upstream — e tambem para esconder o botao "Editar" na UI.
const WHATSAPP_EDIT_WINDOW_MS = 15 * 60 * 1000;

// Limite simples de tamanho do texto editado. WhatsApp aceita ate 65k
// chars, mas para mensagens da clinica isso seria abuso/spam — manter
// igual ao limite implicito do textarea (4k) e mais que suficiente.
const MAX_BODY_LEN = 4096;

/**
 * PATCH /api/whatsapp/messages/[messageId]/edit
 *
 * Edita o corpo de uma mensagem que o operador enviou pelo CRM (ou pelo
 * celular dele, contanto que `from_me === true`). Faz a chamada a Evolution
 * (`/chat/updateMessage`) e, em sucesso, atualiza a linha local com o novo
 * `body`, marca `edited_at = now()`, preserva `original_body` (so na 1a
 * edicao) e incrementa `edit_count`.
 *
 * Validacoes:
 *   - sessao autenticada
 *   - mensagem existe e pertence a company do operador
 *   - `from_me === true` (so editamos o que enviamos)
 *   - `media_type === "text"` (mensagens de midia nao sao editaveis no MVP)
 *   - `evolution_message_id` presente (mensagem ja sincronizada)
 *   - dentro da janela de 15 min do WhatsApp
 *   - texto novo nao vazio, <= MAX_BODY_LEN, diferente do atual
 *   - instancia conectada
 *
 * Idempotencia: se o webhook `messages.edited` chegar depois desta
 * resposta, ele passara pelo mesmo handler de edicao no webhook que ja
 * faz UPDATE com `edited_at = now()` — pode incrementar edit_count uma
 * segunda vez. Isso e aceitavel (a auditoria reflete que o servidor
 * confirmou); valor exato de edit_count nao e exposto na UI hoje.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ messageId: string }> }
) {
  try {
    const { messageId } = await ctx.params;
    const id = messageId?.trim();
    if (!id) {
      return NextResponse.json(
        { error: "messageId obrigatorio." },
        { status: 400 }
      );
    }

    let payload: EditPayload;
    try {
      payload = (await req.json()) as EditPayload;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const newBody = typeof payload.body === "string" ? payload.body.trim() : "";
    if (!newBody) {
      return NextResponse.json(
        { error: "Texto novo obrigatorio." },
        { status: 400 }
      );
    }
    if (newBody.length > MAX_BODY_LEN) {
      return NextResponse.json(
        { error: `Texto excede o limite de ${MAX_BODY_LEN} caracteres.` },
        { status: 400 }
      );
    }

    if (!evolution.isConfigured()) {
      return NextResponse.json(
        { error: "Evolution API nao configurada no servidor." },
        { status: 503 }
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
      .select("id, company_id")
      .eq("auth_id", user.id)
      .single();
    const profileRow = profile as
      | { id: string; company_id: string }
      | null;
    if (!profileRow) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const supabaseAdmin = createAdminClient();
    const companyId = profileRow.company_id;

    const { data: msgData } = await supabaseAdmin
      .from("whatsapp_messages")
      .select(
        "id, company_id, chat_id, evolution_message_id, from_me, body, original_body, edit_count, media_type, sent_at, created_at"
      )
      .eq("id", id)
      .maybeSingle();
    const msgRow = msgData as MessageRow | null;
    if (!msgRow || msgRow.company_id !== companyId) {
      return NextResponse.json(
        { error: "Mensagem nao encontrada." },
        { status: 404 }
      );
    }
    if (!msgRow.from_me) {
      return NextResponse.json(
        { error: "So e possivel editar mensagens enviadas por voce." },
        { status: 403 }
      );
    }
    if (msgRow.media_type !== "text") {
      return NextResponse.json(
        {
          error:
            "Apenas mensagens de texto podem ser editadas. Mensagens com midia nao sao suportadas.",
        },
        { status: 422 }
      );
    }
    if (!msgRow.evolution_message_id) {
      return NextResponse.json(
        {
          error:
            "Mensagem ainda em envio; aguarde alguns segundos para editar.",
        },
        { status: 409 }
      );
    }
    // Compara com o body atual ja trimado para evitar disparar Evolution
    // sem mudanca real (reduz risco de ban e poupa requisicao a Meta).
    if ((msgRow.body ?? "").trim() === newBody) {
      return NextResponse.json(
        { error: "O texto nao mudou; nada para editar." },
        { status: 422 }
      );
    }
    const sentAtMs = new Date(
      msgRow.sent_at ?? msgRow.created_at
    ).getTime();
    if (!Number.isFinite(sentAtMs)) {
      return NextResponse.json(
        { error: "Timestamp da mensagem invalido." },
        { status: 500 }
      );
    }
    const ageMs = Date.now() - sentAtMs;
    if (ageMs > WHATSAPP_EDIT_WINDOW_MS) {
      return NextResponse.json(
        {
          error:
            "Janela de 15 minutos para edicao expirou. WhatsApp nao permite editar mensagens antigas.",
          code: "EDIT_WINDOW_EXPIRED",
        },
        { status: 422 }
      );
    }

    const { data: chatData } = await supabaseAdmin
      .from("whatsapp_chats")
      .select("id, company_id, instance_id, remote_jid")
      .eq("id", msgRow.chat_id)
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

    // Chama Evolution PRIMEIRO. Se o servidor da Meta rejeitar (mensagem
    // muito antiga segundo o relogio da Meta, instancia nao autorizada,
    // etc), nao alteramos o banco — operador ve o erro e o estado local
    // continua coerente com o que esta no celular do destinatario.
    try {
      await evolution.editMessage(instanceRow.instance_name, {
        number: jidToPhone(chatRow.remote_jid),
        text: newBody,
        key: {
          id: msgRow.evolution_message_id,
          remoteJid: chatRow.remote_jid,
          fromMe: true,
        },
      });
    } catch (err) {
      if (err instanceof EvolutionConfigError) {
        return NextResponse.json({ error: err.message }, { status: 503 });
      }
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      return NextResponse.json(
        { error: `Falha ao editar via Evolution: ${message}` },
        { status: 502 }
      );
    }

    const editedAtIso = new Date().toISOString();
    const { error: updErr, data: updatedRow } = await supabaseAdmin
      .from("whatsapp_messages")
      .update({
        body: newBody,
        edited_at: editedAtIso,
        // Preserva o snapshot do corpo original somente na primeira edicao.
        // Edicoes subsequentes mantem o original anteriormente capturado
        // (que pode ter sido salvo pelo webhook se chegou primeiro).
        original_body: msgRow.original_body ?? msgRow.body,
        edit_count: (msgRow.edit_count ?? 0) + 1,
      })
      .eq("id", msgRow.id)
      .select(
        "id, body, edited_at, original_body, edit_count"
      )
      .single();
    if (updErr) {
      return NextResponse.json(
        { error: `Erro ao gravar edicao: ${updErr.message}` },
        { status: 500 }
      );
    }

    // Se esta mensagem e a mais recente do chat, atualiza tambem a
    // `last_message_preview` para refletir o novo texto na lista lateral.
    // Sem isso, o sidebar continuaria mostrando o texto original ate a
    // proxima mensagem chegar — comportamento diferente do WhatsApp.
    {
      const { data: latestMsg } = await supabaseAdmin
        .from("whatsapp_messages")
        .select("id")
        .eq("chat_id", chatRow.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const latestRow = (latestMsg as { id: string } | null) ?? null;
      if (latestRow?.id === msgRow.id) {
        await supabaseAdmin
          .from("whatsapp_chats")
          .update({ last_message_preview: newBody.slice(0, 120) })
          .eq("id", chatRow.id);
      }
    }

    return NextResponse.json({ ok: true, message: updatedRow });
  } catch (err) {
    console.error("[messages/edit] uncaught:", err);
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json(
      { error: `Falha interna ao editar: ${message}` },
      { status: 500 }
    );
  }
}
