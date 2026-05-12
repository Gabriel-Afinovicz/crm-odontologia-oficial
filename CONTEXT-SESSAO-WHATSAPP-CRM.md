# Contexto da sessão — WhatsApp no CRM e produção na Vercel

**Útil como memória quando este chat não estiver disponível.**

**Última atualização:** 12 de maio de 2026 — lista lateral **sem filtro de 30 dias** (paginação “bloco de 30 + Carregar mais”), **reações em mensagens** (`reactions` jsonb, picker de 6 emojis, badges, webhook + load-history + post-login-sync + rota `POST /api/whatsapp/messages/[messageId]/react`), filtragem de bolhas `[unknown]` (reações eram recebidas como mensagens), correção do hydration warning (`suppressHydrationWarning` no `<body>`) e fix do painel de conversa deslocando para a direita (`min-w-0` + `[overflow-wrap:anywhere]`). *(Histórico anterior: paginação de mensagens, mídia, `@lid`, replies, sync incremental, fallback `load-history`.)*

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
- Após bulk insert bem-sucedido, se houver mensagem mais recente que `whatsapp_chats.last_message_at`, **atualizar** `last_message_at` + `last_message_preview`.

---

## Conversas já abertas antes desses fixes

Linhas antigas podem ficar com `created_at` “errados” até alguém apagar mensagens daquele `chat_id` ou limpar dados e recarregar o histórico (opcional por SQL conforme combinado).

---

## Arquivos-chave para retomada rápida

| Área | Arquivo |
|------|---------|
| Constantes WhatsApp (janela 30d — só sync incremental) | `src/lib/whatsapp/constants.ts` (`CHAT_VISIBILITY_DAYS`, `chatVisibilityCutoffIso`) |
| **Reações — emojis + `mergeReactions` + `normalizeReactions`** | `src/lib/whatsapp/reactions.ts` |
| Helpers JID / telefone (`canonicalRemoteJid`, `@lid`) | `src/lib/evolution/phone.ts` |
| Cliente Evolution (incl. `sendReaction`, `getBase64FromMediaMessage`) | `src/lib/evolution/client.ts` |
| Conectar WhatsApp | `src/app/api/whatsapp/instance/connect/route.ts` |
| Status instância (incl. `last_manual_sync_at`) | `src/app/api/whatsapp/instance/status/route.ts` |
| Sync chats (lista, pesado com whatsappNumbers) | `src/app/api/whatsapp/instance/sync/route.ts` |
| Sync pós-login (background, sem whatsappNumbers) | `src/app/api/whatsapp/post-login-sync/route.ts` |
| Webhook mensagens (incl. `reactionMessage`) | `src/app/api/whatsapp/webhook/[instance]/route.ts` |
| Histórico (incl. acumulação de reações em batch) | `src/app/api/whatsapp/messages/load-history/route.ts` |
| **Mídia decodificada (qualquer tipo com `evolution_message_id`)** | `src/app/api/whatsapp/messages/[messageId]/media/route.ts` |
| **Aplicar/remover reação (UI → Evolution)** | `src/app/api/whatsapp/messages/[messageId]/react/route.ts` |
| Enviar mensagem | `src/app/api/whatsapp/messages/send/route.ts` |
| Root layout (`suppressHydrationWarning`) | `src/app/layout.tsx` |
| Layout tenant — disparo sync background | `src/app/[domain]/layout.tsx` + `src/components/layout/whatsapp-post-login-sync.tsx` |
| Página Conversas (carga server-side, paginação sem 30d) | `src/app/[domain]/conversas/page.tsx` |
| UI Conversas (paginação, mídia, replies, **reações**) | `src/app/[domain]/conversas/conversas-content.tsx` |
| UI WhatsApp Settings | `src/components/settings/whatsapp-instance-manager.tsx` |
| Tipos Supabase / schema TS (incl. `WhatsAppMessageReaction`) | `src/lib/types/database.ts` |
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

**Melhoria futura opcional:** reduzir `pullEvolutionForActive` quando webhook estiver “vivo” (ex.: métrica `webhook_last_seen_at`) — só reduz carga na Evolution, não muda risco de ban.

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

## Próximas melhorias possíveis (não implementadas ou parciais)

- Paginação “carregar mensagens mais antigas” já cobre o banco; **página 2 puramente na Evolution** (`findMessages` com `page` incremental) segue opcional se quiser histórico além do que está no Supabase.
- Preview de documentos **não-PDF** (DOCX/XLSX) — hoje só download; PDF usa `<iframe>` nativo.
- **Backfill** de colunas **`quoted_*`** em mensagens já existentes quando o payload Evolution trouxer `contextInfo` mas o insert original ignorou (update condicional por `evolution_message_id`).
- Reduzir `pullEvolutionForActive` quando o webhook estiver claramente ativo
  (ver secção **Risco de banimento** — métrica tipo `webhook_last_seen_at`).
- **Picker estendido de reações** (botão “+” abrindo um seletor maior além dos 6 fixos). Hoje `QUICK_REACTION_EMOJIS` está congelado por simplicidade e allowlist server-side.
- **Backfill de reações antigas:** mensagens já gravadas como `[unknown]` antes da migration estão sendo limpas via `DELETE` manual; idealmente um job que detecte `reactionMessage` lookbehind no Evolution e popule `reactions` retroativamente.
- **Cache do tunnel Cloudflare em dev:** ao recriar o Quick Tunnel a URL muda — fluxo manual de copiar/colar em `.env.local` poderia ser automatizado por um script Node que faz `cloudflared tunnel --url --output json | jq ... > .env.local`.
