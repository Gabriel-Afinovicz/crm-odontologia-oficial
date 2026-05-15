"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/layout/session-provider";
import type {
  Lead,
  WhatsAppChat,
  WhatsAppInstance,
  WhatsAppMessage,
  WhatsAppMessageReaction,
  WhatsAppMessageStatus,
} from "@/lib/types/database";
import {
  QUICK_REACTION_EMOJIS,
  mergeReactions,
  normalizeReactions,
} from "@/lib/whatsapp/reactions";
import { useWhatsAppEvents } from "@/lib/whatsapp/use-whatsapp-events";
import { useWhatsAppHealth } from "@/lib/whatsapp/use-whatsapp-health";

interface ConversasContentProps {
  domain: string;
  companyId: string;
  instance: WhatsAppInstance;
  initialChats: WhatsAppChat[];
  initialChatId: string | null;
  initialHasMore: boolean;
  pageSize: number;
}

function compareChatsDesc(a: WhatsAppChat, b: WhatsAppChat): number {
  // Mais recente primeiro; nulls vao para o final
  const at = a.last_message_at;
  const bt = b.last_message_at;
  if (!at && !bt) return 0;
  if (!at) return 1;
  if (!bt) return -1;
  return bt.localeCompare(at);
}

// Janela de 15 minutos do WhatsApp para edicao de mensagem propria.
// Usada client-side para esconder o botao "Editar" em mensagens antigas
// (a rota tambem valida server-side antes de chamar a Evolution).
// Mantemos folga de 30s do limite real (15 min) para evitar que o
// operador clique em "Editar" e a Evolution rejeite no exato momento.
const WHATSAPP_EDIT_WINDOW_MS = 15 * 60 * 1000 - 30 * 1000;

// Calcula se uma mensagem ainda esta dentro da janela de edicao.
// Centralizado para que o botao no MessageBubble e a validacao em
// `submitEdit` usem a mesma regra (evita race entre click e disparo).
function canEditMessageNow(message: WhatsAppMessage): boolean {
  if (!message.from_me) return false;
  if (message.media_type !== "text") return false;
  if (!message.evolution_message_id) return false;
  if (message.id.startsWith("temp-")) return false;
  const sentAtMs = new Date(
    message.sent_at ?? message.created_at
  ).getTime();
  if (!Number.isFinite(sentAtMs)) return false;
  return Date.now() - sentAtMs < WHATSAPP_EDIT_WINDOW_MS;
}

// Faz upsert idempotente de uma mensagem no array, deduplicando por id real e
// por evolution_message_id, alem de substituir mensagens otimistas (temp-) que
// correspondam por body/from_me.
function upsertMessage(
  prev: WhatsAppMessage[],
  next: WhatsAppMessage
): WhatsAppMessage[] {
  // 1) Mesmo id: substitui in-place
  const byId = prev.findIndex((m) => m.id === next.id);
  if (byId !== -1) {
    const copy = [...prev];
    copy[byId] = next;
    return copy;
  }
  // 2) Mesmo evolution_message_id (caso exista um registro com id antigo)
  if (next.evolution_message_id) {
    const byEvo = prev.findIndex(
      (m) =>
        !!m.evolution_message_id &&
        m.evolution_message_id === next.evolution_message_id
    );
    if (byEvo !== -1) {
      const copy = [...prev];
      copy[byEvo] = next;
      return copy;
    }
  }
  // 3) Mensagem otimista: troca pelo registro real do banco
  if (next.from_me) {
    const byTemp = prev.findIndex(
      (m) =>
        m.id.startsWith("temp-") &&
        m.from_me === next.from_me &&
        m.body === next.body
    );
    if (byTemp !== -1) {
      const copy = [...prev];
      copy[byTemp] = next;
      return copy;
    }
  }
  return [...prev, next];
}

// Remove duplicatas por id, mantendo a ultima ocorrencia. Defesa final
// contra qualquer caso em que duas mensagens com mesmo id entrem no array
// (p.ex. dois subscribers ativos durante HMR/StrictMode em dev).
function dedupeById(list: WhatsAppMessage[]): WhatsAppMessage[] {
  const map = new Map<string, WhatsAppMessage>();
  for (const m of list) {
    map.set(m.id, m);
  }
  return Array.from(map.values());
}

// Timestamp REAL do evento da mensagem para ordenar no eixo do tempo do
// WhatsApp (nao no eixo do "quando o webhook gravou"). Mensagens recebidas
// em rajada (backlog do Baileys ao reconectar) podem ter created_at todos
// proximos de NOW(); ordenar so por created_at as joga fora da ordem real
// e visualmente o operador "perde" mensagens no scroll.
function eventTimestamp(m: WhatsAppMessage): string {
  return m.received_at ?? m.sent_at ?? m.created_at;
}

function compareMessagesAsc(a: WhatsAppMessage, b: WhatsAppMessage): number {
  const at = eventTimestamp(a);
  const bt = eventTimestamp(b);
  if (at === bt) return 0;
  return at < bt ? -1 : 1;
}

function sortMessagesAsc(list: WhatsAppMessage[]): WhatsAppMessage[] {
  return [...list].sort(compareMessagesAsc);
}

// Quantidade inicial de mensagens carregadas ao abrir um chat. Mensagens
// mais antigas ficam "atras" do botao "Carregar mensagens anteriores" no
// topo do painel — o operador puxa por demanda em vez de pagar o render
// de centenas de bolhas de uma vez. 30 cobre o contexto recente da maioria
// das conversas sem causar flash visual ao alinhar o scroll no fim.
const MESSAGES_PAGE_SIZE = 30;

// Jitter aleatorio aplicado entre envios em rajada para simular digitacao
// humana e reduzir o risco do WhatsApp marcar o numero como bot. Mensagem
// isolada (fila vazia no momento do clique) nao paga o custo deste delay.
const JITTER_MIN_MS = 250;
const JITTER_MAX_MS = 800;

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jidToPhoneDisplay(jid: string) {
  const phone = jid.replace(/@.*$/, "");
  if (phone.length >= 13) {
    return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
  }
  return `+${phone}`;
}

function fmtTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// Renderiza os "checks" de status (✓ / ✓✓ / ✓✓ azul) padrao WhatsApp para
// uma mensagem propria. `null`/desconhecido nao renderiza nada.
//
//   - pending  -> relogio (em transito, ainda nao confirmado pelo servidor)
//   - sent     -> 1 check cinza (Evolution confirmou recebimento)
//   - delivered-> 2 checks cinza (entregue ao celular do contato)
//   - read     -> 2 checks azuis (lida pelo contato)
//   - failed   -> ! vermelho
//
// Reutilizado tanto no rodape da bolha quanto na previa da lista lateral
// (so quando `last_message_from_me === true`). O `size` controla o tamanho
// pixelar (default 14, prefira 12 na lista lateral para nao competir com
// o texto da previa).
function MessageStatusChecks({
  status,
  size = 14,
}: {
  status: WhatsAppMessageStatus | null | undefined;
  size?: number;
}) {
  if (!status) return null;
  if (status === "pending") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-gray-400"
        aria-label="Enviando"
      >
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 14" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-red-500"
        aria-label="Falha ao enviar"
      >
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="13" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  // sent / delivered / read renderizam o mesmo "duplo check": para `sent`
  // suprimimos o segundo check (alinhando com WhatsApp). Cor muda para
  // azul (`text-sky-500`) em `read`.
  const color = status === "read" ? "text-sky-500" : "text-gray-500";
  const label =
    status === "read"
      ? "Lida"
      : status === "delivered"
        ? "Entregue"
        : "Enviada";
  return (
    <span
      className={`inline-flex items-center ${color}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {/* Padrao WhatsApp: 2 checks justapostos com leve sobreposicao
          horizontal. Para `sent`, o segundo check fica invisivel (mantem
          o mesmo bounding box do duplo, evitando "pulo" de layout quando
          status muda de sent -> delivered). */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <polyline points="4 13 9 18 20 7" />
      </svg>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={`-ml-[0.45em] ${status === "sent" ? "invisible" : ""}`}
      >
        <polyline points="4 13 9 18 20 7" />
      </svg>
    </span>
  );
}

// Detecta URLs no texto e transforma em links clicaveis preservando o restante
// do conteudo intacto (inclusive quebras de linha e emojis). Aceita os formatos
// "http://...", "https://..." e "www..." (o ultimo recebe `https://` no href
// automaticamente — comportamento padrao do WhatsApp/Telegram).
//
// Por que regex inline e nao biblioteca: 1) zero dependencia nova; 2) cobertura
// de >95% das URLs reais que aparecem em chats de clinica (endereco curto,
// links de Maps, formularios, etc); 3) e robusto contra HTML injection porque
// React escapa por padrao — o `href` recebe a string original sem
// `dangerouslySetInnerHTML`. Caracteres `<`/`>`/espacos cortam a URL.
const URL_REGEX = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/gi;

function renderTextWithLinks(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // RegExp com flag /g preserva lastIndex entre execs — perfeito para
  // particionar a string sem reconstruir. Reset via `exec` natural.
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    const [rawUrl] = match;
    const start = match.index;
    if (start > lastIndex) {
      out.push(text.slice(lastIndex, start));
    }
    // Algumas pontuacoes finais nao fazem parte da URL real (".", ",", ")",
    // "!", "?"). Empurra esses caracteres pra fora do link pra evitar o
    // classico bug de "link com . no final que nao abre". WhatsApp faz igual.
    let url = rawUrl;
    let trailing = "";
    while (/[.,!?)\]}>;:]$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }
    if (url.length === 0) {
      out.push(rawUrl);
      lastIndex = start + rawUrl.length;
      continue;
    }
    const href = url.startsWith("http") ? url : `https://${url}`;
    out.push(
      <a
        key={`u-${start}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline [overflow-wrap:anywhere] hover:text-blue-700"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    );
    if (trailing) out.push(trailing);
    lastIndex = start + rawUrl.length;
  }
  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex));
  }
  return out;
}

export function ConversasContent({
  domain,
  companyId,
  instance,
  initialChats,
  initialChatId,
  initialHasMore,
  pageSize,
}: ConversasContentProps) {
  const session = useSession();
  const currentUserName = session.profile?.name ?? null;
  const currentUserId = session.profile?.id ?? null;

  const [chats, setChats] = useState<WhatsAppChat[]>(initialChats);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(
    initialChatId ?? initialChats[0]?.id ?? null
  );
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  // Paginacao de mensagens: carrega MESSAGES_PAGE_SIZE inicialmente; o
  // operador clica em "Carregar mensagens anteriores" no topo para puxar
  // a proxima pagina (ordenada por created_at DESC, mais antiga em seguida).
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [usersById, setUsersById] = useState<Map<string, string>>(new Map());
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [search, setSearch] = useState("");
  // Resultados da busca server-side. null = sem busca ativa (renderiza
  // `chats` filtrado pela janela de 30 dias). Array = renderiza ESSE array
  // (sem filtro de janela; permite achar contato antigo).
  const [searchResults, setSearchResults] = useState<WhatsAppChat[] | null>(
    null
  );
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showLinkLead, setShowLinkLead] = useState(false);
  const [leadSearch, setLeadSearch] = useState("");
  const [leadOptions, setLeadOptions] = useState<Pick<Lead, "id" | "name" | "phone">[]>([]);
  const [linkedLeadName, setLinkedLeadName] = useState<string | null>(null);
  const [showContactPanel, setShowContactPanel] = useState(false);
  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [incomingToast, setIncomingToast] = useState<{
    chatId: string;
    chatLabel: string;
    preview: string;
  } | null>(null);
  // Reply ativo: snapshot da mensagem que sera citada no proximo envio.
  // Mantemos o body cru aqui para a barra acima do input; o backend
  // resolve evolution_message_id e from_me a partir do messageId.
  const [replyingTo, setReplyingTo] = useState<{
    messageId: string;
    body: string;
    fromMe: boolean;
    senderLabel: string;
  } | null>(null);
  // Edicao ativa: snapshot da mensagem que esta sendo editada. O `draft`
  // e pre-preenchido com o `originalBody` quando esse estado e setado, e
  // o `handleSend` redireciona para `submitEdit` em vez de criar mensagem
  // nova enquanto este estado existir. Reply e edicao sao mutualmente
  // exclusivos: ativar um cancela o outro (igual WhatsApp).
  const [editingMessage, setEditingMessage] = useState<{
    messageId: string;
    originalBody: string;
  } | null>(null);
  // Marca quando uma edicao esta no ar, para desabilitar o botao Enviar
  // e impedir disparos duplicados via Enter rapido. Independente do
  // `sending` global usado para mensagem nova/midia (cuja indicacao e
  // outra: rajada na fila).
  const [editing, setEditing] = useState(false);
  // Mensagem brevemente destacada apos clicar em uma citacao. O highlight
  // dura ~1.5s e some — simula o "pulse" do WhatsApp ao localizar o original.
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Modal de visualizacao em tela cheia. `null` = fechado; objeto contem
  // o tipo de midia (imagem ou documento) e o id da mensagem que originou
  // a abertura — controla qual lightbox renderizar.
  const [lightbox, setLightbox] = useState<
    | { kind: "image"; messageId: string }
    | { kind: "document"; messageId: string }
    | null
  >(null);

  const incomingToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  // Container de scroll do painel de mensagens. Usado para medir se o usuario
  // esta perto do fim antes de fazer auto-scroll quando chega mensagem nova.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // Heuristica de "perto do fim" (default true para a primeira renderizacao).
  // Atualizado a cada onScroll do container.
  const isNearBottomRef = useRef(true);
  // Snapshot do scrollHeight ANTES de carregar mensagens antigas, usado
  // pelo useLayoutEffect para preservar a posicao visual do operador apos
  // prepend (so cresce o conteudo "para cima"). Sem isso o usuario seria
  // "puxado" para o topo do novo bloco.
  const scrollHeightBeforeRef = useRef(0);
  // Sinaliza ao useLayoutEffect[messages] que a proxima atualizacao deve
  // restaurar a posicao em vez de descer ao fim. Limpado no proprio effect.
  const justLoadedOlderRef = useRef(false);
  // Refs para acessar valores atuais dentro de callbacks de realtime
  const hasMoreRef = useRef(hasMore);
  const chatsRef = useRef(chats);
  const activeChatIdRef = useRef(activeChatId);
  // Mapa chatId -> timestamp do ultimo fetch a Evolution. Em ambientes onde
  // o webhook nao consegue alcancar o servidor (ex: localhost), este loop
  // funciona como fallback: a cada poll o chat ATIVO pede as ultimas 10
  // mensagens a Evolution. Como /load-history e idempotente (constraint
  // company_id, evolution_message_id), repetir nao duplica.
  const lastEvolutionFetchRef = useRef<Map<string, number>>(new Map());
  // Intervalo entre fetches automaticos a Evolution para o chat ativo.
  // 15s e um meio-termo entre frescor da conversa (sensacao de "instantaneo"
  // quando webhook nao chega) e nao virar rajada para o numero. Reduzido de
  // 30s -> 15s porque com webhook caindo (ex: tunnel cloudflared instavel),
  // o tempo de aparicao da mensagem no chat ativo era percebido como lento
  // demais pelo operador.
  const EVOLUTION_POLL_INTERVAL_MS = 15_000;
  // Fila de envio: cada nova mensagem aguarda a anterior terminar para
  // garantir que cheguem ao WhatsApp na mesma ordem em que foram enviadas
  // pelo usuario, mesmo se varias forem disparadas em rapida sucessao.
  const sendQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSendsRef = useRef(0);

  // Map tempId -> objectURL local da midia em envio. Permite renderizar
  // imediatamente o thumbnail/preview na bolha otimista sem esperar a
  // Evolution decodificar via rota /media. Trocado por mediaUrl(realId)
  // assim que o servidor responde. `useState` em vez de `useRef` para
  // forcar re-render quando muda — refs nao notificam React por si so.
  // O `tempMediaPreviewsRef` espelha o state para que o cleanup do unmount
  // pegue a versao mais recente (state em useEffect com deps `[]` captura
  // sempre a inicial). Ambos sao atualizados em sincronia.
  const [tempMediaPreviews, setTempMediaPreviews] = useState<
    Map<string, string>
  >(() => new Map());
  const tempMediaPreviewsRef = useRef(tempMediaPreviews);
  useEffect(() => {
    tempMediaPreviewsRef.current = tempMediaPreviews;
  }, [tempMediaPreviews]);
  // Estado do modal de preview da midia antes do envio. `null` = nenhum
  // arquivo selecionado; quando setado, mostra MediaPreviewDialog.
  const [pendingMediaFile, setPendingMediaFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  // Cancela reply em andamento quando troca de conversa: o snapshot do reply
  // referencia uma mensagem do chat anterior; manter no state geraria envio
  // com replyTo "fantasma" no chat novo.
  useEffect(() => {
    setReplyingTo(null);
    // Mesma logica para edicao: a mensagem editada pertence a outro chat,
    // nao deve continuar editavel ao trocar. O draft tambem volta vazio
    // para evitar que o operador envie por engano o conteudo da edicao
    // antiga como mensagem nova no chat novo.
    setEditingMessage(null);
    setDraft("");
  }, [activeChatId]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? null,
    [chats, activeChatId]
  );

  const filteredChats = useMemo(() => {
    if (searchResults !== null) return searchResults;
    return chats;
  }, [chats, searchResults]);

  // Busca server-side com debounce de 250ms. Quando o operador digita
  // >= 2 caracteres consultamos o Supabase ignorando o filtro de janela
  // de 30 dias — o objetivo aqui e localizar contatos antigos pelo nome
  // ou telefone. Caracteres que conflitam com a sintaxe do filtro `.or()`
  // do PostgREST (virgulas, parenteses, `*`) sao removidos antes da query.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const sanitized = q.replace(/[,()*%]/g, "").slice(0, 80);
    if (!sanitized) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    const handle = setTimeout(async () => {
      const supabase = createClient();
      const like = `%${sanitized}%`;
      const { data } = await supabase
        .from("whatsapp_chats")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_archived", false)
        .or(
          `name.ilike.${like},remote_jid.ilike.${like},last_message_preview.ilike.${like}`
        )
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(50);
      // Se a busca foi limpa/atualizada enquanto a query corria, o effect
      // ja foi limpo via cleanup (clearTimeout). Setar mesmo assim e ok:
      // o proximo run sobrescreve.
      setSearchResults((data as WhatsAppChat[] | null) ?? []);
      setSearching(false);
    }, 250);
    return () => {
      clearTimeout(handle);
    };
  }, [search, companyId]);

  // Defesa final: sempre renderiza mensagens deduplicadas por id e ordenadas
  // pelo timestamp real do evento (received_at/sent_at), nao por created_at.
  // Sem essa ordenacao, mensagens recebidas em backlog (com created_at = NOW
  // do webhook) caem fora de ordem cronologica e o scroll automatico para o
  // fim da lista esconde o que veio "antes" no eixo do WhatsApp.
  const renderedMessages = useMemo(
    () => sortMessagesAsc(dedupeById(messages)),
    [messages]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeChatId) {
        if (!cancelled) {
          setMessages([]);
          setHasOlderMessages(false);
          setLoadingOlderMessages(false);
          setLoadingMessages(false);
        }
        return;
      }
      if (!cancelled) {
        setLoadingMessages(true);
        // Reseta paginacao ao trocar de chat: o botao "carregar anteriores"
        // so deve aparecer apos a primeira pagina ser avaliada.
        setHasOlderMessages(false);
        setLoadingOlderMessages(false);
      }
      const supabase = createClient();
      // Carga inicial em DESC para pegar as MESSAGES_PAGE_SIZE mais
      // recentes (PAGE_SIZE + 1 detecta se ha pagina anterior). Depois
      // .reverse() para exibir cronologicamente (mais antiga em cima).
      const { data } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .eq("chat_id", activeChatId)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PAGE_SIZE + 1);
      if (cancelled) return;
      const fetched = (data as WhatsAppMessage[] | null) ?? [];
      const more = fetched.length > MESSAGES_PAGE_SIZE;
      const page = (more ? fetched.slice(0, MESSAGES_PAGE_SIZE) : fetched).slice().reverse();

      // Mostra imediatamente o que ja temos em cache local (banco) para nao
      // bloquear a UI enquanto pedimos historico fresco a Evolution.
      setHasOlderMessages(more);
      setMessages(dedupeById(page));
      setLoadingMessages(false);

      // Sempre puxa as ultimas mensagens da Evolution na primeira abertura
      // desta conversa nesta sessao — assim o operador entra com contexto
      // suficiente para uma conversa fluida, mesmo que o webhook ainda nao
      // tenha entregue tudo. O endpoint /load-history e idempotente
      // (filtra por (company_id, evolution_message_id)), entao nao duplica
      // mensagens ja gravadas. Atualizacoes subsequentes ficam por conta do
      // loop de polling automatico ou do botao manual.
      const lastFetch = lastEvolutionFetchRef.current.get(activeChatId) ?? 0;
      if (Date.now() - lastFetch > EVOLUTION_POLL_INTERVAL_MS) {
        lastEvolutionFetchRef.current.set(activeChatId, Date.now());
        try {
          const res = await fetch("/api/whatsapp/messages/load-history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId: activeChatId,
              limit: MESSAGES_PAGE_SIZE,
            }),
          });
          if (res.ok) {
            // Re-select segue o mesmo padrao DESC + reverse para alinhar
            // com a paginacao: nao expandimos a janela visivel sozinhos,
            // so atualizamos o que ja esta carregado com novidades fresh.
            const { data: refreshed } = await supabase
              .from("whatsapp_messages")
              .select("*")
              .eq("chat_id", activeChatId)
              .order("created_at", { ascending: false })
              .limit(MESSAGES_PAGE_SIZE + 1);
            if (cancelled) return;
            const refreshedList = (refreshed as WhatsAppMessage[] | null) ?? [];
            const moreAfter = refreshedList.length > MESSAGES_PAGE_SIZE;
            const pageAfter = (moreAfter
              ? refreshedList.slice(0, MESSAGES_PAGE_SIZE)
              : refreshedList
            )
              .slice()
              .reverse();
            setHasOlderMessages(moreAfter);
            setMessages(dedupeById(pageAfter));
          }
        } catch {
          // Silencioso: se a Evolution nao tiver historico ou a chamada falhar,
          // a UI segue mostrando o que ja havia em cache local e novas
          // mensagens chegam normalmente pelo webhook + realtime.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  // Mark active chat as read
  useEffect(() => {
    if (!activeChatId) return;
    const target = chats.find((c) => c.id === activeChatId);
    if (!target || target.unread_count === 0) return;
    const supabase = createClient();
    (async () => {
      await supabase
        .from("whatsapp_chats")
        .update({ unread_count: 0 })
        .eq("id", activeChatId);
      setChats((prev) =>
        prev.map((c) =>
          c.id === activeChatId ? { ...c, unread_count: 0 } : c
        )
      );
    })();
  }, [activeChatId, chats]);

  // Auto-scroll executado ANTES do paint (useLayoutEffect) — elimina o
  // "flash" visual de ver o topo da lista por um frame antes do scroll.
  // Tres comportamentos:
  //   1) Acabou de carregar mensagens antigas (prepend): preserva a posicao
  //      visual somando a diferenca de altura ao scrollTop.
  //   2) Usuario perto do fim: desce automaticamente para a nova mensagem.
  //   3) Usuario rolou para cima lendo historico: nao mexe no scroll.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (justLoadedOlderRef.current) {
      const newH = el.scrollHeight;
      el.scrollTop += newH - scrollHeightBeforeRef.current;
      justLoadedOlderRef.current = false;
      return;
    }
    if (isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Trocar de conversa SEMPRE leva ao fim. useLayoutEffect roda antes do
  // paint do novo chat — sem requestAnimationFrame, sem flash visual.
  useLayoutEffect(() => {
    if (!activeChatId) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = true;
    el.scrollTop = el.scrollHeight;
  }, [activeChatId]);

  // Mede a distancia ate o fim para decidir se um proximo update deve dar
  // auto-scroll. Threshold em px considera margem de seguranca para evitar
  // que pequenos ajustes de altura de bolha (ex: status virando "lida") nao
  // sejam interpretados como "usuario subiu".
  function handleMessagesScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 150;
  }

  // Hub semantico de eventos do WhatsApp para esta company.
  //
  // Transporta tudo num unico canal Supabase Realtime (Phoenix WebSocket
  // multiplexado), entregando eventos nomeados:
  //   - new-message-whatsapp       (INSERT, from_me=false)
  //   - new-agent-message-whatsapp (INSERT, from_me=true)
  //   - message-update-whatsapp    (UPDATE: status, reacoes)
  //   - chat-upsert-whatsapp       (INSERT/UPDATE em whatsapp_chats)
  //   - chat-delete-whatsapp       (DELETE em whatsapp_chats)
  //
  // O hook usa internamente o postgres_changes do Supabase com o canal
  // protegido por RLS (a publicacao supabase_realtime ja inclui as duas
  // tabelas) e mantem os handlers via ref — handlers passados aqui sao
  // sempre os mais recentes, sem re-subscrever o canal.
  useWhatsAppEvents(companyId, {
    onChatUpsert: (next) => {
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.id === next.id);
        if (idx !== -1) {
          const copy = [...prev];
          copy[idx] = next;
          copy.sort(compareChatsDesc);
          return copy;
        }
        // Chat novo nao estava na pagina atual. So adiciona se couber no
        // recorte renderizado (last_message_at acima do mais antigo
        // visivel) ou se nao houver mais paginas restantes — caso contrario
        // o operador veria um chat "saltar" para o meio da lista paginada.
        const lastVisible = prev[prev.length - 1];
        const lastTs = lastVisible?.last_message_at ?? null;
        const nextTs = next.last_message_at ?? null;
        const stillHasMore = hasMoreRef.current;
        const fitsInPage =
          !stillHasMore ||
          (nextTs != null && (lastTs == null || nextTs > lastTs));
        if (!fitsInPage) return prev;
        return [...prev, next].sort(compareChatsDesc);
      });
    },
    onChatDelete: (old) => {
      setChats((prev) => prev.filter((c) => c.id !== old.id));
    },
    onNewMessage: (next) => {
      // Chat ativo: anexa mensagem ao painel; o useLayoutEffect[messages]
      // cuida do auto-scroll respeitando a heuristica de "perto do fim".
      if (next.chat_id === activeChatIdRef.current) {
        setMessages((prev) => upsertMessage(prev, next));
        return;
      }
      // Chat nao-ativo: toast discreto para o operador notar mesmo sem
      // olhar a lista lateral. So mensagens IN (from_me=false) chegam
      // aqui — `new-agent-message-whatsapp` nunca gera toast por
      // contrato do hub.
      const chatRef = chatsRef.current.find((c) => c.id === next.chat_id);
      const chatLabel =
        chatRef?.name ??
        chatRef?.remote_jid?.replace(/@.*$/, "") ??
        "Nova mensagem";
      const previewBody =
        next.body && next.body.trim().length > 0
          ? next.body
          : next.media_type !== "text"
            ? `[${next.media_type}]`
            : "(sem conteudo)";
      setIncomingToast({
        chatId: next.chat_id,
        chatLabel,
        preview: previewBody.slice(0, 120),
      });
      if (incomingToastTimerRef.current) {
        clearTimeout(incomingToastTimerRef.current);
      }
      incomingToastTimerRef.current = setTimeout(() => {
        setIncomingToast(null);
        incomingToastTimerRef.current = null;
      }, 4000);
    },
    onNewAgentMessage: (next) => {
      // Mensagem enviada pelo CRM (ou eco do celular do operador). Apenas
      // upserta no painel do chat ativo — chats nao-ativos nao geram toast
      // porque o proprio operador disparou. O state da lista lateral
      // (last_message_preview, unread) ja vem via `onChatUpsert`.
      if (next.chat_id === activeChatIdRef.current) {
        setMessages((prev) => upsertMessage(prev, next));
      }
    },
    onMessageUpdate: (next) => {
      // UPDATE de status (sent/delivered/read), reacoes, etc. Sem toast.
      if (next.chat_id === activeChatIdRef.current) {
        setMessages((prev) => upsertMessage(prev, next));
      }
    },
    onChannelStatus: (status) => {
      if (process.env.NODE_ENV === "development") {
        console.debug("[wa-events] channel status:", status);
      }
    },
  });

  // Cleanup do timer do toast quando o componente desmonta. O `useWhatsAppEvents`
  // cuida do seu proprio canal — este effect existe so para o timer local.
  useEffect(() => {
    return () => {
      if (incomingToastTimerRef.current) {
        clearTimeout(incomingToastTimerRef.current);
        incomingToastTimerRef.current = null;
      }
    };
  }, []);

  // Saude conjunta de webhook + Realtime. Quando saudavel, o tick de
  // polling abaixo reduz a frequencia e desliga o pull a Evolution —
  // matando o ruido visto no DevTools sem perder a rede de seguranca
  // (qualquer regressao de saude reativa o polling antigo).
  const { healthy } = useWhatsAppHealth(companyId);
  const healthyRef = useRef(healthy);
  useEffect(() => {
    healthyRef.current = healthy;
  }, [healthy]);

  // Polling de seguranca: a cada 10s sincroniza o que esta no banco (lista
  // de chats e mensagens do chat ativo) e, em paralelo, a cada
  // EVOLUTION_POLL_INTERVAL_MS pede a Evolution as ultimas mensagens do
  // chat ativo. O segundo loop e o FALLBACK para ambientes onde o webhook
  // nao consegue alcancar o servidor (ex: localhost em dev) — sem ele,
  // mensagens recebidas nunca apareceriam.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function syncActiveChat() {
      const chatId = activeChatIdRef.current;
      if (!chatId) return;
      const { data } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      const recent = (data as WhatsAppMessage[] | null) ?? [];
      if (recent.length === 0) return;
      // Reordena para asc (mais antiga primeiro) e faz upsert sem duplicar
      recent.reverse();
      setMessages((prev) => {
        let next = prev;
        for (const m of recent) {
          next = upsertMessage(next, m);
        }
        return dedupeById(next);
      });
    }

    async function syncChatList() {
      // Sem filtro de janela: refresca os primeiros pageSize chats por
      // last_message_at desc. Realtime de postgres_changes cobre INSERT/
      // UPDATE de chats fora dessa primeira pagina (sobem para o topo
      // quando recebem atividade nova).
      const { data } = await supabase
        .from("whatsapp_chats")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_archived", false)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(pageSize);
      if (cancelled) return;
      const list = (data as WhatsAppChat[] | null) ?? [];
      if (list.length === 0) return;
      setChats((prev) => {
        const map = new Map<string, WhatsAppChat>();
        for (const c of prev) map.set(c.id, c);
        for (const c of list) map.set(c.id, c);
        return Array.from(map.values()).sort(compareChatsDesc);
      });
    }

    // Pede a Evolution as ultimas mensagens do chat ativo, respeitando o
    // intervalo minimo entre fetches por chat. limit=10 porque so queremos
    // o "delta" recente; histórico ja foi carregado no abrir do chat.
    // Se forceFresh=true, ignora o intervalo (usado ao voltar a aba ao foco).
    async function pullEvolutionForActive(forceFresh = false) {
      const chatId = activeChatIdRef.current;
      if (!chatId) return;
      const lastFetch = lastEvolutionFetchRef.current.get(chatId) ?? 0;
      if (
        !forceFresh &&
        Date.now() - lastFetch < EVOLUTION_POLL_INTERVAL_MS
      ) {
        return;
      }
      lastEvolutionFetchRef.current.set(chatId, Date.now());
      try {
        const res = await fetch("/api/whatsapp/messages/load-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, limit: 10 }),
        });
        if (!res.ok) return;
        // Apos a Evolution gravar no banco, deixa o syncActiveChat puxar do
        // banco no proximo tick (ou agora) para alimentar o state com o que
        // veio. Realtime tambem entrega, mas em fallback sem websocket o
        // syncActiveChat garante a atualizacao.
        await syncActiveChat();
      } catch {
        // Silencioso: a tentativa volta no proximo intervalo.
      }
    }

    // Polling adaptativo guiado pela saude do hub (`useWhatsAppHealth`):
    //
    // - Quando NAO saudavel (webhook sem heartbeat fresco OU canal Realtime
    //   instavel): tick rapido a cada 10s + fetch a Evolution como fallback.
    //   E exatamente o comportamento que existia antes da otimizacao — a
    //   rede de seguranca classica para ambientes onde o webhook nao chega
    //   (localhost em dev sem tunnel, p.ex.).
    //
    // - Quando saudavel: tick reduzido para 60s, sem fetch a Evolution
    //   (webhook + Realtime ja entregam tudo). O sync esporadico de 60s
    //   continua como defesa contra regressao silenciosa (ex: INSERT que
    //   por algum motivo nao chegou pelo Realtime). E o que faz o ruido
    //   sumir do DevTools sem abrir mao de robustez.
    //
    // O `setInterval` continua rodando a cada 10s (granularidade) e quem
    // decide se executa o trabalho e o proprio `tick`, lendo `healthyRef`
    // — assim a transicao saudavel <-> nao-saudavel e instantanea sem
    // re-criar o interval.
    const POLL_GRANULARITY_MS = 10_000;
    const POLL_HEALTHY_INTERVAL_MS = 60_000;
    let lastFullTickAt = 0;

    function runFullSync(includeEvolutionPull: boolean) {
      void syncActiveChat();
      void syncChatList();
      if (includeEvolutionPull) {
        void pullEvolutionForActive(false);
      }
    }

    function tick() {
      if (document.hidden) return;
      const isHealthy = healthyRef.current;
      const now = Date.now();
      if (isHealthy && now - lastFullTickAt < POLL_HEALTHY_INTERVAL_MS) {
        return;
      }
      lastFullTickAt = now;
      runFullSync(!isHealthy);
    }

    const interval = setInterval(tick, POLL_GRANULARITY_MS);

    function onVisibility() {
      if (!document.hidden) {
        // Aba voltando ao foco: sempre roda um sync completo imediato
        // independente da saude. Vale o custo: o operador pode ter saido
        // por minutos/horas e merece ver o estado fresco assim que volta.
        // Evolution e marcada com forceFresh para ignorar o cooldown.
        lastFullTickAt = Date.now();
        void syncActiveChat();
        void syncChatList();
        void pullEvolutionForActive(true);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [companyId, pageSize]);

  // Mapa userId -> nome para identificar quem enviou cada mensagem pelo CRM.
  // O numero do WhatsApp e o mesmo para todos os operadores; sem esse rotulo
  // nao da pra saber quem digitou no CRM. Carrega uma vez por company.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("users")
        .select("id, name")
        .eq("company_id", companyId);
      if (cancelled) return;
      const next = new Map<string, string>();
      for (const u of (data as { id: string; name: string }[] | null) ?? []) {
        next.set(u.id, u.name);
      }
      setUsersById(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const leadIdForName = activeChat?.lead_id ?? null;
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      if (!leadIdForName) {
        if (!cancelled) setLinkedLeadName(null);
        return;
      }
      const { data } = await supabase
        .from("leads")
        .select("name")
        .eq("id", leadIdForName)
        .single();
      if (cancelled) return;
      setLinkedLeadName((data as { name: string } | null)?.name ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadIdForName]);

  // Busca de leads para vincular
  useEffect(() => {
    if (!showLinkLead) return;
    const supabase = createClient();
    const t = setTimeout(async () => {
      const q = supabase
        .from("leads")
        .select("id, name, phone")
        .eq("company_id", companyId)
        .order("name")
        .limit(20);
      if (leadSearch.trim()) {
        q.or(`name.ilike.%${leadSearch.trim()}%,phone.ilike.%${leadSearch.trim()}%`);
      }
      const { data } = await q;
      setLeadOptions(
        (data as Pick<Lead, "id" | "name" | "phone">[] | null) ?? []
      );
    }, 200);
    return () => clearTimeout(t);
  }, [showLinkLead, leadSearch, companyId]);

  // Inicia um reply: a barra acima do input vai mostrar a citacao e o
  // proximo envio sera enviado com `replyToMessageId`.
  function startReply(message: WhatsAppMessage) {
    const senderLabel = message.from_me
      ? "Voce"
      : activeChat?.name || jidToPhoneDisplay(activeChat?.remote_jid ?? "");
    const previewBody =
      message.body && message.body.trim().length > 0
        ? message.body
        : message.media_type !== "text"
          ? `[${message.media_type}]`
          : "(sem conteudo)";
    setReplyingTo({
      messageId: message.id,
      body: previewBody,
      fromMe: message.from_me,
      senderLabel,
    });
  }

  function cancelReply() {
    setReplyingTo(null);
  }

  // Inicia edicao de uma mensagem propria. Pre-preenche o draft com o
  // texto atual para que o operador edite incrementalmente em vez de
  // digitar tudo de novo. Cancela qualquer reply ativo (ambos competem
  // pelo mesmo input/botao Enviar). O foco do textarea e dado pelo
  // proprio re-render — o textarea ja existe e seu value muda.
  function startEdit(message: WhatsAppMessage) {
    if (!canEditMessageNow(message)) return;
    setReplyingTo(null);
    setEditingMessage({
      messageId: message.id,
      originalBody: message.body ?? "",
    });
    setDraft(message.body ?? "");
    setSendError(null);
  }

  // Cancela a edicao em andamento. Restaura o draft para vazio (alternativa
  // seria preservar o que o operador estava digitando, mas isso geraria
  // confusao: o operador nao saberia se o texto seria enviado como nova
  // mensagem ou descartado). Vazio = decisao explicita "nao quero editar
  // nem enviar agora".
  function cancelEdit() {
    setEditingMessage(null);
    setDraft("");
  }

  // Submete a edicao para o backend. Atualizacao otimista: aplica o novo
  // body, marca `edited_at = now`, incrementa `edit_count` localmente
  // antes mesmo da resposta da API — assim o operador ve o efeito
  // imediatamente. Em erro, faz rollback completo do snapshot anterior.
  //
  // O webhook de `messages.edited` (ou `messages.update` com edicao)
  // chega depois e bate na mesma linha via Realtime; como o `body` ja
  // estara igual e `upsertMessage` faz merge, o estado final e idempotente.
  async function submitEdit() {
    const target = editingMessage;
    if (!target) return;
    const newBody = draft.trim();
    if (!newBody) {
      setSendError("Digite um novo texto para a edicao.");
      return;
    }
    if (newBody === target.originalBody.trim()) {
      // Nada a fazer: o texto nao mudou. Simplesmente cancela o modo
      // edicao em vez de mostrar erro — operador provavelmente apertou
      // Enter por reflexo sem mudar nada.
      cancelEdit();
      return;
    }
    const messageBefore = messages.find((m) => m.id === target.messageId);
    if (!messageBefore) {
      setSendError("Mensagem nao encontrada para editar.");
      cancelEdit();
      return;
    }
    if (!canEditMessageNow(messageBefore)) {
      setSendError(
        "Esta mensagem nao pode mais ser editada (limite de 15 minutos do WhatsApp)."
      );
      cancelEdit();
      return;
    }

    // Snapshot para rollback em caso de erro. Usamos TODAS as colunas que
    // a edicao otimista mexe; o resto da mensagem (reactions, status, etc)
    // e preservado pelo spread.
    const snapshot = {
      body: messageBefore.body,
      edited_at: messageBefore.edited_at,
      original_body: messageBefore.original_body,
      edit_count: messageBefore.edit_count,
    };
    // Snapshot do preview da lista lateral, para rollback caso a edicao
    // falhe e ja tivermos atualizado a previa otimisticamente.
    const chatBefore = chats.find((c) => c.id === messageBefore.chat_id);
    const previewSnapshot = chatBefore?.last_message_preview ?? null;

    // Otimismo: atualiza local imediatamente.
    const nowIso = new Date().toISOString();
    setMessages((prev) =>
      prev.map((m) =>
        m.id === target.messageId
          ? {
              ...m,
              body: newBody,
              edited_at: nowIso,
              original_body: m.original_body ?? m.body,
              edit_count: (m.edit_count ?? 0) + 1,
            }
          : m
      )
    );
    // Se esta mensagem e a mais recente do chat ativo, atualiza tambem
    // a previa local da lista lateral (o servidor faz o mesmo no `edit`
    // route; aqui e so para o sidebar nao mostrar o texto antigo entre
    // o click em Salvar e a chegada do realtime).
    {
      const messagesInChat = messages.filter(
        (m) => m.chat_id === messageBefore.chat_id
      );
      const latestInChat = messagesInChat[messagesInChat.length - 1];
      if (latestInChat?.id === target.messageId) {
        const newPreview = newBody.slice(0, 120);
        setChats((prev) =>
          prev.map((c) =>
            c.id === messageBefore.chat_id
              ? { ...c, last_message_preview: newPreview }
              : c
          )
        );
      }
    }
    setEditingMessage(null);
    setDraft("");
    setEditing(true);
    setSendError(null);

    try {
      const res = await fetch(
        `/api/whatsapp/messages/${target.messageId}/edit`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: newBody }),
        }
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        // Rollback: restaura o snapshot. Realtime/load-history ainda
        // pode sobrescrever depois caso o servidor tenha aplicado mas
        // a resposta tenha falhado — aceitavel (o estado final converge).
        setMessages((prev) =>
          prev.map((m) =>
            m.id === target.messageId ? { ...m, ...snapshot } : m
          )
        );
        setChats((prev) =>
          prev.map((c) =>
            c.id === messageBefore.chat_id
              ? { ...c, last_message_preview: previewSnapshot }
              : c
          )
        );
        setSendError(payload.error ?? "Falha ao editar mensagem.");
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === target.messageId ? { ...m, ...snapshot } : m
        )
      );
      setChats((prev) =>
        prev.map((c) =>
          c.id === messageBefore.chat_id
            ? { ...c, last_message_preview: previewSnapshot }
            : c
        )
      );
      setSendError(
        err instanceof Error ? err.message : "Erro de rede ao editar."
      );
    } finally {
      setEditing(false);
    }
  }

  // Aplica/remove reacao do operador a uma mensagem. Atualizacao otimista:
  // mexe no array `reactions` local imediatamente para o operador ver o
  // emoji aparecer/sumir, e em paralelo bate na rota que chama a Evolution.
  // Em caso de erro, restauramos o estado anterior e mostramos o erro no
  // mesmo banner ja usado para falhas de send (sendError).
  async function reactToMessage(messageId: string, emoji: string) {
    if (messageId.startsWith("temp-")) return;
    const target = messages.find((m) => m.id === messageId);
    if (!target) return;
    const previousReactions = normalizeReactions(target.reactions);
    const optimistic = mergeReactions(previousReactions, {
      emoji,
      from_me: true,
      reactor_jid: null,
      ts: new Date().toISOString(),
    });
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, reactions: optimistic } : m
      )
    );
    try {
      const res = await fetch(
        `/api/whatsapp/messages/${messageId}/react`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji }),
        }
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setSendError(payload.error ?? "Falha ao reagir.");
        // Rollback: restaura o array anterior; o realtime/syncActiveChat
        // sobrescreve com o estado real no proximo tick caso o servidor
        // tenha feito update parcial.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, reactions: previousReactions }
              : m
          )
        );
      }
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Erro de rede ao reagir."
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, reactions: previousReactions }
            : m
        )
      );
    }
  }

  // Localiza a mensagem original a partir do evolution_message_id citado
  // e rola ate ela. Se a mensagem nao esta carregada (historico curto),
  // nao faz nada — em uma versao futura podemos pedir paginacao.
  function jumpToQuote(quotedEvoId: string) {
    const target = renderedMessages.find(
      (m) => m.evolution_message_id === quotedEvoId
    );
    if (!target) return;
    const el = document.querySelector<HTMLElement>(
      `[data-msg-id="${target.id}"]`
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(target.id);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimerRef.current = null;
    }, 1500);
  }

  // Limpeza do timer de highlight ao desmontar para evitar update em
  // componente desmontado se o usuario sai da pagina logo apos clicar.
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  function handleSend(e?: FormEvent) {
    e?.preventDefault();
    // Modo edicao: o submit do formulario / Enter dispara submitEdit em
    // vez de criar mensagem nova. Mantem a UX consistente: o operador
    // sempre confirma com Enter, independente do modo do input.
    if (editingMessage) {
      void submitEdit();
      return;
    }
    const text = draft.trim();
    if (!text || !activeChat) return;
    const chatIdAtSend = activeChat.id;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const nowIso = new Date().toISOString();
    // Snapshot do reply atual: o backend pode resolver `replyToMessageId`,
    // mas a mensagem otimista precisa do snapshot agora para o usuario ver
    // o quote imediatamente, sem esperar o realtime entregar a mensagem real.
    const replySnapshot = replyingTo;

    // Mensagem otimista para feedback imediato na UI, sem depender do realtime
    const optimistic: WhatsAppMessage = {
      id: tempId,
      company_id: companyId,
      chat_id: chatIdAtSend,
      evolution_message_id: null,
      direction: "out",
      from_me: true,
      body: text,
      media_type: "text",
      media_url: null,
      media_mime_type: null,
      status: "pending",
      error_message: null,
      sent_at: null,
      received_at: null,
      sender_user_id: null,
      quoted_evolution_message_id: null,
      quoted_body: replySnapshot ? replySnapshot.body.slice(0, 240) : null,
      quoted_from_me: replySnapshot ? replySnapshot.fromMe : null,
      reactions: [],
      edited_at: null,
      original_body: null,
      edit_count: 0,
      created_at: nowIso,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setSendError(null);
    setReplyingTo(null);
    // Captura se a fila estava vazia ANTES de incrementar o contador.
    // Mensagem isolada nao paga o custo do jitter; rajada paga.
    const wasQueueEmpty = pendingSendsRef.current === 0;
    pendingSendsRef.current += 1;
    setSending(true);

    // Encadeia o envio na fila: a chamada HTTP so dispara apos a anterior
    // terminar, garantindo a mesma ordem no WhatsApp do destinatario.
    const previousQueue = sendQueueRef.current;
    const thisSend = (async () => {
      try {
        await previousQueue;
      } catch {
        // Erros do envio anterior nao impedem o proximo de tentar
      }
      // Jitter aleatorio apenas quando ha rajada (alguem ja estava na fila).
      // Simula intervalo de digitacao humana entre mensagens consecutivas.
      if (!wasQueueEmpty) {
        await sleep(randInt(JITTER_MIN_MS, JITTER_MAX_MS));
      }
      try {
        const res = await fetch("/api/whatsapp/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId: chatIdAtSend,
            text,
            replyToMessageId: replySnapshot?.messageId,
          }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          setSendError(payload.error ?? "Falha ao enviar.");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId
                ? { ...m, status: "failed", error_message: payload.error ?? "Falha" }
                : m
            )
          );
          return;
        }
        const payload = (await res.json().catch(() => ({}))) as {
          messageId?: string;
        };
        if (payload.messageId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId
                ? {
                    ...m,
                    id: payload.messageId!,
                    status: "sent",
                    sent_at: new Date().toISOString(),
                  }
                : m
            )
          );
        }
      } catch (err) {
        setSendError(err instanceof Error ? err.message : "Falha ao enviar.");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? { ...m, status: "failed", error_message: "Erro de rede" }
              : m
          )
        );
      } finally {
        pendingSendsRef.current = Math.max(0, pendingSendsRef.current - 1);
        if (pendingSendsRef.current === 0) {
          setSending(false);
        }
      }
    })();
    sendQueueRef.current = thisSend;
  }

  // Detecta o tipo de midia para a mensagem otimista. Mesmo criterio do
  // servidor (`detectMediaType` em send-media/route.ts): image/* -> image,
  // video/* -> video, resto -> document. Mantido em paralelo aqui de proposito
  // — a UI nao tem acesso ao codigo do server.
  function detectClientMediaType(
    file: File
  ): "image" | "video" | "document" {
    const t = file.type || "";
    if (t.startsWith("image/")) return "image";
    if (t.startsWith("video/")) return "video";
    return "document";
  }

  // Envia midia via multipart/form-data. Encadeia na mesma sendQueueRef do
  // envio de texto para preservar ordem cronologica no WhatsApp do contato
  // (3 imagens + 1 texto enviados em rajada chegam na ordem disparada).
  function handleSendMedia(file: File, caption: string) {
    if (!activeChat) return;
    const chatIdAtSend = activeChat.id;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const nowIso = new Date().toISOString();
    const replySnapshot = replyingTo;
    const mediaType = detectClientMediaType(file);
    const objectURL = URL.createObjectURL(file);

    // Mensagem otimista: aparece imediatamente com thumbnail local. Substituida
    // pelo registro real quando o servidor responde (via id real + realtime).
    const optimistic: WhatsAppMessage = {
      id: tempId,
      company_id: companyId,
      chat_id: chatIdAtSend,
      evolution_message_id: null,
      direction: "out",
      from_me: true,
      body: caption.trim() || null,
      media_type: mediaType,
      media_url: null,
      media_mime_type: file.type || null,
      status: "pending",
      error_message: null,
      sent_at: null,
      received_at: null,
      sender_user_id: null,
      quoted_evolution_message_id: null,
      quoted_body: replySnapshot ? replySnapshot.body.slice(0, 240) : null,
      quoted_from_me: replySnapshot ? replySnapshot.fromMe : null,
      reactions: [],
      edited_at: null,
      original_body: null,
      edit_count: 0,
      created_at: nowIso,
    };
    setMessages((prev) => [...prev, optimistic]);
    setTempMediaPreviews((prev) => {
      const next = new Map(prev);
      next.set(tempId, objectURL);
      return next;
    });
    setSendError(null);
    setReplyingTo(null);

    const wasQueueEmpty = pendingSendsRef.current === 0;
    pendingSendsRef.current += 1;
    setSending(true);

    const previousQueue = sendQueueRef.current;
    const thisSend = (async () => {
      try {
        await previousQueue;
      } catch {
        // Erros do envio anterior nao impedem o proximo de tentar.
      }
      if (!wasQueueEmpty) {
        await sleep(randInt(JITTER_MIN_MS, JITTER_MAX_MS));
      }
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("chatId", chatIdAtSend);
        if (caption.trim()) formData.append("caption", caption.trim());
        if (replySnapshot?.messageId) {
          formData.append("replyToMessageId", replySnapshot.messageId);
        }
        const res = await fetch("/api/whatsapp/messages/send-media", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setSendError(payload.error ?? "Falha ao enviar midia.");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId
                ? {
                    ...m,
                    status: "failed",
                    error_message: payload.error ?? "Falha",
                  }
                : m
            )
          );
          return;
        }
        const payload = (await res.json().catch(() => ({}))) as {
          messageId?: string;
        };
        if (payload.messageId) {
          const realId = payload.messageId;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId
                ? {
                    ...m,
                    id: realId,
                    status: "sent",
                    sent_at: new Date().toISOString(),
                  }
                : m
            )
          );
          // Move o objectURL para o id real ate o realtime entregar a linha
          // do banco (que tem media_url canonico). Sem isso, ao trocar o id,
          // o lookup do tempMediaPreviews falharia e a bolha pisca um
          // fallback `[imagem]` ate a rota /media responder.
          setTempMediaPreviews((prev) => {
            const next = new Map(prev);
            const url = next.get(tempId);
            if (url) {
              next.delete(tempId);
              next.set(realId, url);
            }
            return next;
          });
          // Revoga depois de 30s — tempo suficiente para o realtime entregar
          // o registro real e o navegador comecar a cachear /media. Se manter,
          // ocupa memoria indefinidamente.
          setTimeout(() => {
            URL.revokeObjectURL(objectURL);
            setTempMediaPreviews((prev) => {
              if (!prev.has(realId)) return prev;
              const next = new Map(prev);
              next.delete(realId);
              return next;
            });
          }, 30_000);
        } else {
          URL.revokeObjectURL(objectURL);
        }
      } catch (err) {
        setSendError(err instanceof Error ? err.message : "Falha ao enviar midia.");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? { ...m, status: "failed", error_message: "Erro de rede" }
              : m
          )
        );
        URL.revokeObjectURL(objectURL);
      } finally {
        pendingSendsRef.current = Math.max(0, pendingSendsRef.current - 1);
        if (pendingSendsRef.current === 0) {
          setSending(false);
        }
      }
    })();
    sendQueueRef.current = thisSend;
  }

  // Click no clipe abre o picker nativo do navegador. Reset do value antes
  // de abrir permite selecionar o MESMO arquivo de novo (caso o operador
  // cancele o preview e queira reabrir o mesmo arquivo).
  function handlePickFile() {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  }

  // Validacao client de tamanho: 4MB. O servidor revalida (defesa em
  // profundidade) mas falhar cedo no client poupa upload inutil.
  const MAX_CLIENT_FILE_BYTES = 4 * 1024 * 1024;

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    if (file.size > MAX_CLIENT_FILE_BYTES) {
      setSendError(
        `Arquivo muito grande. Limite: ${Math.floor(
          MAX_CLIENT_FILE_BYTES / (1024 * 1024)
        )} MB.`
      );
      return;
    }
    setSendError(null);
    setPendingMediaFile(file);
  }

  // Limpa objectURLs ainda em memoria ao desmontar (ex: usuario navega para
  // fora de /conversas). Usa a ref espelho para pegar o estado mais recente:
  // se usasse o state direto, capturaria o map inicial (vazio) por causa
  // do array de deps `[]`.
  useEffect(() => {
    return () => {
      tempMediaPreviewsRef.current.forEach((url) =>
        URL.revokeObjectURL(url)
      );
    };
  }, []);

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === "Escape") {
      if (editingMessage) {
        e.preventDefault();
        cancelEdit();
        return;
      }
      if (replyingTo) {
        e.preventDefault();
        cancelReply();
      }
    }
  }

  async function linkLead(leadId: string) {
    if (!activeChat) return;
    const supabase = createClient();
    await supabase
      .from("whatsapp_chats")
      .update({ lead_id: leadId })
      .eq("id", activeChat.id);
    setShowLinkLead(false);
    setLeadSearch("");
  }

  async function unlinkLead() {
    if (!activeChat) return;
    const supabase = createClient();
    await supabase
      .from("whatsapp_chats")
      .update({ lead_id: null })
      .eq("id", activeChat.id);
  }

  // Renomeia o contato (`whatsapp_chats.name`). Aceita `null`/string vazia
  // como "limpar nome" — a UI vai cair no fallback do telefone formatado.
  // Otimista: atualiza o `chats` local imediatamente; rollback em erro
  // restaura o nome anterior. RLS do Supabase ja garante que so usuarios
  // da mesma `company_id` conseguem fazer o UPDATE.
  async function renameChat(newName: string | null): Promise<{
    ok: boolean;
    error?: string;
  }> {
    if (!activeChat) return { ok: false, error: "Nenhum chat ativo." };
    const previousName = activeChat.name;
    const trimmed =
      typeof newName === "string" ? newName.trim() : null;
    const finalName = trimmed && trimmed.length > 0 ? trimmed : null;
    setChats((prev) =>
      prev.map((c) =>
        c.id === activeChat.id ? { ...c, name: finalName } : c
      )
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("whatsapp_chats")
      .update({ name: finalName })
      .eq("id", activeChat.id);
    if (error) {
      setChats((prev) =>
        prev.map((c) =>
          c.id === activeChat.id ? { ...c, name: previousName } : c
        )
      );
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  // Refresh manual: pede a Evolution as ultimas mensagens do chat ativo e
  // refaz o select local. Ignora o intervalo de polling de proposito — se
  // o operador clicou, ele quer reapurar agora. Usa DESC + reverse para
  // alinhar com a paginacao (so a primeira pagina e exibida; o botao
  // "carregar anteriores" continua valido para descer mais no historico).
  async function refreshHistory() {
    const chatId = activeChatIdRef.current;
    if (!chatId || refreshingHistory) return;
    setRefreshingHistory(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/whatsapp/messages/load-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, limit: MESSAGES_PAGE_SIZE }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setRefreshError(payload.error ?? "Falha ao recarregar mensagens.");
        return;
      }
      const supabase = createClient();
      const { data } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PAGE_SIZE + 1);
      // Reinicia o relogio do polling automatico para nao disparar de novo
      // logo em seguida — ja acabamos de buscar mensagens.
      lastEvolutionFetchRef.current.set(chatId, Date.now());
      const fetched = (data as WhatsAppMessage[] | null) ?? [];
      const more = fetched.length > MESSAGES_PAGE_SIZE;
      const page = (more ? fetched.slice(0, MESSAGES_PAGE_SIZE) : fetched)
        .slice()
        .reverse();
      setHasOlderMessages(more);
      setMessages(dedupeById(page));
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Erro de rede.");
    } finally {
      setRefreshingHistory(false);
    }
  }

  // Pagina anterior de mensagens: usa o created_at MAIS ANTIGO no estado
  // como cursor e busca PAGE_SIZE + 1 com created_at < cursor (DESC). O
  // scroll e preservado pelo useLayoutEffect[messages] usando o flag
  // justLoadedOlderRef + scrollHeightBeforeRef.
  async function loadOlderMessages() {
    if (loadingOlderMessages || !hasOlderMessages) return;
    if (messages.length === 0) return;
    const chatId = activeChatIdRef.current;
    if (!chatId) return;

    // Cursor robusto: o ARRAY pode ter sido reordenado por upserts/realtime,
    // entao calculamos o min(created_at) explicitamente em vez de assumir
    // messages[0]. Empate (mesmo timestamp) e improvavel mas, se ocorrer,
    // o filtro .lt corta corretamente — duplicatas sao removidas pelo dedupe.
    let oldestCreatedAt = messages[0].created_at;
    for (const m of messages) {
      if (m.created_at < oldestCreatedAt) oldestCreatedAt = m.created_at;
    }

    const el = scrollContainerRef.current;
    scrollHeightBeforeRef.current = el?.scrollHeight ?? 0;

    setLoadingOlderMessages(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .eq("chat_id", chatId)
        .lt("created_at", oldestCreatedAt)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PAGE_SIZE + 1);
      const fetched = (data as WhatsAppMessage[] | null) ?? [];
      const more = fetched.length > MESSAGES_PAGE_SIZE;
      const page = (more ? fetched.slice(0, MESSAGES_PAGE_SIZE) : fetched)
        .slice()
        .reverse();
      // Sinaliza ao layout effect: a proxima atualizacao deve preservar a
      // posicao em vez de descer. Setamos ANTES do setMessages para evitar
      // race com o re-render.
      justLoadedOlderRef.current = true;
      setHasOlderMessages(more);
      setMessages((prev) => dedupeById([...page, ...prev]));
    } finally {
      setLoadingOlderMessages(false);
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const supabase = createClient();
      const offset = chatsRef.current.length;
      // Pede pageSize + 1 para detectar se ainda ha mais paginas. Sem
      // filtro de janela: lista completa em blocos de pageSize.
      const { data } = await supabase
        .from("whatsapp_chats")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_archived", false)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + pageSize);
      const fetched = (data as WhatsAppChat[] | null) ?? [];
      const more = fetched.length > pageSize;
      const page = more ? fetched.slice(0, pageSize) : fetched;
      setChats((prev) => {
        const existingIds = new Set(prev.map((c) => c.id));
        const merged = [...prev];
        for (const c of page) {
          if (!existingIds.has(c.id)) merged.push(c);
        }
        merged.sort(compareChatsDesc);
        return merged;
      });
      setHasMore(more);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Conversas</h1>
          <p className="text-xs text-gray-500">
            WhatsApp da clinica
            {instance.phone_number ? ` · +${instance.phone_number}` : ""}
          </p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-80 shrink-0 flex-col border-r border-gray-200 bg-white">
          <div className="border-b border-gray-200 p-3">
            <input
              type="text"
              placeholder="Buscar conversa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-blue-500 focus:bg-white focus:outline-none"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredChats.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-400">
                {searching
                  ? "Buscando..."
                  : searchResults !== null
                    ? "Nenhum contato encontrado."
                    : "Nenhuma conversa."}
              </div>
            ) : (
              filteredChats.map((c) => {
                const active = c.id === activeChatId;
                const hasUnread = c.unread_count > 0 && !active;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setActiveChatId(c.id);
                      setShowContactPanel(false);
                    }}
                    className={`flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                      active ? "bg-blue-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <ContactAvatar
                      pictureUrl={c.profile_picture_url}
                      displayName={c.name}
                      jid={c.remote_jid}
                      hasLead={Boolean(c.lead_id)}
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={`truncate text-sm text-gray-900 ${
                            hasUnread ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {c.name || jidToPhoneDisplay(c.remote_jid)}
                        </p>
                        <span
                          className={`shrink-0 text-[10px] ${
                            hasUnread
                              ? "font-semibold text-emerald-600"
                              : "text-gray-400"
                          }`}
                        >
                          {fmtTime(c.last_message_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={`flex min-w-0 items-center gap-1 truncate text-xs ${
                            hasUnread
                              ? "font-medium text-gray-700"
                              : "text-gray-500"
                          }`}
                        >
                          {/* Checks de WhatsApp na previa, igual o app
                              oficial: so quando a ultima mensagem foi
                              enviada por mim (operador). Se foi do
                              contato, a previa fica so com o texto. */}
                          {c.last_message_from_me && c.last_message_status && (
                            <span className="shrink-0">
                              <MessageStatusChecks
                                status={c.last_message_status}
                                size={12}
                              />
                            </span>
                          )}
                          <span className="truncate">
                            {c.last_message_preview ?? "—"}
                          </span>
                        </p>
                        {hasUnread && (
                          <span
                            aria-label={`${c.unread_count} mensagem${
                              c.unread_count === 1 ? "" : "s"
                            } nao lida${c.unread_count === 1 ? "" : "s"}`}
                            className="ml-2 inline-flex min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm"
                          >
                            {c.unread_count > 99 ? "99+" : c.unread_count}
                          </span>
                        )}
                      </div>
                      {c.lead_id ? (
                        <span className="mt-1 inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                          Lead vinculado
                        </span>
                      ) : (
                        <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          Sem lead
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
            {searchResults === null && filteredChats.length > 0 && (
              <div className="border-t border-gray-100 p-3">
                {hasMore ? (
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {loadingMore ? "Carregando..." : "Carregar mais"}
                  </button>
                ) : (
                  <p className="text-center text-[11px] leading-relaxed text-gray-400">
                    Sem mais conversas.
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-gray-50">
          {!activeChat ? (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
              Selecione uma conversa para comecar
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
                <button
                  type="button"
                  onClick={() => setShowContactPanel(true)}
                  className="flex items-center gap-3 rounded-lg p-1 text-left transition-colors hover:bg-gray-50"
                  aria-label="Ver dados do contato"
                >
                  <ContactAvatar
                    pictureUrl={activeChat.profile_picture_url}
                    displayName={activeChat.name}
                    jid={activeChat.remote_jid}
                    hasLead={Boolean(activeChat.lead_id)}
                    size={40}
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {activeChat.name || jidToPhoneDisplay(activeChat.remote_jid)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {jidToPhoneDisplay(activeChat.remote_jid)}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  {activeChat.lead_id ? (
                    <>
                      <Link
                        href={`/${domain}/leads/${activeChat.lead_id}`}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Ver lead
                        {linkedLeadName ? `: ${linkedLeadName}` : ""}
                      </Link>
                      <button
                        type="button"
                        onClick={unlinkLead}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50"
                      >
                        Desvincular
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowLinkLead(true)}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      Vincular a lead
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={refreshHistory}
                    disabled={refreshingHistory}
                    title={
                      refreshingHistory
                        ? "Recarregando..."
                        : "Recarregar ultimas mensagens"
                    }
                    aria-label="Recarregar ultimas mensagens"
                    className="inline-flex items-center justify-center rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={refreshingHistory ? "animate-spin" : ""}
                    >
                      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                      <path d="M21 3v5h-5" />
                      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                      <path d="M8 16H3v5" />
                    </svg>
                  </button>
                </div>
              </div>

              <div
                ref={scrollContainerRef}
                onScroll={handleMessagesScroll}
                className="min-w-0 flex-1 overflow-y-auto px-6 py-4"
              >
                {loadingMessages ? (
                  <div className="text-center text-xs text-gray-400">
                    Carregando mensagens...
                  </div>
                ) : renderedMessages.length === 0 ? (
                  <div className="text-center text-xs text-gray-400">
                    Sem mensagens nesta conversa.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {hasOlderMessages && (
                      <div className="flex justify-center pb-2 pt-1">
                        <button
                          type="button"
                          onClick={loadOlderMessages}
                          disabled={loadingOlderMessages}
                          className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                        >
                          {loadingOlderMessages
                            ? "Carregando..."
                            : "Carregar mensagens anteriores"}
                        </button>
                      </div>
                    )}
                    {renderedMessages.map((m) => (
                      <MessageBubble
                        key={m.id}
                        message={m}
                        senderName={resolveSenderName(
                          m,
                          usersById,
                          currentUserId,
                          currentUserName
                        )}
                        onReply={startReply}
                        onJumpToQuote={jumpToQuote}
                        onReact={reactToMessage}
                        onEdit={startEdit}
                        onOpenMedia={(kind, id) =>
                          setLightbox({ kind, messageId: id })
                        }
                        highlighted={highlightedMessageId === m.id}
                        contactName={
                          activeChat?.name ??
                          jidToPhoneDisplay(activeChat?.remote_jid ?? "")
                        }
                        tempPreviewUrl={tempMediaPreviews.get(m.id) ?? null}
                      />
                    ))}
                  </div>
                )}
              </div>

              {refreshError && (
                <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                  {refreshError}
                </div>
              )}
              {sendError && (
                <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
                  {sendError}
                </div>
              )}
              {replyingTo && !editingMessage && (
                <div className="flex items-stretch gap-3 border-t border-gray-200 bg-gray-50 px-4 py-2">
                  <div
                    className={`w-1 shrink-0 rounded-full ${
                      replyingTo.fromMe ? "bg-emerald-500" : "bg-blue-500"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 py-1">
                    <p
                      className={`truncate text-[11px] font-semibold ${
                        replyingTo.fromMe ? "text-emerald-700" : "text-blue-700"
                      }`}
                    >
                      Respondendo a {replyingTo.senderLabel}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-600">
                      {replyingTo.body}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={cancelReply}
                    className="shrink-0 self-start rounded-full p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                    aria-label="Cancelar resposta"
                    title="Cancelar resposta"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>
              )}
              {editingMessage && (
                <div className="flex items-stretch gap-3 border-t border-amber-200 bg-amber-50 px-4 py-2">
                  <div
                    className="w-1 shrink-0 rounded-full bg-amber-500"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 py-1">
                    <p className="flex items-center gap-1 truncate text-[11px] font-semibold text-amber-800">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      Editando mensagem
                      <span className="font-normal text-amber-600">
                        (Esc para cancelar)
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-600">
                      Original: {editingMessage.originalBody || "(vazio)"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="shrink-0 self-start rounded-full p-1 text-amber-600 hover:bg-amber-100 hover:text-amber-900"
                    aria-label="Cancelar edicao"
                    title="Cancelar edicao (Esc)"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>
              )}
              <form
                onSubmit={handleSend}
                className="flex items-end gap-2 border-t border-gray-200 bg-white px-4 py-3"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,text/plain,text/csv"
                  className="hidden"
                  onChange={handleFileSelected}
                />
                <button
                  type="button"
                  onClick={handlePickFile}
                  aria-label="Anexar arquivo"
                  title={
                    editingMessage
                      ? "Anexar arquivo (indisponivel em modo edicao)"
                      : "Anexar foto, video ou documento"
                  }
                  disabled={Boolean(editingMessage)}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-500"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder={
                    editingMessage
                      ? "Edite a mensagem... (Enter salva, Esc cancela)"
                      : "Digite uma mensagem... (Enter para enviar, Shift+Enter para nova linha)"
                  }
                  rows={2}
                  className={`flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                    editingMessage
                      ? "border-amber-300 bg-amber-50/30 focus:border-amber-500 focus:ring-amber-500/20"
                      : "border-gray-200 focus:border-blue-500 focus:ring-blue-500/20"
                  }`}
                />
                <button
                  type="submit"
                  disabled={
                    !draft.trim() ||
                    editing ||
                    (Boolean(editingMessage) &&
                      draft.trim() ===
                        (editingMessage?.originalBody ?? "").trim())
                  }
                  className={`rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 ${
                    editingMessage
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                  title={
                    editingMessage
                      ? "Salvar edicao"
                      : sending
                        ? "Enviando mensagens anteriores em ordem..."
                        : undefined
                  }
                >
                  {editingMessage ? (editing ? "Salvando..." : "Salvar") : "Enviar"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>

      {lightbox?.kind === "image" && (
        <MediaLightbox
          messageId={lightbox.messageId}
          onClose={() => setLightbox(null)}
        />
      )}
      {lightbox?.kind === "document" && (
        <DocumentLightbox
          messageId={lightbox.messageId}
          onClose={() => setLightbox(null)}
        />
      )}

      {pendingMediaFile && (
        <MediaPreviewDialog
          file={pendingMediaFile}
          onCancel={() => setPendingMediaFile(null)}
          onConfirm={(caption) => {
            const file = pendingMediaFile;
            setPendingMediaFile(null);
            handleSendMedia(file, caption);
          }}
        />
      )}

      {incomingToast && (
        <button
          type="button"
          onClick={() => {
            setActiveChatId(incomingToast.chatId);
            setIncomingToast(null);
            if (incomingToastTimerRef.current) {
              clearTimeout(incomingToastTimerRef.current);
              incomingToastTimerRef.current = null;
            }
          }}
          className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-left shadow-lg transition-transform hover:-translate-y-0.5 hover:shadow-xl"
        >
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-gray-900">
              Nova mensagem de {incomingToast.chatLabel}
            </span>
            <span className="mt-0.5 block truncate text-xs text-gray-600">
              {incomingToast.preview}
            </span>
          </span>
        </button>
      )}

      {showContactPanel && activeChat && (
        <ContactPanel
          chat={activeChat}
          domain={domain}
          linkedLeadName={linkedLeadName}
          onClose={() => setShowContactPanel(false)}
          onLinkLead={() => {
            setShowContactPanel(false);
            setShowLinkLead(true);
          }}
          onUnlinkLead={unlinkLead}
          onRename={renameChat}
        />
      )}

      {showLinkLead && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLinkLead(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
          >
            <h3 className="text-base font-semibold text-gray-900">
              Vincular conversa a um lead
            </h3>
            <input
              type="text"
              value={leadSearch}
              onChange={(e) => setLeadSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              autoFocus
            />
            <div className="mt-2 max-h-64 overflow-y-auto">
              {leadOptions.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-gray-400">
                  Nenhum lead encontrado.
                </p>
              ) : (
                leadOptions.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => linkLead(l.id)}
                    className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    <span className="font-medium text-gray-900">{l.name}</span>
                    <span className="ml-2 text-xs text-gray-500">{l.phone}</span>
                  </button>
                ))
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setShowLinkLead(false)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getInitials(name: string | null, jid: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  const phone = jid.replace(/\D/g, "");
  return phone.slice(-2) || "??";
}

interface ContactAvatarProps {
  pictureUrl: string | null;
  displayName: string | null;
  jid: string;
  hasLead: boolean;
  size: number;
}

function ContactAvatar({
  pictureUrl,
  displayName,
  jid,
  hasLead,
  size,
}: ContactAvatarProps) {
  const [errored, setErrored] = useState(false);
  const initials = getInitials(displayName, jid);
  const fallbackBg = hasLead
    ? "bg-emerald-100 text-emerald-700"
    : "bg-gray-200 text-gray-600";

  if (pictureUrl && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={pictureUrl}
        alt={displayName ?? "Contato"}
        onError={() => setErrored(true)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-full text-sm font-semibold ${fallbackBg}`}
    >
      {initials}
    </div>
  );
}

interface ContactPanelProps {
  chat: WhatsAppChat;
  domain: string;
  linkedLeadName: string | null;
  onClose: () => void;
  onLinkLead: () => void;
  onUnlinkLead: () => void;
  /**
   * Persiste o nome do contato em `whatsapp_chats.name`. Aceita string
   * vazia/`null` para "limpar nome" (UI cai no fallback do telefone).
   * Resolve com `{ ok, error? }` — o painel exibe o erro inline em vez
   * de descartar a edicao.
   */
  onRename: (newName: string | null) => Promise<{ ok: boolean; error?: string }>;
}

function ContactPanel({
  chat,
  domain,
  linkedLeadName,
  onClose,
  onLinkLead,
  onUnlinkLead,
  onRename,
}: ContactPanelProps) {
  const phone = chat.remote_jid.replace(/@.*$/, "");
  const phoneDisplay = jidToPhoneDisplay(chat.remote_jid);
  const displayName = chat.name || phoneDisplay;
  const waLink = `https://wa.me/${phone}`;

  // Estado do modo edicao do nome. Inicia oculto; click no lapis abre o
  // input pre-preenchido com o nome atual (ou vazio se ainda nao tem).
  // Submit bate em `onRename` (que ja faz UPDATE otimista no chats array
  // do componente pai). Em caso de erro do banco, mostramos inline e
  // mantemos o modo edicao para o operador tentar novo valor.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(chat.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Quando troca de chat (props.chat.id muda) com o painel aberto,
  // sai do modo edicao e re-sincroniza o draft. Sem isso, o draft do
  // contato anterior seria salvo no contato novo se o operador clicar
  // em "Salvar" sem prestar atencao.
  useEffect(() => {
    setEditingName(false);
    setNameDraft(chat.name ?? "");
    setNameError(null);
  }, [chat.id, chat.name]);

  // Foca o input no momento que entra em modo edicao (proxima frame).
  useEffect(() => {
    if (editingName) {
      const id = window.requestAnimationFrame(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      });
      return () => window.cancelAnimationFrame(id);
    }
  }, [editingName]);

  function startEditName() {
    setNameDraft(chat.name ?? "");
    setNameError(null);
    setEditingName(true);
  }

  function cancelEditName() {
    setEditingName(false);
    setNameDraft(chat.name ?? "");
    setNameError(null);
  }

  // Atalho: usar o nome do lead vinculado como nome do contato. So
  // disponivel quando `chat.lead_id` e `linkedLeadName` estao presentes.
  // Apenas pre-preenche o draft — o operador ainda confirma com Salvar.
  function fillFromLead() {
    if (linkedLeadName) {
      setNameDraft(linkedLeadName);
      setNameError(null);
    }
  }

  async function saveName() {
    if (savingName) return;
    setSavingName(true);
    setNameError(null);
    const result = await onRename(nameDraft);
    setSavingName(false);
    if (!result.ok) {
      setNameError(result.error ?? "Falha ao salvar nome.");
      return;
    }
    setEditingName(false);
  }

  function handleNameKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveName();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEditName();
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Dados do contato"
        className="flex h-full w-full max-w-sm flex-col bg-white shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
              aria-label="Fechar"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
            <h2 className="text-sm font-semibold text-gray-900">
              Dados do contato
            </h2>
          </div>
        </header>

        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="flex flex-col items-center gap-3 border-b border-gray-100 bg-gray-50 px-6 py-8">
            <ContactAvatar
              pictureUrl={chat.profile_picture_url}
              displayName={chat.name}
              jid={chat.remote_jid}
              hasLead={Boolean(chat.lead_id)}
              size={120}
            />
            <div className="w-full text-center">
              {editingName ? (
                <div className="flex flex-col items-center gap-2 px-2">
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={handleNameKey}
                    placeholder={phoneDisplay}
                    maxLength={120}
                    disabled={savingName}
                    aria-label="Nome do contato"
                    className="w-full max-w-xs rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-center text-base font-semibold text-gray-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60"
                  />
                  {chat.lead_id && linkedLeadName && (
                    <button
                      type="button"
                      onClick={fillFromLead}
                      disabled={savingName || nameDraft === linkedLeadName}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      title="Preencher com o nome do lead vinculado"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      Usar nome do lead ({linkedLeadName})
                    </button>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={cancelEditName}
                      disabled={savingName}
                      className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={saveName}
                      disabled={
                        savingName ||
                        nameDraft.trim() === (chat.name ?? "").trim()
                      }
                      className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {savingName ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                  {nameError && (
                    <p className="text-[11px] text-red-600">{nameError}</p>
                  )}
                  <p className="text-[10px] text-gray-400">
                    Enter salva, Esc cancela. Vazio = usar telefone.
                  </p>
                </div>
              ) : (
                <div className="group/name inline-flex items-center justify-center gap-1.5">
                  <p className="text-lg font-semibold text-gray-900">
                    {displayName}
                  </p>
                  <button
                    type="button"
                    onClick={startEditName}
                    aria-label="Editar nome do contato"
                    title="Editar nome"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-400 opacity-60 transition-all hover:bg-gray-100 hover:text-emerald-600 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-emerald-400 group-hover/name:opacity-100"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                </div>
              )}
              <p className="mt-1 text-sm text-gray-500">{phoneDisplay}</p>
            </div>
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
            >
              Abrir no WhatsApp
            </a>
          </div>

          <section className="border-b border-gray-100 px-5 py-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Vinculo com lead
            </h3>
            {chat.lead_id ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p className="text-xs text-emerald-700">Lead vinculado</p>
                  <p className="mt-0.5 text-sm font-medium text-emerald-900">
                    {linkedLeadName ?? "—"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/${domain}/leads/${chat.lead_id}`}
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-center text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Ver lead
                  </Link>
                  <button
                    type="button"
                    onClick={onUnlinkLead}
                    className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Desvincular
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onLinkLead}
                className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Vincular a um lead
              </button>
            )}
          </section>

          <section className="border-b border-gray-100 px-5 py-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Informacoes
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Telefone</dt>
                <dd className="text-gray-900">{phoneDisplay}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Mensagens nao lidas</dt>
                <dd className="text-gray-900">{chat.unread_count}</dd>
              </div>
              {chat.last_message_at && (
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Ultima atividade</dt>
                  <dd className="text-gray-900">
                    {new Date(chat.last_message_at).toLocaleString("pt-BR")}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Iniciada em</dt>
                <dd className="text-gray-900">
                  {new Date(chat.created_at).toLocaleDateString("pt-BR")}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
}

// Resolve qual nome exibir acima da bolha de uma mensagem enviada (from_me).
// - Mensagens enviadas pelo CRM ja salvam sender_user_id no banco; basta
//   buscar no mapa de usuarios da company.
// - Para mensagem otimista (id "temp-..."), o sender_user_id ainda nao foi
//   gravado, mas sabemos que e o operador logado.
// - Mensagem from_me sem sender_user_id e que nao e otimista: foi enviada
//   diretamente pelo aparelho conectado, fora do CRM.
function resolveSenderName(
  message: WhatsAppMessage,
  usersById: Map<string, string>,
  currentUserId: string | null,
  currentUserName: string | null
): string | null {
  if (!message.from_me) return null;
  if (message.sender_user_id) {
    return usersById.get(message.sender_user_id) ?? "Operador";
  }
  if (message.id.startsWith("temp-")) {
    return currentUserName ?? (currentUserId ? "Operador" : null);
  }
  return "Enviado pelo celular";
}

function mediaUrl(messageId: string, options?: { download?: boolean }): string {
  const path = `/api/whatsapp/messages/${encodeURIComponent(messageId)}/media`;
  return options?.download ? `${path}?download=1` : path;
}

// Faz download de uma midia para o disco do operador. Usa fetch + blob URL
// porque o servidor expoe Content-Disposition; o atributo `download` do <a>
// e necessario para o browser escolher "salvar" em vez de "navegar".
async function downloadMedia(messageId: string): Promise<void> {
  try {
    const res = await fetch(mediaUrl(messageId, { download: true }));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cd = res.headers.get("Content-Disposition") ?? "";
    const match = cd.match(/filename="([^"]+)"/i);
    const filename = match?.[1] ?? `whatsapp-${messageId.slice(0, 8)}.bin`;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error("[downloadMedia] failed:", err);
  }
}

// Renderiza um sticker via /api/whatsapp/messages/[id]/media (que faz o
// decrypt na Evolution e devolve o webp/png). Mantem fallback textual em
// caso de erro de rede ou midia indisponivel — alguma instancia pode nao
// conseguir decodificar todos os stickers (mediaKey ausente, etc).
function StickerImage({ messageId }: { messageId: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return <p className="italic text-gray-500">[sticker]</p>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={mediaUrl(messageId)}
      alt="Sticker"
      className="h-32 w-32 select-none object-contain"
      draggable={false}
      onError={() => setErrored(true)}
    />
  );
}

// Imagem inline na bolha. Click abre o lightbox em tela cheia (com download
// e fechar). Tamanho maximo permite varias imagens roladas sem dominar o
// viewport; cursor-zoom-in indica a interacao.
//
// `srcOverride`: quando passado, usa essa URL em vez de chamar a rota
// `/media`. Usado para mensagens otimistas (`temp-`) onde o operador acabou
// de selecionar a imagem — mostra o thumbnail local (`URL.createObjectURL`)
// imediatamente, sem precisar esperar a Evolution decodificar via rota /media.
// Quando o id real chega via realtime, o componente e re-renderizado sem
// override e passa a usar o caminho normal.
function MessageImage({
  messageId,
  onOpen,
  srcOverride,
}: {
  messageId: string;
  onOpen: () => void;
  srcOverride?: string | null;
}) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return <p className="italic text-gray-500">[imagem]</p>;
  }
  const src = srcOverride ?? mediaUrl(messageId);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Abrir imagem em tela cheia"
      className="block overflow-hidden rounded-lg"
      disabled={Boolean(srcOverride)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Imagem recebida"
        className={`block max-h-64 w-auto object-cover ${
          srcOverride ? "" : "cursor-zoom-in"
        }`}
        onError={() => setErrored(true)}
      />
    </button>
  );
}

// Player nativo de video. Carrega sob demanda: enquanto o operador rola o
// chat, mostra um placeholder com botao "play"; so apos o click o <video>
// e renderizado e a midia comeca a baixar (autoPlay para sequencia natural
// do clique). Isso evita decodes/conversoes pesadas em rajada na Evolution
// e trafego desnecessario para videos que o operador talvez nem va abrir.
function MessageVideo({
  messageId,
  srcOverride,
}: {
  messageId: string;
  srcOverride?: string | null;
}) {
  const [load, setLoad] = useState(false);
  const [errored, setErrored] = useState(false);
  if (errored) {
    return <p className="italic text-gray-500">[video]</p>;
  }
  // Otimista: mostra player imediato com a fonte local sem o placeholder
  // de "Reproduzir" — o operador acabou de selecionar o arquivo, nao precisa
  // de um intermediario.
  if (srcOverride) {
    return (
      <video
        controls
        preload="metadata"
        src={srcOverride}
        onError={() => setErrored(true)}
        className="block max-h-72 w-auto rounded-lg bg-black"
      />
    );
  }
  if (!load) {
    return (
      <button
        type="button"
        onClick={() => setLoad(true)}
        aria-label="Reproduzir video"
        className="flex h-40 w-60 items-center justify-center gap-2 rounded-lg bg-gray-200/80 text-gray-700 transition-colors hover:bg-gray-300/80"
      >
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/80 text-emerald-700 shadow">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <polygon points="6 4 20 12 6 20 6 4" />
          </svg>
        </span>
        <span className="text-xs font-medium">Reproduzir video</span>
      </button>
    );
  }
  return (
    <video
      controls
      autoPlay
      preload="metadata"
      src={mediaUrl(messageId)}
      onError={() => setErrored(true)}
      className="block max-h-72 w-auto rounded-lg bg-black"
    />
  );
}

// Formata duracao de audio em "M:SS" (ou "MM:SS" para audios longos).
// Usado tanto para tempo decorrido quanto para duracao total.
function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const AUDIO_SPEED_CYCLE = [1, 1.5, 2] as const;

// Player de audio inspirado no WhatsApp Web. Funcionalidades:
//   - Play/Pause sem reload (usa <audio> escondido controlado por ref).
//   - Barra de progresso clicavel para seek arbitrario.
//   - Botao de velocidade que cicla 1x -> 1.5x -> 2x -> 1x.
//   - Tempo decorrido / duracao total.
//   - Botao de download (faz fetch + blob URL).
//
// Lazy-load: `preload="none"` para nao disparar GET na rota (e portanto
// chamada Evolution) ao apenas renderizar o chat. O navegador so puxa o
// arquivo quando o operador clica em play.
//
// Workaround `duration=Infinity`: audios `.ogg/opus` vindos do WhatsApp
// frequentemente reportam `Infinity` no primeiro `loadedmetadata` em
// browsers Chromium. A correcao classica e fazer seek para um valor alto
// e voltar — apos o seek, o browser recalcula a duracao real.
function MessageAudio({
  messageId,
  isMe,
}: {
  messageId: string;
  isMe: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const durationFixedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    function tryFixDuration() {
      if (!a) return;
      // Se o browser ja conseguiu calcular a duracao certa, usa direto.
      if (Number.isFinite(a.duration) && a.duration > 0) {
        setDuration(a.duration);
        durationFixedRef.current = true;
        return;
      }
      // Workaround para ogg/opus do WhatsApp: seek pra "infinito" forca
      // o decoder a percorrer o arquivo e descobrir a duracao real. Apos
      // o seek, voltamos ao inicio e o `durationchange` traz o valor.
      if (!durationFixedRef.current) {
        durationFixedRef.current = true;
        const onceDuration = () => {
          if (!a) return;
          if (Number.isFinite(a.duration) && a.duration > 0) {
            setDuration(a.duration);
            a.currentTime = 0;
          }
          a.removeEventListener("durationchange", onceDuration);
        };
        a.addEventListener("durationchange", onceDuration);
        try {
          a.currentTime = 1e10;
        } catch {
          // alguns browsers lancam se currentTime > seekable range; ignora.
        }
      }
    }

    function onLoadedMetadata() {
      tryFixDuration();
    }
    function onDurationChange() {
      if (!a) return;
      if (Number.isFinite(a.duration) && a.duration > 0) {
        setDuration(a.duration);
      }
    }
    function onTimeUpdate() {
      if (!a) return;
      setCurrentTime(a.currentTime);
    }
    function onPlay() {
      setPlaying(true);
    }
    function onPause() {
      setPlaying(false);
    }
    function onEnded() {
      if (!a) return;
      setPlaying(false);
      setCurrentTime(0);
      try {
        a.currentTime = 0;
      } catch {
        /* noop */
      }
    }
    function onError() {
      setErrored(true);
      setPlaying(false);
    }

    a.addEventListener("loadedmetadata", onLoadedMetadata);
    a.addEventListener("durationchange", onDurationChange);
    a.addEventListener("timeupdate", onTimeUpdate);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("error", onError);
    return () => {
      a.removeEventListener("loadedmetadata", onLoadedMetadata);
      a.removeEventListener("durationchange", onDurationChange);
      a.removeEventListener("timeupdate", onTimeUpdate);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);
    };
  }, []);

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play().catch(() => setErrored(true));
    } else {
      a.pause();
    }
  }

  function cycleSpeed() {
    const next = (speedIndex + 1) % AUDIO_SPEED_CYCLE.length;
    setSpeedIndex(next);
    const a = audioRef.current;
    if (a) a.playbackRate = AUDIO_SPEED_CYCLE[next];
  }

  function seekFromEvent(clientX: number) {
    const a = audioRef.current;
    const bar = progressBarRef.current;
    if (!a || !bar || duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (clientX - rect.left) / rect.width)
    );
    a.currentTime = ratio * duration;
    setCurrentTime(a.currentTime);
  }

  if (errored) {
    return <p className="italic text-gray-500">[audio]</p>;
  }

  const speed = AUDIO_SPEED_CYCLE[speedIndex];
  const progressPct =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const trackBg = isMe ? "bg-emerald-200/70" : "bg-gray-200";
  const fillBg = isMe ? "bg-emerald-600" : "bg-emerald-500";
  const buttonBg = isMe
    ? "bg-emerald-600 text-white hover:bg-emerald-700"
    : "bg-emerald-500 text-white hover:bg-emerald-600";
  const speedBadge = isMe
    ? "bg-emerald-50 text-emerald-800 hover:bg-white"
    : "bg-gray-100 text-gray-700 hover:bg-gray-200";

  return (
    <div className="flex w-64 items-center gap-3">
      <audio ref={audioRef} src={mediaUrl(messageId)} preload="none" />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "Pausar audio" : "Reproduzir audio"}
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-sm transition-colors ${buttonBg}`}
      >
        {playing ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <polygon points="6 4 20 12 6 20 6 4" />
          </svg>
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          ref={progressBarRef}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={duration || 0}
          aria-valuenow={currentTime}
          aria-label="Progresso do audio"
          tabIndex={0}
          onClick={(e) => seekFromEvent(e.clientX)}
          onKeyDown={(e) => {
            if (!audioRef.current || duration <= 0) return;
            if (e.key === "ArrowRight") {
              e.preventDefault();
              audioRef.current.currentTime = Math.min(
                duration,
                audioRef.current.currentTime + 5
              );
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              audioRef.current.currentTime = Math.max(
                0,
                audioRef.current.currentTime - 5
              );
            }
          }}
          className={`relative h-1.5 cursor-pointer rounded-full ${trackBg}`}
        >
          <div
            className={`h-full rounded-full ${fillBg}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
          <span>{formatAudioTime(currentTime)}</span>
          <span>
            {duration > 0 ? formatAudioTime(duration) : "--:--"}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={cycleSpeed}
        aria-label={`Velocidade ${speed}x`}
        title={`Velocidade ${speed}x (clique para alterar)`}
        className={`inline-flex h-7 shrink-0 items-center justify-center rounded-full px-2 text-[10px] font-semibold transition-colors ${speedBadge}`}
      >
        {speed}x
      </button>
      <button
        type="button"
        onClick={() => {
          void downloadMedia(messageId);
        }}
        aria-label="Baixar audio"
        title="Baixar audio"
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${speedBadge}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
    </div>
  );
}

// Card de documento ao estilo WhatsApp: icone do tipo de arquivo a esquerda,
// nome (truncado) e extensao no meio, botoes "abrir/preview" e "baixar" a
// direita. Para PDF, click no card abre o `DocumentLightbox` com preview
// inline (iframe nativo do browser). Outros tipos so abrem o download
// (browser sem viewer integrado).
function MessageDocument({
  messageId,
  fileName,
  mimeType,
  isMe,
  onOpenPreview,
}: {
  messageId: string;
  fileName: string | null;
  mimeType: string | null;
  isMe: boolean;
  onOpenPreview: () => void;
}) {
  const lowerName = (fileName ?? "").toLowerCase();
  const lowerMime = (mimeType ?? "").toLowerCase();
  const isPdf =
    lowerMime.includes("pdf") || lowerName.endsWith(".pdf");
  const ext = (() => {
    if (lowerName.includes(".")) {
      const e = lowerName.split(".").pop() ?? "";
      if (e.length > 0 && e.length <= 5) return e.toUpperCase();
    }
    if (lowerMime) {
      const sub = lowerMime.split("/")[1]?.split(";")[0]?.split("+")[0] ?? "";
      if (sub) return sub.toUpperCase();
    }
    return "DOC";
  })();
  const displayName = fileName?.trim() || `Documento.${ext.toLowerCase()}`;

  function primaryAction() {
    if (isPdf) onOpenPreview();
    else void downloadMedia(messageId);
  }

  const iconBg = isMe
    ? "bg-emerald-200/80 text-emerald-800"
    : "bg-gray-200 text-gray-700";
  const actionBtn = isMe
    ? "text-emerald-800 hover:bg-emerald-200/60"
    : "text-gray-600 hover:bg-gray-200/70";

  return (
    <div className="flex w-72 max-w-full items-center gap-3">
      <button
        type="button"
        onClick={primaryAction}
        title={isPdf ? "Pre-visualizar PDF" : "Baixar documento"}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg transition-colors ${iconBg}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </button>
      <button
        type="button"
        onClick={primaryAction}
        title={isPdf ? "Pre-visualizar PDF" : "Baixar documento"}
        className="min-w-0 flex-1 cursor-pointer text-left"
      >
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="text-[10px] uppercase tracking-wide text-gray-500">
          {ext}
        </p>
      </button>
      {isPdf && (
        <button
          type="button"
          onClick={onOpenPreview}
          aria-label="Pre-visualizar PDF"
          title="Pre-visualizar PDF"
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${actionBtn}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          void downloadMedia(messageId);
        }}
        aria-label="Baixar documento"
        title="Baixar documento"
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${actionBtn}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
    </div>
  );
}

// Modal de pre-visualizacao de PDF em tela cheia. Usa o viewer nativo do
// navegador via `<iframe>`, que reaproveita o mesmo Content-Type:
// application/pdf da rota de midia. Esc / click fora fecha.
function DocumentLightbox({
  messageId,
  onClose,
}: {
  messageId: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Visualizacao de documento"
    >
      <div
        className="mb-3 flex w-full justify-end gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => {
            void downloadMedia(messageId);
          }}
          aria-label="Baixar documento"
          title="Baixar documento"
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/95 px-3 text-xs font-medium text-gray-800 shadow-md transition-colors hover:bg-white"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Baixar
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar visualizacao"
          title="Fechar"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-gray-800 shadow-md transition-colors hover:bg-white"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      <div
        className="flex-1 overflow-hidden rounded-lg bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <iframe
          src={mediaUrl(messageId)}
          title="Pre-visualizacao do documento"
          className="h-full w-full"
        />
      </div>
    </div>
  );
}

// Modal fullscreen para imagem. Esc fecha; click no fundo fecha; barra
// superior tem botoes de download e fechar. O <img> usa o cache da rota
// (mesma URL do thumbnail), entao a abertura e instantanea.
function MediaLightbox({
  messageId,
  onClose,
}: {
  messageId: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Visualizacao de imagem"
    >
      <div
        className="relative flex max-h-full max-w-full flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaUrl(messageId)}
          alt="Imagem em tela cheia"
          className="max-h-[88vh] max-w-[90vw] rounded-lg object-contain"
        />
        <div className="absolute right-2 top-2 flex gap-2">
          <button
            type="button"
            onClick={() => {
              void downloadMedia(messageId);
            }}
            aria-label="Baixar imagem"
            title="Baixar imagem"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-gray-800 shadow-md transition-colors hover:bg-white"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar visualizacao"
            title="Fechar"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-gray-800 shadow-md transition-colors hover:bg-white"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// Agrupa as reactions normalizadas por emoji para a UI: cada grupo vira
// um badge unico, com a contagem (quando > 1) e flag "do operador" para
// permitir o toggle ao clicar.
interface ReactionGroup {
  emoji: string;
  count: number;
  byMe: boolean;
}

function groupReactions(list: WhatsAppMessageReaction[]): ReactionGroup[] {
  const map = new Map<string, ReactionGroup>();
  for (const r of list) {
    const existing = map.get(r.emoji);
    if (existing) {
      existing.count += 1;
      if (r.from_me) existing.byMe = true;
    } else {
      map.set(r.emoji, { emoji: r.emoji, count: 1, byMe: r.from_me });
    }
  }
  return Array.from(map.values());
}

function MessageBubble({
  message,
  senderName,
  onReply,
  onJumpToQuote,
  onReact,
  onEdit,
  onOpenMedia,
  highlighted,
  contactName,
  tempPreviewUrl,
}: {
  message: WhatsAppMessage;
  senderName: string | null;
  onReply: (message: WhatsAppMessage) => void;
  onJumpToQuote: (quotedEvoId: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  // Inicia edicao da mensagem. So sera chamada para mensagens que passam
  // em `canEditMessageNow` — o botao fica escondido nos demais casos.
  onEdit: (message: WhatsAppMessage) => void;
  onOpenMedia: (kind: "image" | "document", messageId: string) => void;
  highlighted: boolean;
  contactName: string;
  // URL local (objectURL) para mensagens otimistas (`temp-`) que tem midia.
  // Quando passada, image/video renderizam imediatamente com a fonte local
  // em vez de fallback `[imagem]`/`[video]`. Documento temp continua sendo
  // texto porque a preview de PDF/DOCX no DOM seria custosa e nao agrega.
  tempPreviewUrl?: string | null;
}) {
  const isMe = message.from_me;
  const time = fmtTime(
    message.received_at ?? message.sent_at ?? message.created_at
  );
  const isExternal = senderName === "Enviado pelo celular";
  const hasQuote = Boolean(message.quoted_body);
  const isTemp = message.id.startsWith("temp-");
  // Mensagem otimista (temp-) ainda nao tem id real no banco; nao podemos
  // usar como replyTo porque o backend nao consegue resolver evolution_message_id.
  const canReply = !isTemp;
  // Reagir tem o mesmo requisito do reply (precisa do evolution_message_id
  // resolvido no servidor) + a instancia precisa estar conectada (a rota
  // valida no servidor; aqui so habilitamos o botao para o caminho feliz).
  const canReact = !isTemp && Boolean(message.evolution_message_id);
  // Edicao: so propria, so texto, so dentro da janela de 15 min do
  // WhatsApp, e so com `evolution_message_id` resolvido. Calculado
  // por `canEditMessageNow` (mesma regra do `submitEdit` no parent
  // para evitar drift entre exibir/aceitar).
  const canEdit = canEditMessageNow(message);
  // Midia so e exibivel se ja temos id real e evolution_message_id (a rota
  // de midia precisa do evo id pra decodificar via Evolution). Excecao:
  // mensagens otimistas com `tempPreviewUrl` (image/video) renderizam com
  // a fonte local para feedback instantaneo no envio.
  const isPlayableMedia =
    Boolean(message.evolution_message_id) && !isTemp;
  const canUseOptimisticPreview =
    isTemp &&
    Boolean(tempPreviewUrl) &&
    (message.media_type === "image" || message.media_type === "video");
  const isSticker = message.media_type === "sticker" && isPlayableMedia;
  const isImage =
    message.media_type === "image" &&
    (isPlayableMedia || canUseOptimisticPreview);
  const isVideo =
    message.media_type === "video" &&
    (isPlayableMedia || canUseOptimisticPreview);
  const isAudio = message.media_type === "audio" && isPlayableMedia;
  const isDocument = message.media_type === "document" && isPlayableMedia;
  // Bolha "naked" (sem fundo/padding) para sticker; padding compacto para
  // imagem/video (evita espacos enormes ao redor da midia); padding normal
  // para texto puro / audio / documento (layouts horizontais proprios).
  const isMedia = isSticker || isImage || isVideo || isAudio || isDocument;
  const reactionList = normalizeReactions(message.reactions);
  const reactionGroups = groupReactions(reactionList);

  // Hooks SEMPRE no topo (regras dos hooks do React) — qualquer early-return
  // tem que vir depois.
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerWrapRef = useRef<HTMLDivElement | null>(null);

  // Fecha o picker ao clicar fora. Usamos pointerdown para nao competir com
  // o click em uma das opcoes do picker (que tambem fecha via handler).
  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: PointerEvent) {
      const wrap = pickerWrapRef.current;
      if (!wrap) return;
      if (wrap.contains(e.target as Node)) return;
      setPickerOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pickerOpen]);

  // Defesa contra o lixo legacy: bolhas vazias (media_type unknown + body
  // null) sem nenhuma reacao agregada nao tem nada para mostrar e poluem
  // o chat. A partir desta versao o webhook ja nao insere mais essas
  // linhas, mas mensagens antigas que escaparam do DELETE da migration
  // ficam ocultas aqui.
  if (
    message.media_type === "unknown" &&
    !message.body &&
    reactionList.length === 0
  ) {
    return null;
  }

  function handleReplyClick(e: React.MouseEvent) {
    e.stopPropagation();
    onReply(message);
  }

  function handleEditClick(e: React.MouseEvent) {
    e.stopPropagation();
    onEdit(message);
  }

  function handleReactButtonClick(e: React.MouseEvent) {
    e.stopPropagation();
    setPickerOpen((prev) => !prev);
  }

  function handlePickEmoji(emoji: string) {
    setPickerOpen(false);
    // Toggle WhatsApp: clicar no MESMO emoji que ja aplicamos remove. Outros
    // emojis substituem a reacao anterior (regra "1 emoji por reator").
    // Esta decisao mora na UI porque o backend trata reactionMessage de
    // forma idempotente — se enviassemos sempre o emoji, entregas duplicadas
    // pelo cache da Evolution viraria "toggle off" indesejado.
    const own = reactionList.find((r) => r.from_me);
    if (own && own.emoji === emoji) {
      onReact(message.id, "");
    } else {
      onReact(message.id, emoji);
    }
  }

  function handleBadgeClick(group: ReactionGroup) {
    // Click numa reacao propria remove (toggle, igual WhatsApp). Click numa
    // reacao do contato re-aplica o mesmo emoji do operador como atalho.
    if (group.byMe) {
      onReact(message.id, "");
    } else {
      onReact(message.id, group.emoji);
    }
  }

  function handleQuoteClick() {
    if (message.quoted_evolution_message_id) {
      onJumpToQuote(message.quoted_evolution_message_id);
    }
  }

  return (
    <div
      data-msg-id={message.id}
      data-evo-id={message.evolution_message_id ?? ""}
      className={`group/msg flex flex-col ${
        isMe ? "items-end" : "items-start"
      } ${highlighted ? "animate-pulse" : ""}`}
    >
      {isMe && senderName && (
        <span
          className={`mb-0.5 px-1 text-[10px] font-medium ${
            isExternal ? "text-gray-400 italic" : "text-emerald-700"
          }`}
        >
          {senderName}
        </span>
      )}
      <div
        className={`relative flex max-w-[70%] items-start gap-1.5 ${
          isMe ? "flex-row-reverse" : "flex-row"
        }`}
      >
        <div
          className={
            isSticker
              ? `min-w-0 ${
                  highlighted
                    ? "rounded-lg ring-2 ring-emerald-400 ring-offset-1"
                    : ""
                }`
              : `min-w-0 rounded-2xl text-sm shadow-sm transition-shadow ${
                  isImage || isVideo ? "p-1.5" : "px-3 py-2"
                } ${
                  isMe
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-white text-gray-900 border border-gray-200"
                } ${highlighted ? "ring-2 ring-emerald-400 ring-offset-1" : ""}`
          }
        >
          {hasQuote && (
            <button
              type="button"
              onClick={handleQuoteClick}
              disabled={!message.quoted_evolution_message_id}
              className={`mb-1 flex w-full items-stretch gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                isMe
                  ? "bg-emerald-50/80 hover:bg-emerald-50"
                  : "bg-gray-50 hover:bg-gray-100"
              } disabled:cursor-default`}
              title={
                message.quoted_evolution_message_id
                  ? "Ir para mensagem original"
                  : undefined
              }
            >
              <span
                aria-hidden
                className={`w-0.5 shrink-0 rounded-full ${
                  message.quoted_from_me ? "bg-emerald-500" : "bg-blue-500"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[11px] font-semibold ${
                    message.quoted_from_me
                      ? "text-emerald-700"
                      : "text-blue-700"
                  }`}
                >
                  {message.quoted_from_me ? "Voce" : contactName}
                </span>
                <span className="mt-0.5 block truncate text-xs text-gray-600">
                  {message.quoted_body}
                </span>
              </span>
            </button>
          )}
          {isSticker ? (
            <StickerImage messageId={message.id} />
          ) : isImage ? (
            <>
              <MessageImage
                messageId={message.id}
                onOpen={() => onOpenMedia("image", message.id)}
                srcOverride={canUseOptimisticPreview ? tempPreviewUrl : null}
              />
              {message.body && (
                <p className="mt-1.5 whitespace-pre-wrap break-words px-1.5 pb-0.5 [overflow-wrap:anywhere]">
                  {renderTextWithLinks(message.body)}
                </p>
              )}
            </>
          ) : isVideo ? (
            <>
              <MessageVideo
                messageId={message.id}
                srcOverride={canUseOptimisticPreview ? tempPreviewUrl : null}
              />
              {message.body && (
                <p className="mt-1.5 whitespace-pre-wrap break-words px-1.5 pb-0.5 [overflow-wrap:anywhere]">
                  {renderTextWithLinks(message.body)}
                </p>
              )}
            </>
          ) : isAudio ? (
            <MessageAudio messageId={message.id} isMe={isMe} />
          ) : isDocument ? (
            <MessageDocument
              messageId={message.id}
              fileName={message.body}
              mimeType={message.media_mime_type}
              isMe={isMe}
              onOpenPreview={() => onOpenMedia("document", message.id)}
            />
          ) : message.body ? (
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {renderTextWithLinks(message.body)}
            </p>
          ) : message.media_type !== "text" ? (
            <p className="italic text-gray-500">
              {isTemp && message.media_type === "document"
                ? "[enviando documento...]"
                : `[${message.media_type}]`}
            </p>
          ) : null}
          <div
            className={`flex items-center justify-end gap-1 text-[10px] text-gray-500 ${
              isSticker
                ? "mt-0.5 px-1"
                : isAudio || isDocument
                  ? "mt-1"
                  : isMedia
                    ? "mt-0.5 px-1.5 pb-0.5"
                    : "mt-1"
            }`}
          >
            {message.edited_at && (
              <span
                className="flex items-center gap-0.5 italic"
                title={`Editada em ${new Date(message.edited_at).toLocaleString("pt-BR")}`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                editada
              </span>
            )}
            <span>{time}</span>
            {isMe && <MessageStatusChecks status={message.status} size={14} />}
          </div>
          {message.error_message && (
            <p className="mt-1 text-[10px] text-red-600">
              {message.error_message}
            </p>
          )}
        </div>
        {(canReply || canReact || canEdit) && (
          <div
            className={`mt-1 flex shrink-0 items-center gap-1 self-start ${
              isMe ? "flex-row-reverse" : "flex-row"
            }`}
          >
            {canReply && (
              <button
                type="button"
                onClick={handleReplyClick}
                aria-label="Responder mensagem"
                title="Responder"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-gray-500 opacity-0 shadow-sm ring-1 ring-gray-200 transition-opacity hover:bg-gray-50 hover:text-emerald-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-emerald-400 group-hover/msg:opacity-100"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 17 4 12 9 7" />
                  <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                </svg>
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={handleEditClick}
                aria-label="Editar mensagem"
                title="Editar (ate 15 min apos o envio)"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-gray-500 opacity-0 shadow-sm ring-1 ring-gray-200 transition-opacity hover:bg-gray-50 hover:text-emerald-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-emerald-400 group-hover/msg:opacity-100"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            )}
            {canReact && (
              <div className="relative" ref={pickerWrapRef}>
                <button
                  type="button"
                  onClick={handleReactButtonClick}
                  aria-label="Reagir a mensagem"
                  aria-haspopup="dialog"
                  aria-expanded={pickerOpen}
                  title="Reagir"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-gray-500 shadow-sm ring-1 ring-gray-200 transition-opacity hover:bg-gray-50 hover:text-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
                    pickerOpen
                      ? "opacity-100"
                      : "opacity-0 group-hover/msg:opacity-100 focus:opacity-100"
                  }`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    <line x1="9" x2="9.01" y1="9" y2="9" />
                    <line x1="15" x2="15.01" y1="9" y2="9" />
                  </svg>
                </button>
                {pickerOpen && (
                  <div
                    role="dialog"
                    aria-label="Escolha um emoji"
                    className={`absolute top-1/2 z-20 flex -translate-y-1/2 items-center gap-0.5 rounded-full border border-gray-200 bg-white p-1 shadow-lg ${
                      isMe ? "right-full mr-2" : "left-full ml-2"
                    }`}
                  >
                    {QUICK_REACTION_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handlePickEmoji(emoji)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        aria-label={`Reagir com ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {reactionGroups.length > 0 && (
        // Sobreposicao estilo WhatsApp: a pilula de reacao "grudada" no canto
        // inferior da bolha, com contorno branco para destacar quando o fundo
        // da bolha tem cor (verde nas nossas, branco/cinza nas do contato).
        // `relative z-10` garante que o badge fique POR CIMA da bolha — sem
        // isso o shadow/border-radius da bolha pintava por cima do badge no
        // ponto de overlap.
        //
        // `-mt-2` = 8px de overlap, igual ao `py-2` (padding-bottom) da bolha:
        // a reacao cobre APENAS a area de padding interno da bolha, nunca o
        // conteudo (texto, hora ou status "entregue/lida" que ficam a 8px+
        // do bottom).
        <div
          className={`relative z-10 -mt-2 flex flex-wrap gap-1 ${
            isMe ? "justify-end pr-2" : "justify-start pl-2"
          }`}
        >
          {reactionGroups.map((g) => (
            <button
              key={g.emoji}
              type="button"
              onClick={() => handleBadgeClick(g)}
              disabled={!canReact}
              title={
                g.byMe
                  ? "Remover sua reacao"
                  : `Reagir com ${g.emoji}`
              }
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs leading-none shadow-md ring-2 ring-white transition-colors ${
                g.byMe
                  ? "bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              } disabled:cursor-default disabled:opacity-70`}
            >
              <span className="text-sm leading-none">{g.emoji}</span>
              {g.count > 1 && (
                <span className="text-[10px] font-medium">{g.count}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Formata tamanho em bytes para humano (B / KB / MB). Usado no card de
// documento dentro do MediaPreviewDialog para que o operador veja o "peso"
// do arquivo antes de enviar.
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Modal de pre-visualizacao antes do envio. Estilo WhatsApp: tela inteira
// escura, midia ao centro, campo de legenda embaixo, botoes Cancelar/Enviar.
// Tecla Esc fecha; Enter no campo de legenda envia (Shift+Enter = nova linha).
//
// O `objectURL` e criado e revogado dentro deste componente — encapsulamento:
// se o operador cancelar o preview, nenhum estado externo precisa lembrar
// do arquivo. So quando ele clicar em "Enviar" e que a midia "vaza" para
// o fluxo otimista do `handleSendMedia` (que cria seu proprio objectURL
// para o thumbnail na bolha).
function MediaPreviewDialog({
  file,
  onCancel,
  onConfirm,
  defaultCaption,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (caption: string) => void;
  defaultCaption?: string;
}) {
  const [caption, setCaption] = useState(defaultCaption ?? "");
  // objectURL local ao modal. Quando o modal desmonta (cancel ou confirm),
  // revoga para liberar memoria. O handleSendMedia cria seu PROPRIO objectURL
  // do mesmo File para o thumbnail otimista — sem reuso entre os dois para
  // que cada ciclo de vida seja independente.
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => {
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  const ext = (() => {
    const name = file.name.toLowerCase();
    if (name.includes(".")) {
      const e = name.split(".").pop() ?? "";
      if (e.length > 0 && e.length <= 5) return e.toUpperCase();
    }
    if (file.type) {
      const sub = file.type.split("/")[1]?.split(";")[0] ?? "";
      if (sub) return sub.toUpperCase();
    }
    return "ARQUIVO";
  })();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onConfirm(caption);
  }

  function handleCaptionKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onConfirm(caption);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="Pre-visualizacao da midia"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancelar"
          title="Cancelar"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
        <p className="truncate px-4 text-sm text-white/80" title={file.name}>
          {file.name}
        </p>
        <span className="w-9" aria-hidden />
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto px-4 py-2">
        {isImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={previewUrl}
            alt="Pre-visualizacao"
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        ) : isVideo ? (
          <video
            src={previewUrl}
            controls
            className="max-h-full max-w-full rounded-lg bg-black"
          />
        ) : (
          <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-xl bg-white/5 px-6 py-8 text-white">
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-lg bg-white/10">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </span>
            <p className="break-all text-center text-sm font-medium">
              {file.name}
            </p>
            <p className="text-xs text-white/60">
              {ext} - {formatFileSize(file.size)}
            </p>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 border-t border-white/10 bg-black/40 px-4 py-3"
      >
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={handleCaptionKey}
          placeholder="Adicionar uma legenda... (opcional)"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
        />
        <button
          type="submit"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-emerald-600 px-5 text-sm font-medium text-white shadow-md transition-colors hover:bg-emerald-700"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M22 2 11 13" />
            <path d="m22 2-7 20-4-9-9-4Z" />
          </svg>
          Enviar
        </button>
      </form>
    </div>
  );
}
