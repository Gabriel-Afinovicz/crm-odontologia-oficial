import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthSession, getDomainCompany } from "@/lib/supabase/cached-data";
import { LeadForm } from "@/components/leads/lead-form";
import type { Lead } from "@/lib/types/database";
import Link from "next/link";

interface EditLeadPageProps {
  params: Promise<{ domain: string; id: string }>;
}

export default async function EditLeadPage({ params }: EditLeadPageProps) {
  const { domain, id } = await params;
  const [{ user }, company] = await Promise.all([
    getAuthSession(),
    getDomainCompany(domain),
  ]);

  if (!user) {
    redirect(`/${domain}`);
  }

  const companyId = company?.id;

  if (!companyId) {
    redirect(`/${domain}`);
  }

  const supabase = await createClient();

  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .single();

  if (error || !lead) {
    notFound();
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex items-center gap-4">
        <Link
          href={`/${domain}/leads/${id}`}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Editar Lead</h1>
          <p className="mt-1 text-sm text-gray-500">
            Atualize as informações do lead
          </p>
        </div>
      </div>

      <div className="max-w-2xl rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <LeadForm domain={domain} lead={lead as unknown as Lead} />
      </div>
    </div>
  );
}
