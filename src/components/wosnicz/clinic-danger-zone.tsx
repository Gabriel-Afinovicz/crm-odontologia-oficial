"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ClinicDangerZoneProps {
  clinicId: string;
  clinicName: string;
  clinicDomain: string;
  isActive: boolean;
}

export function ClinicDangerZone({
  clinicId,
  clinicName,
  clinicDomain,
  isActive,
}: ClinicDangerZoneProps) {
  const router = useRouter();
  const [toggling, setToggling] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    setError(null);
    setToggling(true);
    const res = await fetch("/api/wosnicz/toggle-clinic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicId, isActive: !isActive }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "Erro ao alterar status.");
      setToggling(false);
      return;
    }
    setToggling(false);
    router.refresh();
  }

  async function handleDelete() {
    if (confirmText !== clinicDomain) return;
    setError(null);
    setDeleting(true);
    const res = await fetch("/api/wosnicz/delete-clinic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicId, confirmDomain: confirmText }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "Erro ao excluir clínica.");
      setDeleting(false);
      return;
    }
    router.push("/wosnicz/dashboard");
    router.refresh();
  }

  const canDelete = confirmText === clinicDomain && !deleting;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/40 p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-red-800">Zona de perigo</h2>
      <p className="mt-1 text-xs text-red-700/80">
        Ações destrutivas que afetam toda a clínica.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-100 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mt-5 space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-white p-4">
          <div>
            <p className="text-sm font-medium text-gray-900">
              {isActive ? "Desativar clínica" : "Ativar clínica"}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {isActive
                ? "Usuários não conseguirão logar nesta clínica, mas os dados ficam preservados."
                : "A clínica volta a aceitar logins normalmente."}
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              isActive
                ? "border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                : "border border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
            }`}
          >
            {toggling ? "..." : isActive ? "Desativar" : "Ativar"}
          </button>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-red-300 bg-white p-4">
          <div>
            <p className="text-sm font-medium text-gray-900">
              Excluir permanentemente
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              Apaga a clínica e TODOS os dados associados (usuários, leads,
              tags, atividades). Ação irreversível.
            </p>
          </div>
          <button
            onClick={() => {
              setDeleteModalOpen(true);
              setConfirmText("");
            }}
            className="shrink-0 rounded-lg border border-red-300 bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            Excluir
          </button>
        </div>
      </div>

      {deleteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteModalOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900">
              Excluir permanentemente
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Esta ação vai excluir a clínica{" "}
              <strong>{clinicName}</strong> e{" "}
              <strong>todos os dados</strong> associados (usuários, leads, tags,
              atividades, campos personalizados). Não é possível desfazer.
            </p>

            <div className="mt-5">
              <label className="block text-sm text-gray-700">
                Para confirmar, digite o domínio:{" "}
                <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                  {clinicDomain}
                </code>
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                placeholder={clinicDomain}
                autoFocus
              />
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteModalOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={!canDelete}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Excluindo..." : "Excluir permanentemente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
