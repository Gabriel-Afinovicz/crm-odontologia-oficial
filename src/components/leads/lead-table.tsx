"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import type {
  LeadDetailed,
  PipelineStage,
  Tag,
} from "@/lib/types/database";
import { Input } from "@/components/ui/input";
import { StageBadge } from "@/components/dashboard/stage-badge";

interface LeadTableProps {
  domain: string;
}

type StageFilter = "todos" | string;

const MAX_TAGS_INLINE = 3;

export function LeadTable({ domain }: LeadTableProps) {
  const router = useRouter();
  const { companyId, loading: companyLoading } = useCurrentCompany();
  const [leads, setLeads] = useState<LeadDetailed[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [tagsByLead, setTagsByLead] = useState<Record<string, Tag[]>>({});
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<StageFilter>("todos");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (companyLoading) return;
    if (!companyId) {
      setLeads([]);
      setStages([]);
      setTagsByLead({});
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function fetchAll() {
      const supabase = createClient();

      const [leadsRes, stagesRes, allTagsRes] = await Promise.all([
        supabase
          .from("vw_leads_detailed")
          .select("*")
          .eq("company_id", companyId!)
          .order("created_at", { ascending: false }),
        supabase
          .from("pipeline_stages")
          .select("*")
          .eq("company_id", companyId!)
          .eq("is_active", true)
          .order("position", { ascending: true }),
        supabase
          .from("tags")
          .select("*")
          .eq("company_id", companyId!)
          .order("name", { ascending: true }),
      ]);

      if (cancelled) return;

      const leadsList =
        (leadsRes.data as unknown as LeadDetailed[] | null) ?? [];
      const stagesList =
        (stagesRes.data as unknown as PipelineStage[] | null) ?? [];
      const allTags = (allTagsRes.data as unknown as Tag[] | null) ?? [];

      const leadIds = leadsList.map((l) => l.id);
      let leadTagRows: { lead_id: string; tag_id: string }[] = [];
      if (leadIds.length > 0) {
        const { data } = await supabase
          .from("lead_tags")
          .select("lead_id, tag_id")
          .in("lead_id", leadIds);
        leadTagRows =
          (data as { lead_id: string; tag_id: string }[] | null) ?? [];
      }

      const tagById = new Map(allTags.map((t) => [t.id, t] as const));
      const grouped: Record<string, Tag[]> = {};
      for (const row of leadTagRows) {
        const tag = tagById.get(row.tag_id);
        if (!tag) continue;
        if (!grouped[row.lead_id]) grouped[row.lead_id] = [];
        grouped[row.lead_id].push(tag);
      }

      if (cancelled) return;
      setLeads(leadsList);
      setStages(stagesList);
      setTagsByLead(grouped);
      setLoading(false);
    }

    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [companyLoading, companyId]);

  const stageById = useMemo(() => {
    const map = new Map<string, PipelineStage>();
    for (const s of stages) map.set(s.id, s);
    return map;
  }, [stages]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const lead of leads) {
      counts[lead.stage_id] = (counts[lead.stage_id] ?? 0) + 1;
    }
    return counts;
  }, [leads]);

  const filtered = useMemo(() => {
    let result = leads;

    if (stageFilter !== "todos") {
      result = result.filter((l) => l.stage_id === stageFilter);
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
  }, [leads, stageFilter, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto">
          <FilterTab
            label="Todos"
            count={leads.length}
            active={stageFilter === "todos"}
            onClick={() => setStageFilter("todos")}
          />
          {stages.map((stage) => (
            <FilterTab
              key={stage.id}
              label={stage.name}
              color={stage.color}
              count={stageCounts[stage.id] ?? 0}
              active={stageFilter === stage.id}
              onClick={() => setStageFilter(stage.id)}
            />
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
                  <th className="px-6 py-3">Tags</th>
                  <th className="px-6 py-3">Fonte</th>
                  <th className="px-6 py-3">Responsável</th>
                  <th className="px-6 py-3">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((lead) => {
                  const stage = stageById.get(lead.stage_id);
                  const leadTags = tagsByLead[lead.id] ?? [];
                  return (
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
                          {lead.phone && (
                            <span className="text-sm">{lead.phone}</span>
                          )}
                          {lead.email && (
                            <span className="text-xs text-gray-400">
                              {lead.email}
                            </span>
                          )}
                          {!lead.phone && !lead.email && "—"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3">
                        <StageBadge
                          stageName={stage?.name ?? lead.stage_name}
                          stageColor={stage?.color ?? lead.stage_color}
                          fallbackStatus={lead.status}
                        />
                      </td>
                      <td className="px-6 py-3">
                        <TagsCell tags={leadTags} />
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-sm text-gray-400">
        {filtered.length} lead{filtered.length !== 1 ? "s" : ""} encontrado
        {filtered.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

function FilterTab({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string;
  count: number;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors
        ${
          active
            ? "bg-blue-600 text-white"
            : "text-gray-600 hover:bg-gray-100"
        }`}
    >
      {color && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      <span>{label}</span>
      <span
        className={`inline-flex min-w-[1.25rem] justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
          active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function TagsCell({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) {
    return <span className="text-sm text-gray-300">—</span>;
  }
  const visible = tags.slice(0, MAX_TAGS_INLINE);
  const remaining = tags.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{
            backgroundColor: `${tag.color}20`,
            color: tag.color,
          }}
        >
          {tag.name}
        </span>
      ))}
      {remaining > 0 && (
        <span
          className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600"
          title={tags
            .slice(MAX_TAGS_INLINE)
            .map((t) => t.name)
            .join(", ")}
        >
          +{remaining}
        </span>
      )}
    </div>
  );
}
