"use client";

import { useEffect, useState } from "react";
import {
  REALTIME_LISTEN_TYPES,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
  REALTIME_SUBSCRIBE_STATES,
  type RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { WhatsAppInstance } from "@/lib/types/database";

/**
 * Janelas de "saude":
 *
 * - `WEBHOOK_FRESH_THRESHOLD_MS = 60s`: webhook e considerado vivo se
 *   gravamos heartbeat ha menos de 60s. O handler do webhook atualiza
 *   `webhook_last_seen_at` com throttle server-side de 15s, entao 60s
 *   da uma margem de pelo menos 4 batidas tipicas antes de virar "morto".
 *
 * - `REALTIME_STABLE_THRESHOLD_MS = 30s`: canal Realtime so e considerado
 *   estavel apos 30s contínuos em `SUBSCRIBED`. Evita declarar saude e
 *   suspender polling logo no primeiro tick — perigoso porque um socket
 *   recem-criado pode cair em seguida (rede flapping, sleep do laptop, etc).
 */
const WEBHOOK_FRESH_THRESHOLD_MS = 60_000;
const REALTIME_STABLE_THRESHOLD_MS = 30_000;
const EVAL_INTERVAL_MS = 5_000;

export interface WhatsAppHealth {
  /** Webhook da Evolution recebeu pelo menos 1 evento nos ultimos 60s. */
  webhookAlive: boolean;
  /** Canal Supabase Realtime esta `SUBSCRIBED` ha mais de 30s sem cair. */
  realtimeAlive: boolean;
  /** Ambos saudaveis — sinal para o cliente desligar polling pesado. */
  healthy: boolean;
  /** Ultimo heartbeat conhecido do webhook (ISO 8601) ou null. */
  webhookLastSeenAt: string | null;
  /** Estado bruto do canal — util para diagnostico/UI. */
  channelStatus: `${REALTIME_SUBSCRIBE_STATES}` | "INIT";
}

/**
 * Monitora a saude conjunta de webhook + Realtime para uma `company_id`.
 *
 * Funcionamento:
 *
 * 1. Faz um SELECT inicial em `whatsapp_instances.webhook_last_seen_at` para
 *    ter um valor de partida sem precisar esperar o proximo evento.
 * 2. Assina UPDATE em `whatsapp_instances` via Supabase Realtime e atualiza
 *    o timestamp local conforme o handler do webhook bate o heartbeat.
 * 3. Mantem um `setInterval` leve de 5s que re-avalia as duas janelas
 *    (webhook fresco? canal estavel?) e devolve `healthy` consolidado.
 *
 * Defensivo por design:
 *
 * - Se a publicacao Realtime de `whatsapp_instances` nao estiver ligada
 *   ou o RLS impedir o SELECT, `webhookLastSeenAt` fica null →
 *   `webhookAlive=false` → `healthy=false` → consumidor mantem o polling
 *   classico (comportamento equivalente ao pre-otimizacao).
 *
 * - Se o canal cair, `channelStatus` deixa de ser SUBSCRIBED e
 *   `realtimeAlive` volta a false na proxima avaliacao — polling reativa.
 *
 * O hook nunca lanca: o pior caso e devolver `healthy=false` indefinidamente,
 * que e exatamente o fallback ja existente no app antes desta otimizacao.
 */
export function useWhatsAppHealth(companyId: string): WhatsAppHealth {
  const [webhookLastSeenAt, setWebhookLastSeenAt] = useState<string | null>(
    null
  );
  const [channelStatus, setChannelStatus] = useState<
    `${REALTIME_SUBSCRIBE_STATES}` | "INIT"
  >("INIT");
  // Timestamp (ms epoch) de quando o canal entrou em SUBSCRIBED pela
  // ultima vez, ou null se nao esta subscrito. Mantido como state (nao
  // ref) para que mudancas disparem re-render — os derivados
  // `realtimeAlive` / `healthy` precisam ser recalculados quando a
  // subscricao cai.
  const [subscribedSinceMs, setSubscribedSinceMs] = useState<number | null>(
    null
  );
  // Snapshot do clock corrente, atualizado a cada 5s pelo `setInterval`.
  // Permite calcular `Date.now() - ...` no corpo do componente sem violar
  // a regra de pureza do React Compiler (chamar `Date.now()` durante
  // render produziria resultados nao-deterministicos a cada render).
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      // Pega o instance heartbeat mais recente da company. Hoje so existe
      // uma instancia por company; este `order + limit 1` ja deixa o hook
      // pronto para o cenario futuro multi-instancia (basta o cliente saber
      // se *alguma* instancia esta com webhook vivo).
      const { data } = await supabase
        .from("whatsapp_instances")
        .select("webhook_last_seen_at")
        .eq("company_id", companyId)
        .order("webhook_last_seen_at", {
          ascending: false,
          nullsFirst: false,
        })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const ts =
        (data as Pick<WhatsAppInstance, "webhook_last_seen_at"> | null)
          ?.webhook_last_seen_at ?? null;
      if (ts) setWebhookLastSeenAt(ts);
    })();

    const channelName = `wa-health-${companyId}-${Math.random()
      .toString(36)
      .slice(2, 9)}`;

    const channel = supabase
      .channel(channelName)
      .on(
        REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
        {
          event: REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.UPDATE,
          schema: "public",
          table: "whatsapp_instances",
        },
        (payload: RealtimePostgresChangesPayload<WhatsAppInstance>) => {
          const next = payload.new as WhatsAppInstance;
          if (!next || next.company_id !== companyId) return;
          if (next.webhook_last_seen_at) {
            setWebhookLastSeenAt(next.webhook_last_seen_at);
          }
        }
      )
      .subscribe((status) => {
        setChannelStatus(status);
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          setSubscribedSinceMs(Date.now());
        } else {
          setSubscribedSinceMs(null);
        }
      });

    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, EVAL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [companyId]);

  const webhookAlive =
    webhookLastSeenAt !== null &&
    nowMs - new Date(webhookLastSeenAt).getTime() <
      WEBHOOK_FRESH_THRESHOLD_MS;
  const realtimeAlive =
    subscribedSinceMs !== null &&
    nowMs - subscribedSinceMs >= REALTIME_STABLE_THRESHOLD_MS;

  return {
    webhookAlive,
    realtimeAlive,
    healthy: webhookAlive && realtimeAlive,
    webhookLastSeenAt,
    channelStatus,
  };
}
