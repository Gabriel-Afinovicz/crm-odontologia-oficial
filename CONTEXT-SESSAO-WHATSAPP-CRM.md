# Contexto da sessão — WhatsApp no CRM e produção na Vercel

**Útil como memória quando este chat não estiver disponível.**

**Última atualização:** 15 de maio de 2026 — consolidação pós-Leva 3.5:

- **Webhook de edição resiliente (Evolution 2.3.7):** caminho rápido **antes** do bloco que exige `data?.key` — edições chegam como `messages.update` **sem** `key` no nível externo (só `data.message.editedMessage`) e como `messages.edited` **sem** `data.message`. Funções **`extractEditFromData`** + **`extractEditedMessageBody`** cobrem formato **D** (`message.editedMessage.{ key, message }`), `protocolMessage`, e campos top-level (`data.text`, `data.editedMessage`). Log dev `[webhook] edit-payload-dump` quando o formato foge do esperado. Após aplicar edição na linha, se for a **última mensagem do chat**, atualiza **`whatsapp_chats.last_message_preview`** (prévia da lista lateral não fica “presa” no texto antigo).
- **Checks estilo WhatsApp:** migration **`whatsapp_chats_add_last_message_meta`** — colunas **`last_message_from_me`** e **`last_message_status`**; webhook `messages.upsert` / rotas `send` e `send-media` / `load-history` populam; **`messages.update`** de status propaga para `last_message_status` quando o `evolution_message_id` é o da última mensagem. UI: componente **`MessageStatusChecks`** (1 ✓ enviado, 2 ✓✓ entregue cinza, 2 ✓✓ lidas azuis, relógio pending, erro falhou) substitui palavras “enviada/entregue/lida” nas bolhas e mostra checks **só na prévia lateral** quando a última mensagem foi **minha** (recebida = só texto, como no app oficial).
- **Painel lateral “Dados do contato”:** edição inline do **`whatsapp_chats.name`** (lápis ao lado do nome); **`renameChat`** no pai com UPDATE otimista + rollback; botão **“Usar nome do lead”** quando há lead vinculado (preenche o draft; Salvar persiste).

Detalhes nas secções **Edição de mensagem**, **Prévia do chat + indicadores de status**, **Painel do contato — nome editável** e tabela **Arquivos-chave**.

*(Leva 3 — 15/mai/2026: edição de mensagem WhatsApp. Leva 1 — 13/mai/2026: hub semântico + heartbeat de webhook. Histórico anterior: lista lateral sem filtro 30d, reações, filtragem `[unknown]`, hydration warning, painel deslocando à direita, paginação, mídia recebida, `@lid`, replies, sync incremental, fallback `load-history`.)*

---

## Stack resumido

- **Next.js 16** (`src/app/`), **Supabase**, **Evolution API** (Baileys) para WhatsApp.
- Tenant em `/[domain]/...`; painel master em `/wosnicz`.

---

## Produção (Vercel) — Evolution “não configurada” / connect quebrando

### Mensagem literal

`Evolution API nao configurada no servidor.` vem de
`POST /api/whatsapp/instance/connect` quando `evolution.isConfigured()` é falso —
faltava **no ambiente Production** pelo menos uma de:

- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`

### Outro problema comum na Vercel

Após configurar só as variáveis da Evolution, ainda assim dava erro genérico
**“Erro ao conectar WhatsApp.”** (fallback do cliente quando a resposta não era JSON estruturado).

**Causa:** faltava `SUPABASE_SERVICE_ROLE_KEY` na Vercel. A rota de connect chama
`createAdminClient()` antes do insert; sem a service role, a função estourava com **500**.
`NEXT_PUBLIC_PUBLIC_APP_URL` também é recomendada (links externos / confirmação).

### Mudanças de repo relacionadas

- **`.env.example`** na raiz: variáveis Evolution + Supabase + `NEXT_PUBLIC_PUBLIC_APP_URL`.
- **`.gitignore`:** `!/env.example`-style via `!.env.example`; pasta **`/docs/`** ignorada (decisão do usuário para não commitar docs locais).
- **`src/components/settings/whatsapp-instance-manager.tsx`:** em erro de POST no connect,
  mostrar **HTTP status** e um trecho do corpo quando não for JSON (`res.text()`).

---

## Aba Conversas — quem enviou (operador vs celular)

**Objetivo:** com o mesmo número da clínica usado por vários usuários, mostrar **quem digitou no CRM**.

- `whatsapp_messages` já tem **`sender_user_id`**; a API de envio
  `/api/whatsapp/messages/send` já preenche.
- **`src/app/[domain]/conversas/conversas-content.tsx`:**
  - Carrega um mapa `users` da empresa (`id` → `name`).
  - `useSession()` para o usuário atual (mensagem otimista antes do servidor).
  - Acima das bolhas **outbound:** nome em verde; sem `sender_user_id` na mensagem
    (exceto temporárias) rotula como **“Enviado pelo celular”**.

---

## Conversas — paginação de mensagens + scroll (sem salto visual)

**Objetivo:** não renderizar centenas de bolhas de uma vez; ao abrir o chat mostrar só as **30 mensagens mais recentes** e manter o scroll “colado” no fim **sem** flash de topo→fundo.

### Constante e estado (`conversas-content.tsx`)

- **`MESSAGES_PAGE_SIZE = 30`** (local ao arquivo).
- Estados: **`hasOlderMessages`**, **`loadingOlderMessages`**.
- Refs: **`scrollHeightBeforeRef`**, **`justLoadedOlderRef`** (prepend de mensagens antigas preserva posição de scroll).

### Carga inicial e `load-history` na abertura do chat

- Primeiro `select` no Supabase: **`ORDER BY created_at DESC LIMIT 31`** → se vier mais de 30 linhas, **`hasOlderMessages = true`**, exibe só as 30 mais recentes, **`reverse()`** para ordem cronológica na UI (mais antiga em cima).
- Após isso, **`POST /load-history`** com **`limit: MESSAGES_PAGE_SIZE` (30)**; re-select no mesmo padrão DESC 31 + reverse (alinha com a página visível; não volta a carregar 500 linhas).
- **`refreshHistory`** (ícone de atualizar no header do chat): mesmo padrão — Evolution 30 + re-select DESC 31 + atualiza **`hasOlderMessages`**.

### Botão “Carregar mensagens anteriores”

- Query: **`created_at < min(created_at)`** do estado atual, **DESC LIMIT 31**, prepend; dedupe por id.
- **`useLayoutEffect([messages])`**: se **`justLoadedOlderRef`**, ajusta **`scrollTop += newScrollHeight - scrollHeightBeforeRef`** em vez de descer ao fim.

### Scroll (troca de chat e mensagens novas)

- **`useLayoutEffect([messages])`** e **`useLayoutEffect([activeChatId])`**: **`scrollContainerRef.scrollTop = scrollHeight`** quando perto do fim ou ao trocar chat — **antes do paint** (sem `requestAnimationFrame` + sem `scrollIntoView("smooth")` que causavam flash).
- **`isNearBottomRef`** + **`handleMessagesScroll`** (threshold 150px): só auto-desce se o operador já estava no fim (leitura no histórico preservada).

### Observação sobre `jumpToQuote`

- O quote pode apontar para mensagem **fora** das ~30 carregadas; **`jumpToQuote`** continua silencioso se o alvo não está no DOM — operador pode usar **“Carregar mensagens anteriores”** até a mensagem aparecer.

---

## Lista lateral — paginação simples (sem filtro de 30 dias)

**Decisão de produto (maio/2026):** o filtro **`.gte("last_message_at", chatVisibilityCutoffIso())`** foi **removido** da lista lateral. Agora exibe os contatos ordenados por `last_message_at desc` em **blocos de 30**; abaixo do contato nº 30 aparece **“Carregar mais”** que traz +30, indefinidamente, até esgotar.

- **`src/app/[domain]/conversas/page.tsx`** — carga server-side: `select(...).order("last_message_at desc").limit(PAGE_SIZE + 1)` (busca 31 para detectar `hasMore` sem `count`). **Sem** `.gte` em `last_message_at`.
- **`src/app/[domain]/conversas/conversas-content.tsx`** — `syncChatList` e `loadMore` também sem `.gte`; **`loadMore`** continua usando `lt("last_message_at", oldest)` para paginar.
- **Rodapé da lista** (sem busca ativa, com pelo menos 1 chat visível): se `hasMore`, botão **“Carregar mais”**; senão, texto **“Sem mais conversas.”** (não menciona mais a janela de 30 dias).
- O helper **`chatVisibilityCutoffIso()`** ainda existe em `src/lib/whatsapp/constants.ts` e é usado **apenas** no **sync incremental de `whatsappNumbers`** (ver secção **Janela de 30 dias** mais abaixo) — para evitar lookups na agenda WhatsApp para contatos inativos.

---

## Histórico das últimas mensagens (lazy load pela Evolution)

**Problema:** só chegava o que vinha pelo **webhook** após conectar; chats antigos apareciam vazios no CRM.

**Solução:**

1. **`src/lib/evolution/client.ts` — `findMessages`**
   - `POST /chat/findMessages/{instance}`
   - Corpo típico: `where: { key: { remoteJid } }`, `limit`, `page`,
     ordenação **desc** por timestamp (duas chaves compatíveis com versões da Evolution).

2. **`POST /api/whatsapp/messages/load-history`**
   - Body: `{ chatId, limit? }` (cap no servidor ~50).
   - Autenticação + valida empresa/chat/instância conectada.
   - Pull da Evolution → insere linhas novas em `whatsapp_messages`.
   - **Fallback `@lid`:** quando o chat é número `@s.whatsapp.net` / `@c.us`, faz segunda rodada de `findMessages` no JID `@lid` correspondente descoberto via `findChats` (`lastMessage.key.remoteJidAlt`). Detalhes na secção **Fallback load-history**.

3. **`conversas-content.tsx`:**
   - Na primeira abertura do chat na sessão: após o select paginado no banco (ver secção **Paginação de mensagens**), chama `load-history` com **`limit: 30`** alinhado a **`MESSAGES_PAGE_SIZE`** quando passou o intervalo Evolution; re-select no mesmo padrão DESC 31.

### Bugs passados ao gravar histórico (para não repetir)

- **Duplicate key:** constraint único é **`(company_id, evolution_message_id)`** — não inclui `chat_id`.
  O `select` de “já existe” não pode filtrar só por `chat_id`, senão falha contra mensagens já inseridas pelo webhook.
- **`upsert ... onConflict: company_id,evolution_message_id`:** Postgres retornou **42P10**
  (“no unique constraint matching ON CONFLICT”) — o formulário esperado pela lib não batia com o índice real → **voltamos a `INSERT` em lote** com fallback linha-a-linha só em **23505** (race com webhook).

### Ordem cronológica e preview na lista lateral

**Problema:** mensagens de histórico entravam com `created_at` = hora da inserção; a UI ordena por `created_at ASC` → todas “no fim”, fora de ordem, e **`last_message_preview`** do chat desatualizado.

**Correção no `load-history`:**

- Preencher **`created_at`** com o **timestamp da mensagem** (mesmo de `sent_at` / `received_at`).
- Após bulk insert bem-sucedido, se houver mensagem mais recente que `whatsapp_chats.last_message_at`, **atualizar** `last_message_at` + `last_message_preview` (+ desde maio/2026: **`last_message_from_me`** e **`last_message_status`** quando a msg mais recente do batch for própria).

---

## Conversas já abertas antes desses fixes

Linhas antigas podem ficar com `created_at` “errados” até alguém apagar mensagens daquele `chat_id` ou limpar dados e recarregar o histórico (opcional por SQL conforme combinado).

---

## Arquivos-chave para retomada rápida

| Área | Arquivo |
|------|---------|
| Constantes WhatsApp (janela 30d — só sync incremental) | `src/lib/whatsapp/constants.ts` (`CHAT_VISIBILITY_DAYS`, `chatVisibilityCutoffIso`) |
| **Reações — emojis + `mergeReactions` + `normalizeReactions`** | `src/lib/whatsapp/reactions.ts` |
| **Hub semântico de eventos WhatsApp** (`new-message-whatsapp` etc.) | `src/lib/whatsapp/use-whatsapp-events.ts` |
| **Saúde do realtime + heartbeat do webhook** | `src/lib/whatsapp/use-whatsapp-health.ts` |
| Helpers JID / telefone (`canonicalRemoteJid`, `@lid`) | `src/lib/evolution/phone.ts` |
| Cliente Evolution (incl. `sendReaction`, `getBase64FromMediaMessage`, **`editMessage`**) | `src/lib/evolution/client.ts` |
| Conectar WhatsApp | `src/app/api/whatsapp/instance/connect/route.ts` |
| Status instância (incl. `last_manual_sync_at`) | `src/app/api/whatsapp/instance/status/route.ts` |
| Sync chats (lista, pesado com whatsappNumbers) | `src/app/api/whatsapp/instance/sync/route.ts` |
| Sync pós-login (background, sem whatsappNumbers) | `src/app/api/whatsapp/post-login-sync/route.ts` |
| Webhook mensagens (incl. `reactionMessage`, heartbeat, **edição via `protocolMessage` em `messages.update`/`messages.edited`**) | `src/app/api/whatsapp/webhook/[instance]/route.ts` |
| Histórico (incl. acumulação de reações em batch, **`last_message_from_me` / `last_message_status` no refresh do chat**) | `src/app/api/whatsapp/messages/load-history/route.ts` |
| **Mídia decodificada (qualquer tipo com `evolution_message_id`)** | `src/app/api/whatsapp/messages/[messageId]/media/route.ts` |
| **Aplicar/remover reação (UI → Evolution)** | `src/app/api/whatsapp/messages/[messageId]/react/route.ts` |
| **Editar mensagem própria (UI → Evolution, 15 min)** | `src/app/api/whatsapp/messages/[messageId]/edit/route.ts` |
| Enviar mensagem (texto) | `src/app/api/whatsapp/messages/send/route.ts` |
| **Enviar mídia (imagem/video/documento)** | `src/app/api/whatsapp/messages/send-media/route.ts` |
| Root layout (`suppressHydrationWarning`) | `src/app/layout.tsx` |
| Layout tenant — disparo sync background | `src/app/[domain]/layout.tsx` + `src/components/layout/whatsapp-post-login-sync.tsx` |
| Página Conversas (carga server-side, paginação sem 30d) | `src/app/[domain]/conversas/page.tsx` |
| UI Conversas (paginação, mídia in/out, replies, reações, envio de mídia, links clicáveis, edição própria, **checks de status**, **prévia lateral**, **painel contato + rename**) | `src/app/[domain]/conversas/conversas-content.tsx` |
| UI WhatsApp Settings | `src/components/settings/whatsapp-instance-manager.tsx` |
| Tipos Supabase / schema TS (`WhatsAppMessageReaction`, **`last_message_from_me` / `last_message_status` em `WhatsAppChat`**) | `src/lib/types/database.ts` |
| Banco — colunas meta da última mensagem no chat | migration **`whatsapp_chats_add_last_message_meta`** (Supabase) |
| Env exemplo | `.env.example` |

---

## O que não colocar neste arquivo

- Chaves JWT, URLs de preview com tunnel pessoais, **`SUPABASE_SERVICE_ROLE_KEY`**, etc.
  Usar apenas **`.env.local`** ou os segredos no painel Vercel/Supabase.

---

## Webhook — DEV (Cloudflare Tunnel) vs PROD (Vercel)

A Evolution só consegue empurrar mensagens novas se a URL configurada em
`EVOLUTION_WEBHOOK_BASE_URL` for **alcançável publicamente**. Sem isso o CRM
fica dependente do polling de fallback (**15s** no chat ativo, ver `conversas-content.tsx`) e perde notificações instantâneas.

### Produção (Vercel)

- Configurar `EVOLUTION_WEBHOOK_BASE_URL=https://<seu-app>.vercel.app` nas
  Environment Variables (escopo Production).
