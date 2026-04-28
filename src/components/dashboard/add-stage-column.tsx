"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PipelineStage } from "@/lib/types/database";
import { PIPELINE_STAGE_COLORS } from "@/lib/pipeline-stage-colors";
import {
  StageFormFields,
  type StageFormValues,
} from "./stage-form-fields";

interface AddStageColumnProps {
  companyId: string;
  /** Próxima posição livre (geralmente `max(position) + 1` entre etapas não-perdidas). */
  nextPosition: number;
  onCreated: (stage: PipelineStage) => void;
  onError: (message: string) => void;
}

const INITIAL_VALUES: StageFormValues = {
  name: "",
  color: PIPELINE_STAGE_COLORS[0],
  is_won: false,
  is_lost: false,
};

/**
 * Cartão fixo no final do kanban que permite criar uma nova etapa
 * (coluna) sem sair da tela. Usa a mesma paleta e a mesma persistência
 * em `pipeline_stages` que a tela de configurações.
 */
export function AddStageColumn({
  companyId,
  nextPosition,
  onCreated,
  onError,
}: AddStageColumnProps) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<StageFormValues>(INITIAL_VALUES);
  const [saving, setSaving] = useState(false);

  function reset() {
    setValues(INITIAL_VALUES);
    setOpen(false);
  }

  async function handleCreate() {
    const trimmed = values.name.trim();
    if (!trimmed) return;
    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("pipeline_stages")
      .insert({
        company_id: companyId,
        name: trimmed,
        color: values.color,
        position: nextPosition,
        is_won: values.is_won,
        is_lost: values.is_lost,
      })
      .select("*")
      .single();

    setSaving(false);
    if (error || !data) {
      onError(error?.message ?? "Falha ao criar etapa.");
      return;
    }
    onCreated(data as unknown as PipelineStage);
    reset();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-[220px] shrink-0 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50/40 px-3 py-6 text-sm font-medium text-gray-500 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
      >
        <svg
          className="mb-1 h-5 w-5"
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
        Adicionar etapa
      </button>
    );
  }

  return (
    <div className="flex min-w-[260px] shrink-0 flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">Nova etapa</span>
        <button
          type="button"
          onClick={reset}
          disabled={saving}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          aria-label="Cancelar"
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
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <StageFormFields
        values={values}
        onChange={setValues}
        disabled={saving}
        autoFocusName
        onSubmitShortcut={handleCreate}
      />

      <button
        type="button"
        onClick={handleCreate}
        disabled={saving || !values.name.trim()}
        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Criando..." : "Criar etapa"}
      </button>
    </div>
  );
}
