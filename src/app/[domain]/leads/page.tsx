import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/supabase/cached-data";
import { LeadTable } from "@/components/leads/lead-table";
import Link from "next/link";

interface LeadsPageProps {
  params: Promise<{ domain: string }>;
}

export default async function LeadsPage({ params }: LeadsPageProps) {
  const { domain } = await params;
  const { user } = await getAuthSession();

  if (!user) {
    redirect(`/${domain}`);
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="mt-1 text-sm text-gray-500">
            Gerencie todos os leads da sua clínica
          </p>
        </div>
        <Link
          href={`/${domain}/leads/new`}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Novo Lead
        </Link>
      </div>

      <LeadTable domain={domain} />
    </div>
  );
}