- Após mudar a env, **redeploy** + clicar em **Sync** ou **reconectar** o WhatsApp
  na aba Settings para a Evolution registrar o novo webhook.

### Dev local — Cloudflare Tunnel

`cloudflared` está instalado via winget (`cloudflared --version` deve responder).
Há duas modalidades: **Quick Tunnel** (sem login, URL temporária) e
**Named Tunnel** (URL fixa em domínio Cloudflare).

#### Opção A — Quick Tunnel (sem login, mais rápido)

A URL muda **toda vez** que o tunnel sobe (ex.: `https://random-words-1234.trycloudflare.com`).
Bom para sessões curtas; ruim se você abre/fecha o terminal várias vezes ao dia.

1. `npm run dev` (terminal 1, Next na porta 3000).
2. `npm run tunnel` (terminal 2). Roda
   `cloudflared tunnel --url http://localhost:3000` e imprime a URL pública na primeira
   linha (`Your quick Tunnel has been created! Visit it at: https://...trycloudflare.com`).
3. Copiar a URL e colar em `.env.local`:

   ```
   EVOLUTION_WEBHOOK_BASE_URL=https://random-words-1234.trycloudflare.com
   ```
4. **Reiniciar `npm run dev`** (Next só lê `.env.local` no boot).
5. Na aba Settings do CRM, clicar **Sync** (ou desconectar/reconectar) para que a
   Evolution sobrescreva o webhook registrado com a URL nova.

#### Opção B — Named Tunnel (URL fixa, requer domínio Cloudflare)

Recomendado se tem domínio próprio na Cloudflare; a URL é permanente.

1. `cloudflared tunnel login` (uma vez — abre browser, escolhe o domínio).
2. `cloudflared tunnel create crm-dev` → gera `crm-dev.json` em `~/.cloudflared/`.
3. `cloudflared tunnel route dns crm-dev crm-dev.seudominio.com`.
4. Criar `~/.cloudflared/config.yml`:

   ```yaml
   tunnel: crm-dev
   credentials-file: C:\Users\Usuario\.cloudflared\<UUID>.json
   ingress:
     - hostname: crm-dev.seudominio.com
       service: http://localhost:3000
     - service: http_status:404
   ```
5. No `.env.local`:

   ```
   CLOUDFLARED_TUNNEL_NAME=crm-dev
   EVOLUTION_WEBHOOK_BASE_URL=https://crm-dev.seudominio.com
   ```
6. Em **dois terminais**:
   - `npm run dev`
   - `npm run tunnel:named` (executa `cloudflared tunnel run crm-dev`).
7. Sync na Settings só uma vez — depois disso a URL não muda mais.

### Quando o tunnel "expira"

- **Quick Tunnel:** ao fechar o `cloudflared`, a URL morre. Subir de novo gera **outra**
  URL → precisa atualizar `.env.local`, reiniciar `npm run dev` e clicar Sync.
- **Named Tunnel:** URL é permanente; só precisa manter o `npm run tunnel:named` rodando.

### Fallback se o tunnel cair

Mesmo sem webhook, o CRM faz polling na Evolution para o **chat ativo** via
`pullEvolutionForActive` em `conversas-content.tsx` — intervalo mínimo **15s**
entre chamadas (`EVOLUTION_POLL_INTERVAL_MS`; antes era 30s). Não é instantâneo
como o webhook, mas reduz a sensação de atraso quando o tunnel cai.

A partir da **Leva 1 (maio/2026)** este polling virou **adaptativo**: enquanto
`useWhatsAppHealth` reporta `healthy=false` (webhook sem heartbeat fresco ou
canal Realtime instável), o `tick` continua a cada **10s** disparando
`syncActiveChat + syncChatList + pullEvolutionForActive` — exatamente o
comportamento clássico. Assim que o webhook volta a bater
`whatsapp_instances.webhook_last_seen_at` e o canal Realtime fica `SUBSCRIBED`
por > 30s, o tick passa a rodar full sync só a cada **60s** e o pull à
Evolution é desligado (deixado on-demand pelo abrir-chat / botão refresh).
Ver secção **Polling adaptativo + hub semântico** abaixo.

---

## Lista lateral — badge de não lidas (WhatsApp)

**Objetivo:** contatos **não selecionados** mostram contador verde quando há mensagens recebidas não vistas.

