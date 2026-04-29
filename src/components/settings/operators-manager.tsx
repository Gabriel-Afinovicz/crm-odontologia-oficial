"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { User, UserRoleTag } from "@/lib/types/database";

interface UserWithTags extends User {
  tagIds: string[];
}

export function OperatorsManager() {
  const params = useParams<{ domain?: string }>();
  const domain = params?.domain;
  const { companyId, loading: companyLoading } = useCurrentCompany();
  const { profile } = useAuth();

  const [users, setUsers] = useState<UserWithTags[]>([]);
  const [tags, setTags] = useState<UserRoleTag[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [extension, setExtension] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"operator" | "admin">("operator");
  const [createTagIds, setCreateTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingTagsForId, setSavingTagsForId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  async function fetchAll() {
    if (!companyId) return;
    const supabase = createClient();
    const [usersRes, tagsRes, assignmentsRes] = await Promise.all([
      supabase
        .from("users")
        .select("*")
        .eq("company_id", companyId)
        .in("role", ["operator", "admin"])
        .order("name"),
      supabase
        .from("user_role_tags")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("user_role_tag_assignments")
        .select("user_id, tag_id"),
    ]);

    if (usersRes.error) {
      setListError(usersRes.error.message);
      setLoading(false);
      return;
    }

    const tagsByUser = new Map<string, string[]>();
    for (const a of (assignmentsRes.data as
      | { user_id: string; tag_id: string }[]
      | null) ?? []) {
      const arr = tagsByUser.get(a.user_id) ?? [];
      arr.push(a.tag_id);
      tagsByUser.set(a.user_id, arr);
    }

    setListError(null);
    setUsers(
      ((usersRes.data ?? []) as unknown as User[]).map((u) => ({
        ...u,
        tagIds: tagsByUser.get(u.id) ?? [],
      }))
    );
    setTags((tagsRes.data as unknown as UserRoleTag[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (companyLoading) return;
    if (!companyId) {
      setUsers([]);
      setTags([]);
      setLoading(false);
      return;
    }
    fetchAll();
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
        role,
        tagIds: createTagIds,
      }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setCreateError(payload.error ?? "Erro ao criar usuário.");
      setSaving(false);
      return;
    }

    setName("");
    setExtension("");
    setPassword("");
    setRole("operator");
    setCreateTagIds([]);
    setSaving(false);
    await fetchAll();
  }

  async function toggleTag(user: UserWithTags, tagId: string) {
    if (!companyId) return;
    const has = user.tagIds.includes(tagId);
    setSavingTagsForId(user.id);
    const supabase = createClient();
    const { error } = has
      ? await supabase
          .from("user_role_tag_assignments")
          .delete()
          .eq("user_id", user.id)
          .eq("tag_id", tagId)
      : await supabase
          .from("user_role_tag_assignments")
          .insert({ user_id: user.id, tag_id: tagId });
    setSavingTagsForId(null);
    if (error) {
      setListError(error.message);
      return;
    }
    setUsers((prev) =>
      prev.map((u) =>
        u.id === user.id
          ? {
              ...u,
              tagIds: has
                ? u.tagIds.filter((t) => t !== tagId)
                : [...u.tagIds, tagId],
            }
          : u
      )
    );
  }

  async function handleDelete(userId: string, displayName: string) {
    if (!domain) return;
    const confirmed = window.confirm(
      `Excluir o usuário "${displayName}"? Esta ação não pode ser desfeita.`
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
      setListError(payload.error ?? "Erro ao excluir usuário.");
      setDeletingId(null);
      return;
    }

    setDeletingId(null);
    await fetchAll();
  }

  const canRender = !companyLoading && companyId;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Novo membro</h2>
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

          <div className="grid gap-4 sm:grid-cols-3">
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
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Permissão *
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "operator" | "admin")}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="operator">Operador</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Funções
            </label>
            {tags.length === 0 ? (
              <p className="text-xs text-gray-500">
                Nenhuma função cadastrada. Crie em &quot;Funções&quot;.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const active = createTagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        setCreateTagIds((prev) =>
                          prev.includes(t.id)
                            ? prev.filter((x) => x !== t.id)
                            : [...prev, t.id]
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                        active
                          ? "border-transparent text-white"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                      style={
                        active
                          ? { backgroundColor: t.color, borderColor: t.color }
                          : undefined
                      }
                    >
                      {t.name}
                      {t.marks_as_dentist && " · dentista"}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Criar
            </Button>
          </div>
        </form>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            Membros da equipe
          </h2>
          <span className="text-xs text-gray-400">
            {users.length}{" "}
            {users.length === 1 ? "membro" : "membros"}
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
        ) : users.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            Nenhum membro cadastrado ainda.
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
                    Permissão
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Funções
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
                {users.map((u) => {
                  const isSelf = profile?.id === u.id;
                  const isDeleting = deletingId === u.id;
                  return (
                    <tr key={u.id}>
                      <td className="px-5 py-3">
                        <p className="text-sm font-medium text-gray-900">
                          {u.name}
                        </p>
                        <p className="text-xs text-gray-400">{u.email}</p>
                      </td>
                      <td className="px-5 py-3">
                        <code className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                          {u.extension_number}
                        </code>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.role === "admin"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {u.role === "admin" ? "Admin" : "Operador"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {tags.length === 0 ? (
                            <span className="text-xs text-gray-400">—</span>
                          ) : (
                            tags.map((t) => {
                              const active = u.tagIds.includes(t.id);
                              return (
                                <button
                                  key={t.id}
                                  type="button"
                                  disabled={savingTagsForId === u.id}
                                  onClick={() => toggleTag(u, t.id)}
                                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                                    active
                                      ? "border-transparent text-white"
                                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                                  }`}
                                  style={
                                    active
                                      ? {
                                          backgroundColor: t.color,
                                          borderColor: t.color,
                                        }
                                      : undefined
                                  }
                                >
                                  {t.name}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        {u.is_active ? (
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
                          onClick={() => handleDelete(u.id, u.name)}
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
