import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/supabase/cached-data";
import { LeadForm } from "@/components/leads/lead-form";
import Link from "next/link";

interface NewLeadPageProps {
  params: Promise<{ domain: string }>;
}

export default async function NewLeadPage({ params }: NewLeadPageProps) {
  const { domain } = await params;
  const { user } = await getAuthSession();

  if (!user) {
    redirect(`/${domain}`);
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex items-center gap-4">
        <Link
          href={`/${domain}/leads`}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Novo Lead</h1>
          <p className="mt-1 text-sm text-gray-500">
            Preencha os dados para cadastrar um novo lead
          </p>
        </div>
      </div>

      <div className="max-w-2xl rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <LeadForm domain={domain} />
      </div>
    </div>
  );
}
