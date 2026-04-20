"use client";

import Link from "next/link";
import type { ClinicSummary } from "@/app/wosnicz/(app)/dashboard/page";

interface ClinicsTableProps {
  clinics: ClinicSummary[];
}

export function ClinicsTable({ clinics }: ClinicsTableProps) {
  const realClinics = clinics.filter((c) => c.domain !== "wosnicz");

  if (realClinics.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <p className="text-gray-500">Nenhuma clínica cadastrada ainda.</p>
        <Link
          href="/wosnicz/clinicas/nova"
          className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Cadastrar primeira clínica
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <Th>Clínica</Th>
            <Th>Domínio</Th>
            <Th>Usuários</Th>
            <Th>Leads</Th>
            <Th>Status</Th>
            <Th className="text-right">Ações</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {realClinics.map((clinic) => (
            <tr key={clinic.id} className="transition-colors hover:bg-gray-50">
              <td className="px-5 py-3">
                <p className="text-sm font-medium text-gray-900">{clinic.name}</p>
                {clinic.createdAt && (
                  <p className="text-xs text-gray-400">
                    Criada em{" "}
                    {new Date(clinic.createdAt).toLocaleDateString("pt-BR")}
                  </p>
                )}
              </td>
              <td className="px-5 py-3">
                <code className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                  /{clinic.domain}
                </code>
              </td>
              <td className="px-5 py-3 text-sm text-gray-700">
                {clinic.usersCount}
              </td>
              <td className="px-5 py-3 text-sm text-gray-700">
                {clinic.leadsCount}
              </td>
              <td className="px-5 py-3">
                {clinic.isActive ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    Ativa
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                    Inativa
                  </span>
                )}
              </td>
              <td className="px-5 py-3 text-right">
                <div className="inline-flex items-center gap-2">
                  <Link
                    href={`/${clinic.domain}/dashboard`}
                    className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Entrar
                  </Link>
                  <Link
                    href={`/wosnicz/clinicas/${clinic.id}`}
                    className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-slate-800"
                  >
                    Detalhes
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 ${className}`}
    >
      {children}
    </th>
  );
}
