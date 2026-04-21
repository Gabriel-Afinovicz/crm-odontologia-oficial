"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type {
  LeadStatus,
  ProcedureType,
  Room,
  User,
} from "@/lib/types/database";
import { StatusBadge } from "@/components/ui/badge";
import { BookAppointmentModal } from "@/components/agenda/book-appointment-modal";
import { useCurrentCompany } from "@/hooks/use-current-company";

const STATUSES: { value: LeadStatus; label: string }[] = [
  { value: "novo", label: "Novo" },
  { value: "agendado", label: "Agendado" },
  { value: "atendido", label: "Atendido" },
  { value: "finalizado", label: "Finalizado" },
  { value: "perdido", label: "Perdido" },
];

interface LeadHeaderProps {
  leadId: string;
  leadName: string;
  status: LeadStatus;
  domain: string;
}

export function LeadHeader({ leadId, leadName, status, domain }: LeadHeaderProps) {
  const router = useRouter();
  const { companyId } = useCurrentCompany();
  const [currentStatus, setCurrentStatus] = useState(status);
  const [changing, setChanging] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showBook, setShowBook] = useState(false);
  const [agendaResources, setAgendaResources] = useState<{
    rooms: Room[];
    procedures: ProcedureType[];
    dentists: Pick<User, "id" | "name" | "is_dentist">[];
  }>({ rooms: [], procedures: [], dentists: [] });

  useEffect(() => {
    if (!companyId || !showBook) return;
    if (agendaResources.rooms.length > 0) return;
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
          .order("name"),
      ]);
      setAgendaResources({
        rooms: (r.data as unknown as Room[]) ?? [],
        procedures: (p.data as unknown as ProcedureType[]) ?? [],
        dentists:
          (u.data as unknown as Pick<User, "id" | "name" | "is_dentist">[]) ??
          [],
      });
    })();
  }, [companyId, showBook, agendaResources.rooms.length]);

  async function handleStatusChange(newStatus: LeadStatus) {
    if (newStatus === currentStatus) {
      setShowDropdown(false);
      return;
    }

    setChanging(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("leads")
      .update({ status: newStatus })
      .eq("id", leadId);

    if (!error) {
      setCurrentStatus(newStatus);
    }
    setChanging(false);
    setShowDropdown(false);
    router.refresh();
  }

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
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{leadName}</h1>
          <div className="mt-1 flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                disabled={changing}
                className="flex items-center gap-1 transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                <StatusBadge status={currentStatus} />
                <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {showDropdown && (
                <div className="absolute left-0 top-full z-10 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {STATUSES.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => handleStatusChange(s.value)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-gray-50
                        ${s.value === currentStatus ? "font-medium text-blue-600" : "text-gray-700"}`}
                    >
                      <StatusBadge status={s.value} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
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
        <BookAppointmentModal
          domain={domain}
          rooms={agendaResources.rooms}
          procedures={agendaResources.procedures}
          dentists={agendaResources.dentists}
          initialLeadId={leadId}
          onClose={() => setShowBook(false)}
          onCreated={() => {
            setShowBook(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
