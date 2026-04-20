import { createClient } from "@/lib/supabase/server";
import { ClinicsTable } from "@/components/wosnicz/clinics-table";

interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  is_active: boolean | null;
  created_at: string | null;
}

export interface ClinicSummary {
  id: string;
  name: string;
  domain: string;
  isActive: boolean;
  createdAt: string | null;
  leadsCount: number;
  usersCount: number;
}

export default async function WosniczDashboardPage() {
  const supabase = await createClient();

  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, domain, is_active, created_at")
    .order("created_at", { ascending: false });

  const rows = (companies ?? []) as CompanyRow[];

  const summaries: ClinicSummary[] = await Promise.all(
    rows.map(async (c) => {
      const [{ count: leadsCount }, { count: usersCount }] = await Promise.all([
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("company_id", c.id),
        supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("company_id", c.id),
      ]);
      return {
        id: c.id,
        name: c.name,
        domain: c.domain ?? "",
        isActive: c.is_active ?? true,
        createdAt: c.created_at,
        leadsCount: leadsCount ?? 0,
        usersCount: usersCount ?? 0,
      };
    })
  );

  const totalClinics = summaries.filter((s) => s.domain !== "wosnicz").length;
  const totalLeads = summaries.reduce((acc, s) => acc + s.leadsCount, 0);
  const totalUsers = summaries.reduce(
    (acc, s) => acc + (s.domain === "wosnicz" ? 0 : s.usersCount),
    0
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Visão Geral</h1>
        <p className="mt-1 text-sm text-gray-500">
          Gerencie todas as clínicas cadastradas na plataforma.
        </p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <StatCard label="Clínicas ativas" value={totalClinics} />
        <StatCard label="Usuários (clínicas)" value={totalUsers} />
        <StatCard label="Leads (plataforma)" value={totalLeads} />
      </div>

      <ClinicsTable clinics={summaries} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
