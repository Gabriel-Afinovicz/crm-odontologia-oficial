/**
 * Cliente HTTP para Evolution API (server-only).
 *
 * Configuracao via env vars:
 *  - EVOLUTION_API_URL    (ex: https://evo.example.com)
 *  - EVOLUTION_API_KEY    (chave global do servidor Evolution)
 *  - EVOLUTION_WEBHOOK_BASE_URL (ex: https://crm.example.com) — usado para
 *    registrar o webhook ao criar a instance. Em dev, aponte para um tunel.
 */

import "server-only";

const BASE = process.env.EVOLUTION_API_URL;
const API_KEY = process.env.EVOLUTION_API_KEY;
const WEBHOOK_BASE = process.env.EVOLUTION_WEBHOOK_BASE_URL ?? "";

export class EvolutionConfigError extends Error {
  constructor(message = "Evolution API nao configurada") {
    super(message);
    this.name = "EvolutionConfigError";
  }
}

function ensureConfig() {
  if (!BASE || !API_KEY) {
    throw new EvolutionConfigError(
      "Defina EVOLUTION_API_URL e EVOLUTION_API_KEY no servidor."
    );
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { instanceToken?: string } = {}
): Promise<T> {
  ensureConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: init.instanceToken ?? API_KEY!,
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!res.ok) {
    const message =
      (payload as { message?: string; error?: string } | null)?.message ??
      (payload as { error?: string } | null)?.error ??
      `Evolution API ${res.status}`;
    const err = new Error(`Evolution API: ${message}`);
    (err as Error & { status?: number; payload?: unknown }).status = res.status;
    (err as Error & { status?: number; payload?: unknown }).payload = payload;
    throw err;
  }
  return payload as T;
}

export interface CreateInstanceResponse {
  instance: {
    instanceName: string;
    instanceId?: string;
    status: string;
  };
  hash?: { apikey?: string } | string;
  qrcode?: { base64?: string; code?: string };
}

export interface ConnectInstanceResponse {
  base64?: string;
  code?: string;
  pairingCode?: string;
  count?: number;
}

export interface ConnectionStateResponse {
  instance: { instanceName: string; state: "open" | "close" | "connecting" };
}

export interface SendMessageResponse {
  key: { id: string; remoteJid: string; fromMe: boolean };
  message?: unknown;
  status?: string;
  messageTimestamp?: number | string;
}

export interface EvolutionChatItem {
  id?: string | null;
  remoteJid: string;
  pushName?: string | null;
  name?: string | null;
  profilePicUrl?: string | null;
  updatedAt?: string | null;
  unreadCount?: number | null;
  lastMessage?: {
    messageTimestamp?: number | string | null;
    message?: Record<string, unknown> | null;
    key?: {
      id?: string | null;
      remoteJid?: string | null;
      remoteJidAlt?: string | null;
      addressingMode?: string | null;
      fromMe?: boolean | null;
    } | null;
  } | null;
}

export interface EvolutionInstanceItem {
  id: string;
  name: string;
  connectionStatus?: string;
  ownerJid?: string | null;
  profileName?: string | null;
  profilePicUrl?: string | null;
}

export interface EvolutionWhatsAppNumberInfo {
  jid: string;
  exists: boolean;
  number: string;
  name?: string | null;
}

/**
 * Estrutura de mensagem retornada por /chat/findMessages — tolerante a
 * variacoes de versao da Evolution. Os campos sao opcionais porque alguns
 * podem vir ausentes dependendo da forma como a instancia capturou a msg.
 */
export interface EvolutionMessageRecord {
  id?: string;
  key?: {
    id?: string | null;
    remoteJid?: string | null;
    fromMe?: boolean | null;
    participant?: string | null;
    /**
     * JID alternativo entregue pela Evolution quando `remoteJid` esta em
     * `@lid` (privacidade do WhatsApp). Tipicamente aponta para o
     * `@s.whatsapp.net`/`@c.us` real do contato. Usar via
     * `canonicalRemoteJid` para manter o historico unificado.
     */
    remoteJidAlt?: string | null;
    addressingMode?: string | null;
  };
  pushName?: string | null;
  message?: Record<string, unknown> | null;
  messageType?: string | null;
  messageTimestamp?: number | string | null;
  status?: string | null;
  /**
   * `contextInfo` top-level que a Evolution coloca FORA de `message` quando
   * a mensagem e tipo `conversation` (texto curto). Para mensagens com
   * reply em `conversation`, o `stanzaId` / `quotedMessage` ficam aqui em
   * vez de dentro de `message.extendedTextMessage.contextInfo`. Use-o como
   * argumento extra ao chamar `extractQuoted`.
   */
  contextInfo?: Record<string, unknown> | null;
}

