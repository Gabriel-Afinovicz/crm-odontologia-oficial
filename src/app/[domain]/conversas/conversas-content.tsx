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
}: ConversasContentProps) {
  const [chats, setChats] = useState<WhatsAppChat[]>(initialChats);
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

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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
      setMessages((data as WhatsAppMessage[] | null) ?? []);
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

  // Realtime: chats e messages da company
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`whatsapp-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_chats",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const next = payload.new as WhatsAppChat | null;
          const old = payload.old as WhatsAppChat | null;
          if (payload.eventType === "DELETE" && old) {
            setChats((prev) => prev.filter((c) => c.id !== old.id));
            return;
          }
          if (!next) return;
          setChats((prev) => {
            const idx = prev.findIndex((c) => c.id === next.id);
            if (idx === -1) {
              return [next, ...prev];
            }
            const copy = [...prev];
            copy[idx] = next;
            copy.sort((a, b) => {
              const ax = a.last_message_at ?? "";
              const bx = b.last_message_at ?? "";
              return bx.localeCompare(ax);
            });
            return copy;
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_messages",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const next = payload.new as WhatsAppMessage | null;
          if (!next) return;
          setMessages((prev) => {
            if (next.chat_id !== activeChatId) return prev;
            const idx = prev.findIndex((m) => m.id === next.id);
            if (idx === -1) return [...prev, next];
            const copy = [...prev];
            copy[idx] = next;
            return copy;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, activeChatId]);

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

  async function handleSend(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !activeChat) return;
    setSending(true);
    setSendError(null);
    setDraft("");
    const res = await fetch("/api/whatsapp/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: activeChat.id, text }),
    });
    setSending(false);
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setSendError(payload.error ?? "Falha ao enviar.");
      setDraft(text);
    }
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
                    onClick={() => setActiveChatId(c.id)}
                    className={`flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                      active ? "bg-blue-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                        c.lead_id
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {(c.name ?? c.remote_jid.slice(0, 2))
                        .replace(/\D/g, "")
                        .slice(-2) || "??"}
                    </div>
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
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {activeChat.name || jidToPhoneDisplay(activeChat.remote_jid)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {jidToPhoneDisplay(activeChat.remote_jid)}
                  </p>
                </div>
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
                ) : messages.length === 0 ? (
                  <div className="text-center text-xs text-gray-400">
                    Sem mensagens nesta conversa.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {messages.map((m) => (
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
                  disabled={sending || !draft.trim()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  {sending ? "Enviando..." : "Enviar"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>

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
