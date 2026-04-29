"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import type { PipelineStage, Specialty } from "@/lib/types/database";
import type {
  KanbanLead,
  KanbanOperator,
} from "@/lib/supabase/dashboard-data";
import { KanbanColumn, columnSortableId, type LaneCell } from "./kanban-column";
import { KanbanCard } from "./kanban-card";
import { LostReasonModal } from "./lost-reason-modal";
import { KanbanLeadEditModal } from "./kanban-lead-edit-modal";
import { AddStageColumn } from "./add-stage-column";
import { EditStageModal } from "./edit-stage-modal";

type LaneMode = "none" | "dentist";

interface LeadKanbanBoardProps {
  domain: string;
  initialLeads: KanbanLead[];
  operators: KanbanOperator[];
  stages: PipelineStage[];
  specialties: Specialty[];
  lastActivityByLead: Record<string, string>;
  /**
   * Notifica o pai sempre que o conjunto de leads do board muda
   * (mover entre etapas, reordenar, editar). Usado para manter
   * indicadores externos — como o Funil de Leads — sincronizados
   * com o que o usuário enxerga no kanban.
   */
  onLeadsChange?: (leads: KanbanLead[]) => void;
  /**
   * Notifica o pai sempre que a ordem das colunas (etapas) muda,
   * para que outras visualizações (funil, badges em "Últimos leads")
   * possam refletir a mesma ordenação em tempo real.
   */
  onStagesChange?: (stages: PipelineStage[]) => void;
}

type BoardState = Record<string, KanbanLead[]>;