- **`whatsapp_chats.unread_count`** existe no banco; o **webhook** incrementa em cada mensagem **IN** (`messages.upsert`).
- **`POST /api/whatsapp/messages/load-history`:** quando não há webhook (tunnel caído / dev), mensagens novas entram pelo polling de `pullEvolutionForActive` (**~15s** entre pulls ao servidor Evolution por chat ativo). O load-history **também incrementa** `unread_count` ao inserir mensagens IN novas (somando ao contador atual). Se a última mensagem do batch é **from_me**, zera como no webhook.
- **`conversas-content.tsx`:** badge só quando `unread_count > 0 && chat !== ativo`; nome/preview mais fortes e hora em verde quando há não lidas; `useEffect` ao abrir chat zera `unread_count` no Supabase.
- **Scripts dev:** `npm run tunnel` = Quick Tunnel Cloudflare; `npm run tunnel:named` = Named Tunnel (ver secção acima). `.env.example` documenta `CLOUDFLARED_TUNNEL_NAME`.

---

## Sync automático após login (chats + mensagens recentes em background)

**Objetivo:** ao entrar no sistema após logout/login, se o WhatsApp já estiver **connected**, sincronizar contatos/previews e puxar histórico recente dos chats mais ativos **sem** exigir clique manual em Sync e **sem** rodar em paralelo com a própria aba `/conversas` (onde já há polling próprio).

### Banco

- **`whatsapp_instances.last_post_login_sync_at`** (`timestamptz`, nullable) — migration **`whatsapp_instances_add_last_post_login_sync_at`**.
  Cooldown **server-side 60s** entre execuções reais da Evolution por empresa (evita rajada quando vários operadores logam ao mesmo tempo ou há várias abas).

### Backend — `POST /api/whatsapp/post-login-sync`

- Auth qualquer usuário do tenant (`createClient` + `users.company_id`); não exige admin.
- Sai cedo se instância inexistente, não `connected`, Evolution não configurada, ou cooldown `< 60s` desde `last_post_login_sync_at` (resposta `ok + skipped: cooldown`).
- Fluxo:
  1. **`findChats`** (Evolution — cache Baileys local, não conta tráfego para servidores do WhatsApp).
  2. Atualiza/insere `whatsapp_chats` (sem **`whatsappNumbers`** — esse passo fica só no sync manual pesado).
  3. Top **20** chats por `last_message_at`: paralelo limitado (**5** `findMessages` simultâneas), **limit 20** por chat.
  4. Um único `select` em massa de `evolution_message_id` já existentes; **`INSERT` em lote** com fallback linha-a-linha em **23505** (mesmo padrão do `load-history`).
  5. Atualiza `last_message_at` / preview / `unread_count` dos chats afetados (lógica alinhada ao `load-history` quando há mensagens IN novas).

### Client — `WhatsAppPostLoginSync`

- **`src/components/layout/whatsapp-post-login-sync.tsx`** — montado em **`src/app/[domain]/layout.tsx`** dentro do `SessionProvider`.
- **Uma vez por sessão de aba** (`sessionStorage` key `wa:postSync:${companyId}:${userId}`).
- **Não dispara** em `/${domain}` (login) nem em rotas que começam com `/${domain}/conversas`.
- Dispara após **~1.5s** (`requestIdleCallback`-style via `setTimeout`) com `fetch(..., { keepalive: true })`.
- Em desenvolvimento loga `[wa:postSync]` no console.

### Observação

O **`post-login-sync`** e o **`load-history`/polling** usam `findMessages`/`findChats` → leitura do cache local Baileys na Evolution; **não aumentam risco de banimento** por si só (diferente de `whatsappNumbers` em rajada).

### `@lid` (Linked ID) — pós-correção maio/2026

- Chats individuais podem vir como **`NNNNN@lid`** (privacidade WhatsApp); a Evolution frequentemente envia **`key.remoteJidAlt`** com o **`@s.whatsapp.net`**/`@c.us` real do contato.
- **`canonicalRemoteJid(remoteJid, remoteJidAlt)`** em **`src/lib/evolution/phone.ts`** — se `remoteJid` é `@lid` e o alt é número real, usa o alt para **`whatsapp_chats.remote_jid`** e unifica histórico com o chat já existente.
- **`isIndividualJid`** aceita `@s.whatsapp.net`, `@c.us` e **`@lid`** (grupos `@g.us` continuam ignorados onde aplicável).
- **`post-login-sync`**: normaliza `remoteJid` via `lastMessage.key.remoteJidAlt` antes de upsert de chats; top-N de mensagens inclui também chats `@lid` puros (`allChatRows` filtra com `isIndividualJid`).

---

## Polling adaptativo + hub semântico de eventos (Leva 1 — maio/2026)

**Problema atacado:** mesmo com Supabase Realtime já entregando `INSERT`
de `whatsapp_messages` e `whatsapp_chats` em tempo real, o painel
`/conversas` mantinha três loops simultâneos por aba aberta:

1. `setInterval(tick, 10000)` em `conversas-content.tsx` chamando
   `syncActiveChat` (SELECT em `whatsapp_messages`) e `syncChatList`
   (SELECT em `whatsapp_chats`).
2. Dentro do mesmo tick, `pullEvolutionForActive(false)` → `POST
   /api/whatsapp/messages/load-history` a cada 15s.
3. O canal `postgres_changes` do Realtime, que já entregava tudo
   em 95% dos casos.

Em produção com webhook estável os loops (1) e (2) eram trabalho
desperdiçado: ruidosos no DevTools e proporcionais ao número de
abas/operadores conectados.

### Heartbeat do webhook

Migration **`whatsapp_instances_webhook_heartbeat`**:

- Coluna **`whatsapp_instances.webhook_last_seen_at timestamptz NULL`**.
- Tabela publicada na publicação `supabase_realtime` (idempotente).

**`src/app/api/whatsapp/webhook/[instance]/route.ts`** — após validar
`apikey`, dispara um UPDATE fire-and-forget:

```ts
const heartbeatCutoffIso = new Date(Date.now() - 15_000).toISOString();
void supabaseAdmin
  .from("whatsapp_instances")
  .update({ webhook_last_seen_at: new Date().toISOString() })
  .eq("id", instanceRow.id)
  .or(`webhook_last_seen_at.is.null,webhook_last_seen_at.lt.${heartbeatCutoffIso}`)
  .then(() => undefined, (err) => console.warn("[webhook] heartbeat update failed", err));
```

- Throttle no `WHERE`: só atualiza se NULL ou se o último heartbeat foi há
  mais de 15s. Em rajada, limita o broadcast Realtime a ~4 vezes/min
  independente da quantidade de eventos.
- Falha do heartbeat não bloqueia nem invalida o webhook (cai em
  `console.warn`); o cliente apenas continua reportando `webhookAlive=false`.

### Hub semântico — `src/lib/whatsapp/use-whatsapp-events.ts`

Hook `useWhatsAppEvents(companyId, handlers)` que expõe eventos nomeados
sobre o `postgres_changes` existente:

| Evento                       | Handler              | Origem                                      |
|------------------------------|----------------------|---------------------------------------------|
| `new-message-whatsapp`       | `onNewMessage`       | `whatsapp_messages` INSERT, `from_me=false` |
| `new-agent-message-whatsapp` | `onNewAgentMessage`  | `whatsapp_messages` INSERT, `from_me=true`  |
| `message-update-whatsapp`    | `onMessageUpdate`    | `whatsapp_messages` UPDATE                  |
| `chat-upsert-whatsapp`       | `onChatUpsert`       | `whatsapp_chats` INSERT ou UPDATE           |
| `chat-delete-whatsapp`       | `onChatDelete`       | `whatsapp_chats` DELETE                     |
| (raw)                        | `onChannelStatus`    | status do canal Realtime                    |

- Um único canal Phoenix por aba, multiplexado sobre o mesmo WebSocket
  do Supabase Realtime (sem transporte novo).
- Constantes exportadas em `WHATSAPP_EVENT` para logs/diagnóstico.
- Handlers ficam em `useRef` interna → consumidor pode passar funções
  inline a cada render sem re-subscrever o canal (não perde eventos).
- Nome de canal aleatório por mount (`wa-events-${companyId}-${rand}`)
  para neutralizar StrictMode/HMR em dev.

### Saúde — `src/lib/whatsapp/use-whatsapp-health.ts`

Hook `useWhatsAppHealth(companyId)` devolve:

```ts
{ webhookAlive: boolean, realtimeAlive: boolean, healthy: boolean,
  webhookLastSeenAt: string | null,
  channelStatus: "INIT" | "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR" }
```

- `WEBHOOK_FRESH_THRESHOLD_MS = 60_000` — webhook é "vivo" se heartbeat
  < 60s (margem de ~4 batidas tipicas).
- `REALTIME_STABLE_THRESHOLD_MS = 30_000` — canal só "estável" após 30s
  contínuos em `SUBSCRIBED`.
- Implementação faz select inicial em
  `whatsapp_instances.webhook_last_seen_at` para partir com valor real;
  depois assina UPDATE em `whatsapp_instances` num canal próprio
  (`wa-health-*`), multiplexado no mesmo WS do `wa-events-*`.
- Usa `nowMs` em state (atualizado a cada 5s pelo `setInterval`) em vez
  de `Date.now()` no corpo do componente — respeita a regra de pureza do
  React Compiler.

### Polling adaptativo em `conversas-content.tsx`

`tick` agora lê `healthyRef`:

```ts
const POLL_GRANULARITY_MS = 10_000;
const POLL_HEALTHY_INTERVAL_MS = 60_000;

function tick() {
  if (document.hidden) return;
  const isHealthy = healthyRef.current;
  const now = Date.now();
  if (isHealthy && now - lastFullTickAt < POLL_HEALTHY_INTERVAL_MS) return;
  lastFullTickAt = now;
  runFullSync(!isHealthy); // includeEvolutionPull = !isHealthy
}
```

- Não saudável (boot + degradação): tick 10s + `pullEvolutionForActive` —
  comportamento idêntico ao pré-otimização.
- Saudável: tick 60s, sem pull à Evolution.
- `visibilitychange` (aba volta ao foco): sync forçado imediato com
  `forceFresh=true` na Evolution, independente da saúde.

