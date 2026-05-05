# Contexto da sessão — WhatsApp no CRM e produção na Vercel

**Útil como memória quando este chat não estiver disponível.**

**Última atualização:** 5 de maio de 2026 (reply + badge não lidas + tunnel).

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

3. **`conversas-content.tsx`:**
   - Ao abrir um chat cuja lista local está vazia e ainda não tentou nesta sessão,
     chama `load-history` (ex.: limite **30**) e refaz `select`.

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
| Cliente Evolution | `src/lib/evolution/client.ts` |
| Conectar WhatsApp | `src/app/api/whatsapp/instance/connect/route.ts` |
| Sync chats (lista) | `src/app/api/whatsapp/instance/sync/route.ts` |
| Webhook mensagens | `src/app/api/whatsapp/webhook/[instance]/route.ts` |
| Histórico | `src/app/api/whatsapp/messages/load-history/route.ts` |
| Enviar mensagem | `src/app/api/whatsapp/messages/send/route.ts` |
| UI Conversas | `src/app/[domain]/conversas/conversas-content.tsx` |
| Tipos Supabase / schema TS | `src/lib/types/database.ts` |
| Env exemplo | `.env.example` |

---

## O que não colocar neste arquivo

- Chaves JWT, URLs de preview com tunnel pessoais, **`SUPABASE_SERVICE_ROLE_KEY`**, etc.
  Usar apenas **`.env.local`** ou os segredos no painel Vercel/Supabase.

---

## Webhook — DEV (Cloudflare Tunnel) vs PROD (Vercel)

A Evolution só consegue empurrar mensagens novas se a URL configurada em
`EVOLUTION_WEBHOOK_BASE_URL` for **alcançável publicamente**. Sem isso o CRM
fica dependente do polling de fallback (30s) e perde notificações instantâneas.

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

Mesmo sem webhook, o CRM faz polling de 30s na Evolution para o chat ativo
(ver `pullEvolutionForActive` em `conversas-content.tsx`). Não é instantâneo,
mas garante que mensagens recebidas chegam em até ~30s sem precisar reconectar.

---

## Lista lateral — badge de não lidas (WhatsApp)

**Objetivo:** contatos **não selecionados** mostram contador verde quando há mensagens recebidas não vistas.

- **`whatsapp_chats.unread_count`** existe no banco; o **webhook** incrementa em cada mensagem **IN** (`messages.upsert`).
- **`POST /api/whatsapp/messages/load-history`:** quando não há webhook (tunnel caído / dev), mensagens novas entram pelo polling de `pullEvolutionForActive` (~30s). O load-history **também incrementa** `unread_count` ao inserir mensagens IN novas (somando ao contador atual). Se a última mensagem do batch é **from_me**, zera como no webhook.
- **`conversas-content.tsx`:** badge só quando `unread_count > 0 && chat !== ativo`; nome/preview mais fortes e hora em verde quando há não lidas; `useEffect` ao abrir chat zera `unread_count` no Supabase.
- **Scripts dev:** `npm run tunnel` = Quick Tunnel Cloudflare; `npm run tunnel:named` = Named Tunnel (ver secção acima). `.env.example` documenta `CLOUDFLARED_TUNNEL_NAME`.

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
- **Webhook** — função **`extractQuoted(message, remoteJid)`**: lê `contextInfo` em `extendedTextMessage`, `imageMessage`, etc.; `stanzaId` → id citado; `participant !== remoteJid` → mensagem citada era nossa (heurística chat individual).
- **`load-history`** — mesma extração ao importar histórico da Evolution.

### UI (`conversas-content.tsx`)

- Botão **Responder** (hover, ícone seta) em cada bolha; não em mensagens `temp-*`.
- Estado **`replyingTo`** + barra acima do textarea (faixa lateral verde/azul, preview, **X** ou **Esc** para cancelar).
- Ao **trocar de chat**, reply é cancelado.
- **`MessageBubble`:** bloco de citação no topo da bolha; **clique** no quote chama **`jumpToQuote(quoted_evolution_message_id)`** — scroll até mensagem com mesmo `evolution_message_id` + pulse ~1,5s (silencioso se original não está nas ~500 msgs carregadas).
- Envio: `fetch(.../send, { replyToMessageId })`; mensagem otimista já inclui `quoted_body` / `quoted_from_me` para feedback imediato.

### Pontos de atenção para retomada

- **Evolution:** se `quoted` no JSON não for aceito por alguma versão, checar log 502 e payload da API; formato esperado é compatível Baileys v2.
- **Quote sem `quoted_evolution_message_id`:** clicável desabilitado (sem scroll).
- **Grupos:** webhook ignora JIDs que não são `@s.whatsapp.net` / `@c.us`; reply em grupo não foi escopo.

---

## Próximas melhorias possíveis (não implementadas nesta sessão)

- Paginação “carregar mensagens mais antigas” (página 2 da Evolution).
- Renderizar mídia (imagem/áudio) em vez só de placeholder `[tipo]`.
