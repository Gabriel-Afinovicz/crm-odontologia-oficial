"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { PipelineStage } from "@/lib/types/database";
import type { KanbanLead } from "@/lib/supabase/dashboard-data";
import { KanbanCard } from "./kanban-card";

export interface LaneCell {
  laneKey: string;
  laneLabel: string | null;
  laneColor?: string | null;
  leads: KanbanLead[];
}

interface KanbanColumnProps {
  stage: PipelineStage;
  cells: LaneCell[];
  domain: string;
  totalCount: number;
  lastActivityByLead: Record<string, string>;
  showLaneLabel: boolean;
}

function CellDroppable({
  id,
  leads,
  domain,
  lastActivityByLead,
  empty,
}: {
  id: string;
  leads: KanbanLead[];
  domain: string;
  lastActivityByLead: Record<string, string>;
  empty: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: "cell" } });
  const ids = leads.map((l) => l.id);
  return (
    <div
      ref={setNodeRef}
      className={`space-y-2 rounded-md p-1 transition-colors ${
        isOver ? "bg-blue-50/70 ring-1 ring-blue-300/60" : ""
      }`}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {leads.map((lead) => (
          <KanbanCard
            key={lead.id}
            lead={lead}
            domain={domain}
            lastActivityAt={lastActivityByLead[lead.id] ?? null}
          />
        ))}
      </SortableContext>
      {empty && leads.length === 0 && (
        <div className="flex h-20 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 text-[11px] text-gray-400">
          Solte aqui
        </div>
      )}
    </div>
  );
}

export function KanbanColumn({
  stage,
  cells,
  domain,
  totalCount,
  lastActivityByLead,
  showLaneLabel,
}: KanbanColumnProps) {
  return (
    <div
      className="flex min-w-[280px] flex-1 flex-col rounded-xl border border-gray-200 bg-gray-50/50"
      style={{ borderTopColor: stage.color, borderTopWidth: 3 }}
    >
      <div className="flex items-center justify-between border-b border-gray-200 bg-white/70 px-3 py-2 rounded-t-xl">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: stage.color }}
          />
          <h3 className="text-sm font-semibold text-gray-800">{stage.name}</h3>
          {stage.is_won && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700">
              ganho
            </span>
          )}
          {stage.is_lost && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-700">
              perdido
            </span>
          )}
        </div>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-600">
          {totalCount}
        </span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {cells.map((cell) => (
          <div key={cell.laneKey}>
            {showLaneLabel && cell.laneLabel !== null && (
              <div className="mb-1 flex items-center gap-2 px-1">
                {cell.laneColor && (
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: cell.laneColor }}
                  />
                )}
                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  {cell.laneLabel}
                </span>
                <span className="text-[10px] text-gray-400">
                  {cell.leads.length}
                </span>
              </div>
            )}
            <CellDroppable
              id={`cell:${stage.id}:${cell.laneKey}`}
              leads={cell.leads}
              domain={domain}
              lastActivityByLead={lastActivityByLead}
              empty={showLaneLabel}
            />
          </div>
        ))}
        {!showLaneLabel && totalCount === 0 && (
          <div className="flex h-24 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 text-xs text-gray-400">
            Solte um card aqui
          </div>
        )}
      </div>
    </div>
  );
}