### Garantias de "não quebra nada"

- Migration aditiva (coluna nullable, publicação idempotente).
- Heartbeat opcional: se a publicação cair ou o RLS bloquear o SELECT,
  o cliente nunca declara `healthy=true` e roda o polling clássico.
- Polling não foi removido; só **reduzido** quando saudável. Regressão
  reativa o comportamento clássico em ≤ 10s.

### Documento de referência

Detalhes (cenários, decisões registradas, próximas levas) em
**`LEVA1-HUB-EVENTOS-WHATSAPP.md`** na raiz do repo.

---

## Constante `CHAT_VISIBILITY_DAYS` — onde ainda é usada

### Lista lateral — **NÃO usa mais** (maio/2026)

A partir de 12/maio/2026 o filtro foi **removido** da lista lateral; ver secção **Lista lateral — paginação simples** acima. A constante e o helper continuam exportados (importação `import { chatVisibilityCutoffIso } from "@/lib/whatsapp/constants"`) porque o sync incremental abaixo ainda os usa.

### Busca “Buscar conversa…”

- **`searchResults`** + debounce **250ms**; query Supabase **sem** filtro de janela quando `q.length >= 2` (`ilike` em `name`, `remote_jid`, `last_message_preview`), limite 50.
- **`filteredChats`**: usa `searchResults` quando não-null; senão `chats` (já sem filtro).
- **“Carregar mais”** oculto durante busca ativa (`searchResults !== null`).

### Sync manual — `whatsappNumbers` incremental (mantém janela)

- Em **`POST /api/whatsapp/instance/sync`**, antes dos batches de **`whatsappNumbers`**, carrega **`existingChats`** com **`last_message_at`**.
- **`numbersToCheck`** só inclui chats onde vale resolver nome na agenda: **novo no banco**, ou **sem `name`** e **ativo nos últimos N dias** (`CHAT_VISIBILITY_DAYS`); **`@lid`** pula o lookup (telefone derivado é opaco).
- Considera **`siblingJid`** ao casar linha existente (nono dígito BR).
- Se **`numbersToCheck.length === 0`**, não chama **`whatsappNumbers`** (ex.: 2ª sync em diante quando todos já têm nome ou estão inativos na janela).
- Motivo de manter a janela aqui: **`whatsappNumbers`** toca **servidores Meta** (ver secção **Risco de banimento**); reduzir o universo para contatos com atividade recente continua sendo a mitigação principal contra rajadas.

---

## Fallback `load-history` quando o histórico recente está só em `@lid`

**Problema:** `findMessages` filtra por **`remoteJid` exato**. Chat no CRM como **`5543...@s.whatsapp.net`** pode ter mensagens novas só sob **`215259...@lid`** no cache Baileys.

**Solução em `POST /api/whatsapp/messages/load-history`:**

1. Primeiro **`findMessages`** no **`chatRow.remote_jid`** (comportamento anterior).
2. Se o JID do chat é **`@s.whatsapp.net`** ou **`@c.us`**, **`findChats`** (cache local) e procura item **`@lid`** cujo **`lastMessage.key.remoteJidAlt`** iguala o **`remote_jid`** do chat.
3. Segundo **`findMessages`** nesse **`@lid`**; concatena registros; dedupe por **`evolution_message_id`** no fluxo existente de insert.

Logs incluem **`lid_fallback`** no **`[load-history] records fetched`** quando um JID `@lid` foi usado. Falha no fallback é **best-effort** (warning no log, não quebra o refresh principal).

---

## Sync manual em Settings (`/instance/sync`) — cooldown server-side

**Problema resolvido:** o cooldown de **60s** existia só no cliente (`whatsapp-instance-manager.tsx`). Ao dar **F5** ou abrir outra aba, o contador zerava e era possível disparar de novo `findChats` + **`whatsappNumbers`** em batches — vetor sensível a comportamento “bot”.

### Banco

- **`whatsapp_instances.last_manual_sync_at`** (`timestamptz`, nullable) — migration **`whatsapp_instances_add_last_manual_sync_at`**.

### Backend — `POST /api/whatsapp/instance/sync`

- Inclui chats **`@lid`** após normalização via **`lastMessage.key.remoteJidAlt`** quando disponível (mesma lógica do webhook/`canonicalRemoteJid`).
- **`numbersToCheck`** para **`whatsappNumbers`**: ver secção **Janela de 30 dias** — sync incremental (reduz chamadas a servidor WhatsApp e tempo de sync nas execuções seguintes).
- Antes do trabalho pesado: se `last_manual_sync_at` existe e há menos de **60s**, retorna **HTTP 429** com corpo JSON incluindo `code: "COOLDOWN"`, `retryAfterMs`, `retryAfterSeconds`, `lastManualSyncAt` e header **`Retry-After`**.
- Ao aceitar a requisição, grava **`last_manual_sync_at = now()` antes** do trabalho — duas chamadas paralelas não geram duas rajadas.
- Em erro **antes** de completar o sync (ex.: falha na Evolution), o timestamp já foi gravado; comportamento aceito para não permitir spam em caso de instabilidade.

### Status — `GET /api/whatsapp/instance/status`

- Passa a incluir **`last_manual_sync_at`** no objeto `instance` para o cliente alinhar o contador visual após reload.

### Client — `whatsapp-instance-manager.tsx`

- Função **`applyCooldown(lastSyncMs)`** unifica: sync OK local, **429** do servidor (usa `lastManualSyncAt`), e **primeira leitura** do status ao montar (`cooldownSyncedFromServerRef` — só uma vez por montagem, não a cada poll de 3s).
- Botão **Sincronizar conversas**: spinner + **tempo decorrido em segundos** durante o sync; após **~15s** aparece aviso de que pode levar 1–2 minutos com muitos contatos.
- Erros de sync não silenciados; 429 mostra mensagem amigável no `syncResult`.
- Transição **connected** continua chamando `syncChats()` uma vez; se vier **429**, apenas alinha cooldown — não segunda rajada.

---

## Risco de banimento WhatsApp — mapa rápido (Evolution)

Referência para revisões futuras; **sem garantias legais** — só orientação técnica.

| Chamada Evolution | Arquivo(s) | Toca servidor Meta/WhatsApp? |
|-------------------|------------|--------------------------------|
| `sendText` | `messages/send` | **Sim** — mensagens reais |
| `whatsappNumbers` | `instance/sync` | **Sim** — checagem de números em batches |
| `findChats`, `findMessages` | `post-login-sync`, `load-history`, `instance/sync` | **Não** — cache Baileys local no servidor Evolution |
| `getBase64FromMediaMessage` | `evolution/client.ts` → rota `messages/[messageId]/media` | **Não** — descriptografa mídia já no cache local Baileys (mesmo perfil que `findMessages`; **sem** tráfego adicional para servidores Meta no fluxo típico) |
| `getConnectionState`, `connect`, `setWebhook` | várias rotas | Maioria não é “envio em massa”; gestão de sessão |

**Mitigações já no código:**

- Envio: fila + jitter **250–800ms** entre mensagens consecutivas (`conversas-content.tsx`).
- **Mídia na UI:** vídeo e áudio **lazy** (vídeo só carrega após “Reproduzir”; áudio `preload="none"` até play) — evita rajada de `getBase64FromMediaMessage` ao abrir chats cheios de mídia.
- `instance/sync`: batches `whatsappNumbers` com delay **500–900ms** entre lotes + cooldown **60s** UI + **60s server** (`last_manual_sync_at`). **Além disso**, só monta **`numbersToCheck`** para contatos onde o lookup agrega valor (novos / sem nome na janela ativa — ver secção **Janela de 30 dias**).
- `post-login-sync`: sem `whatsappNumbers`; cooldown **60s** server (`last_post_login_sync_at`).

**Implementado (Leva 1 — maio/2026):** `pullEvolutionForActive` no `setInterval` agora é desligado quando `useWhatsAppHealth` reporta `healthy=true` (webhook bateu `webhook_last_seen_at` < 60s **E** canal Realtime `SUBSCRIBED` > 30s). Pull à Evolution continua existindo on-demand (abrir chat, botão refresh). Ver secção **Polling adaptativo + hub semântico**.

---

## Resposta a mensagem específica (reply / citação — estilo WhatsApp)

Implementado ponta a ponta: envio via Evolution com quote Baileys, persistência, webhook/load-history e UI.

### Banco (Supabase)

Migration **`whatsapp_messages_add_quoted_columns`** (projeto ativo do CRM):

- `quoted_evolution_message_id text` — stanzaId da mensagem citada (sem FK; mensagem antiga pode não existir no banco).
- `quoted_body text` — snapshot do texto citado (preview).
- `quoted_from_me boolean` — cor da faixa na UI (verde = nossa; azul = contato).
- Índice parcial `(company_id, quoted_evolution_message_id)` onde não é null.

Tipos TS em **`WhatsAppMessage`** (`database.ts`).

### Backend

- **`evolution.sendText`** — opcional `quoted: { evolutionMessageId, fromMe, remoteJid, body }` monta corpo `quoted: { key, message: { conversation } }` para `POST /message/sendText/{instance}`.
- **`POST /api/whatsapp/messages/send`** — body opcional **`replyToMessageId`** (uuid local de `whatsapp_messages.id`). Valida mesmo `company_id` + mesmo `chat_id`, resolve `evolution_message_id` da original, envia com quote, insere/atualiza linha com colunas `quoted_*`. Se `replyToMessageId` inválido, envia texto sem quote (não falha o envio).
- **Webhook** — **`extractQuoted(message, remoteJid, topLevelContextInfo?)`**: primeiro tenta **`contextInfo` top-level** no payload Evolution (`data.contextInfo`) — obrigatório para **`messageType: "conversation"`** (texto curto), onde o reply **não** fica dentro de `extendedTextMessage.contextInfo`. Depois percorre os sub-objetos (`extendedTextMessage`, `imageMessage`, …). `stanzaId` → id citado; `participant !== remoteJid` (JID canônico do chat) → mensagem citada era nossa (heurística chat individual).
- **`load-history`** e **`post-login-sync`** — mesma assinatura: passam **`r.contextInfo`** do record da Evolution além de **`r.message`**.

