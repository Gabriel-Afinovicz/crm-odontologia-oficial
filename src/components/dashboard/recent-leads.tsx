"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StageBadge } from "@/components/dashboard/stage-badge";
import type { Lead, PipelineStage } from "@/lib/types/database";

interface RecentLeadsProps {
  domain: string;
  initialLeads?: Lead[];
  /**
   * Lista de etapas do pipeline (na ordem atual do kanban). Quando informada,
   * a coluna "Status" da tabela exibe a tag da etapa correspondente
   * (`stage.name`/`stage.color`) em vez do status legado.
   */
  stages?: PipelineStage[];
}

export function RecentLeads({ domain, initialLeads, stages }: RecentLeadsProps) {
  const router = useRouter();
  const { companyId, loading: companyLoading } = useCurrentCompany();
  const [leads, setLeads] = useState<Lead[]>(initialLeads ?? []);
  const [loading, setLoading] = useState(initialLeads === undefined);

  useEffect(() => {
    if (initialLeads !== undefined) return;
    if (companyLoading) return;
    if (!companyId) {
      setLeads([]);
      setLoading(false);
      return;
    }

    async function fetchLeads() {
      const supabase = createClient();
      const { data } = await supabase
        .from("leads")
        .select("*")
        .eq("company_id", companyId!)
        .order("created_at", { ascending: false })
        .limit(10);

      if (data) setLeads(data as unknown as Lead[]);
      setLoading(false);
    }

    fetchLeads();
  }, [companyLoading, companyId, initialLeads]);

  const stageById = useMemo(() => {
    const map = new Map<string, PipelineStage>();
    for (const s of stages ?? []) map.set(s.id, s);
    return map;
  }, [stages]);

  if (loading) {
    return (
      <Card padding="none">
        <div className="p-6">
          <CardHeader>
            <CardTitle>Últimos Leads</CardTitle>
          </CardHeader>
        </div>
        <div className="space-y-1 px-6 pb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded bg-gray-100"
            />
          ))}
        </div>
      </Card>
    );
  }

  if (leads.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Últimos Leads</CardTitle>
        </CardHeader>
        <p className="text-sm text-gray-500">
          Nenhum lead encontrado. Os leads aparecerão aqui quando forem
          cadastrados.
        </p>
      </Card>
    );
  }

  return (
    <Card padding="none">
      <div className="flex items-center justify-between p-6 pb-0">
        <CardHeader>
          <CardTitle>Últimos Leads</CardTitle>
        </CardHeader>
        <Link
          href={`/${domain}/leads`}
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Ver todos →
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-6 py-3">Nome</th>
              <th className="px-6 py-3">Contato</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Data</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {leads.map((lead) => {
              const stage = stageById.get(lead.stage_id);
              return (
                <tr
                  key={lead.id}
                  onClick={() => router.push(`/${domain}/leads/${lead.id}`)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="whitespace-nowrap px-6 py-3 font-medium text-gray-900">
                    {lead.name}
                  </td>
                  <td className="px-6 py-3 text-gray-600">
                    <div className="flex flex-col">
                      {lead.phone && (
                        <span className="text-sm">{lead.phone}</span>
                      )}
                      {lead.email && (
                        <span className="text-xs text-gray-400">{lead.email}</span>
                      )}
                      {!lead.phone && !lead.email && "—"}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3">
                    <StageBadge
                      stageName={stage?.name}
                      stageColor={stage?.color}
                      fallbackStatus={lead.status}
                    />
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-gray-500">
                    {new Date(lead.created_at).toLocaleDateString("pt-BR")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
