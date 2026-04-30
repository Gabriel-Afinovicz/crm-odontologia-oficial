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
  const [chats, setChats] = useState<WhatsAppChat[]>(initialChats);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(
    initialChatId ?? initialChats[0]?.id ?? null
  );
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
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

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  // Refs para acessar valores atuais dentro de callbacks de realtime
  const hasMoreRef = useRef(hasMore);
  const chatsRef = useRef(chats);
  const activeChatIdRef = useRef(activeChatId);
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

  // Defesa final: sempre renderiza mensagens deduplicadas por id, evitando
  // o warning "two children with the same key" e bubbles duplicados na UI
  // mesmo se algum cenario raro acabar inserindo duplicatas no state.
  const renderedMessages = useMemo(() => dedupeById(messages), [messages]);

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
      // Garante dedup ja na carga inicial caso o banco ou o realtime gerem
      // alguma duplicacao logica.
      setMessages(dedupeById(fresh));
      setLoadingMessages(false);
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

  // Scroll to bottom on messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

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
          if (next.chat_id !== activeChatIdRef.current) return;
          setMessages((prev) => upsertMessage(prev, next));
        }
      )
      .subscribe((status) => {
        if (process.env.NODE_ENV === "development") {
          console.debug(`[realtime] channel ${channelName} status:`, status);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId]);

  // Polling de seguranca: a cada 10s busca mensagens recentes do chat ativo
  // e da o chat list. Funciona como fallback caso o WebSocket de Realtime
  // esteja temporariamente desconectado ou um evento se perca. Usa upsertMessage
  // para nao gerar duplicacoes.
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

    function tick() {
      if (document.hidden) return;
      void syncActiveChat();
      void syncChatList();
    }

    const interval = setInterval(tick, 10000);

    function onVisibility() {
      if (!document.hidden) {
        // Forca um sync imediato quando a aba volta ao foco
        void syncActiveChat();
        void syncChatList();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [companyId, pageSize]);

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

  function handleSend(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !activeChat) return;
    const chatIdAtSend = activeChat.id;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const nowIso = new Date().toISOString();

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
      created_at: nowIso,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setSendError(null);
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
          body: JSON.stringify({ chatId: chatIdAtSend, text }),
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
                        <p className="truncate text-sm font-medium text-gray-900">
                          {c.name || jidToPhoneDisplay(c.remote_jid)}
                        </p>
                        <span className="shrink-0 text-[10px] text-gray-400">
                          {fmtTime(c.last_message_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-gray-500">
                          {c.last_message_preview ?? "—"}
                        </p>
                        {c.unread_count > 0 && !active && (
                          <span className="ml-2 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            {c.unread_count}
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
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4">
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
                      <MessageBubble key={m.id} message={m} />
                    ))}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {sendError && (
                <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
                  {sendError}
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

function MessageBubble({ message }: { message: WhatsAppMessage }) {
  const isMe = message.from_me;
  const time = fmtTime(
    message.received_at ?? message.sent_at ?? message.created_at
  );
  return (
    <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          isMe
            ? "bg-emerald-100 text-emerald-900"
            : "bg-white text-gray-900 border border-gray-200"
        }`}
      >
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
    </div>
  );
}
