"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function NewClinicForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");

  const [adminName, setAdminName] = useState("");
  const [adminExtension, setAdminExtension] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAnyAdminField =
    !!(adminName.trim() || adminExtension.trim() || adminPassword);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !domain.trim()) {
      setError("Nome e domínio são obrigatórios.");
      return;
    }

    if (hasAnyAdminField) {
      if (!adminName.trim() || !adminExtension.trim() || !adminPassword) {
        setError(
          "Para criar o admin, preencha nome, ramal e senha — ou deixe os três vazios."
        );
        return;
      }
      if (adminPassword.length < 6) {
        setError("A senha do admin deve ter pelo menos 6 caracteres.");
        return;
      }
    }

    setSaving(true);

    const res = await fetch("/api/wosnicz/create-clinic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        domain: domain.trim().toLowerCase(),
        admin: hasAnyAdminField
          ? {
              name: adminName.trim(),
              extension: adminExtension.trim(),
              password: adminPassword,
            }
          : undefined,
      }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "Erro ao criar clínica.");
      setSaving(false);
      return;
    }

    const created = (await res.json()) as { id: string };
    router.push(`/wosnicz/clinicas/${created.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Dados da clínica
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">Campos obrigatórios</p>
        </div>

        <Input
          label="Nome da clínica *"
          placeholder="Ex: Clínica Sorriso"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        <div>
          <Input
            label="Domínio *"
            placeholder="Ex: clinica-sorriso"
            value={domain}
            onChange={(e) => setDomain(e.target.value.toLowerCase())}
          />
          <p className="mt-1.5 text-xs text-gray-500">
            Será usado na URL de login:{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
              /{domain || "dominio"}
            </code>
            . Use apenas letras minúsculas, números e hífens.
          </p>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Primeiro admin (opcional)
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Preencha para já criar um admin. Se deixar em branco, a clínica
            ficará sem usuários (você poderá cadastrar depois).
          </p>
        </div>

        <Input
          label="Nome do admin"
          placeholder="Ex: Maria Silva"
          value={adminName}
          onChange={(e) => setAdminName(e.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Ramal"
            placeholder="Ex: 1001"
            value={adminExtension}
            onChange={(e) => setAdminExtension(e.target.value)}
          />
          <Input
            label="Senha"
            type="password"
            placeholder="Mínimo 6 caracteres"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push("/wosnicz/dashboard")}
          className="rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Cancelar
        </button>
        <Button type="submit" loading={saving} size="lg">
          Criar clínica
        </Button>
      </div>
    </form>
  );
}
