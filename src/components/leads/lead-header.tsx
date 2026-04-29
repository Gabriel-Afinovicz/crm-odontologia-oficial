"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { ProcedureType, Room, User } from "@/lib/types/database";
import { AppointmentModal } from "@/components/agenda/appointment-modal";
import { useCurrentCompany } from "@/hooks/use-current-company";

interface LeadHeaderProps {
  leadId: string;
  leadName: string;
  domain: string;
}

/**
 * Cabeçalho do detalhe do lead. O status agora é gerido exclusivamente
 * pelas etapas dinâmicas do kanban (sem dropdown legado de
 * Novo/Agendado/.../Perdido).
 */
export function LeadHeader({ leadId, leadName, domain }: LeadHeaderProps) {
  const router = useRouter();
  const { companyId } = useCurrentCompany();
  const [showBook, setShowBook] = useState(false);
  const [agendaResources, setAgendaResources] = useState<{
    rooms: Room[];
    procedures: ProcedureType[];
    dentists: Pick<User, "id" | "name" | "is_dentist">[];
  }>({ rooms: [], procedures: [], dentists: [] });

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const [r, p, u] = await Promise.all([
        supabase
          .from("rooms")
          .select("*")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("procedure_types")
          .select("*")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("users")
          .select("id, name, is_dentist")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .eq("is_dentist", true)
          .neq("role", "super_admin")
          .order("name"),
      ]);
      if (cancelled) return;
      setAgendaResources({
        rooms: (r.data as unknown as Room[]) ?? [],
        procedures: (p.data as unknown as ProcedureType[]) ?? [],
        dentists:
          (u.data as unknown as Pick<User, "id" | "name" | "is_dentist">[]) ??
          [],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <Link
          href={`/${domain}/leads`}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{leadName}</h1>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowBook(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
          </svg>
          Agendar
        </button>
        <Link
          href={`/${domain}/leads/${leadId}/edit`}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
          </svg>
          Editar
        </Link>
      </div>

      {showBook && (
        <AppointmentModal
          mode="create"
          rooms={agendaResources.rooms}
          procedures={agendaResources.procedures}
          dentists={agendaResources.dentists}
          prefill={{ leadId }}
          onClose={() => setShowBook(false)}
          onSaved={() => {
            setShowBook(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
