"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { Lead } from "@/lib/types/database";

const statusBadge: Record<string, { label: string; classes: string }> = {
  novo: { label: "Novo", classes: "bg-blue-100 text-blue-700" },
  agendado: { label: "Agendado", classes: "bg-yellow-100 text-yellow-700" },
  atendido: { label: "Atendido", classes: "bg-green-100 text-green-700" },
  finalizado: {
    label: "Finalizado",
    classes: "bg-purple-100 text-purple-700",
  },
  perdido: { label: "Perdido", classes: "bg-red-100 text-red-700" },
};

export function RecentLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeads() {
      const supabase = createClient();
      const { data } = await supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);

      if (data) setLeads(data as unknown as Lead[]);
      setLoading(false);
    }

    fetchLeads();
  }, []);

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
      <div className="p-6 pb-0">
        <CardHeader>
          <CardTitle>Últimos Leads</CardTitle>
        </CardHeader>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-6 py-3">Nome</th>
              <th className="px-6 py-3">Telefone</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Data</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {leads.map((lead) => {
              const badge = statusBadge[lead.status];
              return (
                <tr key={lead.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-3 font-medium text-gray-900">
                    {lead.name}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-gray-600">
                    {lead.phone || "—"}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
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
