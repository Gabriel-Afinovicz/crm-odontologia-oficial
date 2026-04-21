"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CustomFieldType } from "@/lib/types/database";

const FIELD_TYPE_OPTIONS: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "boolean", label: "Sim/Não" },
  { value: "select", label: "Seleção única" },
  { value: "multi_select", label: "Seleção múltipla" },
  { value: "phone", label: "Telefone" },
  { value: "email", label: "E-mail" },
  { value: "url", label: "URL" },
];

const hasOptions = (type: CustomFieldType) =>
  type === "select" || type === "multi_select";

interface AddCustomFieldFormProps {
  companyId: string;
  currentFieldCount: number;
  onCreated: () => void | Promise<void>;
  onCancel?: () => void;
}

export function AddCustomFieldForm({
  companyId,
  currentFieldCount,
  onCreated,
  onCancel,
}: AddCustomFieldFormProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setError(null);
    setSaving(true);
    const supabase = createClient();

    const optionsArr = hasOptions(type)
      ? options
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean)
      : null;

    const { error: insertError } = await supabase.from("custom_fields").insert({
      name: name.trim(),
      field_type: type,
      is_required: required,
      options: optionsArr,
      display_order: currentFieldCount,
      company_id: companyId,
    });

    if (insertError) {
      setError(`Erro ao criar campo: ${insertError.message}`);
      setSaving(false);
      return;
    }

    setName("");
    setType("text");
    setRequired(false);
    setOptions("");
    setSaving(false);
    await onCreated();
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
        Novo Campo Personalizado
      </h3>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-gray-600">Nome</label>
            <input
              type="text"
              placeholder="Ex: CPF, Convênio..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Tipo</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as CustomFieldType)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              {FIELD_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {hasOptions(type) && (
          <div>
            <label className="mb-1 block text-sm text-gray-600">
              Opções (separadas por vírgula)
            </label>
            <input
              type="text"
              placeholder="Opção 1, Opção 2, Opção 3"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        )}

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-600">Campo obrigatório</span>
        </label>

        <div className="flex gap-2">
          <button
            onClick={handleCreate}
            disabled={saving || !name.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Criando...
              </span>
            ) : (
              "Criar Campo"
            )}
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
