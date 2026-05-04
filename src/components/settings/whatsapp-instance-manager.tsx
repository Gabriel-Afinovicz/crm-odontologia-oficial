"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { WhatsAppInstance } from "@/lib/types/database";

interface StatusResponse {
  instance: WhatsAppInstance | null;
  qrBase64?: string | null;
  pairingCode?: string | null;
}

interface ConnectResponse {
  instanceId?: string;
  status?: string;
  qrBase64?: string | null;
  pairingCode?: string | null;
  error?: string;
}

const POLL_MS = 3000;
// Cooldown apos sincronizacao bem sucedida. Evita que o usuario clique
// repetidamente no botao e dispare uma rajada de chamadas para a Evolution
// API (findChats + whatsappNumbers em batches), o que pode levar o numero
// a ser flagado como comportamento automatizado.
const SYNC_COOLDOWN_MS = 60_000;

export function WhatsAppInstanceManager() {
  const params = useParams<{ domain?: string }>();
  const domain = params?.domain;

  const [loading, setLoading] = useState(true);
  const [instance, setInstance] = useState<WhatsAppInstance | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncedRef = useRef(false);
  const lastSyncAtRef = useRef<number>(0);
  const cooldownTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCooldown() {
    lastSyncAtRef.current = Date.now();
    setCooldownRemaining(Math.ceil(SYNC_COOLDOWN_MS / 1000));
    if (cooldownTickRef.current) {
      clearInterval(cooldownTickRef.current);
    }
    cooldownTickRef.current = setInterval(() => {
      const elapsed = Date.now() - lastSyncAtRef.current;
      const remaining = Math.max(
        0,
        Math.ceil((SYNC_COOLDOWN_MS - elapsed) / 1000)
      );
      setCooldownRemaining(remaining);
      if (remaining <= 0 && cooldownTickRef.current) {
        clearInterval(cooldownTickRef.current);
        cooldownTickRef.current = null;
      }
    }, 1000);
  }

  async function syncChats() {
    if (!domain || syncing) return;
    // Bloqueia se ainda esta no cooldown apos um sync recente
    const sinceLast = Date.now() - lastSyncAtRef.current;
    if (lastSyncAtRef.current > 0 && sinceLast < SYNC_COOLDOWN_MS) return;

    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/whatsapp/instance/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      if (res.ok) {
        const payload = (await res.json()) as { synced?: number; total?: number };
        const synced = payload.synced ?? 0;
        const total = payload.total ?? 0;
        setSyncResult(
          synced > 0
            ? `${synced} conversa${synced !== 1 ? "s" : ""} importada${synced !== 1 ? "s" : ""} com sucesso.`
            : total > 0
              ? "Todas as conversas ja estao sincronizadas."
              : "Nenhuma conversa encontrada na instancia."
        );
        startCooldown();
      }
    } finally {
      setSyncing(false);
    }
  }

  async function fetchStatus(): Promise<StatusResponse | null> {
    if (!domain) return null;
    const res = await fetch(
      `/api/whatsapp/instance/status?domain=${encodeURIComponent(domain)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    return (await res.json()) as StatusResponse;
  }

  async function refresh() {
    const s = await fetchStatus();
    if (!s) {
      setInstance(null);
      setLoading(false);
      return;
    }
    setInstance((prev) => {
      // Detecta transição para connected: dispara sync automático uma vez
      if (
        s.instance?.status === "connected" &&
        prev?.status !== "connected" &&
        !syncedRef.current
      ) {
        syncedRef.current = true;
        // Chama sync fora do setState para não bloquear a atualização de estado
        setTimeout(() => syncChats(), 0);
      }
      return s.instance;
    });
    if (s.qrBase64) setQr(s.qrBase64);
    if (s.pairingCode) setPairingCode(s.pairingCode);
    if (s.instance?.status === "connected" && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      setShowQrModal(false);
      setQr(null);
      setPairingCode(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (cooldownTickRef.current) clearInterval(cooldownTickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(refresh, POLL_MS);
  }

  async function handleConnect() {
    if (!domain) return;
    setError(null);
    setBusy(true);
    setShowQrModal(true);
    const res = await fetch("/api/whatsapp/instance/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
    });
    setBusy(false);
    const rawText = await res.text();
    let payload: ConnectResponse = {};
    try {
      payload = rawText ? (JSON.parse(rawText) as ConnectResponse) : {};
    } catch {
      payload = {};
    }
    if (!res.ok) {
      const fallback = `Erro ao conectar WhatsApp. (HTTP ${res.status}${
        rawText && !payload.error
          ? `: ${rawText.slice(0, 160).replace(/\s+/g, " ").trim()}`
          : ""
      })`;
      setError(payload.error ?? fallback);
      setShowQrModal(false);
      return;
    }
    setQr(payload.qrBase64 ?? null);
    setPairingCode(payload.pairingCode ?? null);
    startPolling();
    refresh();
  }

  async function handleDisconnect() {
    if (!domain) return;
    if (!confirm("Desconectar o WhatsApp da clinica?")) return;
    setError(null);
    setBusy(true);
    const res = await fetch("/api/whatsapp/instance/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "Erro ao desconectar.");
      return;
    }
    setQr(null);
    setPairingCode(null);
    setShowQrModal(false);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    refresh();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              WhatsApp da clinica
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Conecte o numero WhatsApp da clinica via QR code para enviar e
              receber mensagens diretamente do CRM.
            </p>
          </div>
          {instance ? (
            <StatusBadge status={instance.status} />
          ) : (
            <StatusBadge status="disconnected" />
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-4 h-10 animate-pulse rounded bg-gray-100" />
        ) : instance?.status === "connected" ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Conectado{" "}
              {instance.phone_number && (
                <>
                  ao numero{" "}
                  <code className="rounded bg-white px-1.5 py-0.5">
                    +{instance.phone_number}
                  </code>
                </>
              )}
              .
              {instance.connected_at && (
                <span className="ml-2 text-emerald-600">
                  desde {new Date(instance.connected_at).toLocaleString("pt-BR")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={syncChats}
                disabled={syncing || busy || cooldownRemaining > 0}
                title={
                  cooldownRemaining > 0
                    ? `Aguarde ${cooldownRemaining}s antes de sincronizar novamente para evitar comportamento que possa flagar o numero.`
                    : undefined
                }
                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                {syncing
                  ? "Sincronizando..."
                  : cooldownRemaining > 0
                    ? `Aguarde ${cooldownRemaining}s para sincronizar novamente`
                    : "Sincronizar conversas"}
              </button>
              <button
                type="button"
                onClick={handleConnect}
                disabled={busy}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Reconectar (gerar novo QR)
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={busy}
                className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Desconectar
              </button>
            </div>
            {syncResult && (
              <p className="text-xs text-emerald-700">{syncResult}</p>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-gray-600">
              Ao conectar, abriremos um QR code que voce escaneia pelo
              WhatsApp do celular da clinica em &quot;Aparelhos
              conectados&quot;.
            </p>
            <button
              type="button"
              onClick={handleConnect}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "Conectando..." : "Conectar WhatsApp"}
            </button>
          </div>
        )}
      </section>

      {showQrModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowQrModal(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-gray-900">
                Conectar WhatsApp
              </h3>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
                aria-label="Fechar"
              >
                X
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Abra o WhatsApp no celular da clinica em
              <strong> Configuracoes &gt; Aparelhos conectados </strong>e
              escaneie o QR abaixo.
            </p>
            <div className="mt-4 flex flex-col items-center gap-3">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`}
                  alt="QR Code WhatsApp"
                  className="h-64 w-64 rounded-lg border border-gray-200"
                  style={{ filter: "saturate(0) contrast(5)" }}
                />
              ) : (
                <div className="flex h-64 w-64 items-center justify-center rounded-lg border border-dashed border-gray-300 text-xs text-gray-400">
                  Aguardando QR...
                </div>
              )}
              <p className="text-[11px] text-gray-400">
                Esta janela atualiza sozinha quando a conexao for efetivada.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    connected: {
      label: "Conectado",
      cls: "bg-emerald-100 text-emerald-700",
    },
    connecting: {
      label: "Conectando",
      cls: "bg-amber-100 text-amber-700",
    },
    disconnected: {
      label: "Desconectado",
      cls: "bg-gray-100 text-gray-600",
    },
  };
  const item = map[status] ?? map.disconnected;
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${item.cls}`}
    >
      {item.label}
    </span>
  );
}
