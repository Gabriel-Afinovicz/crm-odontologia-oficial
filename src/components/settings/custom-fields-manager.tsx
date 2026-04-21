"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import type { CustomField, CustomFieldType } from "@/lib/types/database";
import { AddCustomFieldForm } from "./add-custom-field-form";

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Texto",
  number: "Número",
  date: "Data",
  boolean: "Sim/Não",
  select: "Seleção única",
  multi_select: "Seleção múltipla",
  phone: "Telefone",
  email: "E-mail",
  url: "URL",
};

const hasOptions = (type: CustomFieldType) =>
  type === "select" || type === "multi_select";

export function CustomFieldsManager() {
  const { companyId, loading: companyLoading } = useCurrentCompany();
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRequired, setEditRequired] = useState(false);
  const [editOptions, setEditOptions] = useState("");
  const [operatingId, setOperatingId] = useState<string | null>(null);

  async function fetchFields() {
    if (!companyId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("custom_fields")
      .select("*")
      .eq("company_id", companyId)
      .order("display_order");
    if (data) setFields(data as unknown as CustomField[]);
    setLoading(false);
  }

  useEffect(() => {
    if (companyLoading) return;
    if (!companyId) {
      setFields([]);
      setLoading(false);
      return;
    }
    fetchFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyLoading, companyId]);

  async function handleUpdate(id: string) {
    if (!editName.trim()) return;
    setError(null);
    setOperatingId(id);
    const supabase = createClient();
    const field = fields.find((f) => f.id === id);

    const optionsArr = field && hasOptions(field.field_type)
      ? editOptions.split(",").map((o) => o.trim()).filter(Boolean)
      : undefined;

    const { error: updateError } = await supabase.from("custom_fields").update({
      name: editName.trim(),
      is_required: editRequired,
      ...(optionsArr !== undefined ? { options: optionsArr } : {}),
    }).eq("id", id);

    if (updateError) {
      setError(`Erro ao atualizar: ${updateError.message}`);
      setOperatingId(null);
      return;
    }

    setEditingId(null);
    setOperatingId(null);
    await fetchFields();
  }

  async function handleToggleActive(id: string, currentActive: boolean) {
    setError(null);
    setOperatingId(id);
    const supabase = createClient();
    const { error: updateError } = await supabase.from("custom_fields").update({ is_active: !currentActive }).eq("id", id);
    if (updateError) {
      setError(`Erro ao atualizar: ${updateError.message}`);
    }
    setOperatingId(null);
    await fetchFields();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Excluir o campo "${name}"? Todos os valores preenchidos para este campo serão removidos.`)) return;
    setError(null);
    setOperatingId(id);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("custom_fields").delete().eq("id", id);
    if (deleteError) {
      setError(`Erro ao excluir: ${deleteError.message}`);
      setOperatingId(null);
      return;
    }
    setOperatingId(null);
    await fetchFields();
  }

  function startEdit(field: CustomField) {
    setEditingId(field.id);
    setEditName(field.name);
    setEditRequired(field.is_required);
    const opts = Array.isArray(field.options) ? (field.options as string[]).join(", ") : "";
    setEditOptions(opts);
  }

  function typeLabel(type: CustomFieldType) {
    return FIELD_TYPE_LABELS[type] ?? type;
  }

  if (loading) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />)}</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Novo Campo
        </button>
      ) : companyId ? (
        <AddCustomFieldForm
          companyId={companyId}
          currentFieldCount={fields.length}
          onCreated={async () => {
            setShowForm(false);
            await fetchFields();
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {fields.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            Nenhum campo personalizado criado ainda.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {fields.map((field) => (
              <div key={field.id} className={`px-5 py-3 transition-opacity ${operatingId === field.id ? "opacity-50" : ""}`}>
                {editingId === field.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                        autoFocus
                      />
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{typeLabel(field.field_type)}</span>
                    </div>
                    {hasOptions(field.field_type) && (
                      <input
                        type="text"
                        value={editOptions}
                        onChange={(e) => setEditOptions(e.target.value)}
                        placeholder="Opções separadas por vírgula"
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                      />
                    )}
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={editRequired} onChange={(e) => setEditRequired(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className="text-xs text-gray-600">Obrigatório</span>
                    </label>
                    <div className="flex gap-2">
                      <button onClick={() => handleUpdate(field.id)} className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">Salvar</button>
                      <button onClick={() => setEditingId(null)} className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-medium ${field.is_active ? "text-gray-900" : "text-gray-400 line-through"}`}>{field.name}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{typeLabel(field.field_type)}</span>
                      {field.is_required && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-500">Obrigatório</span>}
                      {!field.is_active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Inativo</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => startEdit(field)} className="rounded px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700">Editar</button>
                      <button
                        onClick={() => handleToggleActive(field.id, field.is_active)}
                        className={`rounded px-2 py-1 text-xs transition-colors ${field.is_active ? "text-yellow-600 hover:bg-yellow-50" : "text-green-600 hover:bg-green-50"}`}
                      >
                        {field.is_active ? "Desativar" : "Ativar"}
                      </button>
                      <button onClick={() => handleDelete(field.id, field.name)} className="rounded px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 hover:text-red-700">Excluir</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