### UI (`conversas-content.tsx`)

- Botão **Responder** (hover, ícone seta) em cada bolha; não em mensagens `temp-*`.
- Estado **`replyingTo`** + barra acima do textarea (faixa lateral verde/azul, preview, **X** ou **Esc** para cancelar).
- Ao **trocar de chat**, reply é cancelado.
- **`MessageBubble`:** bloco de citação no topo da bolha; **clique** no quote chama **`jumpToQuote(quoted_evolution_message_id)`** — scroll até mensagem com mesmo `evolution_message_id` + pulse ~1,5s (silencioso se a original ainda não foi carregada na janela paginada — ver **Paginação de mensagens**).
- Envio: `fetch(.../send, { replyToMessageId })`; mensagem otimista já inclui `quoted_body` / `quoted_from_me` para feedback imediato.

### Pontos de atenção para retomada

- **Evolution:** se `quoted` no JSON não for aceito por alguma versão, checar log 502 e payload da API; formato esperado é compatível Baileys v2.
- **Quote sem `quoted_evolution_message_id`:** clicável desabilitado (sem scroll).
- **Mensagens antigas já gravadas** com **`quoted_*` null** por causa do bug do top-level **não são reescritas** automaticamente pelo `load-history` (idempotência por `evolution_message_id`). Novas mensagens e novos imports passam a gravar corretamente. **Melhoria opcional futura:** patch que atualize só `quoted_*` quando existir `stanzaId` e a linha já existir.
- **Grupos:** webhook ignora **`@g.us`** (não individuais); chats **`@lid`** / **`@s.whatsapp.net`** / **`@c.us`** individuais são tratados após **`canonicalRemoteJid`**.

---

## Envio de mídia + links clicáveis (maio/2026)

**Escopo entregue:** envio de **imagem, vídeo, documento** com caption opcional e suporte a reply; **URLs clicáveis** em todas as bolhas (texto puro e captions). **Áudio fora do escopo** — não há gravação no navegador nem upload de áudio.

**Limite por arquivo:** 4 MB. Validado **client (UX)** e **server (defesa em profundidade)**. Transporte cliente → servidor por `multipart/form-data` (binário 1:1, fica abaixo do limite Vercel de 4.5 MB). Servidor converte para base64 antes de chamar Evolution.

### Evolution client — `src/lib/evolution/client.ts`

**`evolution.sendMedia(instanceName, jid, params)`** chama `POST /message/sendMedia/{instance}`:

- `mediatype: "image" | "video" | "document"` — controla como o WhatsApp do destinatário renderiza.
- `mimetype`, `media` (base64 puro), `fileName` — obrigatórios.
- `caption`, `linkPreview`, `quoted` — opcionais. `quoted` segue o mesmo formato Baileys de `sendText`.
- **Risco de ban:** mesmo perfil de `sendText` (toca servidor Meta). Mantém o jitter 250–800ms da fila de envio quando há rajada.

### Backend — `src/app/api/whatsapp/messages/send-media/route.ts` (nova rota)

- Lê `multipart/form-data`. Campos: `file` (File), `chatId` (string), `caption?`, `replyToMessageId?`.
- Valida `file.size <= 4 MB` → **413** `code: "TOO_LARGE"` se ultrapassa.
- Detecta `mediaType` pelo `file.type`: `image/*` → image, `video/*` → video, resto → document.
- Resolve `quotedSnapshot` igual `[send/route.ts](src/app/api/whatsapp/messages/send/route.ts)` (mesmas validações de empresa/chat).
- `Buffer.from(arrayBuffer).toString("base64")` → `evolution.sendMedia(...)`.
- Insere linha em `whatsapp_messages` com `media_type`, `media_mime_type`, `body=caption`, `evolution_message_id`, e atualiza `whatsapp_chats.last_message_preview` (`[imagem]` / `[video]` / `[documento]` ou caption truncado em 120 chars).
- Idempotência: se o webhook já inseriu (race), apenas atualiza `sender_user_id` + `media_type` + `media_mime_type` + (opcional) `body`/`quoted_*`.
- Trata 502 (Evolution) e 409 (NOT_CONNECTED) iguais ao `/send`.

### UI — `src/app/[domain]/conversas/conversas-content.tsx`

**A. Botão clipe + input file** no `<form>` do envio:

- Ícone de clipe à esquerda do textarea (estilo WhatsApp Web).
- `<input type="file" hidden accept="image/*,video/*,application/pdf,application/msword,...">`.
- `handlePickFile` reseta `input.value=""` antes de abrir (permite reselecionar o mesmo arquivo após cancelar).
- `handleFileSelected` valida tamanho client-side (mesmo limite 4 MB) e abre o modal de preview.

**B. Componente `MediaPreviewDialog`** (no mesmo arquivo, próximo ao `MediaLightbox`):

- Modal fullscreen escuro (`bg-black/90`).
- Header: botão **X** à esquerda + nome do arquivo no centro.
- Preview central:
  - **Imagem**: `<img>` com `object-contain`.
  - **Vídeo**: `<video controls>` autoplay desligado para o operador conferir antes de enviar.
  - **Documento**: card com ícone, nome do arquivo, extensão e tamanho (`formatFileSize`).
- Footer: `<textarea>` de caption ("Adicionar uma legenda... (opcional)") + botão **Enviar** verde com ícone de avião.
- `Esc` cancela. `Enter` no caption envia (`Shift+Enter` = nova linha).
- `URL.createObjectURL(file)` criado dentro do modal (encapsulamento). Revogado no unmount via `useEffect`.

**C. `handleSendMedia(file, caption)`**:

- Cria `tempId` + `objectURL` próprio (independente do modal — cada ciclo de vida isolado).
- Mensagem otimista com `media_type` correto, `body=caption ?? null`.
- Adiciona à `tempMediaPreviews` (state `Map<tempId, objectURL>`) e à `tempMediaPreviewsRef` (espelho para cleanup no unmount).
- Encadeia na **mesma `sendQueueRef`** do envio de texto → 3 imagens + 1 texto em rajada chegam ao destinatário na ordem disparada. Jitter 250–800ms aplicado quando a fila não estava vazia (mesmo critério do texto).
- `fetch("/api/whatsapp/messages/send-media", { method: "POST", body: FormData })`.
- Sucesso: troca `tempId → realId` em `setMessages` e em `tempMediaPreviews`; `setTimeout(30s, revokeObjectURL)` libera memória após o Realtime entregar a linha real e a rota `/media` cachear.
- Erro/falha: bolha marcada `failed`, mensagem em `setSendError`, `URL.revokeObjectURL` imediato.

**D. Thumbnail otimista em `MessageImage` / `MessageVideo`**:

- Ambos ganharam prop `srcOverride?: string | null`.
- Quando passada, renderizam imediatamente com a URL local em vez de chamar `/media`. Sem placeholder "Reproduzir" para vídeo otimista.
- `MessageBubble` calcula `canUseOptimisticPreview = isTemp && tempPreviewUrl && (image|video)` e passa `srcOverride` correspondente.
- **Documento temp-** continua mostrando fallback `[enviando documento...]` (preview de PDF/DOCX no DOM não agrega para um envio que dura poucos segundos).

**E. Links clicáveis — `renderTextWithLinks(text)`**:

- Regex `(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/gi`. Cobre >95% das URLs reais em chats de clínica.
- Pontuação final (`.,!?)]}>;:`) é **removida do `<a>`** e mantida como texto plano fora — evita o clássico bug "link com . no final que não abre".
- `www.*` recebe `https://` no `href` automaticamente (texto visível permanece `www.*`).
- `target="_blank" rel="noopener noreferrer"` + classe `text-blue-600 underline [overflow-wrap:anywhere]`.
- `onClick={e => e.stopPropagation()}` evita disparar click do quote/bolha por engano.
- Aplicada nos 3 `<p>` que renderizam `message.body` no `MessageBubble`: caption de imagem, caption de vídeo e texto puro.
- **Não** aplicada no `quoted_body` da citação (a citação é botão "ir para original" — URL ali atrapalha).

### Cenários cobertos

| # | Cenário | Esperado |
|---|---|---|
| 1 | Imagem 200 KB JPEG sem caption | Thumb local imediato; troca para `/media` após resposta; status "entregue" via webhook |
| 2 | Imagem com caption contendo URL | Caption clicável; sem deslocar painel |
| 3 | Vídeo MP4 com caption | Player local imediato; troca para fluxo normal após id real |
| 4 | PDF 500 KB | Card de documento; click abre `DocumentLightbox` |
| 5 | Mídia como reply | Modal de preview mantém barra de reply; backend resolve `quoted_*` |
| 6 | Imagem 5 MB | Bloqueada client com `setSendError` |
| 7 | Envio com instância desconectada | Server 409; bolha `failed` |
| 8 | URL `https://exemplo.com` | Clicável, abre nova aba |
| 9 | URL `www.foo.com` | Auto-prepend `https://` no href |
| 10 | URL no início, meio e fim | Texto ao redor preservado |
| 11 | Texto sem URL | Sem `<a>`, sem regressão |
| 12 | Caption + URL longa | `[overflow-wrap:anywhere]` impede deslocamento |
| 13 | Rajada (3 imagens + 1 texto) | `sendQueueRef` preserva ordem; jitter entre envios |

### Pontos de atenção

- **Limite de tamanho** é decidido pelo Vercel (4.5 MB body default) — não pelo WhatsApp em si (que aceita até 16 MB de imagem/vídeo, 100 MB de documento). Para arquivos maiores, próxima leva: upload via Supabase Storage + URL pública para `evolution.sendMedia({ media: url })`.
- **Vídeo otimista vira placeholder ao trocar id**: durante a transição `tempId → realId` (segundos), o componente re-renderiza sem `srcOverride` e cai no placeholder "Reproduzir vídeo". É tolerável — operador acabou de ver o preview no modal e na bolha temp-.
- **Áudio**: caminho intencional bloqueado. UI não tem botão de microfone. O `MessageAudio` continua existindo apenas para mídia **recebida**.
- **Eventos `MESSAGES_EDITED`**: o envio de mídia pelo CRM não emite edição (WhatsApp só permite editar texto). Mídia editada via app oficial ainda dispara o webhook como mensagem nova, não como edição.