function groupByStage(leads: KanbanLead[], stages: PipelineStage[]): BoardState {
  const base: BoardState = {};
  for (const s of stages) base[s.id] = [];
  for (const lead of leads) {
    if (base[lead.stage_id]) {
      base[lead.stage_id].push(lead);
    }
  }
  for (const stageId of Object.keys(base)) {
    base[stageId].sort(
      (a, b) =>
        a.kanban_position - b.kanban_position ||
        (a.created_at < b.created_at ? 1 : -1)
    );
  }
  return base;
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function parseCellId(
  id: string
): { stageId: string; laneKey: string } | null {
  if (!id.startsWith("cell:")) return null;
  const rest = id.slice(5);
  const idx = rest.indexOf(":");
  if (idx === -1) return null;
  return { stageId: rest.slice(0, idx), laneKey: rest.slice(idx + 1) };
}

export function LeadKanbanBoard({
  domain,
  initialLeads,
  operators,
  stages: initialStages,
  specialties,
  lastActivityByLead,
  onLeadsChange,
  onStagesChange,
}: LeadKanbanBoardProps) {
  const { companyId } = useCurrentCompany();
  const [stages, setStages] = useState<PipelineStage[]>(initialStages);
  const [board, setBoard] = useState<BoardState>(() =>
    groupByStage(initialLeads, initialStages)
  );

  const onLeadsChangeRef = useRef(onLeadsChange);
  useEffect(() => {
    onLeadsChangeRef.current = onLeadsChange;
  }, [onLeadsChange]);

  useEffect(() => {
    const cb = onLeadsChangeRef.current;
    if (!cb) return;
    const flat: KanbanLead[] = [];
    for (const stageId of Object.keys(board)) {
      for (const lead of board[stageId]) flat.push(lead);
    }
    cb(flat);
  }, [board]);

  const onStagesChangeRef = useRef(onStagesChange);
  useEffect(() => {
    onStagesChangeRef.current = onStagesChange;
  }, [onStagesChange]);

  useEffect(() => {
    onStagesChangeRef.current?.(stages);
  }, [stages]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingLost, setPendingLost] = useState<{
    lead: KanbanLead;
    destOrderedIds: string[];
    sourceOrderedIds: string[];
    fromStageId: string;
    toStageId: string;
    specialtyId: string | null;
    snapshot: BoardState;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [editingStage, setEditingStage] = useState<PipelineStage | null>(null);
  const dragSourceStageIdRef = useRef<string | null>(null);

  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");
  const [laneMode, setLaneMode] = useState<LaneMode>("none");
  const [showInactiveOnly, setShowInactiveOnly] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const stageById = useMemo(() => {
    const map = new Map<string, PipelineStage>();
    for (const s of stages) map.set(s.id, s);
    return map;
  }, [stages]);

  const dentists = useMemo(
    () => operators.filter((o) => o.is_dentist),
    [operators]
  );

  const activeLead = useMemo(() => {
    if (!activeId) return null;
    for (const stageId of Object.keys(board)) {
      const found = board[stageId].find((l) => l.id === activeId);
      if (found) return found;
    }
    return null;
  }, [activeId, board]);

  function passesFilters(l: KanbanLead): boolean {
    const term = search.trim().toLowerCase();
    if (term) {
      const match =
        l.name.toLowerCase().includes(term) ||
        (l.phone ?? "").toLowerCase().includes(term) ||
        (l.email ?? "").toLowerCase().includes(term);
      if (!match) return false;
    }
    if (assigneeFilter === "unassigned" && l.assigned_to) return false;
    if (
      assigneeFilter !== "all" &&
      assigneeFilter !== "unassigned" &&
      l.assigned_to !== assigneeFilter
    )
      return false;
    if (specialtyFilter === "none" && l.specialty_id) return false;
    if (
      specialtyFilter !== "all" &&
      specialtyFilter !== "none" &&
      l.specialty_id !== specialtyFilter
    )
      return false;
    if (showInactiveOnly) {
      const ref = lastActivityByLead[l.id] ?? l.updated_at ?? l.created_at;
      if (daysSince(ref) < 30) return false;
    }
    return true;
  }

  function buildLanes(leads: KanbanLead[]): LaneCell[] {
    if (laneMode === "none") {
      return [
        {
          laneKey: "all",
          laneLabel: null,
          laneColor: null,
          leads,
        },
      ];
    }
    // dentist
    const pool = dentists.length > 0 ? dentists : operators;
    const cells: LaneCell[] = pool.map((u) => ({
      laneKey: u.id,
      laneLabel: u.name,
      laneColor: u.is_dentist ? "#10b981" : "#3b82f6",
      leads: leads.filter((l) => l.assigned_to === u.id),
    }));
    cells.push({
      laneKey: "none",
      laneLabel: "Sem responsável",
      laneColor: "#9ca3af",
      leads: leads.filter((l) => !l.assigned_to),
    });
    return cells;
  }

  const columns = useMemo(() => {
    return stages.map((stage) => {
      const all = board[stage.id] ?? [];
      const filtered = all.filter(passesFilters);
      return {
        stage,
        totalCount: filtered.length,
        cells: buildLanes(filtered),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    board,
    stages,
    search,
    assigneeFilter,
    specialtyFilter,
    showInactiveOnly,
    laneMode,
    specialties,
    operators,
    dentists,
    lastActivityByLead,
  ]);

  function findStageOf(leadId: string): string | null {
    for (const stageId of Object.keys(board)) {
      if (board[stageId].some((l) => l.id === leadId)) return stageId;
    }
    return null;
  }

  function resolveTargetStage(overId: string): {
    stageId: string;
    laneKey: string | null;
  } | null {
    if (overId.startsWith("cell:")) {
      const parsed = parseCellId(overId);
      return parsed ? { stageId: parsed.stageId, laneKey: parsed.laneKey } : null;
    }
    const stageId = findStageOf(overId);
    return stageId ? { stageId, laneKey: null } : null;
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveId(id);
    setError(null);
    if (event.active.data.current?.type === "column") {
      dragSourceStageIdRef.current = null;
      return;
    }
    dragSourceStageIdRef.current = findStageOf(id);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    if (active.data.current?.type !== "card") return;

    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    const fromStage = findStageOf(activeIdStr);
    const target = resolveTargetStage(overIdStr);

    if (!fromStage || !target) return;
    if (fromStage === target.stageId) return;

    setBoard((prev) => {
      const source = prev[fromStage];
      const dest = prev[target.stageId] ?? [];
      const idx = source.findIndex((l) => l.id === activeIdStr);
      if (idx === -1) return prev;
      const targetStage = stageById.get(target.stageId);
      const moving: KanbanLead = {
        ...source[idx],
        stage_id: target.stageId,
        status: targetStage?.legacy_status ?? source[idx].status,
      };
      const overIndex = dest.findIndex((l) => l.id === overIdStr);
      const insertAt = overIndex === -1 ? dest.length : overIndex;
      return {
        ...prev,
        [fromStage]: source.filter((l) => l.id !== activeIdStr),
        [target.stageId]: [
          ...dest.slice(0, insertAt),
          moving,
          ...dest.slice(insertAt),
        ],
      };
    });
  }

  async function persistMove(
    leadId: string,
    fromStageId: string,
    toStageId: string,
    destOrderedIds: string[],
    sourceOrderedIds: string[],
    specialtyId: string | null,
    snapshot: BoardState,
    lostReason?: string
  ) {
    const supabase = createClient();
    const { error: rpcErr } = await supabase.rpc("apply_kanban_move_v2", {
      p_lead_id: leadId,
      p_from_stage_id: fromStageId,
      p_to_stage_id: toStageId,
      p_dest_ordered_ids: destOrderedIds,
      p_source_ordered_ids: sourceOrderedIds,
      p_specialty_id: specialtyId,
      p_lost_reason: lostReason ?? null,
    });

    if (rpcErr) {
      setBoard(snapshot);
      setError("Falha ao mover o lead. Alterações revertidas.");
    }
  }

  function snapshotBoard(): BoardState {
    const s: BoardState = {};
    for (const stageId of Object.keys(board)) s[stageId] = [...board[stageId]];
    return s;
  }

  async function persistStageOrder(orderedIds: string[]) {
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("reorder_pipeline_stages", {
      p_ordered_ids: orderedIds,
    });
    if (rpcError) {
      throw rpcError;
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    const originStageId = dragSourceStageIdRef.current;
    dragSourceStageIdRef.current = null;
    if (!over) return;

    if (active.data.current?.type === "column") {
      const activeStageId = String(active.data.current?.stageId ?? "");
      const overStageId = String(over.data.current?.stageId ?? "");
      if (!activeStageId || !overStageId || activeStageId === overStageId) {
        return;
      }
      const oldIndex = stages.findIndex((s) => s.id === activeStageId);
      const newIndex = stages.findIndex((s) => s.id === overStageId);
      if (oldIndex === -1 || newIndex === -1) return;
      const snapshot = stages;
      const reordered = arrayMove(stages, oldIndex, newIndex).map((s, i) => ({
        ...s,
        position: i,
      }));
      setStages(reordered);
      void persistStageOrder(reordered.map((s) => s.id)).catch((err) => {
        setStages(snapshot);
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message?: string }).message)
            : "";
        setError(
          msg
            ? `Falha ao reordenar colunas: ${msg}`
            : "Falha ao reordenar colunas. Alterações revertidas."
        );
      });
      return;
    }

    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    const fromStageId = originStageId ?? findStageOf(activeIdStr);
    const target = resolveTargetStage(overIdStr);
    if (!fromStageId || !target) return;

    const snapshot = snapshotBoard();
    const toStageId = target.stageId;
    const toStage = stageById.get(toStageId);

    const specialtyToSet: string | null = null;

    if (fromStageId === toStageId) {
      const items = board[fromStageId];
      const oldIndex = items.findIndex((l) => l.id === activeIdStr);
      const newIndex = items.findIndex((l) => l.id === overIdStr);
      if (oldIndex === -1) return;
      const reordered =
        newIndex === -1 || oldIndex === newIndex
          ? items
          : arrayMove(items, oldIndex, newIndex);

      const normalized = reordered.map((l, i) => ({
        ...l,
        kanban_position: i,
        ...(l.id === activeIdStr && specialtyToSet !== null
          ? { specialty_id: specialtyToSet }
          : {}),
      }));
      setBoard({ ...board, [fromStageId]: normalized });

      const destOrderedIds = normalized.map((l) => l.id);
      if (
        oldIndex === newIndex &&
        specialtyToSet === null &&
        (laneMode !== "dentist" || target.laneKey === null)
      ) {
        return;
      }

      void persistMove(
        activeIdStr,
        fromStageId,
        toStageId,
        destOrderedIds,
        [],
        specialtyToSet,
        snapshot
      );

      if (laneMode === "dentist" && target.laneKey) {
        const newAssignee = target.laneKey === "none" ? null : target.laneKey;
        void createClient()
          .from("leads")
          .update({ assigned_to: newAssignee })
          .eq("id", activeIdStr);
      }
      return;
    }

    const destColumn = (board[toStageId] ?? []).map((l, i) => ({
      ...l,
      kanban_position: i,
      ...(l.id === activeIdStr && specialtyToSet !== null
        ? { specialty_id: specialtyToSet }
        : {}),
    }));
    const sourceColumn = (board[fromStageId] ?? []).map((l, i) => ({
      ...l,
      kanban_position: i,
    }));

    setBoard({
      ...board,
      [toStageId]: destColumn,
      [fromStageId]: sourceColumn,
    });

    const destOrderedIds = destColumn.map((l) => l.id);
    const sourceOrderedIds = sourceColumn.map((l) => l.id);
    const movingLead = destColumn.find((l) => l.id === activeIdStr);

    if (laneMode === "dentist" && target.laneKey) {
      const newAssignee = target.laneKey === "none" ? null : target.laneKey;
      void createClient()
        .from("leads")
        .update({ assigned_to: newAssignee })
        .eq("id", activeIdStr);
    }

    if (toStage?.is_lost && movingLead) {
      setPendingLost({
        lead: movingLead,
        destOrderedIds,
        sourceOrderedIds,
        fromStageId,
        toStageId,
        specialtyId: specialtyToSet,
        snapshot,
      });
      return;
    }

    void persistMove(
      activeIdStr,
      fromStageId,
      toStageId,
      destOrderedIds,
      sourceOrderedIds,
      specialtyToSet,
      snapshot
    );
  }

  function handleDragCancel() {
    setActiveId(null);
    dragSourceStageIdRef.current = null;
  }

  const stats = useMemo(() => {
    const total = Object.values(board).reduce((acc, l) => acc + l.length, 0);
    const unassigned = Object.values(board).reduce(
      (acc, list) => acc + list.filter((l) => !l.assigned_to).length,
      0
    );
    const inactiveCount = Object.values(board).reduce(
      (acc, list) =>
        acc +
        list.filter((l) => {
          const ref =
            lastActivityByLead[l.id] ?? l.updated_at ?? l.created_at;
          return daysSince(ref) >= 30;
        }).length,
      0
    );
    return { total, unassigned, inactive: inactiveCount };
  }, [board, lastActivityByLead]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou e-mail..."
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pl-9 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <svg
            className="absolute left-3 top-2.5 h-4 w-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
        </div>

        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        >
          <option value="all">Todos os responsáveis</option>
          <option value="unassigned">Sem responsável</option>
          {operators.map((op) => (
            <option key={op.id} value={op.id}>
              {op.is_dentist ? `Dr(a). ${op.name}` : op.name}
            </option>
          ))}
        </select>

        <select
          value={specialtyFilter}
          onChange={(e) => setSpecialtyFilter(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        >
          <option value="all">Todas especialidades</option>
          <option value="none">Sem especialidade</option>
          {specialties.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.name}
            </option>
          ))}
        </select>

        <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5 text-xs">
          {(["none", "dentist"] as LaneMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setLaneMode(mode)}
              className={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                laneMode === mode
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {mode === "none" ? "Sem raias" : "Raias por Dentista"}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowInactiveOnly((v) => !v)}
          className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            showInactiveOnly
              ? "border-amber-400 bg-amber-50 text-amber-700"
              : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          Inativos (30+ dias) · {stats.inactive}
        </button>

        {(search ||
          assigneeFilter !== "all" ||
          specialtyFilter !== "all" ||
          showInactiveOnly ||
          laneMode !== "none") && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setAssigneeFilter("all");
              setSpecialtyFilter("all");
              setShowInactiveOnly(false);
              setLaneMode("none");
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Limpar
          </button>
        )}

        <div className="ml-auto hidden items-center gap-3 text-xs text-gray-500 sm:flex">
          <span>
            <span className="font-semibold text-gray-700">{stats.total}</span>{" "}
            leads
          </span>
          {stats.unassigned > 0 && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
              {stats.unassigned} sem responsável
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <DndContext
        id="lead-kanban"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex gap-3 overflow-x-auto pb-2 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300">
          <SortableContext
            items={stages.map((s) => columnSortableId(s.id))}
            strategy={horizontalListSortingStrategy}
          >
            {columns.map((col) => (
              <KanbanColumn
                key={col.stage.id}
                stage={col.stage}
                cells={col.cells}
                totalCount={col.totalCount}
                domain={domain}
                lastActivityByLead={lastActivityByLead}
                showLaneLabel={laneMode !== "none"}
                onOpenEdit={setEditingLeadId}
                onEditStage={setEditingStage}
              />
            ))}
          </SortableContext>
          {companyId && (
            <AddStageColumn
              companyId={companyId}
              nextPosition={
                stages
                  .filter((s) => !s.is_lost)
                  .reduce((m, s) => Math.max(m, s.position), 0) + 1
              }
              onCreated={(stage) => {
                setStages((prev) => [...prev, stage]);
                setBoard((prev) => ({ ...prev, [stage.id]: [] }));
              }}
              onError={(message) =>
                setError(`Falha ao criar etapa: ${message}`)
              }
            />
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeLead ? (
            <KanbanCard lead={activeLead} domain={domain} isOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>

      {editingLeadId && (
        <KanbanLeadEditModal
          domain={domain}
          leadId={editingLeadId}
          onClose={() => setEditingLeadId(null)}
          onSaved={(updated) => {
            setBoard((prev) => {
              const next: BoardState = {};
              for (const stageId of Object.keys(prev)) {
                next[stageId] = prev[stageId].map((l) =>
                  l.id === updated.id ? { ...l, ...updated } : l
                );
              }
              return next;
            });
            setEditingLeadId(null);
          }}
        />
      )}

      {editingStage && (
        <EditStageModal
          stage={editingStage}
          leadCount={(board[editingStage.id] ?? []).length}
          onClose={() => setEditingStage(null)}
          onSaved={(updated) => {
            setStages((prev) =>
              prev.map((s) => (s.id === updated.id ? updated : s))
            );
            setEditingStage(null);
          }}
          onDeleted={(stageId) => {
            setStages((prev) => prev.filter((s) => s.id !== stageId));
            setBoard((prev) => {
              const next: BoardState = {};
              for (const k of Object.keys(prev)) {
                if (k !== stageId) next[k] = prev[k];
              }
              return next;
            });
            setEditingStage(null);
          }}
        />
      )}

      {pendingLost && (
        <LostReasonModal
          lead={pendingLost.lead}
          onCancel={() => {
            setBoard(pendingLost.snapshot);
            setPendingLost(null);
          }}
          onConfirm={async (reason) => {
            await persistMove(
              pendingLost.lead.id,
              pendingLost.fromStageId,
              pendingLost.toStageId,
              pendingLost.destOrderedIds,
              pendingLost.sourceOrderedIds,
              pendingLost.specialtyId,
              pendingLost.snapshot,
              reason
            );
            setPendingLost(null);
          }}
        />
      )}
    </div>
  );
}