function webhookUrlFor(instanceName: string): string | undefined {
  if (!WEBHOOK_BASE) return undefined;
  return `${WEBHOOK_BASE.replace(/\/$/, "")}/api/whatsapp/webhook/${encodeURIComponent(instanceName)}`;
}

export const evolution = {
  async createInstance(instanceName: string): Promise<CreateInstanceResponse> {
    const webhook = webhookUrlFor(instanceName);
    const body: Record<string, unknown> = {
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
    };
    if (webhook) {
      body.webhook = {
        enabled: true,
        url: webhook,
        byEvents: false,
        base64: true,
        events: [
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
          "CONNECTION_UPDATE",
          "CHATS_UPSERT",
          "CHATS_UPDATE",
        ],
      };
    }
    return request<CreateInstanceResponse>("/instance/create", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  async connect(instanceName: string): Promise<ConnectInstanceResponse> {
    return request<ConnectInstanceResponse>(
      `/instance/connect/${encodeURIComponent(instanceName)}`,
      { method: "GET" }
    );
  },

  async getConnectionState(
    instanceName: string
  ): Promise<ConnectionStateResponse> {
    return request<ConnectionStateResponse>(
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
      { method: "GET" }
    );
  },

  async logout(instanceName: string): Promise<unknown> {
    return request<unknown>(
      `/instance/logout/${encodeURIComponent(instanceName)}`,
      { method: "DELETE" }
    );
  },

  async deleteInstance(instanceName: string): Promise<unknown> {
    return request<unknown>(
      `/instance/delete/${encodeURIComponent(instanceName)}`,
      { method: "DELETE" }
    );
  },

  async sendText(
    instanceName: string,
    jid: string,
    text: string,
    options?: {
      linkPreview?: boolean;
      /**
       * Reply (citacao) estilo WhatsApp. Evolution v2 espera a estrutura
       * Baileys "quoted" com `key` e `message` da mensagem original. O
       * Baileys casa pelo `id` da `key` no historico do chat para vincular.
       */
      quoted?: {
        evolutionMessageId: string;
        fromMe: boolean;
        remoteJid: string;
        body: string | null;
      };
    }
  ): Promise<SendMessageResponse> {
    const body: Record<string, unknown> = { number: jid, text };
    // Quando habilitado, a Evolution faz scraping do link e envia como
    // mensagem com preview, o que ajuda o WhatsApp a tratar a URL como
    // tocavel no celular do destinatario.
    if (options?.linkPreview) {
      body.linkPreview = true;
    }
    if (options?.quoted) {
      const q = options.quoted;
      // O campo `message.conversation` e o suficiente para texto. Para midia
      // (imagem/audio), idealmente seria o objeto message original; aqui
      // mandamos um conversation com o caption/texto disponivel — a UI do
      // destinatario ainda mostra o quote, ainda que sem thumbnail.
      body.quoted = {
        key: {
          id: q.evolutionMessageId,
          fromMe: q.fromMe,
          remoteJid: q.remoteJid,
        },
        message: {
          conversation: q.body ?? "",
        },
      };
    }
    return request<SendMessageResponse>(
      `/message/sendText/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
  },

  /**
   * Envia uma reacao (emoji) a uma mensagem existente. Evolution v2 endpoint:
   * `POST /message/sendReaction/{instance}` com `{ key, reaction }`.
   *
   * `reaction` vazia ("") remove a reacao previa do reator nesta mensagem
   * (mesmo comportamento do app oficial WhatsApp). O Baileys casa a reacao
   * pela `key.id` da mensagem alvo, entao precisamos do `evolution_message_id`
   * original armazenado na linha de `whatsapp_messages`.
   */
  async sendReaction(
    instanceName: string,
    target: {
      evolutionMessageId: string;
      fromMe: boolean;
      remoteJid: string;
    },
    reaction: string
  ): Promise<SendMessageResponse> {
    return request<SendMessageResponse>(
      `/message/sendReaction/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        body: JSON.stringify({
          key: {
            id: target.evolutionMessageId,
            fromMe: target.fromMe,
            remoteJid: target.remoteJid,
          },
          reaction,
        }),
      }
    );
  },

  /**
   * Busca mensagens historicas de um chat especifico do cache local Baileys
   * da instancia (Evolution v2: POST /chat/findMessages/{instance}).
   *
   * E uma operacao de LEITURA local: nao gera trafego para os servidores do
   * WhatsApp e portanto nao tem risco de banimento por si so. Use mesmo assim
   * com limites baixos (default 30) e somente sob demanda do usuario.
   */
  async findMessages(
    instanceName: string,
    remoteJid: string,
    limit: number = 30,
    page: number = 1
  ): Promise<EvolutionMessageRecord[]> {
    const result = await request<
      | EvolutionMessageRecord[]
      | {
          messages?: {
            records?: EvolutionMessageRecord[];
            total?: number;
            pages?: number;
            currentPage?: number;
          };
        }
    >(`/chat/findMessages/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        where: { key: { remoteJid } },
        // Pede explicitamente as mensagens mais recentes primeiro. Evolution
        // v2 aceita tanto "desc" quanto -1 dependendo da versao; mandamos as
        // duas formas mais comuns. O servidor ignora o que nao reconhece.
        sort: { messageTimestamp: "desc" },
        order: { messageTimestamp: -1 },
        limit,
        page,
      }),
    });
    if (Array.isArray(result)) return result;
    return result?.messages?.records ?? [];
  },

  async findChats(instanceName: string): Promise<EvolutionChatItem[]> {
    const result = await request<
      EvolutionChatItem[] | { data?: EvolutionChatItem[]; chats?: EvolutionChatItem[] }
    >(`/chat/findChats/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (Array.isArray(result)) return result;
    return result?.data ?? result?.chats ?? [];
  },

  async fetchInstances(): Promise<EvolutionInstanceItem[]> {
    const result = await request<EvolutionInstanceItem[]>(
      `/instance/fetchInstances`,
      { method: "GET" }
    );
    return Array.isArray(result) ? result : [];
  },

  /**
   * Verifica numeros no WhatsApp e retorna o nome salvo na agenda do dono.
   * Aceita lista; uma chamada por lote.
   */
  async whatsappNumbers(
    instanceName: string,
    numbers: string[]
  ): Promise<EvolutionWhatsAppNumberInfo[]> {
    if (numbers.length === 0) return [];
    const result = await request<
      EvolutionWhatsAppNumberInfo[] | { data?: EvolutionWhatsAppNumberInfo[] }
    >(`/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({ numbers }),
    });
    if (Array.isArray(result)) return result;
    return result?.data ?? [];
  },

  /**
   * Recupera a midia (imagem/sticker/audio/video/documento) decodificada da
   * mensagem em base64. A `media_url` que vem nos eventos do Baileys e uma
   * URL criptografada do WhatsApp (`mmg.whatsapp.net/...`) que precisa de
   * `mediaKey` + decrypt para virar arquivo utilizavel; este endpoint da
   * Evolution faz isso no servidor dela e devolve o conteudo pronto.
   *
   * Operacao de LEITURA do cache local Baileys da Evolution: nao gera
   * trafego para servidores Meta/WhatsApp, portanto nao tem risco de
   * banimento associado (mesmo perfil de `findMessages`/`findChats`).
   */
  async getBase64FromMediaMessage(
    instanceName: string,
    evolutionMessageId: string,
    options?: { convertToMp4?: boolean }
  ): Promise<{
    base64?: string;
    mimetype?: string | null;
    fileName?: string | null;
    mediaType?: string | null;
  }> {
    return request<{
      base64?: string;
      mimetype?: string | null;
      fileName?: string | null;
      mediaType?: string | null;
    }>(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        body: JSON.stringify({
          message: { key: { id: evolutionMessageId } },
          convertToMp4: Boolean(options?.convertToMp4),
        }),
      }
    );
  },

  async fetchProfilePictureUrl(
    instanceName: string,
    number: string
  ): Promise<string | null> {
    try {
      const res = await request<{
        wuid?: string;
        profilePictureUrl?: string | null;
      }>(`/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        body: JSON.stringify({ number }),
      });
      return res?.profilePictureUrl ?? null;
    } catch {
      return null;
    }
  },

  async setWebhook(instanceName: string, webhookUrl: string): Promise<unknown> {
    try {
      return await request<unknown>(
        `/webhook/set/${encodeURIComponent(instanceName)}`,
        {
          method: "POST",
          body: JSON.stringify({
            webhook: {
              enabled: true,
              url: webhookUrl,
              byEvents: false,
              base64: true,
              events: [
                "MESSAGES_UPSERT",
                "MESSAGES_UPDATE",
                "CONNECTION_UPDATE",
                "CHATS_UPSERT",
                "CHATS_UPDATE",
              ],
            },
          }),
        }
      );
    } catch {
      return null;
    }
  },

  isConfigured(): boolean {
    return Boolean(BASE && API_KEY);
  },
};
