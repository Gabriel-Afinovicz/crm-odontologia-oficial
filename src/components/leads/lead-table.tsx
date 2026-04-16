"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { LeadDetailed, LeadStatus } from "@/lib/types/database";
import { StatusBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const STATUS_TABS: { label: string; value: LeadStatus | "todos" }[] = [
  { label: "Todos", value: "todos" },
  { label: "Novo", value: "novo" },
  { label: "Agendado", value: "agendado" },
  { label: "Atendido", value: "atendido" },
  { label: "Finalizado", value: "finalizado" },
  { label: "Perdido", value: "perdido" },
];

interface LeadTableProps {
  domain: string;
}

export function LeadTable({ domain }: LeadTableProps) {
  const router = useRouter();
  const [leads, setLeads] = useState<LeadDetailed[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "todos">("todos");
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function fetchLeads() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vw_leads_detailed")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data) {
        setLeads(data as unknown as LeadDetailed[]);
      }
      setLoading(false);
    }

    fetchLeads();
  }, []);

  const filtered = useMemo(() => {
    let result = leads;

    if (statusFilter !== "todos") {
      result = result.filter((l) => l.status === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.phone?.toLowerCase().includes(q) ||
          l.email?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [leads, statusFilter, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors
                ${
                  statusFilter === tab.value
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-64">
          <Input
            placeholder="Buscar por nome, telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">
            {leads.length === 0
              ? "Nenhum lead cadastrado ainda."
              : "Nenhum lead encontrado com os filtros selecionados."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-6 py-3">Nome</th>
                  <th className="px-6 py-3">Contato</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Fonte</th>
                  <th className="px-6 py-3">Responsável</th>
                  <th className="px-6 py-3">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => router.push(`/${domain}/leads/${lead.id}`)}
                    className="cursor-pointer transition-colors hover:bg-gray-50"
                  >
                    <td className="whitespace-nowrap px-6 py-3 font-medium text-gray-900">
                      {lead.name}
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      <div className="flex flex-col">
                        {lead.phone && <span className="text-sm">{lead.phone}</span>}
                        {lead.email && (
                          <span className="text-xs text-gray-400">{lead.email}</span>
                        )}
                        {!lead.phone && !lead.email && "—"}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-3">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-600">
                      {lead.source_name || "—"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-600">
                      {lead.assigned_to_name || "—"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                      {new Date(lead.created_at).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-sm text-gray-400">
        {filtered.length} lead{filtered.length !== 1 ? "s" : ""} encontrado{filtered.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