---

## Mídia na conversa (receber, visualizar, baixar)

A `media_url` que vem do Baileys nos payloads (**webhook** / **`findMessages`**) costuma ser URL **criptografada** do WhatsApp (`mmg.whatsapp.net/...`) — **não** serve para `<img src>` direto. O CRM decodifica via Evolution e serve bytes autenticados pela sessão do operador.

### Evolution — `getBase64FromMediaMessage`

- **`src/lib/evolution/client.ts`** — método **`evolution.getBase64FromMediaMessage(instanceName, evolutionMessageId, { convertToMp4? })`**
- Chama **`POST /chat/getBase64FromMediaMessage/{instance}`** (OpenAPI Evolution v2).
- Body típico: **`{ message: { key: { id: evolutionMessageId } }, convertToMp4: boolean }`**.
- Resposta: objeto com **`base64`** (às vezes em formato **data URI** `data:mime;base64,...`), opcionalmente **`mimetype`**, **`fileName`**.

**Risco de ban:** leitura do **cache local Baileys** na Evolution — **mesmo perfil** de `findMessages` / `findChats` (não é envio em massa para servidores Meta).

### Rota CRM — `GET /api/whatsapp/messages/[messageId]/media`

- **`messageId`** na URL = **uuid** de `whatsapp_messages.id` (não o `evolution_message_id`).
- Auth: usuário logado; valida **`company_id`** da mensagem, chat e instância **`connected`**.
- Lê **`evolution_message_id`** da linha; chama **`getBase64FromMediaMessage`**.
- **`convertToMp4: true`** quando **`media_type === "video"`** (codec tocável no `<video>` nativo).
- Query **`?download=1`**: **`Content-Disposition: attachment`** (download explícito); sem query → **`inline`** (preview no browser / iframe).
- Helpers: **`buildFallbackFilename`**, **`escapeContentDispositionFilename`**.
- **`Cache-Control: private, max-age=3600`**.

### UI — `conversas-content.tsx`

Componentes client-side (todos usam **`mediaUrl(messageId)`** ou **`downloadMedia(messageId)`** com `fetch` + blob):

| `media_type` | Comportamento |
|--------------|---------------|
| **sticker** | `<img>` ~128px; fallback `[sticker]` em erro. |
| **image** | Thumb (max-h-64); click abre **`MediaLightbox`** (fullscreen + baixar). Caption em **`body`** abaixo se houver. |
| **video** | Placeholder “Reproduzir vídeo”; após click, `<video controls autoPlay>` (lazy — não dispara GET até play). Caption em **`body`** se houver. |
| **audio** | **`MessageAudio`**: play/pause, barra clicável (seek), velocidade 1x / 1.5x / 2x, tempo, download; `<audio preload="none">`; workaround **`duration=Infinity`** em OGG/Opus (seek alto + `durationchange`). |
| **document** | Card estilo WhatsApp (**`MessageDocument`**): ícone, nome (**`body`** = caption ou `fileName` do webhook), extensão; **PDF**: botão preview + **`DocumentLightbox`** (`<iframe src={mediaUrl}>`); download sempre. Outros tipos: click principal = download. |

**Lightbox unificado:** estado **`lightbox`**: objeto com **`kind`: `"image"` ou `"document"`** + **`messageId`**, ou **`null`** se fechado — prop **`onOpenMedia(kind, id)`** no **`MessageBubble`**.

**Requisito para renderizar mídia rica:** linha com **`evolution_message_id`** e **não** `temp-*`; senão fallback **`[tipo]`**.

### Webhook / `load-history` (extração de documento)

- **`documentMessage`**: `body` = caption ?? fileName; **`media_type: "document"`**; **`media_url` / `media_mime_type`** como no proto Baileys (URL encriptada é persistida mas a UI **não** usa direto — só a rota `/media`).

---

## Reações em mensagens (estilo WhatsApp)

**Problema original:** reações recebidas (`reactionMessage` no payload Baileys) entravam no CRM como **mensagens** com `body = null` e `media_type = "unknown"`, renderizando bolhas vazias com `[unknown]`. Idealmente uma reação deve aparecer como **badge** abaixo da bolha original, como no app oficial.

### Banco (Supabase)

- Migration **`whatsapp_messages_add_reactions_column`**: nova coluna **`reactions jsonb NOT NULL DEFAULT '[]'::jsonb`** em `whatsapp_messages`.
- Estrutura de cada item: `{ emoji: string, from_me: boolean, reactor_jid: string | null, ts: string }` (ISO).
- Cleanup: durante a janela de edição rodaram dois `DELETE FROM whatsapp_messages WHERE media_type='unknown' AND body IS NULL` para limpar lixo já gravado.

### Tipos TS

- **`WhatsAppMessageReaction`** em `src/lib/types/database.ts`; **`WhatsAppMessage`** ganhou campo `reactions: WhatsAppMessageReaction[]`.

### Util compartilhado — `src/lib/whatsapp/reactions.ts`

- **`QUICK_REACTION_EMOJIS`** (6 fixos): 👍, ❤️, 😂, 😮, 😢, 🙏 — picker rápido tipo WhatsApp.
- **`mergeReactions(current, incoming)`** — **idempotente**:
  - Filtra qualquer reação prévia **do mesmo reator** (chave: `from_me`; `reactor_jid` é tiebreak caso multi-operador no futuro).
  - **`incoming.emoji === ""`** ⇒ apenas remove (sem adicionar). Mesmo comportamento do Baileys quando o app oficial envia `text=""` no `reactionMessage`.
  - **`incoming.emoji !== ""`** ⇒ sempre **substitui** (até se for o mesmo emoji). **Não há toggle aqui** — esse comportamento foi movido para a UI.
- **`normalizeReactions(raw)`** — coerce defensivo de JSONB do banco para `WhatsAppMessageReaction[]` bem-tipado.

### Evolution client — `sendReaction`

- **`evolution.sendReaction(instanceName, { evolutionMessageId, fromMe, remoteJid }, emoji)`** em `src/lib/evolution/client.ts`.
- Chama **`POST /message/sendReaction/{instance}`**; body monta `reactionMessage: { key: { id, fromMe, remoteJid }, text: emoji }`. `text=""` remove.
- Risco de ban: usa **mesmo canal de envio** do `sendText` (`messages/send`) — tocando servidor Meta. Não é envio em massa por design, mas vale aplicar mesmo jitter se um dia for spammado.

### Webhook — `src/app/api/whatsapp/webhook/[instance]/route.ts`

- **`extractReaction(rawMessage, fromMe, reactorJid)`** detecta `reactionMessage` no payload e devolve:
  - **`targetEvolutionMessageId`** (do `key.id` da mensagem original).
  - Objeto **`WhatsAppMessageReaction`** pronto pra merge.
- Quando o payload é **`reactionMessage`**:
  - Procura a linha original (`whatsapp_messages` filtrado por `company_id` + `evolution_message_id`).
  - **NÃO** insere mensagem nova.
  - `update reactions = mergeReactions(current, incoming)` na linha existente.
  - Se a mensagem original ainda não está no banco (chegou fora de ordem), a reação é descartada com warning — o `load-history` posterior vai reentregar pelo `messages.upsert`.
- **Filtro de `[unknown]`:** payloads com **`mediaType === "unknown" && !body`** **NÃO** são inseridos — evita lixo (reações antigas, status updates, etc.).

### `load-history` e `post-login-sync`

Mesmo padrão do webhook: durante o loop de processamento mantém um `Map<targetId, WhatsAppMessageReaction[]>` acumulando todas as reações observadas naquele batch; após o `INSERT` em lote das mensagens novas, faz um **`select` em massa** das linhas alvo + **`update` linha-a-linha** com `mergeReactions`. Idempotente por construção (re-receber a mesma reação não duplica).

### Rota — `POST /api/whatsapp/messages/[messageId]/react`

- **`messageId`** = uuid local de `whatsapp_messages.id`.
- Body: `{ emoji?: string }`. Aceita **string vazia (remoção)** ou um dos `QUICK_REACTION_EMOJIS` — allowlist server-side.
- Pipeline:
  1. Auth do usuário; resolve `company_id` via `users.auth_id`.
  2. Carrega mensagem (valida `company_id`), chat e instância (valida `connected`).
  3. **Envia primeiro via Evolution `sendReaction`**; se falhar, **NÃO** atualiza o banco — UI vê o erro.
  4. Sucesso: `update reactions = mergeReactions(current, { emoji, from_me: true, reactor_jid: null, ts: now() })`.
- Responde **`{ ok: true, reactions: merged }`**.
- 503 quando Evolution não configurada; 502 em falha do Evolution; 409 quando instância **`!== "connected"`** ou mensagem sem `evolution_message_id` (temp).

### UI — `MessageBubble` em `conversas-content.tsx`

- Botão **smiley** (hover, ao lado do botão Responder) abre um **picker flutuante** com `QUICK_REACTION_EMOJIS`.
- Clique no emoji chama **`reactToMessage(messageId, emoji)`** (otimista: atualiza o array local antes da resposta da rota).
- **Toggle no front-end** (`handlePickEmoji`): se o operador clica no mesmo emoji que **já** aplicou, envia **`""`** (remove) em vez de re-aplicar. Decisão importante: o backend NÃO faz toggle (`mergeReactions` foi simplificado pra ser idempotente — ver bug histórico abaixo).
- Badge abaixo da bolha:
  - `groupReactions` agrupa por emoji com **`count`** + flag `mine` (se algum item tem `from_me === true`).
  - Container `relative z-10 -mt-2 flex flex-wrap` — fica **acima** da bolha (z-index), com `-mt-2` para overlap do padding (sem cobrir o status “entregue”).
  - Cada badge: `shadow-md ring-2 ring-white` — efeito flutuante estilo WhatsApp.
- Clique no badge: o **próprio** emoji do operador chama `reactToMessage(id, "")` (remove); um emoji só do contato aplica o mesmo emoji a partir do operador.
- Bolhas com **`media_type === "unknown" && !body && reactions.length === 0`** retornam `null` (fallback para linhas legacy ainda não limpas).

