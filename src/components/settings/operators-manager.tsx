"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { User } from "@/lib/types/database";

export function OperatorsManager() {
  const params = useParams<{ domain?: string }>();
  const domain = params?.domain;
  const { companyId, loading: companyLoading } = useCurrentCompany();
  const { profile } = useAuth();

  const [operators, setOperators] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [extension, setExtension] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  async function fetchOperators() {
    if (!companyId) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("company_id", companyId)
      .eq("role", "operator")
      .order("name");

    if (error) {
      setListError(error.message);
      setLoading(false);
      return;
    }

    setListError(null);
    setOperators((data ?? []) as unknown as User[]);
    setLoading(false);
  }

  useEffect(() => {
    if (companyLoading) return;
    if (!companyId) {
      setOperators([]);
      setLoading(false);
      return;
    }
    fetchOperators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyLoading, companyId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);

    if (!domain) {
      setCreateError("Domínio da clínica não encontrado.");
      return;
    }
    if (!name.trim() || !extension.trim() || !password) {
      setCreateError("Preencha nome, ramal e senha.");
      return;
    }
    if (!/^[0-9]+$/.test(extension.trim())) {
      setCreateError("Ramal inválido. Use apenas números.");
      return;
    }
    if (password.length < 6) {
      setCreateError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/operators/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain,
        name: name.trim(),
        extension: extension.trim(),
        password,
      }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setCreateError(payload.error ?? "Erro ao criar operador.");
      setSaving(false);
      return;
    }

    setName("");
    setExtension("");
    setPassword("");
    setSaving(false);
    await fetchOperators();
  }

  async function toggleIsDentist(op: User) {
    if (!companyId) return;
    setTogglingId(op.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("users")
      .update({ is_dentist: !op.is_dentist })
      .eq("id", op.id);
    setTogglingId(null);
    if (error) {
      setListError(error.message);
      return;
    }
    setOperators((prev) =>
      prev.map((u) =>
        u.id === op.id ? { ...u, is_dentist: !op.is_dentist } : u
      )
    );
  }

  async function handleDelete(userId: string, displayName: string) {
    if (!domain) return;
    const confirmed = window.confirm(
      `Excluir o operador "${displayName}"? Esta ação não pode ser desfeita.`
    );
    if (!confirmed) return;

    setDeletingId(userId);
    const res = await fetch("/api/operators/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, userId }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setListError(payload.error ?? "Erro ao excluir operador.");
      setDeletingId(null);
      return;
    }

    setDeletingId(null);
    await fetchOperators();
  }

  const canRender = !companyLoading && companyId;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Novo operador</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          O login é feito com o ramal e a senha definidos aqui.
        </p>

        <form onSubmit={handleCreate} className="mt-4 space-y-4">
          {createError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {createError}
            </div>
          )}

          <Input
            label="Nome *"
            placeholder="Ex: João Silva"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Ramal *"
              placeholder="Ex: 1002"
              value={extension}
              onChange={(e) => setExtension(e.target.value)}
              inputMode="numeric"
            />
            <Input
              label="Senha *"
              type="password"
              placeholder="Mínimo 6 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Criar operador
            </Button>
          </div>
        </form>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            Operadores cadastrados
          </h2>
          <span className="text-xs text-gray-400">
            {operators.length} {operators.length === 1 ? "operador" : "operadores"}
          </span>
        </div>

        {listError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {listError}
          </div>
        )}

        {!canRender || loading ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            Carregando…
          </div>
        ) : operators.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            Nenhum operador cadastrado ainda.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Nome
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Ramal
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Dentista
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {operators.map((op) => {
                  const isSelf = profile?.id === op.id;
                  const isDeleting = deletingId === op.id;
                  return (
                    <tr key={op.id}>
                      <td className="px-5 py-3">
                        <p className="text-sm font-medium text-gray-900">
                          {op.name}
                        </p>
                        <p className="text-xs text-gray-400">{op.email}</p>
                      </td>
                      <td className="px-5 py-3">
                        <code className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                          {op.extension_number}
                        </code>
                      </td>
                      <td className="px-5 py-3">
                        <button
                          type="button"
                          onClick={() => toggleIsDentist(op)}
                          disabled={togglingId === op.id}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                            op.is_dentist
                              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              op.is_dentist ? "bg-emerald-500" : "bg-gray-400"
                            }`}
                          />
                          {op.is_dentist ? "Sim" : "Não"}
                        </button>
                      </td>
                      <td className="px-5 py-3">
                        {op.is_active ? (
                          <span className="text-xs text-green-700">Ativo</span>
                        ) : (
                          <span className="text-xs text-gray-400">Inativo</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isSelf}
                          loading={isDeleting}
                          onClick={() => handleDelete(op.id, op.name)}
                        >
                          Excluir
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
