import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evolution, EvolutionConfigError } from "@/lib/evolution/client";
import { QUICK_REACTION_EMOJIS } from "@/lib/whatsapp/reactions";
import { mergeReactions, normalizeReactions } from "@/lib/whatsapp/reactions";
import type { WhatsAppMessageReaction } from "@/lib/types/database";

interface ReactPayload {
  /**
   * Emoji a aplicar. String vazia ("") remove a reacao previa do operador
   * (mesmo comportamento do app WhatsApp). Apenas emojis do conjunto
   * QUICK_REACTION_EMOJIS sao aceitos — controle simples e suficiente para
   * o caso de uso da clinica.
   */
  emoji?: string;
}

interface MessageRow {
  id: string;
  company_id: string;
  chat_id: string;
  evolution_message_id: string | null;
  from_me: boolean;
  reactions: unknown;
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

/**
 * POST /api/whatsapp/messages/[messageId]/react
 *
 * Aplica/remove uma reacao (emoji) na mensagem identificada pelo uuid local
 * `whatsapp_messages.id`. Envia a reacao via Evolution (`/message/sendReaction`)
 * e ATUALIZA o array `reactions` da linha localmente para que a UI mostre
 * sem esperar o webhook chegar. Idempotente: o webhook subsequente vai
 * passar pela mesma logica `mergeReactions` e nao introduzir entradas
 * duplicadas para o operador.
 */
export async function POST(
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

    let body: ReactPayload;
    try {
      body = (await req.json()) as ReactPayload;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const rawEmoji = typeof body.emoji === "string" ? body.emoji : "";
    // Aceita string vazia (remocao) ou qualquer emoji do conjunto permitido.
    // Sem allowlist o operador poderia mandar texto arbitrario por curl;
    // mantemos o set fechado simples.
    const allowed =
      rawEmoji.length === 0 ||
      (QUICK_REACTION_EMOJIS as readonly string[]).includes(rawEmoji);
    if (!allowed) {
      return NextResponse.json(
        { error: "Emoji nao suportado." },
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
        "id, company_id, chat_id, evolution_message_id, from_me, reactions"
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
    if (!msgRow.evolution_message_id) {
      return NextResponse.json(
        { error: "Mensagem sem evolution_message_id; ainda nao sincronizada." },
        { status: 409 }
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

    // Envia primeiro a reacao via Evolution. Se falhar nao atualizamos o
    // banco — o operador ve o erro e o estado local fica consistente com
    // o que o WhatsApp realmente tem.
    try {
      await evolution.sendReaction(
        instanceRow.instance_name,
        {
          evolutionMessageId: msgRow.evolution_message_id,
          // `fromMe` aqui se refere a mensagem ALVO, nao ao reator. O
          // Baileys precisa para casar a key da mensagem no historico.
          fromMe: msgRow.from_me,
          remoteJid: chatRow.remote_jid,
        },
        rawEmoji
      );
    } catch (err) {
      if (err instanceof EvolutionConfigError) {
        return NextResponse.json({ error: err.message }, { status: 503 });
      }
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      return NextResponse.json(
        { error: `Falha ao reagir via Evolution: ${message}` },
        { status: 502 }
      );
    }

    const incoming: WhatsAppMessageReaction = {
      emoji: rawEmoji,
      from_me: true,
      // chat individual: o reator do operador e sempre o owner da instancia;
      // mas como o operador nao tem JID proprio (compartilha o numero da
      // clinica), usamos null. mergeReactions empata pelo `from_me`.
      reactor_jid: null,
      ts: new Date().toISOString(),
    };
    const current = normalizeReactions(msgRow.reactions);
    const merged = mergeReactions(current, incoming);

    const { error: updErr } = await supabaseAdmin
      .from("whatsapp_messages")
      .update({ reactions: merged })
      .eq("id", msgRow.id);
    if (updErr) {
      return NextResponse.json(
        { error: `Erro ao gravar reacao: ${updErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, reactions: merged });
  } catch (err) {
    console.error("[messages/react] uncaught:", err);
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json(
      { error: `Falha interna ao reagir: ${message}` },
      { status: 500 }
    );
  }
}
