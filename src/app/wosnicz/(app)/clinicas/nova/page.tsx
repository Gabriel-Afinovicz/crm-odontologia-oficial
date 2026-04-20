import Link from "next/link";
import { NewClinicForm } from "@/components/wosnicz/new-clinic-form";

export default function NovaClinicaPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/wosnicz/dashboard"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5 8.25 12l7.5-7.5"
            />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nova Clínica</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Cadastre uma nova clínica na plataforma
          </p>
        </div>
      </div>

      <NewClinicForm />
    </div>
  );
}