### Bug histórico — “reações somem e voltam”

**Causa:** uma versão anterior de `mergeReactions` tinha **toggle**: se o emoji recebido era igual ao já aplicado pelo mesmo reator, removia. Mas o webhook entrega o `reactionMessage` **mais o** `load-history` re-entrega o mesmo evento alguns segundos depois (polling de 15s no chat ativo) → o segundo evento era interpretado como “mesmo emoji ⇒ toggle off ⇒ remove”, o badge sumia; o terceiro evento (próximo polling) re-adicionava. Loop visível ao operador.

**Fix:**

1. **Backend idempotente:** `mergeReactions` agora só remove com `emoji === ""`. Receber o mesmo emoji 10× em sequência mantém o badge estável.
2. **Toggle no front-end:** `handlePickEmoji` decide se a intenção é “aplicar” ou “remover” comparando com o estado atual e envia explicitamente `""` quando é remoção.

---

## Hydration warning — `suppressHydrationWarning` no `<body>`

**Sintoma:** console do Next mostrava hydration mismatch apontando atributos como **`cz-shortcut-listen="true"`** no `<body>` do HTML do servidor vs. cliente.

**Causa:** extensões de browser (ColorZilla com `cz-shortcut-listen`, Grammarly com `data-gr-ext-installed`, etc.) injetam atributos no `<body>` **antes** do React hidratar. O React detecta a divergência e dispara warning — mas é inofensivo (nada quebra de fato).

**Fix:** em **`src/app/layout.tsx`**, adicionado **`suppressHydrationWarning`** no `<body>`. O escopo é apenas **atributos deste elemento**; mismatches reais em filhos ou conteúdo continuam sendo reportados normalmente.

---

## Painel de conversa “desloca para a direita” quando entra em contato

**Sintoma:** ao abrir um chat com mensagem contendo URL muito longa sem espaços (ex.: `https://l.facebook.com/l.php?u=...` com 600+ caracteres), o painel inteiro de conversa “escorregava” para fora da viewport e o operador não conseguia ver as mensagens nem o textarea de envio.

**Causa raiz:** em CSS Flexbox, **`flex` items têm `min-width: auto` por padrão**, o que faz o item crescer para acomodar o conteúdo intrínseco. A `<section>` do painel de conversa tinha `flex-1` mas **não** `min-w-0`, então uma “palavra” gigante (URL sem espaço) forçava o flex item a expandir além do parent, mesmo o parent tendo `overflow-hidden`. O `break-words` (`overflow-wrap: break-word`) sozinho não força quebra dentro de uma palavra ininterrupta nesse cenário.

**Fix em `src/app/[domain]/conversas/conversas-content.tsx`:**

1. **`min-w-0`** na **`<section className="flex flex-1 flex-col bg-gray-50">`** (linha ~1322) — permite o flex item ser comprimido até a largura real disponível.
2. **`min-w-0`** no scroll container interno **`<div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-6 py-4">`** (linha ~1415) — mesma razão um nível abaixo.
3. **`[overflow-wrap:anywhere]`** adicionado nos três `<p>` que renderizam `message.body` (caption de imagem, caption de vídeo e texto puro) — força quebra em **qualquer** ponto dentro da palavra quando necessário. Mais agressivo que `break-words` sem o efeito colateral de `break-all` (que quebraria texto normal sem necessidade).

Padrão para evitar regressão futura: qualquer flex item filho de container com largura limitada que possa receber conteúdo intrínseco largo (URL, hash, base64) precisa de **`min-w-0`** + textos de mensagem com **`[overflow-wrap:anywhere]`**.

---

## Diagnóstico rápido — “últimas mensagens não aparecem no CRM”

1. **Webhook alcançável?** `EVOLUTION_WEBHOOK_BASE_URL` na Evolution + tunnel em dev (ver secção Cloudflare).
2. **Contato migrou para `@lid`?** No servidor Evolution, `findMessages` no `@s.whatsapp.net` pode parar no último timestamp antes da migração; o CRM agora usa **`canonicalRemoteJid`** no webhook/sync e **fallback `@lid` no `load-history`** (ver secções acima).
3. **Evolution deslogada / cache velho?** `fetchInstances` pode mostrar `disconnectionReasonCode` histórico mesmo com `connectionStatus: open`; se mensagens globais estão paradas, reconectar instância pode ser necessário no painel Evolution.

---

## Edição de mensagem WhatsApp (Leva 3 + 3.5 — maio/2026)

**Suporte:** Evolution API ≥ 2.3.5; instalação atual em 2.3.7.

Cobre **dois fluxos**:

1. **Recebimento** — operador edita pelo celular ou contato edita do lado dele → CRM atualiza a bolha em tempo real e mostra o badge "editada".
2. **Saída** (Leva 3.5) — operador edita pela bolha do CRM → backend chama Evolution → mensagem é alterada também no celular do destinatário e a bolha local atualiza otimisticamente.

### Banco (Supabase)

Migration **`whatsapp_messages_add_edit_columns`**:

- `edited_at timestamptz NULL` — timestamp da última edição. `NULL` = nunca editada.
- `original_body text NULL` — snapshot do `body` antes da **primeira** edição. `NULL` se nunca editada ou se o body já era null.
- `edit_count int NOT NULL DEFAULT 0` — contador de edições incrementado a cada UPDATE.

### Evolution client — `src/lib/evolution/client.ts`

- `MESSAGES_EDITED` adicionado à lista de `events` nos métodos `createInstance` e `setWebhook` (mesmo que a Evolution 2.3.x não emita esse evento de forma consistente — ver "Webhook resiliente" abaixo).
- **`evolution.editMessage(instanceName, { number, text, key })`** — chama `POST /chat/updateMessage/{instance}`. `key` traz `{ id, remoteJid, fromMe }` da mensagem original. Restrições do WhatsApp validadas antes (15 min, fromMe, texto puro) — Evolution rejeita do lado dela se algo escapar.

### Webhook — `src/app/api/whatsapp/webhook/[instance]/route.ts`

**Caminho rápido (Leva 3.6 — correção real em produção):** o bloco principal de `messages.upsert` / `messages.update` / `messages.edited` exige **`data?.key`** para resolver `remoteJid` → chat. Na prática a Evolution 2.3.7 envia edições assim:

- **`messages.update` com `data.message.editedMessage`** mas **`data.key` ausente** no nível externo (só a key vem *dentro* do envelope `editedMessage`).
- **`messages.edited` com `data.key` preenchido** mas **`data.message` nulo** — o texto pode vir em `data.editedMessage`, `data.text`, etc.

Por isso existe um **handler antecedente**: para `messages.update` **ou** `messages.edited`, chama-se **`extractEditFromData(data)`** (que por sua vez usa **`extractEditedMessageBody` em `data.message`** e fallbacks top-level). Se `newBody !== null`, aplica o `UPDATE` em `whatsapp_messages` por `evolution_message_id` **sem** depender de `data.key` externo.

**Formatos cobertos (resumo):**

| Formato | Onde | Novo texto / ID original |
|---------|------|--------------------------|
| A | `data.message` direto | `conversation` / `extendedTextMessage.text` |
| B/C | `data.message.protocolMessage` | `editedMessage` + `key.id` |
| D | **`data.message.editedMessage`** (envelope Baileys) | `editedMessage.message` (texto ou `protocolMessage` interno) + `editedMessage.key` |
| Top-level | `data` sem `message` útil | `data.text`, `data.body`, `data.editedMessage`, cruzado com `data.key` |

Após o `UPDATE` da mensagem: se o registro editado for a **mensagem mais recente** do `chat_id` (ordenar por `created_at DESC`), também atualiza **`whatsapp_chats.last_message_preview`** com os primeiros 120 caracteres do novo texto — evita prévia lateral desatualizada após edição pelo celular ou pelo outro participante.

Diagnóstico em dev:

- `[webhook] message-event-debug` — chaves do `data`, `key`, `messageKeys`, `hasEditedMessage`, etc.
- **`[webhook] edit-payload-dump`** — JSON do `data` truncado (~4k) quando o evento parece edição mas o corpo não foi extraído.

Fluxo resumido após extrair `newBody`:

1. `targetEvoId = editExtract.originalEvoId ?? data?.key?.id`
2. `UPDATE whatsapp_messages` (body, `edited_at`, `original_body`, `edit_count`)
3. Se última mensagem do chat → `UPDATE whatsapp_chats.last_message_preview`
4. Realtime → `onMessageUpdate` → UI

**Observação:** `load-history` devolve mensagens já com texto final no cache Baileys; os campos de auditoria (`edited_at`, etc.) consolidam-se principalmente via webhook.

### Backend — `PATCH /api/whatsapp/messages/[messageId]/edit` (Leva 3.5)

Body: `{ "body": "novo texto" }` (trim aplicado; vazio → 400).

Validações (em ordem; primeira que falhar retorna erro claro):

1. Sessão autenticada → 401.
2. Mensagem existe e pertence à `company_id` do operador → 404.
3. `from_me === true` → 403 (`So e possivel editar mensagens enviadas por voce.`).
4. `media_type === "text"` → 422 (mídia não suportada no MVP).
5. `evolution_message_id` presente → 409 (mensagem otimista ainda em envio).
6. Texto novo ≠ `body` atual (pós-trim) → 422 (evita gastar request à Meta).
7. `Date.now() - sent_at < 15 min` → 422 com `code: "EDIT_WINDOW_EXPIRED"`.
8. Instância `status === "connected"` → 409 com `code: "NOT_CONNECTED"`.

Se passar, chama `evolution.editMessage` **antes** de tocar o banco. Em sucesso, `UPDATE body = newBody, edited_at = now, original_body = original_body ?? body, edit_count++` e devolve a row atualizada. Se a mensagem editada for a **mais recente** do chat, também atualiza **`whatsapp_chats.last_message_preview`** (alinhado ao webhook).

### UI — `conversas-content.tsx`

**Badge "editada" no rodapé da bolha** (Leva 3, recebimento):
- Ícone de lápis (SVG 9×9) + texto `editada` em itálico, em `text-gray-500`.
- `title` com data/hora completa (`toLocaleString("pt-BR")`).
- Posicionado à esquerda da hora.

