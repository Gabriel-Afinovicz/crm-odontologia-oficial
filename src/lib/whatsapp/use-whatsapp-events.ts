"use client";

import { useEffect, useRef } from "react";
import {
  REALTIME_LISTEN_TYPES,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
  type REALTIME_SUBSCRIBE_STATES,
  type RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { WhatsAppChat, WhatsAppMessage } from "@/lib/types/database";

// Vocabulario semantico que materializa o que o usuario chamou de
// `new-message-whatsapp` / `new-agent-message-whatsapp`. O transporte
// (Supabase Realtime via `postgres_changes`) e detalhe interno do hook:
// o consumidor lida apenas com eventos nomeados sobre o dominio.
export const WHATSAPP_EVENT = {
  NEW_MESSAGE: "new-message-whatsapp",
  NEW_AGENT_MESSAGE: "new-agent-message-whatsapp",
  MESSAGE_UPDATE: "message-update-whatsapp",
  CHAT_UPSERT: "chat-upsert-whatsapp",
  CHAT_DELETE: "chat-delete-whatsapp",
} as const;

export type WhatsAppEventName =
  (typeof WHATSAPP_EVENT)[keyof typeof WHATSAPP_EVENT];

export type WhatsAppChannelStatus = `${REALTIME_SUBSCRIBE_STATES}`;

export interface WhatsAppEventHandlers {
  /** `new-message-whatsapp`: INSERT em whatsapp_messages com from_me === false. */
  onNewMessage?: (msg: WhatsAppMessage) => void;
  /**
   * `new-agent-message-whatsapp`: INSERT em whatsapp_messages com
   * from_me === true. Cobre tanto envio pelo CRM quanto eco do celular
   * do proprio operador (mesmo `key.fromMe` no payload do Baileys).
   */
  onNewAgentMessage?: (msg: WhatsAppMessage) => void;
  /** `message-update-whatsapp`: UPDATE em whatsapp_messages (status, reactions). */
  onMessageUpdate?: (msg: WhatsAppMessage) => void;
  /** `chat-upsert-whatsapp`: INSERT ou UPDATE em whatsapp_chats. */
  onChatUpsert?: (chat: WhatsAppChat) => void;
  /** `chat-delete-whatsapp`: DELETE em whatsapp_chats. */
  onChatDelete?: (chat: WhatsAppChat) => void;
  /**
   * Status do canal Realtime que aliments o hub. Util para a feature de
   * "saude" do realtime (ver `useWhatsAppHealth`) e para diagnostico em
   * dev. Recebe os 4 estados da `subscribe`: SUBSCRIBED, TIMED_OUT,
   * CLOSED, CHANNEL_ERROR.
   */
  onChannelStatus?: (status: WhatsAppChannelStatus) => void;
}

/**
 * Hub semantico de eventos do WhatsApp para uma `company_id`.
 *
 * Encapsula a unica fonte real-time da pagina (Supabase Realtime via
 * `postgres_changes`) por tras de uma API de eventos nomeados:
 *
 * - `new-message-whatsapp`: mensagem nova recebida do contato.
 * - `new-agent-message-whatsapp`: mensagem nova enviada (CRM ou celular).
 * - `message-update-whatsapp`: UPDATE de status/reactions/edicao.
 * - `chat-upsert-whatsapp`: chat criado ou atualizado (preview, unread, etc).
 * - `chat-delete-whatsapp`: chat deletado.
 *
 * Funciona como um unico WebSocket por aba (o canal Phoenix do Supabase
 * Realtime), independente da quantidade de instancias WhatsApp da company.
 * O isolamento por company e garantido pelas RLS policies de `whatsapp_chats`
 * e `whatsapp_messages` no servidor — alem disso aplicamos um guard
 * `company_id === companyId` client-side por defesa em profundidade.
 *
 * Importante: os handlers passados em `handlers` sao mantidos em ref e
 * sempre que invocados usam a versao mais recente sem precisar re-subscrever
 * o canal. Re-subscrever a cada render perderia eventos em transito.
 */
export function useWhatsAppEvents(
  companyId: string,
  handlers: WhatsAppEventHandlers
): void {
  // Ref garante que handlers atualizados (ex: capturando state novo via
  // closure no componente) sao usados sem recriar o canal a cada render.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const supabase = createClient();
    // Nome de canal unico por mount evita que React StrictMode/HMR em dev
    // mantenham dois subscribers ativos no mesmo nome de canal e entreguem
    // o mesmo evento em duplicidade.
    const channelName = `wa-events-${companyId}-${Math.random()
      .toString(36)
      .slice(2, 9)}`;

    const channel = supabase
      .channel(channelName)
      .on(
        REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
        {
          event: REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.ALL,
          schema: "public",
          table: "whatsapp_chats",
        },
        (payload: RealtimePostgresChangesPayload<WhatsAppChat>) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Partial<WhatsAppChat>;
            if (!old || old.company_id !== companyId) return;
            handlersRef.current.onChatDelete?.(old as WhatsAppChat);
            return;
          }
          const next = payload.new as WhatsAppChat;
          if (!next || next.company_id !== companyId) return;
          handlersRef.current.onChatUpsert?.(next);
        }
      )
      .on(
        REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
        {
          event: REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.ALL,
          schema: "public",
          table: "whatsapp_messages",
        },
        (payload: RealtimePostgresChangesPayload<WhatsAppMessage>) => {
          if (payload.eventType === "DELETE") return;
          const next = payload.new as WhatsAppMessage;
          if (!next || next.company_id !== companyId) return;
          if (payload.eventType === "INSERT") {
            if (next.from_me) {
              handlersRef.current.onNewAgentMessage?.(next);
            } else {
              handlersRef.current.onNewMessage?.(next);
            }
            return;
          }
          if (payload.eventType === "UPDATE") {
            handlersRef.current.onMessageUpdate?.(next);
          }
        }
      )
      .subscribe((status) => {
        handlersRef.current.onChannelStatus?.(status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId]);
}
