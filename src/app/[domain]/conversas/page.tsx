import { redirect } from "next/navigation";
import { getAuthSession, getDomainCompany } from "@/lib/supabase/cached-data";
import { createClient } from "@/lib/supabase/server";
import type { WhatsAppChat, WhatsAppInstance } from "@/lib/types/database";
import { ConversasContent } from "./conversas-content";
import Link from "next/link";

interface ConversasPageProps {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ chat?: string }>;
}

export default async function ConversasPage({
  params,
  searchParams,
}: ConversasPageProps) {
  const { domain } = await params;
  const { chat } = await searchParams;

  const [{ user }, company] = await Promise.all([
    getAuthSession(),
    getDomainCompany(domain),
  ]);

  if (!user) redirect(`/${domain}`);
  if (!company) redirect(`/${domain}/dashboard`);

  const supabase = await createClient();

  const { data: instanceRow } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("company_id", company.id)
    .maybeSingle();
  const instance = instanceRow as WhatsAppInstance | null;

  if (!instance || instance.status !== "connected") {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-base font-semibold text-gray-900">
            WhatsApp ainda nao conectado
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Para usar a aba Conversas, conecte o numero WhatsApp da clinica em
            Configuracoes.
          </p>
          <Link
            href={`/${domain}/settings?tab=whatsapp`}
            className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Ir para Configuracoes
          </Link>
        </div>
      </div>
    );
  }

  const PAGE_SIZE = 30;

  // Busca uma extra para detectar se ha mais paginas sem fazer count
  const { data: chatsData } = await supabase
    .from("whatsapp_chats")
    .select("*")
    .eq("company_id", company.id)
    .eq("is_archived", false)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE + 1);

  const allChats = (chatsData as WhatsAppChat[] | null) ?? [];
  const hasMore = allChats.length > PAGE_SIZE;
  const chats = hasMore ? allChats.slice(0, PAGE_SIZE) : allChats;

  return (
    <ConversasContent
      domain={domain}
      companyId={company.id}
      instance={instance}
      initialChats={chats}
      initialChatId={chat ?? null}
      initialHasMore={hasMore}
      pageSize={PAGE_SIZE}
    />
  );
}
