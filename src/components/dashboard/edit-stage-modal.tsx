"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PipelineStage } from "@/lib/types/database";
import {
  StageFormFields,
  type StageFormValues,
} from "./stage-form-fields";

interface EditStageModalProps {
  stage: PipelineStage;
  /** Quantos leads há atualmente nesta etapa (impede excluir se > 0). */
  leadCount: number;
  onClose: () => void;
  onSaved: (stage: PipelineStage) => void;
  onDeleted: (stageId: string) => void;
}

/**
 * Modal de edição/exclusão de etapa do pipeline disparado pelo botão
 * de "três pontinhos" em cada coluna do kanban. Reaproveita
 * `StageFormFields` (mesmos campos do formulário de criação) e a
 * mesma regra de exclusão da tela de configurações: só permite remover
 * se a etapa estiver vazia.
 */
export function EditStageModal({
  stage,
  leadCount,
  onClose,
  onSaved,
  onDeleted,
}: EditStageModalProps) {
  const [values, setValues] = useState<StageFormValues>({
    name: stage.name,
    color: stage.color,
    is_won: stage.is_won,
    is_lost: stage.is_lost,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleSave() {
    const trimmed = values.name.trim();
    if (!trimmed) return;
    setError(null);
    setSaving(true);
    const supabase = createClient();
    const { data, error: updateErr } = await supabase
      .from("pipeline_stages")
      .update({
        name: trimmed,
        color: values.color,
        is_won: values.is_won,
        is_lost: values.is_lost,
      })
      .eq("id", stage.id)
      .select("*")
      .single();
    setSaving(false);
    if (updateErr || !data) {
      setError(updateErr?.message ?? "Falha ao salvar.");
      return;
    }
    onSaved(data as unknown as PipelineStage);
  }

  async function handleDelete() {
    if (leadCount > 0) {
      setError(
        `Não é possível excluir: existem ${leadCount} lead(s) nesta etapa.`
      );
      return;
    }
    setError(null);
    setDeleting(true);
    const supabase = createClient();
    const { error: deleteErr } = await supabase
      .from("pipeline_stages")
      .delete()
      .eq("id", stage.id);
    setDeleting(false);
    if (deleteErr) {
      setError(deleteErr.message);
      return;
    }
    onDeleted(stage.id);
  }

  const busy = saving || deleting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Editar etapa</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Fechar"
          >
            <svg
              className="h-4 w-4"
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
          disabled={busy}
          autoFocusName
          onSubmitShortcut={handleSave}
        />

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={busy || leadCount > 0}
              title={
                leadCount > 0
                  ? `Não é possível excluir: ${leadCount} lead(s) nesta etapa.`
                  : "Excluir etapa"
              }
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Excluir etapa
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700">Tem certeza?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Excluindo..." : "Confirmar exclusão"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !values.name.trim()}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
