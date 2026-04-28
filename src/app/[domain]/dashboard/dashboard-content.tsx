"use client";

import { useMemo, useState } from "react";
import { UserInfo } from "@/components/dashboard/user-info";
import {
  LeadFunnel,
  type StageFunnelRow,
} from "@/components/dashboard/lead-funnel";
import { RecentLeads } from "@/components/dashboard/recent-leads";
import { LeadKanbanBoard } from "@/components/dashboard/lead-kanban-board";
import type {
  Lead,
  PipelineStage,
  Specialty,
} from "@/lib/types/database";
import type {
  KanbanLead,
  KanbanOperator,
} from "@/lib/supabase/dashboard-data";

type DashboardTab = "funil" | "kanban";

interface DashboardContentProps {
  domain: string;
  companyName: string;
  initialRecentLeads: Lead[];
  initialKanbanLeads: KanbanLead[];
  initialOperators: KanbanOperator[];
  initialStages: PipelineStage[];
  initialSpecialties: Specialty[];
  initialLastActivity: Record<string, string>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deriva o funil a partir das etapas atuais do pipeline (uma linha por
 * coluna do kanban). O nome e a cor de cada cartão refletem exatamente a
 * etapa correspondente — adicionar/renomear/recolorir uma coluna propaga
 * automaticamente para o funil.
 */
function computeStageFunnel(
  leads: KanbanLead[],
  stages: PipelineStage[]
): StageFunnelRow[] {
  const now = Date.now();
  const cutoff7 = now - 7 * DAY_MS;
  const cutoff30 = now - 30 * DAY_MS;

  const counts = new Map<
    string,
    { total: number; last_7_days: number; last_30_days: number }
  >();
  for (const stage of stages) {
    counts.set(stage.id, { total: 0, last_7_days: 0, last_30_days: 0 });
  }

  for (const lead of leads) {
    const bucket = counts.get(lead.stage_id);
    if (!bucket) continue;
    bucket.total += 1;
    const createdAt = lead.created_at
      ? new Date(lead.created_at).getTime()
      : NaN;
    if (!Number.isNaN(createdAt)) {
      if (createdAt >= cutoff7) bucket.last_7_days += 1;
      if (createdAt >= cutoff30) bucket.last_30_days += 1;
    }
  }

  return stages.map((stage) => {
    const bucket = counts.get(stage.id) ?? {
      total: 0,
      last_7_days: 0,
      last_30_days: 0,
    };
    return {
      stageId: stage.id,
      label: stage.name,
      color: stage.color,
      total: bucket.total,
      last_7_days: bucket.last_7_days,
      last_30_days: bucket.last_30_days,
    };
  });
}

export function DashboardContent({
  domain,
  companyName,
  initialRecentLeads,
  initialKanbanLeads,
  initialOperators,
  initialStages,
  initialSpecialties,
  initialLastActivity,
}: DashboardContentProps) {
  const [tab, setTab] = useState<DashboardTab>("kanban");
  const [leads, setLeads] = useState<KanbanLead[]>(initialKanbanLeads);
  const [orderedStages, setOrderedStages] =
    useState<PipelineStage[]>(initialStages);

  const funnelData = useMemo(
    () => computeStageFunnel(leads, orderedStages),
    [leads, orderedStages]
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="px-6 py-4 lg:px-8">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-gray-900">
              {companyName}
            </h1>
            <UserInfo domain={domain} companyName={companyName} />
          </div>
        </div>
      </header>

      <main className="p-6 lg:p-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
          <p className="mt-1 text-sm text-gray-500">
            Visão geral dos seus leads e atividades
          </p>
        </div>

        <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
          <TabButton
            active={tab === "funil"}
            onClick={() => setTab("funil")}
            icon={
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 5.25h16.5L14.25 12v6.75L9.75 21v-9L3.75 5.25Z"
                />
              </svg>
            }
          >
            Funil
          </TabButton>
          <TabButton
            active={tab === "kanban"}
            onClick={() => setTab("kanban")}
            icon={
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6a2.25 2.25 0 0 1 2.25-2.25h1.5A2.25 2.25 0 0 1 9.75 6v12a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18V6ZM14.25 6A2.25 2.25 0 0 1 16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v6A2.25 2.25 0 0 1 18 14.25h-1.5A2.25 2.25 0 0 1 14.25 12V6Z"
                />
              </svg>
            }
          >
            Kanban
          </TabButton>
        </div>

        <div className={tab === "funil" ? "space-y-6" : "hidden"}>
          <LeadFunnel data={funnelData} />
          <RecentLeads
            domain={domain}
            initialLeads={initialRecentLeads}
            stages={orderedStages}
          />
        </div>
        <div className={tab === "kanban" ? undefined : "hidden"}>
          <LeadKanbanBoard
            domain={domain}
            initialLeads={initialKanbanLeads}
            operators={initialOperators}
            stages={initialStages}
            specialties={initialSpecialties}
            lastActivityByLead={initialLastActivity}
            onLeadsChange={setLeads}
            onStagesChange={setOrderedStages}
          />
        </div>
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors
        ${
          active
            ? "bg-blue-600 text-white shadow-sm"
            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
        }`}
    >
      {icon}
      {children}
    </button>
  );
}
