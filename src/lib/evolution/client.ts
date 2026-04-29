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
    text: string
  ): Promise<SendMessageResponse> {
    return request<SendMessageResponse>(
      `/message/sendText/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        body: JSON.stringify({
          number: jid,
          text,
        }),
      }
    );
  },

  isConfigured(): boolean {
    return Boolean(BASE && API_KEY);
  },
};
