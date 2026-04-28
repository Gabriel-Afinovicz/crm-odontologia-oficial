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

  const [toggleModalOpen, setToggleModalOpen] = useState(false);
  const [toggleExtension, setToggleExtension] = useState("");
  const [togglePassword, setTogglePassword] = useState("");
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleteExtension, setDeleteExtension] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openToggleModal() {
    setToggleExtension("");
    setTogglePassword("");
    setToggleError(null);
    setToggleModalOpen(true);
  }

  function openDeleteModal() {
    setConfirmText("");
    setDeleteExtension("");
    setDeletePassword("");
    setDeleteError(null);
    setDeleteModalOpen(true);
  }

  async function handleToggle() {
    if (!toggleExtension.trim() || !togglePassword) {
      setToggleError("Informe seu ramal e senha para confirmar.");
      return;
    }
    setToggleError(null);
    setToggling(true);
    const res = await fetch("/api/wosnicz/toggle-clinic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinicId,
        isActive: !isActive,
        extensionNumber: toggleExtension.trim(),
        password: togglePassword,
      }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setToggleError(payload.error ?? "Erro ao alterar status.");
      setToggling(false);
      return;
    }
    setToggling(false);
    setToggleModalOpen(false);
    router.refresh();
  }

  async function handleDelete() {
    if (confirmText !== clinicDomain) {
      setDeleteError("Confirmação de domínio inválida.");
      return;
    }
    if (!deleteExtension.trim() || !deletePassword) {
      setDeleteError("Informe seu ramal e senha para confirmar.");
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    const res = await fetch("/api/wosnicz/delete-clinic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinicId,
        confirmDomain: confirmText,
        extensionNumber: deleteExtension.trim(),
        password: deletePassword,
      }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setDeleteError(payload.error ?? "Erro ao excluir clínica.");
      setDeleting(false);
      return;
    }
    router.push("/wosnicz/dashboard");
    router.refresh();
  }

  const canToggle =
    !!toggleExtension.trim() && !!togglePassword && !toggling;
  const canDelete =
    confirmText === clinicDomain &&
    !!deleteExtension.trim() &&
    !!deletePassword &&
    !deleting;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/40 p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-red-800">Zona de perigo</h2>
      <p className="mt-1 text-xs text-red-700/80">
        Ações destrutivas que afetam toda a clínica.
      </p>

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
            onClick={openToggleModal}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                : "border border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
            }`}
          >
            {isActive ? "Desativar" : "Ativar"}
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
            onClick={openDeleteModal}
            className="shrink-0 rounded-lg border border-red-300 bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            Excluir
          </button>
        </div>
      </div>

      {toggleModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !toggling) {
              setToggleModalOpen(false);
            }
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900">
              {isActive ? "Desativar clínica" : "Ativar clínica"}
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Você está prestes a {isActive ? "desativar" : "reativar"}{" "}
              <strong>{clinicName}</strong>. Confirme com seu ramal e senha de
              super admin para prosseguir.
            </p>

            <div className="mt-5 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Ramal do super admin
                </label>
                <input
                  type="text"
                  value={toggleExtension}
                  onChange={(e) => setToggleExtension(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Ex: 1001"
                  autoComplete="username"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Senha
                </label>
                <input
                  type="password"
                  value={togglePassword}
                  onChange={(e) => setTogglePassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="••••••"
                  autoComplete="current-password"
                />
              </div>
            </div>

            {toggleError && (
              <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {toggleError}
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setToggleModalOpen(false)}
                disabled={toggling}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleToggle}
                disabled={!canToggle}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isActive
                    ? "bg-yellow-600 hover:bg-yellow-700"
                    : "bg-green-600 hover:bg-green-700"
                }`}
              >
                {toggling
                  ? "Confirmando..."
                  : isActive
                    ? "Desativar clínica"
                    : "Ativar clínica"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleting) {
              setDeleteModalOpen(false);
            }
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900">
              Excluir permanentemente
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Esta ação vai excluir a clínica <strong>{clinicName}</strong> e{" "}
              <strong>todos os dados</strong> associados (usuários, leads, tags,
              atividades, campos personalizados). Não é possível desfazer.
            </p>

            <div className="mt-5 space-y-3">
              <div>
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
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                  placeholder={clinicDomain}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Ramal do super admin
                </label>
                <input
                  type="text"
                  value={deleteExtension}
                  onChange={(e) => setDeleteExtension(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                  placeholder="Ex: 1001"
                  autoComplete="username"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Senha
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                  placeholder="••••••"
                  autoComplete="current-password"
                />
              </div>
            </div>

            {deleteError && (
              <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {deleteError}
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleting}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
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
