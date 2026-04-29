"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import type { MessageTemplate, MessageTemplateKind } from "@/lib/types/database";

const KIND_LABEL: Record<MessageTemplateKind, string> = {
  confirmation: "Confirmação",
  reminder: "Lembrete",
  post_visit: "Pós-consulta",
  birthday: "Aniversário",
  custom: "Outro",
};

const PLACEHOLDERS = [
  "{{paciente}}",
  "{{dentista}}",
  "{{data}}",
  "{{clinica}}",
  "{{link}}",
];

interface DraftState {
  kind: MessageTemplateKind;
  name: string;
  body: string;
}

const EMPTY_DRAFT: DraftState = {
  kind: "reminder",
  name: "",
  body: "",
};

export function MessageTemplatesManager() {
  const { companyId, loading: companyLoading } = useCurrentCompany();
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftState>(EMPTY_DRAFT);

  async function fetchAll() {
    if (!companyId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("message_templates")
      .select("*")
      .eq("company_id", companyId)
      .order("kind")
      .order("name");
    if (data) setItems(data as unknown as MessageTemplate[]);
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
    if (!draft.name.trim() || !draft.body.trim() || !companyId) return;
    setError(null);
    setSaving(true);
    const supabase = createClient();
    const { error: e } = await supabase.from("message_templates").insert({
      company_id: companyId,
      kind: draft.kind,
      name: draft.name.trim(),
      body: draft.body,
    });
    setSaving(false);
    if (e) {
      setError(`Erro ao criar: ${e.message}`);
      return;
    }
    setDraft(EMPTY_DRAFT);
    await fetchAll();
  }

  async function handleUpdate(id: string) {
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase
      .from("message_templates")
      .update({
        kind: editDraft.kind,
        name: editDraft.name.trim(),
        body: editDraft.body,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (e) {
      setError(`Erro ao salvar: ${e.message}`);
      return;
    }
    setEditingId(null);
    await fetchAll();
  }

  async function handleToggle(item: MessageTemplate) {
    const supabase = createClient();
    const { error: e } = await supabase
      .from("message_templates")
      .update({ is_active: !item.is_active })
      .eq("id", item.id);
    if (e) setError(`Erro: ${e.message}`);
    await fetchAll();
  }

  function startEdit(item: MessageTemplate) {
    setEditingId(item.id);
    setEditDraft({ kind: item.kind, name: item.name, body: item.body });
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />
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
          Novo template
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <select
            value={draft.kind}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                kind: e.target.value as MessageTemplateKind,
              }))
            }
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {(Object.keys(KIND_LABEL) as MessageTemplateKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Nome do template"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-2"
          />
        </div>
        <textarea
          rows={4}
          placeholder="Olá {{paciente}}, podemos confirmar sua consulta em {{data}} com {{dentista}}? Confirme em: {{link}}"
          value={draft.body}
          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
          <span>Variáveis:</span>
          {PLACEHOLDERS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() =>
                setDraft((d) => ({ ...d, body: `${d.body}${p}` }))
              }
              className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700 hover:bg-gray-200"
            >
              {p}
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !draft.name.trim() || !draft.body.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Criando..." : "Criar template"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {items.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            Nenhum template cadastrado.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => (
              <div
                key={item.id}
                className={`px-5 py-3 ${!item.is_active ? "bg-gray-50/60" : ""}`}
              >
                {editingId === item.id ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <select
                        value={editDraft.kind}
                        onChange={(e) =>
                          setEditDraft((d) => ({
                            ...d,
                            kind: e.target.value as MessageTemplateKind,
                          }))
                        }
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                      >
                        {(Object.keys(KIND_LABEL) as MessageTemplateKind[]).map(
                          (k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k]}
                            </option>
                          )
                        )}
                      </select>
                      <input
                        type="text"
                        value={editDraft.name}
                        onChange={(e) =>
                          setEditDraft((d) => ({ ...d, name: e.target.value }))
                        }
                        className="rounded border border-gray-300 px-2 py-1 text-sm sm:col-span-2"
                      />
                    </div>
                    <textarea
                      rows={3}
                      value={editDraft.body}
                      onChange={(e) =>
                        setEditDraft((d) => ({ ...d, body: e.target.value }))
                      }
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-600"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => handleUpdate(item.id)}
                        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white"
                      >
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {item.name}
                          <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                            {KIND_LABEL[item.kind]}
                          </span>
                          {!item.is_active && (
                            <span className="ml-2 text-xs text-gray-400">
                              (inativo)
                            </span>
                          )}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                          {item.body}
                        </p>
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
