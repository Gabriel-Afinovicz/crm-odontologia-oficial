"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { CustomField, CustomFieldType } from "@/lib/types/database";

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

const hasOptions = (type: CustomFieldType) => type === "select" || type === "multi_select";

export function CustomFieldsManager() {
  const { profile } = useAuth();
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<CustomFieldType>("text");
  const [newRequired, setNewRequired] = useState(false);
  const [newOptions, setNewOptions] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRequired, setEditRequired] = useState(false);
  const [editOptions, setEditOptions] = useState("");
  const [operatingId, setOperatingId] = useState<string | null>(null);

  async function fetchFields() {
    const supabase = createClient();
    const { data } = await supabase.from("custom_fields").select("*").order("display_order");
    if (data) setFields(data as unknown as CustomField[]);
    setLoading(false);
  }

  useEffect(() => {
    fetchFields();
  }, []);

  async function handleCreate() {
    if (!newName.trim() || !profile?.company_id) return;
    setError(null);
    setSaving(true);
    const supabase = createClient();

    const optionsArr = hasOptions(newType)
      ? newOptions.split(",").map((o) => o.trim()).filter(Boolean)
      : null;

    const { error: insertError } = await supabase.from("custom_fields").insert({
      name: newName.trim(),
      field_type: newType,
      is_required: newRequired,
      options: optionsArr,
      display_order: fields.length,
      company_id: profile.company_id,
    });

    if (insertError) {
      setError(`Erro ao criar campo: ${insertError.message}`);
      setSaving(false);
      return;
    }

    setNewName("");
    setNewType("text");
    setNewRequired(false);
    setNewOptions("");
    setShowForm(false);
    setSaving(false);
    await fetchFields();
  }

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
    return FIELD_TYPE_OPTIONS.find((o) => o.value === type)?.label || type;
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
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Novo Campo Personalizado</h3>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-gray-600">Nome</label>
                <input
                  type="text"
                  placeholder="Ex: CPF, Convênio..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Tipo</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as CustomFieldType)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  {FIELD_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {hasOptions(newType) && (
              <div>
                <label className="mb-1 block text-sm text-gray-600">Opções (separadas por vírgula)</label>
                <input
                  type="text"
                  placeholder="Opção 1, Opção 2, Opção 3"
                  value={newOptions}
                  onChange={(e) => setNewOptions(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            )}

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={newRequired}
                onChange={(e) => setNewRequired(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">Campo obrigatório</span>
            </label>

            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={saving || !newName.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Criando...
                  </span>
                ) : "Criar Campo"}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

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
