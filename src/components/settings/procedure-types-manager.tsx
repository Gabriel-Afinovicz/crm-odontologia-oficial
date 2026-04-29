"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import type { ProcedureType, Specialty } from "@/lib/types/database";

interface DraftState {
  name: string;
  duration: number;
  value: string;
  specialtyId: string;
}

const EMPTY_DRAFT: DraftState = {
  name: "",
  duration: 30,
  value: "",
  specialtyId: "",
};

function parseValue(input: string): number | null {
  if (!input.trim()) return null;
  const normalized = input.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function formatValue(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function ProcedureTypesManager() {
  const { companyId, loading: companyLoading } = useCurrentCompany();
  const [items, setItems] = useState<ProcedureType[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [operatingId, setOperatingId] = useState<string | null>(null);

  async function fetchAll() {
    if (!companyId) return;
    const supabase = createClient();
    const [proceduresRes, specialtiesRes] = await Promise.all([
      supabase
        .from("procedure_types")
        .select("*")
        .eq("company_id", companyId)
        .order("name"),
      supabase
        .from("specialties")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
    ]);
    if (proceduresRes.data) {
      setItems(proceduresRes.data as unknown as ProcedureType[]);
    }
    if (specialtiesRes.data) {
      setSpecialties(specialtiesRes.data as unknown as Specialty[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (companyLoading) return;
    if (!companyId) {
      setItems([]);
      setSpecialties([]);
      setLoading(false);
      return;
    }
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyLoading, companyId]);

  async function handleCreate() {
    if (!draft.name.trim() || !companyId) return;
    setError(null);
    setSaving(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("procedure_types").insert({
      name: draft.name.trim(),
      default_duration_minutes: draft.duration,
      default_value: parseValue(draft.value),
      specialty_id: draft.specialtyId || null,
      company_id: companyId,
    });
    if (insertError) {
      setError(`Erro ao criar procedimento: ${insertError.message}`);
      setSaving(false);
      return;
    }
    setDraft(EMPTY_DRAFT);
    setSaving(false);
    await fetchAll();
  }

  async function handleUpdate(id: string) {
    if (!editDraft.name.trim()) return;
    setError(null);
    setOperatingId(id);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("procedure_types")
      .update({
        name: editDraft.name.trim(),
        default_duration_minutes: editDraft.duration,
        default_value: parseValue(editDraft.value),
        specialty_id: editDraft.specialtyId || null,
      })
      .eq("id", id);
    if (updateError) {
      setError(`Erro ao atualizar: ${updateError.message}`);
      setOperatingId(null);
      return;
    }
    setEditingId(null);
    setOperatingId(null);
    await fetchAll();
  }

  async function handleToggleActive(item: ProcedureType) {
    setOperatingId(item.id);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("procedure_types")
      .update({ is_active: !item.is_active })
      .eq("id", item.id);
    if (updateError) setError(`Erro: ${updateError.message}`);
    setOperatingId(null);
    await fetchAll();
  }

  function startEdit(item: ProcedureType) {
    setEditingId(item.id);
    setEditDraft({
      name: item.name,
      duration: item.default_duration_minutes,
      value: item.default_value !== null ? String(item.default_value) : "",
      specialtyId: item.specialty_id ?? "",
    });
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  const specialtyById = new Map(specialties.map((s) => [s.id, s]));

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          Novo procedimento
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Nome
            </label>
            <input
              type="text"
              placeholder="Ex: Limpeza, Canal..."
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Duração (min)
            </label>
            <input
              type="number"
              min={5}
              step={5}
              value={draft.duration}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  duration: parseInt(e.target.value, 10) || 30,
                }))
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Valor (R$)
            </label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={draft.value}
              onChange={(e) =>
                setDraft((d) => ({ ...d, value: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Especialidade
            </label>
            <select
              value={draft.specialtyId}
              onChange={(e) =>
                setDraft((d) => ({ ...d, specialtyId: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Sem especialidade</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={handleCreate}
            disabled={saving || !draft.name.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Criando..." : "Criar"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {items.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            Nenhum procedimento cadastrado.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => {
              const specialty = item.specialty_id
                ? specialtyById.get(item.specialty_id)
                : null;
              return (
                <div
                  key={item.id}
                  className={`px-5 py-3 transition-opacity ${
                    operatingId === item.id ? "opacity-50" : ""
                  } ${!item.is_active ? "bg-gray-50/60" : ""}`}
                >
                  {editingId === item.id ? (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
                      <div className="lg:col-span-2">
                        <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">
                          Nome
                        </label>
                        <input
                          type="text"
                          value={editDraft.name}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, name: e.target.value }))
                          }
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">
                          Duração (min)
                        </label>
                        <input
                          type="number"
                          min={5}
                          step={5}
                          value={editDraft.duration}
                          onChange={(e) =>
                            setEditDraft((d) => ({
                              ...d,
                              duration: parseInt(e.target.value, 10) || 30,
                            }))
                          }
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">
                          Valor (R$)
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={editDraft.value}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, value: e.target.value }))
                          }
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">
                          Especialidade
                        </label>
                        <select
                          value={editDraft.specialtyId}
                          onChange={(e) =>
                            setEditDraft((d) => ({
                              ...d,
                              specialtyId: e.target.value,
                            }))
                          }
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        >
                          <option value="">Sem especialidade</option>
                          {specialties.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleUpdate(item.id)}
                          className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white"
                        >
                          Salvar
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-600"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {item.name}
                        </span>
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                          {item.default_duration_minutes} min
                        </span>
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                          {formatValue(item.default_value)}
                        </span>
                        {specialty && (
                          <span
                            className="rounded px-2 py-0.5 text-[11px] font-medium"
                            style={{
                              backgroundColor: `${specialty.color}1a`,
                              color: specialty.color,
                            }}
                          >
                            {specialty.name}
                          </span>
                        )}
                        {!item.is_active && (
                          <span className="text-xs text-gray-400">
                            (inativo)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => startEdit(item)}
                          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleToggleActive(item)}
                          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                        >
                          {item.is_active ? "Desativar" : "Reativar"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
