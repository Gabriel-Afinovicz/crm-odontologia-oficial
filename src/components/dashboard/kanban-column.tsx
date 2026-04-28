"use client";

import { useState } from "react";
import Link from "next/link";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PipelineStage } from "@/lib/types/database";
import type { KanbanLead } from "@/lib/supabase/dashboard-data";
import { KanbanCard } from "./kanban-card";

export function columnSortableId(stageId: string) {
  return `col:${stageId}`;
}

function NewLeadButton({ domain }: { domain: string }) {
  return (
    <Link
      href={`/${domain}/leads/new`}
      className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white/60 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
    >
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 4.5v15m7.5-7.5h-15"
        />
      </svg>
      Novo Lead
    </Link>
  );
}

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
  onOpenEdit?: (leadId: string) => void;
  /** Acionado pelo botão de "três pontinhos" no topo da coluna. */
  onEditStage?: (stage: PipelineStage) => void;
}

function CellDroppable({
  id,
  leads,
  domain,
  lastActivityByLead,
  empty,
  onOpenEdit,
}: {
  id: string;
  leads: KanbanLead[];
  domain: string;
  lastActivityByLead: Record<string, string>;
  empty: boolean;
  onOpenEdit?: (leadId: string) => void;
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
            onOpenEdit={onOpenEdit}
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
  onOpenEdit,
  onEditStage,
}: KanbanColumnProps) {
  const [openLanes, setOpenLanes] = useState<Set<string>>(() => new Set());

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: columnSortableId(stage.id),
    data: { type: "column", stageId: stage.id },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function toggleLane(key: string) {
    setOpenLanes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderTopColor: stage.color, borderTopWidth: 3 }}
      className={`flex min-w-[280px] flex-1 flex-col rounded-xl border border-gray-200 bg-gray-50/50 ${
        isDragging ? "opacity-60 ring-2 ring-blue-400/40" : ""
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="flex cursor-grab items-center justify-between border-b border-gray-200 bg-white/70 px-3 py-2 rounded-t-xl select-none active:cursor-grabbing"
      >
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
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalCount}
          </span>
          {onEditStage && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onEditStage(stage);
              }}
              title="Editar etapa"
              aria-label={`Editar etapa ${stage.name}`}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M10 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm0 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm0 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {totalCount === 0 && <NewLeadButton domain={domain} />}
        {cells.map((cell) => {
          const isDrawer = showLaneLabel && cell.laneLabel !== null;
          const isOpen = !isDrawer || openLanes.has(cell.laneKey);
          return (
            <div key={cell.laneKey}>
              {isDrawer && (
                <button
                  type="button"
                  onClick={() => toggleLane(cell.laneKey)}
                  className="mb-1 flex w-full items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors hover:bg-gray-100"
                >
                  <svg
                    className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.21 14.77a.75.75 0 0 1 .02-1.06L10.94 10 7.23 6.29a.75.75 0 0 1 1.04-1.08l4.25 4.25a.75.75 0 0 1 0 1.08l-4.25 4.25a.75.75 0 0 1-1.06-.02Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {cell.laneColor && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: cell.laneColor }}
                    />
                  )}
                  <span className="flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    {cell.laneLabel}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {cell.leads.length}
                  </span>
                </button>
              )}
              {isOpen && (
                <CellDroppable
                  id={`cell:${stage.id}:${cell.laneKey}`}
                  leads={cell.leads}
                  domain={domain}
                  lastActivityByLead={lastActivityByLead}
                  empty={showLaneLabel}
                  onOpenEdit={onOpenEdit}
                />
              )}
            </div>
          );
        })}
        {!showLaneLabel && totalCount === 0 && (
          <div className="flex h-24 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 text-xs text-gray-400">
            Solte um card aqui
          </div>
        )}
        {totalCount > 0 && <NewLeadButton domain={domain} />}
      </div>
    </div>
  );
}
