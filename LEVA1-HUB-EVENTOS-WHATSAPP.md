# Leva 1 — Hub semântico de eventos WhatsApp + heartbeat de webhook

**Status:** entregue.
**Data:** 13 de maio de 2026.
**Contexto:** primeira leva da agenda de otimizações discutida em
`ANALISE-WEBSOCKET-API-EDICAO.md` (arquivo substituído por este).
Foco: tirar o ruído de requisições visto no DevTools sem mudar o transporte
em tempo real (Supabase Realtime continua sendo a única fonte) e expor
um vocabulário semântico (`new-message-whatsapp`, `new-agent-message-whatsapp`)
sobre o `postgres_changes` já existente.

---

## 1) O que foi entregue

### 1.1 Migration — heartbeat no banco

Migration: **`whatsapp_instances_webhook_heartbeat`**.

- Nova coluna **`whatsapp_instances.webhook_last_seen_at timestamptz NULL`**.
- Tabela **`whatsapp_instances`** adicionada à publicação `supabase_realtime`
  (idempotente — checa antes de adicionar).
- Comentário na coluna documenta o uso (heartbeat throttled em 15s
  server-side, consumido por `useWhatsAppHealth` no cliente).

### 1.2 Webhook handler — `src/app/api/whatsapp/webhook/[instance]/route.ts`

Após validar `apikey` (não antes), o handler dispara um UPDATE
fire-and-forget:

```ts
const heartbeatCutoffIso = new Date(Date.now() - 15_000).toISOString();
void supabaseAdmin
  .from("whatsapp_instances")
  .update({ webhook_last_seen_at: new Date().toISOString() })
  .eq("id", instanceRow.id)
  .or(
    `webhook_last_seen_at.is.null,webhook_last_seen_at.lt.${heartbeatCutoffIso}`
  )
  .then(() => undefined, (err) => console.warn("[webhook] heartbeat update failed", err));
```

- **Throttle no `WHERE`**: só atualiza se `webhook_last_seen_at IS NULL OR <
  now() - 15s`. Em rajada (vários eventos de uma mesma instância em
  sequência) o UPDATE só efetiva ~4 vezes/min, limitando o broadcast
  Realtime para todos os operadores conectados.
- **Não bloqueante**: `void promise.then(ok, err)`. O webhook segue normal
  se o UPDATE falhar, caindo no logger.

### 1.3 Hub semântico — `src/lib/whatsapp/use-whatsapp-events.ts`

Hook React `useWhatsAppEvents(companyId, handlers)` que entrega eventos
nomeados sobre o `postgres_changes`:

| Evento conceitual          | Handler              | Origem (banco)                              |
| -------------------------- | -------------------- | ------------------------------------------- |
| `new-message-whatsapp`     | `onNewMessage`       | `whatsapp_messages` INSERT, `from_me=false` |
| `new-agent-message-whatsapp` | `onNewAgentMessage` | `whatsapp_messages` INSERT, `from_me=true`  |
| `message-update-whatsapp`  | `onMessageUpdate`    | `whatsapp_messages` UPDATE                  |
| `chat-upsert-whatsapp`     | `onChatUpsert`       | `whatsapp_chats` INSERT ou UPDATE           |
| `chat-delete-whatsapp`     | `onChatDelete`       | `whatsapp_chats` DELETE                     |
| (raw)                      | `onChannelStatus`    | status do canal Realtime                    |

Constantes exportadas em `WHATSAPP_EVENT` para uso em logs/diagnóstico.

**Detalhes importantes:**

- **Um único canal Phoenix** por aba, multiplexado sobre o WebSocket
  do Supabase Realtime. Não há transporte adicional.
- **RLS** filtra por `company_id` no servidor; o hook reforça com
  guard client-side (`next.company_id !== companyId`).
- **Handlers em ref interna** (`useRef`): atualizar handlers a cada render
  do componente consumidor não re-subscreve o canal (evita perder
  eventos em trânsito).
- **Nome de canal aleatório por mount** (`wa-events-${companyId}-${rand}`)
  para neutralizar duplicidade do React StrictMode/HMR em dev.

### 1.4 Saúde — `src/lib/whatsapp/use-whatsapp-health.ts`

