"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import type { Lead, ProcedureType, Room, User } from "@/lib/types/database";

interface BookAppointmentModalProps {
  domain: string;
  rooms: Room[];
  procedures: ProcedureType[];
  dentists: Pick<User, "id" | "name" | "is_dentist">[];
  initialStartsAt?: string;
  initialDentistId?: string | null;
  initialLeadId?: string;
  onClose: () => void;
  onCreated?: () => void;
}

function toDatetimeLocal(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addMinutesIso(iso: string, minutes: number) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

export function BookAppointmentModal({
  rooms,
  procedures,
  dentists,
  initialStartsAt,
  initialDentistId,
  initialLeadId,
  onClose,
  onCreated,
}: BookAppointmentModalProps) {
  const { companyId } = useCurrentCompany();
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(initialStartsAt));
  const [duration, setDuration] = useState(30);
  const [dentistId, setDentistId] = useState<string>(initialDentistId ?? "");
  const [roomId, setRoomId] = useState<string>("");
  const [procedureId, setProcedureId] = useState<string>("");
  const [leadId, setLeadId] = useState<string>(initialLeadId ?? "");
  const [notes, setNotes] = useState("");
  const [leadSearch, setLeadSearch] = useState("");
  const [leadOptions, setLeadOptions] = useState<Pick<Lead, "id" | "name">[]>(
    []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    if (initialLeadId) return;
    const supabase = createClient();
    const t = setTimeout(async () => {
      const q = supabase
        .from("leads")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name")
        .limit(25);
      if (leadSearch.trim()) q.ilike("name", `%${leadSearch.trim()}%`);
      const { data } = await q;
      setLeadOptions((data as unknown as Pick<Lead, "id" | "name">[]) ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [companyId, leadSearch, initialLeadId]);

  const selectedProcedure = useMemo(
    () => procedures.find((p) => p.id === procedureId),
    [procedures, procedureId]
  );

  useEffect(() => {
    if (selectedProcedure) {
      setDuration(selectedProcedure.default_duration_minutes);
    }
  }, [selectedProcedure]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!companyId) {
      setError("Aguardando empresa...");
      return;
    }
    if (!leadId) {
      setError("Selecione um paciente.");
      return;
    }
    if (!startsAt) {
      setError("Informe data e hora.");
      return;
    }

    const startsIso = new Date(startsAt).toISOString();
    const endsIso = addMinutesIso(startsIso, duration);

    setSaving(true);
    const supabase = createClient();

    const { data: conflictData, error: conflictErr } = await supabase.rpc(
      "check_appointment_conflict",
      {
        p_dentist_id: dentistId || null,
        p_room_id: roomId || null,
        p_starts_at: startsIso,
        p_ends_at: endsIso,
      }
    );

    if (conflictErr) {
      setError(`Erro ao verificar conflito: ${conflictErr.message}`);
      setSaving(false);
      return;
    }
    if (conflictData === true) {
      setError(
        "Conflito de horário: dentista ou sala já ocupados neste intervalo."
      );
      setSaving(false);
      return;
    }

    const { error: insertErr } = await supabase.from("appointments").insert({
      company_id: companyId,
      lead_id: leadId,
      dentist_id: dentistId || null,
      room_id: roomId || null,
      procedure_type_id: procedureId || null,
      starts_at: startsIso,
      ends_at: endsIso,
      notes: notes.trim() || null,
    });

    if (insertErr) {
      setError(`Erro ao agendar: ${insertErr.message}`);
      setSaving(false);
      return;
    }

    setSaving(false);
    onCreated?.();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Agendar consulta
            </h3>
            <p className="text-xs text-gray-500">
              O sistema bloqueia conflitos de dentista e sala no mesmo horário.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L8.94 10l-5.72 5.72a.75.75 0 1 0 1.06 1.06L10 11.06l5.72 5.72a.75.75 0 1 0 1.06-1.06L11.06 10l5.72-5.72a.75.75 0 0 0-1.06-1.06L10 8.94 4.28 3.22Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {!initialLeadId && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Paciente *
              </label>
              <input
                type="text"
                value={leadSearch}
                onChange={(e) => {
                  setLeadSearch(e.target.value);
                  setLeadId("");
                }}
                placeholder="Buscar paciente..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              {leadOptions.length > 0 && !leadId && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                  {leadOptions.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => {
                        setLeadId(l.id);
                        setLeadSearch(l.name);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-blue-50"
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              )}
              {leadId && (
                <p className="mt-1 text-xs text-gray-500">
                  Selecionado:{" "}
                  <span className="font-medium text-gray-800">{leadSearch}</span>
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Data e hora *
              </label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Duração (min)
              </label>
              <input
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value, 10) || 30)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Dentista
              </label>
              <select
                value={dentistId}
                onChange={(e) => setDentistId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Sem dentista</option>
                {dentists.map((d) => (
                  <option key={d.id} value={d.id}>
                    Dr(a). {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Sala
              </label>
              <select
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Sem sala</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Procedimento
            </label>
            <select
              value={procedureId}
              onChange={(e) => setProcedureId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Nenhum</option>
              {procedures.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.default_duration_minutes}min
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Observações
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Anotações sobre o agendamento..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Agendando..." : "Agendar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