**Botão "Editar" no menu de ação** (Leva 3.5, saída):
- SVG lápis 13×13, ao lado de Reply e Reagir, escondido por default e visível em hover (`opacity-0 group-hover/msg:opacity-100`).
- Aparece apenas quando `canEditMessageNow(message)` é true: `from_me === true` + `media_type === "text"` + `evolution_message_id` presente + `id` real (não temp) + `Date.now() - sent_at < 14:30 min` (folga de 30s do limite de 15 min para evitar race).

**Barra "Editando mensagem" acima do input** (estilo WhatsApp):
- Cor âmbar (`border-amber-200 bg-amber-50`) para distinguir visualmente do reply (que é cinza/azul/verde).
- Mostra `Original: <texto>` truncado, ícone lápis, e botão X (cancela; Esc também cancela).
- Reply e edição são **mutuamente exclusivos** — ativar um cancela o outro.

**Estados e funções (em `conversas-content.tsx`):**
- `editingMessage: { messageId; originalBody } | null` — snapshot do que está sendo editado.
- `editing: boolean` — request em voo, desabilita o botão Salvar.
- `startEdit(message)` — pré-preenche `draft` com `body` original; cancela `replyingTo`.
- `cancelEdit()` — limpa `editingMessage` e `draft`.
- `submitEdit()` — valida 15 min de novo (defesa contra mensagem antiga visível na UI), faz UPDATE otimista local, chama `PATCH /edit`, em erro faz rollback completo do snapshot (mensagem **e** `last_message_preview` no array `chats` quando a edição era da última mensagem).
- `handleSend` — redireciona para `submitEdit` quando `editingMessage !== null`.
- `handleKey` — Esc cancela edição (preferência sobre cancelar reply).
- Cleanup ao trocar de chat: zera `editingMessage` e `draft` (snapshot referencia mensagem do chat anterior).

**Botão Salvar:**
- Cor âmbar (`bg-amber-600`) em vez de verde para reforçar visualmente o modo "edição".
- Disabled quando texto está vazio, edição em voo, ou texto idêntico ao original.
- Texto: `Salvar` / `Salvando...` em modo edição; `Enviar` em modo normal.

**Anexar arquivo (clipe)** fica `disabled` em modo edição — não faz sentido trocar texto por mídia.

### Pontos de atenção (edição)

- **Instâncias existentes (recebimento):** após deploy, clicar em **Sync** nas Settings para que a Evolution registre `MESSAGES_EDITED` no webhook. **Mesmo sem depender só desse evento**, o **caminho rápido** com `extractEditFromData` cobre `messages.update` sem `data.key` e `messages.edited` sem `data.message`.
- **Janela de 15 minutos:** validada client-side (UI esconde botão) **e** server-side (rota retorna 422 com `code: "EDIT_WINDOW_EXPIRED"`). A folga de 30s no client evita que o botão fique visível mas o servidor rejeite.
- **Apenas texto:** mídia não pode ser editada nem na entrada nem na saída (WhatsApp não suporta caption-only edit de forma consistente; conservador no MVP).
- **`original_body` em mensagens antigas:** linhas gravadas antes desta leva têm `edit_count = 0` e `edited_at = null`. Não há backfill automático.
- **Risco de ban:** edição toca os servidores Meta — mesmo perfil de risco de `sendText`. Sem rate-limit dedicado: o operador edita uma mensagem por vez na UI, em volume baixo.

---

## Prévia do chat + indicadores de status (maio/2026)

**Problema:** a lista lateral mostrava só texto (`last_message_preview`); após edições feitas fora do CRM, a prévia podia ficar com o **texto antigo**. Os rodapés das bolhas usavam palavras “enviada / entregue / lida” em vez do padrão visual do WhatsApp.

**Banco — migration `whatsapp_chats_add_last_message_meta`**

- `last_message_from_me boolean NULL` — `true` se a última mensagem do chat foi **minha** (CRM ou celular da instância), `false` se recebida do contato.
- `last_message_status text NULL` — `pending` / `sent` / `delivered` / `read` / `failed` quando aplicável; na prática significativo quando `last_message_from_me = true`. **Backfill:** mensagem mais recente por `chat_id` (`created_at DESC`).

**Quem mantém as colunas**

| Origem | O que grava |
|--------|-------------|
| Webhook `messages.upsert` | Ao atualizar o chat após insert: `last_message_from_me`, `last_message_status` (`sent` se `from_me`, senão `null`), `last_message_preview`, etc. |
| Webhook `messages.update` (ACK) | Depois de atualizar `whatsapp_messages.status`, se o `evolution_message_id` é o da **última** mensagem do chat → atualiza `last_message_status` no registro do chat. |
| Webhook edição / `PATCH .../edit` | Se a mensagem editada é a mais recente → `last_message_preview` com o novo texto (até 120 chars). |
| `POST .../send` e `send-media` | `last_message_from_me: true`, `last_message_status: 'sent'` + preview. |
| `load-history` | Quando avança `last_message_at`/preview pelo batch mais recente, também preenche `last_message_from_me` e `last_message_status` (status só para mensagens `from_me`). |

**UI — componente `MessageStatusChecks` (`conversas-content.tsx`)**

- Ícones SVG no estilo WhatsApp: **1 check** (sent), **2 checks** cinza sobrepostos (delivered), **2 checks azuis** `sky-500` (read), **relógio** (pending), **!** vermelho (failed). Para `sent`, o segundo check fica `invisible` para evitar “pulo” de layout ao virar `delivered`.
- **Bolhas próprias:** substitui texto “enviada/entregue/lida”.
- **Prévia na lista lateral:** checks só quando **`last_message_from_me === true`** e há **`last_message_status`**; última mensagem do **contato** = só texto (como no app oficial).

---

## Painel do contato — nome editável (maio/2026)

**Onde:** **`ContactPanel`** em `conversas-content.tsx` (overlay lateral “Dados do contato”).

- **Lápis** ao lado do nome (`chat.name` ou fallback do telefone formatado).
- Modo edição: input (máx. 120), Salvar / Cancelar, **Enter** / **Esc**.
- Nome vazio salvo → `name = null` no banco → UI usa o telefone como rótulo.
- Com **lead vinculado:** botão **“Usar nome do lead”** preenche o campo com o nome do lead; confirmação manual com **Salvar**.
- **`renameChat`** no componente pai: `UPDATE whatsapp_chats` via Supabase client, atualização **otimista** do array `chats`, **rollback** com erro inline no painel.
- Troca de chat com o painel aberto: reseta modo edição e re-sincroniza o draft (não mistura contatos).

---

## Próximas melhorias possíveis (não implementadas ou parciais)

- Paginação “carregar mensagens mais antigas” já cobre o banco; **página 2 puramente na Evolution** (`findMessages` com `page` incremental) segue opcional se quiser histórico além do que está no Supabase.
- Preview de documentos **não-PDF** (DOCX/XLSX) — hoje só download; PDF usa `<iframe>` nativo.
- **Backfill** de colunas **`quoted_*`** em mensagens já existentes quando o payload Evolution trouxer `contextInfo` mas o insert original ignorou (update condicional por `evolution_message_id`).
- ~~Reduzir `pullEvolutionForActive` quando o webhook estiver claramente ativo~~
  **Implementado na Leva 1 (maio/2026)** — ver secção **Polling adaptativo + hub semântico**.
- ~~Edição de mensagem chegando do WhatsApp para o CRM via evento `MESSAGES_EDITED`~~
  **Implementado na Leva 3 (maio/2026)** — ver secção **Edição de mensagem**.
- ~~Edição de mensagem **saindo** do CRM (operador edita a bolha, repercute no WhatsApp do destinatário)~~
  **Implementado na Leva 3.5 (maio/2026)** — botão lápis no `MessageBubble`, rota `PATCH /api/whatsapp/messages/[id]/edit`, validação de janela de 15 min em ambas as pontas.
- ~~Recebimento de edições fora do CRM com prévia lateral e bolhas corretas (`extractEditFromData`, `last_message_preview` na última mensagem)~~
  **Implementado (maio/2026)** — ver secção **Edição de mensagem** (webhook caminho rápido).
- ~~Checks de status (✓ / ✓✓) na bolha e na prévia lateral; colunas `last_message_from_me` / `last_message_status`~~
  **Implementado (maio/2026)** — ver secção **Prévia do chat + indicadores de status**.
- ~~Painel do contato: editar e salvar nome (`whatsapp_chats.name`); atalho nome do lead~~
  **Implementado (maio/2026)** — ver secção **Painel do contato — nome editável**.
- ~~Envio de imagem/vídeo/documento pelo CRM com caption e reply~~
  **Implementado em maio/2026** — ver secção **Envio de mídia + links clicáveis**.
- **Envio de mídia > 4 MB**: hoje limitado a 4 MB pelo body default da Vercel. Para arquivos maiores, próxima leva pode usar Supabase Storage como intermediário (upload do cliente direto pro bucket; URL pública passada para `evolution.sendMedia({ media: url })`).
- **Áudio (gravação no navegador estilo PTT)**: intencionalmente fora desta leva. Requer `MediaRecorder` + endpoint `sendWhatsAppAudio` + UI de gravação tipo "press and hold".
- **Múltiplos arquivos por envio**: hoje 1 arquivo por modal. Igual ao WhatsApp Web original (que também envia 1 por vez), mas pode ser melhorado se houver demanda.
- **Picker estendido de reações** (botão “+” abrindo um seletor maior além dos 6 fixos). Hoje `QUICK_REACTION_EMOJIS` está congelado por simplicidade e allowlist server-side.
- **Backfill de reações antigas:** mensagens já gravadas como `[unknown]` antes da migration estão sendo limpas via `DELETE` manual; idealmente um job que detecte `reactionMessage` lookbehind no Evolution e popule `reactions` retroativamente.
- **Cache do tunnel Cloudflare em dev:** ao recriar o Quick Tunnel a URL muda — fluxo manual de copiar/colar em `.env.local` poderia ser automatizado por um script Node que faz `cloudflared tunnel --url --output json | jq ... > .env.local`.