Hook `useWhatsAppHealth(companyId)` que devolve:

```ts
{
  webhookAlive: boolean;     // heartbeat < 60s
  realtimeAlive: boolean;    // canal SUBSCRIBED há >= 30s
  healthy: boolean;          // webhookAlive && realtimeAlive
  webhookLastSeenAt: string | null;
  channelStatus: "INIT" | "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";
}
```

**Janelas:**

- `WEBHOOK_FRESH_THRESHOLD_MS = 60_000` — webhook é considerado vivo
  se gravamos heartbeat há menos de 60s. Como o handler atualiza com
  throttle de 15s, 60s garante margem de ~4 batidas antes de virar
  "morto".
- `REALTIME_STABLE_THRESHOLD_MS = 30_000` — canal só é considerado
  estável após 30s contínuos em `SUBSCRIBED`. Evita declarar saúde
  num socket recém-criado que pode cair em seguida.

**Implementação:**

- Select inicial em `whatsapp_instances.webhook_last_seen_at` para
  partir com valor real (não esperar o próximo UPDATE).
- Assina UPDATE em `whatsapp_instances` (canal `wa-health-...`).
- `setInterval` de 5s atualiza `nowMs` como state (evita
  `Date.now()` no corpo do componente — regra de pureza do React
  Compiler).
- Quando o canal sai de `SUBSCRIBED`, `subscribedSinceMs` volta a
  `null` → `realtimeAlive` cai imediatamente.

### 1.5 `conversas-content.tsx` — refatoração

**A.** Substituiu o `useEffect` de ~107 linhas que cuidava do
`postgres_changes` pelo `useWhatsAppEvents` com handlers nomeados.
Comportamento preservado linha a linha:

- `onChatUpsert`: mesma regra `fitsInPage` baseada em `last_message_at`
  vs último visível + `hasMoreRef`.
- `onChatDelete`: mesmo filter.
- `onNewMessage`:
  - Chat ativo (`chat_id === activeChatIdRef.current`) → `upsertMessage`
    no array.
  - Chat não-ativo → toast discreto (timer de 4s).
- `onNewAgentMessage`: só atualiza painel do chat ativo, sem toast.
- `onMessageUpdate`: só atualiza painel do chat ativo, sem toast.

**B.** Adicionou `useWhatsAppHealth(companyId)` + `healthyRef`.

**C.** `tick` do polling agora é adaptativo:

```ts
const POLL_GRANULARITY_MS = 10_000;       // setInterval base
const POLL_HEALTHY_INTERVAL_MS = 60_000;  // debounce quando saudável
let lastFullTickAt = 0;

function tick() {
  if (document.hidden) return;
  const isHealthy = healthyRef.current;
  const now = Date.now();
  if (isHealthy && now - lastFullTickAt < POLL_HEALTHY_INTERVAL_MS) return;
  lastFullTickAt = now;
  runFullSync(!isHealthy); // includeEvolutionPull = !isHealthy
}
```

- **Não saudável** (default no boot, ou degradado): tick a cada 10s
  + pull à Evolution — comportamento idêntico ao pré-otimização.
- **Saudável**: tick reduzido para 60s + sem pull à Evolution.
- **Aba inativa → ativa** (`visibilitychange`): sync forçado imediato
  independente de saúde, com `forceFresh=true` na Evolution. Comportamento
  preservado.

---

## 2) Por que isso não quebra nada

- **Migration aditiva**: coluna nullable e publicação idempotente. Schema
  antigo continua válido. Inserts antigos seguem passando.
- **Heartbeat é opcional**: se a publicação Realtime cair, o RLS impedir
  o select, ou a coluna nunca for atualizada — o cliente apenas nunca
  declara `healthy=true` e cai no comportamento de polling clássico.
- **Polling adaptativo, não removido**: o `setInterval` continua existindo.
  Saúde só *reduz* a frequência e *suspende* o pull à Evolution. Regressão
  de saúde (webhook morre, Realtime cai) reativa o comportamento clássico
  no próximo tick (≤ 10s).
- **Lints e type-check**: passaram limpos após a refatoração
  (`tsc --noEmit`, `eslint`).

### 2.1 Cenários verificados mentalmente

