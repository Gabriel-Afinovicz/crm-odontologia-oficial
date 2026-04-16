"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { LeadSource } from "@/lib/types/database";

export function SourcesManager() {
  const { profile } = useAuth();
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [operatingId, setOperatingId] = useState<string | null>(null);

  async function fetchSources() {
    const supabase = createClient();
    const { data } = await supabase.from("lead_sources").select("*").order("name");
    if (data) setSources(data as unknown as LeadSource[]);
    setLoading(false);
  }

  useEffect(() => {
    fetchSources();
  }, []);

  async function handleCreate() {
    if (!newName.trim() || !profile?.company_id) return;
    setError(null);
    setSaving(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("lead_sources").insert({
      name: newName.trim(),
      company_id: profile.company_id,
    });
    if (insertError) {
      setError(`Erro ao criar fonte: ${insertError.message}`);
      setSaving(false);
      return;
    }
    setNewName("");
    setSaving(false);
    await fetchSources();
  }

  async function handleUpdate(id: string) {
    if (!editName.trim()) return;
    setError(null);
    setOperatingId(id);
    const supabase = createClient();
    const { error: updateError } = await supabase.from("lead_sources").update({ name: editName.trim() }).eq("id", id);
    if (updateError) {
      setError(`Erro ao atualizar: ${updateError.message}`);
      setOperatingId(null);
      return;
    }
    setEditingId(null);
    setOperatingId(null);
    await fetchSources();
  }

  async function handleToggleActive(id: string, currentActive: boolean) {
    setError(null);
    setOperatingId(id);
    const supabase = createClient();
    const { error: updateError } = await supabase.from("lead_sources").update({ is_active: !currentActive }).eq("id", id);
    if (updateError) {
      setError(`Erro ao atualizar: ${updateError.message}`);
    }
    setOperatingId(null);
    await fetchSources();
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

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Nova Fonte</h3>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Nome da fonte (ex: Instagram, Indicação...)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
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
            ) : "Criar"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {sources.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            Nenhuma fonte de lead criada ainda.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sources.map((source) => (
              <div key={source.id} className={`flex items-center justify-between px-5 py-3 transition-opacity ${operatingId === source.id ? "opacity-50" : ""}`}>
                {editingId === source.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && handleUpdate(source.id)}
                    />
                    <button onClick={() => handleUpdate(source.id)} className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">Salvar</button>
                    <button onClick={() => setEditingId(null)} className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">Cancelar</button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-medium ${source.is_active ? "text-gray-900" : "text-gray-400 line-through"}`}>
                        {source.name}
                      </span>
                      {!source.is_active && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Inativa</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setEditingId(source.id); setEditName(source.name); }} className="rounded px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700">Editar</button>
                      <button
                        onClick={() => handleToggleActive(source.id, source.is_active)}
                        className={`rounded px-2 py-1 text-xs transition-colors ${source.is_active ? "text-yellow-600 hover:bg-yellow-50" : "text-green-600 hover:bg-green-50"}`}
                      >
                        {source.is_active ? "Desativar" : "Ativar"}
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
