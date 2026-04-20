import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ClinicUsersList } from "@/components/wosnicz/clinic-users-list";
import { ClinicDangerZone } from "@/components/wosnicz/clinic-danger-zone";

interface ClinicDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ClinicDetailPage({
  params,
}: ClinicDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: clinic } = await supabase
    .from("companies")
    .select("id, name, domain, is_active, created_at, email, phone")
    .eq("id", id)
    .single();

  if (!clinic) {
    notFound();
  }

  const c = clinic as {
    id: string;
    name: string;
    domain: string;
    is_active: boolean | null;
    created_at: string | null;
    email: string | null;
    phone: string | null;
  };

  const isWosnicz = c.domain === "wosnicz";

  const { data: users } = await supabase
    .from("users")
    .select("id, name, extension_number, role, is_active, email")
    .eq("company_id", id)
    .order("role", { ascending: true })
    .order("name", { ascending: true });

  const [{ count: leadsCount }, { count: activitiesCount }] = await Promise.all([
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", id),
    supabase
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("company_id", id),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/wosnicz/dashboard"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5 8.25 12l7.5-7.5"
              />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{c.name}</h1>
            <p className="mt-0.5 flex items-center gap-2 text-sm text-gray-500">
              <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                /{c.domain}
              </code>
              {c.is_active ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                  Ativa
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  Inativa
                </span>
              )}
            </p>
          </div>
        </div>

        {!isWosnicz && (
          <Link
            href={`/${c.domain}/dashboard`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            Entrar na clínica
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
              />
            </svg>
          </Link>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Usuários" value={users?.length ?? 0} />
        <StatCard label="Leads" value={leadsCount ?? 0} />
        <StatCard label="Atividades" value={activitiesCount ?? 0} />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Usuários
        </h2>
        <ClinicUsersList users={(users ?? []) as never} />
      </section>

      {!isWosnicz && (
        <section>
          <ClinicDangerZone
            clinicId={c.id}
            clinicName={c.name}
            clinicDomain={c.domain}
            isActive={c.is_active ?? true}
          />
        </section>
      )}

      {isWosnicz && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Esta é a clínica-sistema usada apenas para ancorar o Super Admin. Não
          pode ser desativada nem excluída.
        </div>
      )}
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