| Cenário                                | Comportamento esperado                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Prod, webhook + Realtime ok            | 1 WS estável, sync a cada 60s sem pull à Evolution. DevTools limpo após ~30s.                   |
| Cloudflare tunnel cai em dev           | Heartbeat envelhece > 60s → `webhookAlive=false` → polling 10s + pull Evolution reativam.       |
| Localhost sem webhook configurado      | `webhook_last_seen_at` nunca atualiza → `healthy=false` permanente → comportamento atual.       |
| Realtime cai (`CHANNEL_ERROR`/`TIMED_OUT`) | `realtimeAlive=false` no próximo render → polling reativa.                                  |
| Trocar de chat                         | Hub não re-subscreve (mesma `companyId`); refs `activeChatIdRef`/`chatsRef` dão o estado atual. |
| Aba inativa → ativa                    | Sync forçado com `forceFresh=true`, independente de saúde.                                      |

---

## 3) Como inspecionar no DevTools

Após `~30s` em `/conversas` em prod (webhook ativo):

- **WS:** 1 entrada `websocket?apikey=...` estável (Phoenix do Supabase
  multiplexando o `wa-events-*` e o `wa-health-*` no mesmo socket).
- **Network XHR/Fetch:** sem repetição de `whatsapp_messages?select=*&chat_id=...`
  nem `whatsapp_chats?select=*&company_id=...` a cada 10s.
- **`load-history`:** só dispara ao abrir um chat ou via botão refresh
  no header do chat.

Se voltar a ver `whatsapp_messages?...` repetindo, significa
`healthy=false` — isto é, o sistema detectou que webhook ou Realtime
caíram e religou o polling clássico. Sintoma defensivo esperado.

---

## 4) Arquivos tocados

| Tipo       | Caminho                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| Migration  | `whatsapp_instances_webhook_heartbeat` (no projeto Supabase do CRM)      |
| Tipos      | `src/lib/types/database.ts` (adicionado `webhook_last_seen_at`)          |
| Backend    | `src/app/api/whatsapp/webhook/[instance]/route.ts` (heartbeat fire-and-forget) |
| Hook       | `src/lib/whatsapp/use-whatsapp-events.ts` (novo)                         |
| Hook       | `src/lib/whatsapp/use-whatsapp-health.ts` (novo)                         |
| UI         | `src/app/[domain]/conversas/conversas-content.tsx` (refatoração)         |

---

## 5) Próximas levas (não iniciadas)

Combinadas para depois da validação em produção da Leva 1:

- **Leva 2** — API tokens externos por usuário+empresa, header
  `Authorization: Bearer`, tabela `api_tokens (token_hash, scopes,
  rate_limit, ...)`, UI em Settings para criar/revogar. Reusar
  `/api/whatsapp/messages/send` com dois modos de auth (cookie ou bearer).
- **Leva 3** — Edição de mensagem chegando do WhatsApp para o CRM
  via evento `MESSAGES_EDITED` (suportado a partir de Evolution 2.3.5
  — a instalação atual está em 2.3.7). Migration `edited_at /
  original_body / edit_count` em `whatsapp_messages` + badge "editada"
  na UI.
- **Leva 4 (opcional)** — Multi-instância por empresa. Requer spec de
  produto antes de mexer no schema.

---

## 6) Decisões registradas

- **NÃO foi criado** um socket.io próprio nem um endpoint SSE separado.
  O Supabase Realtime já entrega o que o vocabulário do sócio descreveu;
  reinventar transporte custaria processo long-lived (Vercel não roda
  bem) e perda de RLS automática por `company_id`.
- **NÃO foi exposta** chave/credencial da Evolution no browser. Toda
  comunicação com a Evolution permanece server-side.
- **Replica identity** das tabelas `whatsapp_*` mantida em `DEFAULT`.
  Supabase Realtime entrega `payload.new` com todas as colunas em
  INSERT/UPDATE mesmo com replica identity default (só o `payload.old`
  é restrito à PK em UPDATE/DELETE), então não há necessidade de mudar
  para `FULL`.
- **Heartbeat throttled no WHERE da query**, não em código aplicação,
  para evitar dupla viagem ao banco (select + update).
