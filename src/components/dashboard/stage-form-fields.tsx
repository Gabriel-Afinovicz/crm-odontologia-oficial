"use client";

import { PIPELINE_STAGE_COLORS } from "@/lib/pipeline-stage-colors";

export interface StageFormValues {
  name: string;
  color: string;
  is_won: boolean;
  is_lost: boolean;
}

interface StageFormFieldsProps {
  values: StageFormValues;
  onChange: (next: StageFormValues) => void;
  disabled?: boolean;
  /** Se verdadeiro, foca o input de nome ao montar. */
  autoFocusName?: boolean;
  onSubmitShortcut?: () => void;
}

/**
 * Campos compartilhados entre criação e edição de etapa do pipeline.
 * Garante que os flags `is_won` e `is_lost` sejam mutuamente exclusivos
 * (mesma regra usada na tela de configurações).
 */
export function StageFormFields({
  values,
  onChange,
  disabled = false,
  autoFocusName = false,
  onSubmitShortcut,
}: StageFormFieldsProps) {
  function setName(name: string) {
    onChange({ ...values, name });
  }
  function setColor(color: string) {
    onChange({ ...values, color });
  }
  function toggleWon() {
    onChange({
      ...values,
      is_won: !values.is_won,
      is_lost: !values.is_won ? false : values.is_lost,
    });
  }
  function toggleLost() {
    onChange({
      ...values,
      is_lost: !values.is_lost,
      is_won: !values.is_lost ? false : values.is_won,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={values.name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmitShortcut?.();
        }}
        disabled={disabled}
        autoFocus={autoFocusName}
        placeholder="Nome da etapa"
        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50"
      />

      <div>
        <label className="mb-1.5 block text-xs font-medium text-gray-600">
          Cor
        </label>
        <div className="flex flex-wrap gap-1.5">
          {PIPELINE_STAGE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              disabled={disabled}
              className={`h-6 w-6 rounded-full transition-transform ${
                values.color === c
                  ? "scale-110 ring-2 ring-offset-1 ring-gray-400"
                  : ""
              }`}
              style={{ backgroundColor: c }}
              aria-label={`Cor ${c}`}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs">
        <label className="inline-flex items-center gap-1.5 text-gray-700">
          <input
            type="checkbox"
            checked={values.is_won}
            onChange={toggleWon}
            disabled={disabled}
            className="h-3.5 w-3.5 rounded border-gray-300"
          />
          Marcar como{" "}
          <span className="font-semibold text-emerald-700">Ganho</span>
        </label>
        <label className="inline-flex items-center gap-1.5 text-gray-700">
          <input
            type="checkbox"
            checked={values.is_lost}
            onChange={toggleLost}
            disabled={disabled}
            className="h-3.5 w-3.5 rounded border-gray-300"
          />
          Marcar como{" "}
          <span className="font-semibold text-red-700">Perdido</span>
        </label>
      </div>
    </div>
  );
}
