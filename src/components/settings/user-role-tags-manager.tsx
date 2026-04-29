"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { Badge } from "@/components/ui/badge";
import type { UserRoleTag } from "@/lib/types/database";

const PRESET_COLORS = [
  "#10b981",
  "#6366f1",
  "#06b6d4",
  "#f59e0b",
  "#ec4899",
  "#3b82f6",
  "#8b5cf6",
  "#f97316",
  "#ef4444",
  "#14b8a6",
];

interface DraftState {
  name: string;
  color: string;
  marks_as_dentist: boolean;
}

const EMPTY_DRAFT: DraftState = {
  name: "",
  color: PRESET_COLORS[0],
  marks_as_dentist: false,
};

export function UserRoleTagsManager() {
  const { companyId, loading: companyLoading } = useCurrentCompany();
  const [items, setItems] = useState<UserRoleTag[]>([]);
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
    const { data } = await supabase
      .from("user_role_tags")
      .select("*")
      .eq("company_id", companyId)
      .order("name");
    if (data) setItems(data as unknown as UserRoleTag[]);
    setLoading(false);
  }

  useEffect(() => {
    if (companyLoading) return;
    if (!companyId) {
      setItems([]);
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
    const { error: e } = await supabase.from("user_role_tags").insert({
      company_id: companyId,
      name: draft.name.trim(),
      color: draft.color,
      marks_as_dentist: draft.marks_as_dentist,
    });
    setSaving(false);
    if (e) {
      setError(`Erro ao criar tag: ${e.message}`);
      return;
    }
    setDraft(EMPTY_DRAFT);
    await fetchAll();
  }

  async function handleUpdate(id: string) {
    if (!editDraft.name.trim()) return;
    setError(null);
    setOperatingId(id);
    const supabase = createClient();
    const { error: e } = await supabase
      .from("user_role_tags")
      .update({
        name: editDraft.name.trim(),
        color: editDraft.color,
        marks_as_dentist: editDraft.marks_as_dentist,
      })
      .eq("id", id);
    setOperatingId(null);
    if (e) {
      setError(`Erro ao atualizar: ${e.message}`);
      return;
    }
    setEditingId(null);
    await fetchAll();
  }

  async function handleToggle(item: UserRoleTag) {
    setOperatingId(item.id);
    const supabase = createClient();
    const { error: e } = await supabase
      .from("user_role_tags")
      .update({ is_active: !item.is_active })
      .eq("id", item.id);
    setOperatingId(null);
    if (e) {
      setError(`Erro: ${e.message}`);
      return;
    }
    await fetchAll();
  }

  function startEdit(item: UserRoleTag) {
    setEditingId(item.id);
    setEditDraft({
      name: item.name,
      color: item.color,
      marks_as_dentist: item.marks_as_dentist,
    });
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          Nova função
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            type="text"
            placeholder="Ex: Dentista, Secretário(a), Auxiliar..."
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Selecionar cor ${c}`}
                  onClick={() => setDraft((d) => ({ ...d, color: c }))}
                  className={`h-6 w-6 rounded-full transition-transform ${
                    draft.color === c
                      ? "scale-110 ring-2 ring-offset-1 ring-gray-400"
                      : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={draft.marks_as_dentist}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    marks_as_dentist: e.target.checked,
                  }))
                }
              />
              Marca como dentista
            </label>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !draft.name.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Criando..." : "Criar"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Quando uma função tem &quot;marca como dentista&quot;, qualquer
          usuário com essa tag passa a aparecer no select de dentista da agenda.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {items.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            Nenhuma função cadastrada.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => (
              <div
                key={item.id}
                className={`flex items-center justify-between px-5 py-3 transition-opacity ${
                  operatingId === item.id ? "opacity-50" : ""
                } ${!item.is_active ? "bg-gray-50/60" : ""}`}
              >
                {editingId === item.id ? (
                  <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={editDraft.name}
                      onChange={(e) =>
                        setEditDraft((d) => ({ ...d, name: e.target.value }))
                      }
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                      autoFocus
                    />
                    <div className="flex items-center gap-1">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={`Selecionar cor ${c}`}
                          onClick={() =>
                            setEditDraft((d) => ({ ...d, color: c }))
                          }
                          className={`h-5 w-5 rounded-full ${
                            editDraft.color === c ? "ring-2 ring-gray-400" : ""
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={editDraft.marks_as_dentist}
                        onChange={(e) =>
                          setEditDraft((d) => ({
                            ...d,
                            marks_as_dentist: e.target.checked,
                          }))
                        }
                      />
                      Dentista
                    </label>
                    <div className="flex gap-2">
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
                  <>
                    <div className="flex items-center gap-2">
                      <Badge color={item.color}>{item.name}</Badge>
                      {item.marks_as_dentist && (
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          Dentista
                        </span>
                      )}
                      {!item.is_active && (
                        <span className="text-xs text-gray-400">(inativa)</span>
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
                        onClick={() => handleToggle(item)}
                        className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                      >
                        {item.is_active ? "Desativar" : "Reativar"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
