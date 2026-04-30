/**
 * Helper de cliente para envio de mensagens WhatsApp.
 *
 * Tenta enviar via Evolution API (rota /api/whatsapp/messages/send). Se a
 * instance da clinica estiver desconectada (HTTP 409), faz fallback abrindo
 * wa.me com a mensagem pre-preenchida — assim o operador nao perde o fluxo
 * mesmo sem conexao configurada.
 */

export interface SendArgs {
  text: string;
  /** Para mensagens vinculadas a um chat especifico (preferencial). */
  chatId?: string;
  /** Resolve o JID a partir do lead (busca o phone do lead no servidor). */
  leadId?: string;
  /** Telefone manual (com ou sem mascara). */
  phone?: string;
  /**
   * Solicita preview de link na mensagem (Evolution faz scraping da URL).
   * Util em lembretes/confirmacoes para que o link vire tocavel no app.
   */
  linkPreview?: boolean;
}

export type SendResult =
  | { kind: "sent"; chatId: string; messageId: string }
  | { kind: "fallback"; reason: "not_connected" | "no_phone" | "error"; message: string }
  | { kind: "error"; message: string };

function openWaMeFallback(phone: string | null | undefined, text: string) {
  const digits = (phone ?? "").replace(/\D+/g, "");
  if (!digits) return false;
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

export async function sendWhatsAppMessage(args: SendArgs): Promise<SendResult> {
  const { text, chatId, leadId, phone, linkPreview } = args;
  if (!text.trim()) {
    return { kind: "error", message: "Mensagem vazia." };
  }

  let res: Response;
  try {
    res = await fetch("/api/whatsapp/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, chatId, leadId, phone, linkPreview }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro de rede";
    if (openWaMeFallback(phone, text)) {
      return {
        kind: "fallback",
        reason: "error",
        message: `Sem conexao com servidor. Abrindo WhatsApp Web. (${message})`,
      };
    }
    return { kind: "error", message };
  }

  if (res.ok) {
    const data = (await res.json()) as { chatId: string; messageId: string };
    return { kind: "sent", chatId: data.chatId, messageId: data.messageId };
  }

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };

  if (payload.code === "NOT_CONNECTED") {
    if (openWaMeFallback(phone, text)) {
      return {
        kind: "fallback",
        reason: "not_connected",
        message:
          "WhatsApp da clinica nao esta conectado. Abrindo WhatsApp Web como alternativa.",
      };
    }
    return {
      kind: "error",
      message:
        "WhatsApp da clinica nao esta conectado e nao foi possivel abrir o WhatsApp Web (telefone ausente).",
    };
  }

  if (payload.code === "NO_PHONE") {
    return {
      kind: "error",
      message:
        payload.error ?? "Paciente sem telefone valido cadastrado.",
    };
  }

  if (openWaMeFallback(phone, text)) {
    return {
      kind: "fallback",
      reason: "error",
      message: payload.error ?? "Falha no envio. Abrindo WhatsApp Web.",
    };
  }

  return {
    kind: "error",
    message: payload.error ?? "Falha ao enviar mensagem.",
  };
}
