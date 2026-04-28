"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { PIPELINE_STAGE_COLORS } from "@/lib/pipeline-stage-colors";
import type { PipelineStage } from "@/lib/types/database";

const PRESET_COLORS = PIPELINE_STAGE_COLORS;

function StageRow({
  stage,
  onEdit,
  onToggleActive,
  onToggleWon,
  onToggleLost,
  hasLeads,
  operatingId,
}: {
  stage: PipelineStage;
  onEdit: (stage: PipelineStage) => void;
  onToggleActive: (stage: PipelineStage) => void;
  onToggleWon: (stage: PipelineStage) => void;
  onToggleLost: (stage: PipelineStage) => void;
  hasLeads: boolean;
  operatingId: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stage.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-4 py-3 transition-opacity
        ${isDragging ? "opacity-50" : ""}
        ${operatingId === stage.id ? "opacity-50" : ""}
        ${!stage.is_active ? "bg-gray-50/60" : ""}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab text-gray-400 hover:text-gray-600 active:cursor-grabbing"
        aria-label="Arrastar"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M7 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM7 9a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM7 14a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
        </svg>
      </button>
      <span
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: stage.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-900">
            {stage.name}
          </span>
          {stage.is_won && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
              ganho
            </span>
          )}
          {stage.is_lost && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700">
              perdido
            </span>
          )}
          {!stage.is_active && (
            <span className="text-xs text-gray-400">(inativo)</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <label className="inline-flex items-center gap-1 text-gray-600">
          <input
            type="checkbox"
            checked={stage.is_won}
            onChange={() => onToggleWon(stage)}
            className="h-3.5 w-3.5 rounded border-gray-300"
          />
          Ganho
        </label>
        <label className="inline-flex items-center gap-1 text-gray-600">
          <input
            type="checkbox"
            checked={stage.is_lost}
            onChange={() => onToggleLost(stage)}
            className="h-3.5 w-3.5 rounded border-gray-300"
          />
          Perdido
        </label>
        <button
          onClick={() => onEdit(stage)}
          className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
        >
          Editar
        </button>
        <button
          onClick={() => onToggleActive(stage)}
          disabled={hasLeads && stage.is_active}
          title={
            hasLeads && stage.is_active
              ? "Existem leads neste estágio. Mova-os antes de desativar."
              : undefined
          }
          className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {stage.is_active ? "Desativar" : "Reativar"}
        </button>
      </div>
    </div>
  );
}

export function PipelineStagesManager() {
  const { companyId, loading: companyLoading } = useCurrentCompany();
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [leadCountByStage, setLeadCountByStage] = useState<
    Record<string, number>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operatingId, setOperatingId] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<PipelineStage | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  async function fetchAll() {
    if (!companyId) return;
    const supabase = createClient();
    const [stagesRes, countsRes] = await Promise.all([
      supabase
        .from("pipeline_stages")
        .select("*")
        .eq("company_id", companyId)
        .order("position", { ascending: true }),
      supabase
        .from("leads")
        .select("stage_id")
        .eq("company_id", companyId),
    ]);
    if (stagesRes.data) setStages(stagesRes.data as unknown as PipelineStage[]);
    const counts: Record<string, number> = {};
    for (const row of (countsRes.data as { stage_id: string }[] | null) ?? []) {
      counts[row.stage_id] = (counts[row.stage_id] ?? 0) + 1;
    }
    setLeadCountByStage(counts);
    setLoading(false);
  }

  useEffect(() => {
    if (companyLoading) return;
    if (!companyId) {
      setStages([]);
      setLoading(false);
      return;
    }
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyLoading, companyId]);

  async function handleCreate() {
    if (!newName.trim() || !companyId) return;
    setError(null);
    setSaving(true);
    const supabase = createClient();
    const nextPosition =
      (stages.filter((s) => !s.is_lost).reduce(
        (m, s) => Math.max(m, s.position),
        0
      ) ?? 0) + 1;
    const { error: insertError } = await supabase.from("pipeline_stages").insert({
      company_id: companyId,
      name: newName.trim(),
      color: newColor,
      position: nextPosition,
    });
    if (insertError) {
      setError(`Erro ao criar: ${insertError.message}`);
      setSaving(false);
      return;
    }
    setNewName("");
    setNewColor(PRESET_COLORS[0]);
    setSaving(false);
    await fetchAll();
  }

  async function handleUpdate() {
    if (!editing || !editName.trim()) return;
    setOperatingId(editing.id);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("pipeline_stages")
      .update({ name: editName.trim(), color: editColor })
      .eq("id", editing.id);
    setOperatingId(null);
    if (updateError) {
      setError(`Erro: ${updateError.message}`);
      return;
    }
    setEditing(null);
    await fetchAll();
  }

  async function handleToggleActive(stage: PipelineStage) {
    const count = leadCountByStage[stage.id] ?? 0;
    if (stage.is_active && count > 0) {
      setError(
        `Não é possível desativar "${stage.name}": existem ${count} lead(s) neste estágio.`
      );
      return;
    }
    setOperatingId(stage.id);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("pipeline_stages")
      .update({ is_active: !stage.is_active })
      .eq("id", stage.id);
    setOperatingId(null);
    if (updateError) {
      setError(`Erro: ${updateError.message}`);
      return;
    }
    await fetchAll();
  }

  async function handleToggleWon(stage: PipelineStage) {
    setOperatingId(stage.id);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("pipeline_stages")
      .update({ is_won: !stage.is_won, is_lost: false })
      .eq("id", stage.id);
    setOperatingId(null);
    if (updateError) setError(`Erro: ${updateError.message}`);
    await fetchAll();
  }

  async function handleToggleLost(stage: PipelineStage) {
    setOperatingId(stage.id);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("pipeline_stages")
      .update({ is_lost: !stage.is_lost, is_won: false })
      .eq("id", stage.id);
    setOperatingId(null);
    if (updateError) setError(`Erro: ${updateError.message}`);
    await fetchAll();
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = stages.findIndex((s) => s.id === active.id);
    const newIndex = stages.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(stages, oldIndex, newIndex).map((s, i) => ({
      ...s,
      position: i + 1,
    }));
    setStages(next);

    const supabase = createClient();
    await Promise.all(
      next.map((s) =>
        supabase
          .from("pipeline_stages")
          .update({ position: s.position })
          .eq("id", s.id)
      )
    );
  }

  function startEdit(stage: PipelineStage) {
    setEditing(stage);
    setEditName(stage.name);
    setEditColor(stage.color);
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          Novo estágio
        </h3>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Ex: Consulta de retorno"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`h-6 w-6 rounded-full ${
                  newColor === c ? "ring-2 ring-gray-400 ring-offset-1" : ""
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            onClick={handleCreate}
            disabled={saving || !newName.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Criando..." : "Criar"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/60 px-4 py-2 text-xs text-gray-500">
          Arraste para reordenar os estágios do pipeline.
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={stages.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="divide-y divide-gray-100">
              {stages.map((stage) => (
                <StageRow
                  key={stage.id}
                  stage={stage}
                  onEdit={startEdit}
                  onToggleActive={handleToggleActive}
                  onToggleWon={handleToggleWon}
                  onToggleLost={handleToggleLost}
                  hasLeads={(leadCountByStage[stage.id] ?? 0) > 0}
                  operatingId={operatingId}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">
              Editar estágio
            </h3>
            <div className="mt-4 space-y-3">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <div className="flex items-center gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setEditColor(c)}
                    className={`h-6 w-6 rounded-full ${
                      editColor === c ? "ring-2 ring-gray-400 ring-offset-1" : ""
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleUpdate}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
