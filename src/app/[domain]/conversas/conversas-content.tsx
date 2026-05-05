"use client";

import {
  useEffect,
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
} from "@/lib/types/database";

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
  const [usersById, setUsersById] = useState<Map<string, string>>(new Map());
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [search, setSearch] = useState("");
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
  // Mensagem brevemente destacada apos clicar em uma citacao. O highlight
  // dura ~1.5s e some — simula o "pulse" do WhatsApp ao localizar o original.
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const incomingToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  // Container de scroll do painel de mensagens. Usado para medir se o usuario
  // esta perto do fim antes de fazer auto-scroll quando chega mensagem nova.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // Heuristica de "perto do fim" (default true para a primeira renderizacao).
  // Atualizado a cada onScroll do container.
  const isNearBottomRef = useRef(true);
  // Refs para acessar valores atuais dentro de callbacks de realtime
  const hasMoreRef = useRef(hasMore);
  const chatsRef = useRef(chats);
  const activeChatIdRef = useRef(activeChatId);
  // Mapa chatId -> timestamp do ultimo fetch a Evolution. Em ambientes onde
  // o webhook nao consegue alcancar o servidor (ex: localhost), este loop
  // funciona como fallback: a cada 30s o chat ATIVO pede as ultimas 10
  // mensagens a Evolution. Como /load-history e idempotente
  // (constraint company_id, evolution_message_id), repetir nao duplica.
  const lastEvolutionFetchRef = useRef<Map<string, number>>(new Map());
  // Intervalo entre fetches automaticos a Evolution para o chat ativo.
  // 30s e um meio-termo entre frescor da conversa e nao virar rajada.
  const EVOLUTION_POLL_INTERVAL_MS = 30_000;
  // Fila de envio: cada nova mensagem aguarda a anterior terminar para
  // garantir que cheguem ao WhatsApp na mesma ordem em que foram enviadas
  // pelo usuario, mesmo se varias forem disparadas em rapida sucessao.
  const sendQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSendsRef = useRef(0);
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
  }, [activeChatId]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? null,
    [chats, activeChatId]
  );

  const filteredChats = useMemo(() => {
    if (!search.trim()) return chats;
    const q = search.trim().toLowerCase();
    return chats.filter((c) => {
      const phone = c.remote_jid.toLowerCase();
      const name = (c.name ?? "").toLowerCase();
      const preview = (c.last_message_preview ?? "").toLowerCase();
      return phone.includes(q) || name.includes(q) || preview.includes(q);
    });
  }, [chats, search]);

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
          setLoadingMessages(false);
        }
        return;
      }
      if (!cancelled) setLoadingMessages(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .eq("chat_id", activeChatId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (cancelled) return;
      const fresh = (data as WhatsAppMessage[] | null) ?? [];

      // Mostra imediatamente o que ja temos em cache local (banco) para nao
      // bloquear a UI enquanto pedimos historico fresco a Evolution.
      setMessages(dedupeById(fresh));
      setLoadingMessages(false);

      // Sempre puxa as ultimas 50 mensagens da Evolution na primeira
      // abertura desta conversa nesta sessao — assim o operador entra com
      // contexto suficiente para uma conversa fluida, mesmo que o webhook
      // ainda nao tenha entregue tudo. O endpoint /load-history e idempotente
      // (filtra por (company_id, evolution_message_id)), entao nao duplica
      // mensagens ja gravadas. Atualizacoes subsequentes ficam por conta do
      // loop de polling automatico (a cada 30s) ou do botao manual.
      const lastFetch = lastEvolutionFetchRef.current.get(activeChatId) ?? 0;
      if (Date.now() - lastFetch > EVOLUTION_POLL_INTERVAL_MS) {
        lastEvolutionFetchRef.current.set(activeChatId, Date.now());
        try {
          const res = await fetch("/api/whatsapp/messages/load-history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId: activeChatId, limit: 50 }),
          });
          if (res.ok) {
            const { data: refreshed } = await supabase
              .from("whatsapp_messages")
              .select("*")
              .eq("chat_id", activeChatId)
              .order("created_at", { ascending: true })
              .limit(500);
            if (cancelled) return;
            const list = (refreshed as WhatsAppMessage[] | null) ?? [];
            setMessages(dedupeById(list));
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

  // Auto-scroll inteligente: SO desce automaticamente se o usuario ja estava
  // perto do fim. Isso preserva a posicao de leitura quando o operador esta
  // rolando o historico para cima e o polling/realtime entrega novas mensagens.
  useEffect(() => {
    if (!isNearBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Trocar de conversa SEMPRE leva ao fim (comportamento esperado: abrir o
  // chat ja mostrando a mensagem mais recente).
  useEffect(() => {
    if (!activeChatId) return;
    isNearBottomRef.current = true;
    // 'auto' sem animacao para nao parecer um scroll automatico estranho.
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
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

  // Realtime: chats e messages da company.
  // Importante: NAO usamos filter no servidor (postgres_changes filter)
  // porque em algumas versoes do Realtime o filtro por UUID pode entregar
  // INSERTs de forma inconsistente. Em vez disso, deixamos a RLS filtrar
  // por company (ja faz isso) e aplicamos um filtro client-side adicional.
  useEffect(() => {
    const supabase = createClient();
    // Nome de canal unico por mount evita que React StrictMode/HMR em dev
    // mantenham dois subscribers ativos no mesmo nome de canal e entreguem
    // o mesmo evento em duplicidade.
    const channelName = `whatsapp-${companyId}-${Math.random().toString(36).slice(2, 9)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_chats",
        },
        (payload) => {
          const next = payload.new as WhatsAppChat | null;
          const old = payload.old as WhatsAppChat | null;
          if (payload.eventType === "DELETE" && old) {
            if (old.company_id !== companyId) return;
            setChats((prev) => prev.filter((c) => c.id !== old.id));
            return;
          }
          if (!next) return;
          if (next.company_id !== companyId) return;
          setChats((prev) => {
            const idx = prev.findIndex((c) => c.id === next.id);
            if (idx !== -1) {
              const copy = [...prev];
              copy[idx] = next;
              copy.sort(compareChatsDesc);
              return copy;
            }
            const lastVisible = prev[prev.length - 1];
            const lastTs = lastVisible?.last_message_at ?? null;
            const nextTs = next.last_message_at ?? null;
            const stillHasMore = hasMoreRef.current;
            const fitsInPage =
              !stillHasMore ||
              (nextTs != null && (lastTs == null || nextTs > lastTs));
            if (!fitsInPage) {
              return prev;
            }
            return [...prev, next].sort(compareChatsDesc);
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_messages",
        },
        (payload) => {
          const next = payload.new as WhatsAppMessage | null;
          if (!next) return;
          if (next.company_id !== companyId) return;
          // Usa ref para sempre ler o activeChatId atual; o canal nao re-subscreve
          // ao trocar de conversa, evitando perder mensagens em transito.
          if (next.chat_id === activeChatIdRef.current) {
            setMessages((prev) => upsertMessage(prev, next));
            return;
          }
          // Mensagem chegou em chat diferente do ativo: se for IN, mostra
          // um toast discreto para o operador notar a notificacao mesmo
          // sem olhar a lista lateral. Eventos OUT (envio do proprio CRM
          // para outro chat, ou eco do celular) nao geram toast.
          if (payload.eventType !== "INSERT") return;
          if (next.from_me) return;
          const chatRef = chatsRef.current.find((c) => c.id === next.chat_id);
          const chatLabel =
            chatRef?.name ?? chatRef?.remote_jid?.replace(/@.*$/, "") ?? "Nova mensagem";
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
        }
      )
      .subscribe((status) => {
        if (process.env.NODE_ENV === "development") {
          console.debug(`[realtime] channel ${channelName} status:`, status);
        }
      });

    return () => {
      supabase.removeChannel(channel);
      if (incomingToastTimerRef.current) {
        clearTimeout(incomingToastTimerRef.current);
        incomingToastTimerRef.current = null;
      }
    };
  }, [companyId]);

  // Polling de seguranca: a cada 10s sincroniza o que esta no banco (lista
  // de chats e mensagens do chat ativo) e, em paralelo, a cada 30s pede a
  // Evolution as ultimas mensagens do chat ativo. O segundo loop e o
  // FALLBACK para ambientes onde o webhook nao consegue alcancar o servidor
  // (ex: localhost em dev) — sem ele, mensagens recebidas nunca apareceriam.
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

    function tick() {
      if (document.hidden) return;
      void syncActiveChat();
      void syncChatList();
      void pullEvolutionForActive(false);
    }

    const interval = setInterval(tick, 10000);

    function onVisibility() {
      if (!document.hidden) {
        // Forca um sync imediato quando a aba volta ao foco. Evolution e
        // marcada com forceFresh para nao depender do timer de 30s.
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

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === "Escape" && replyingTo) {
      e.preventDefault();
      cancelReply();
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

  // Refresh manual: pede a Evolution as ultimas 50 mensagens do chat ativo
  // e refaz o select local. Ignora o intervalo de polling de proposito —
  // se o operador clicou, ele quer reapurar agora.
  async function refreshHistory() {
    const chatId = activeChatIdRef.current;
    if (!chatId || refreshingHistory) return;
    setRefreshingHistory(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/whatsapp/messages/load-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, limit: 50 }),
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
        .order("created_at", { ascending: true })
        .limit(500);
      // Reinicia o relogio do polling automatico para nao disparar de novo
      // logo em seguida — ja acabamos de buscar 50 msgs.
      lastEvolutionFetchRef.current.set(chatId, Date.now());
      const list = (data as WhatsAppMessage[] | null) ?? [];
      setMessages(dedupeById(list));
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Erro de rede.");
    } finally {
      setRefreshingHistory(false);
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const supabase = createClient();
      const offset = chatsRef.current.length;
      // Pede pageSize + 1 para detectar se ainda ha mais paginas
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
                Nenhuma conversa.
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
                          className={`truncate text-xs ${
                            hasUnread
                              ? "font-medium text-gray-700"
                              : "text-gray-500"
                          }`}
                        >
                          {c.last_message_preview ?? "—"}
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
            {hasMore && !search.trim() && (
              <div className="border-t border-gray-100 p-3">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {loadingMore ? "Carregando..." : "Carregar mais"}
                </button>
              </div>
            )}
          </div>
        </aside>

        <section className="flex flex-1 flex-col bg-gray-50">
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
                className="flex-1 overflow-y-auto px-6 py-4"
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
                        highlighted={highlightedMessageId === m.id}
                        contactName={
                          activeChat?.name ??
                          jidToPhoneDisplay(activeChat?.remote_jid ?? "")
                        }
                      />
                    ))}
                  </div>
                )}
                <div ref={messagesEndRef} />
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
              {replyingTo && (
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
              <form
                onSubmit={handleSend}
                className="flex items-end gap-2 border-t border-gray-200 bg-white px-4 py-3"
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Digite uma mensagem... (Enter para enviar, Shift+Enter para nova linha)"
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                  title={
                    sending
                      ? "Enviando mensagens anteriores em ordem..."
                      : undefined
                  }
                >
                  Enviar
                </button>
              </form>
            </>
          )}
        </section>
      </div>

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
}

function ContactPanel({
  chat,
  domain,
  linkedLeadName,
  onClose,
  onLinkLead,
  onUnlinkLead,
}: ContactPanelProps) {
  const phone = chat.remote_jid.replace(/@.*$/, "");
  const phoneDisplay = jidToPhoneDisplay(chat.remote_jid);
  const displayName = chat.name || phoneDisplay;
  const waLink = `https://wa.me/${phone}`;

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
            <div className="text-center">
              <p className="text-lg font-semibold text-gray-900">
                {displayName}
              </p>
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

function MessageBubble({
  message,
  senderName,
  onReply,
  onJumpToQuote,
  highlighted,
  contactName,
}: {
  message: WhatsAppMessage;
  senderName: string | null;
  onReply: (message: WhatsAppMessage) => void;
  onJumpToQuote: (quotedEvoId: string) => void;
  highlighted: boolean;
  contactName: string;
}) {
  const isMe = message.from_me;
  const time = fmtTime(
    message.received_at ?? message.sent_at ?? message.created_at
  );
  const isExternal = senderName === "Enviado pelo celular";
  const hasQuote = Boolean(message.quoted_body);
  // Mensagem otimista (temp-) ainda nao tem id real no banco; nao podemos
  // usar como replyTo porque o backend nao consegue resolver evolution_message_id.
  const canReply = !message.id.startsWith("temp-");

  function handleReplyClick(e: React.MouseEvent) {
    e.stopPropagation();
    onReply(message);
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
          className={`min-w-0 rounded-2xl px-3 py-2 text-sm shadow-sm transition-shadow ${
            isMe
              ? "bg-emerald-100 text-emerald-900"
              : "bg-white text-gray-900 border border-gray-200"
          } ${highlighted ? "ring-2 ring-emerald-400 ring-offset-1" : ""}`}
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
          {message.body ? (
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          ) : message.media_type !== "text" ? (
            <p className="italic text-gray-500">[{message.media_type}]</p>
          ) : null}
          <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-gray-500">
            <span>{time}</span>
            {isMe && (
              <span aria-label={`Status: ${message.status}`}>
                {message.status === "read"
                  ? "lida"
                  : message.status === "delivered"
                    ? "entregue"
                    : message.status === "sent"
                      ? "enviada"
                      : message.status === "failed"
                        ? "falhou"
                        : "..."}
              </span>
            )}
          </div>
          {message.error_message && (
            <p className="mt-1 text-[10px] text-red-600">
              {message.error_message}
            </p>
          )}
        </div>
        {canReply && (
          <button
            type="button"
            onClick={handleReplyClick}
            aria-label="Responder mensagem"
            title="Responder"
            className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-full bg-white text-gray-500 opacity-0 shadow-sm ring-1 ring-gray-200 transition-opacity hover:bg-gray-50 hover:text-emerald-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-emerald-400 group-hover/msg:opacity-100"
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
      </div>
    </div>
  );
}
