"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { LeadFunnel as LeadFunnelType } from "@/lib/types/database";

const statusConfig: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  novo: { label: "Novos", color: "text-blue-700", bg: "bg-blue-50" },
  agendado: {
    label: "Agendados",
    color: "text-yellow-700",
    bg: "bg-yellow-50",
  },
  atendido: {
    label: "Atendidos",
    color: "text-green-700",
    bg: "bg-green-50",
  },
  finalizado: {
    label: "Finalizados",
    color: "text-purple-700",
    bg: "bg-purple-50",
  },
  perdido: { label: "Perdidos", color: "text-red-700", bg: "bg-red-50" },
};

export function LeadFunnel() {
  const { companyId, loading: companyLoading } = useCurrentCompany();
  const [data, setData] = useState<LeadFunnelType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (companyLoading) return;
    if (!companyId) {
      setData([]);
      setLoading(false);
      return;
    }

    async function fetchFunnel() {
      const supabase = createClient();
      const { data: funnelData } = await supabase
        .from("vw_lead_funnel")
        .select("*")
        .eq("company_id", companyId!);

      if (funnelData) setData(funnelData as unknown as LeadFunnelType[]);
      setLoading(false);
    }

    fetchFunnel();
  }, [companyLoading, companyId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Funil de Leads</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      </Card>
    );
  }

  const orderedStatuses = ["novo", "agendado", "atendido", "finalizado", "perdido"];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funil de Leads</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {orderedStatuses.map((status) => {
          const item = data.find((d) => d.status === status);
          const config = statusConfig[status];

          return (
            <div
              key={status}
              className={`rounded-lg ${config.bg} p-4 text-center`}
            >
              <p className={`text-2xl font-bold ${config.color}`}>
                {item?.total ?? 0}
              </p>
              <p className={`text-sm font-medium ${config.color}`}>
                {config.label}
              </p>
              <div className="mt-2 space-y-0.5 text-xs text-gray-500">
                <p>7d: {item?.last_7_days ?? 0}</p>
                <p>30d: {item?.last_30_days ?? 0}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
