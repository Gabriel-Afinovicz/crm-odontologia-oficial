"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type {
  AgendaBlock,
  AppointmentDetailed,
  ClinicHoliday,
  ClinicHours,
  MessageTemplate,
  ProcedureType,
  Room,
  User,
} from "@/lib/types/database";
import { AppointmentModal } from "@/components/agenda/appointment-modal";
import { AppointmentActions } from "@/components/agenda/appointment-actions";
import {
  AgendaGrid,
  type AgendaDropTarget,
  type PendingSlot,
  type ResourceAxis,
} from "@/components/agenda/agenda-grid";
import { AgendaMonth } from "@/components/agenda/agenda-month";

type ViewMode = "day" | "week" | "month";

interface AgendaContentProps {
  domain: string;
  viewMode: ViewMode;
  resourceAxis: ResourceAxis;
  selectedDate: string;
  rangeStart: string;
  rangeEnd: string;
  appointments: AppointmentDetailed[];
  monthCounts: { starts_at: string; status: string }[];
  blocks: AgendaBlock[];
  holidays: ClinicHoliday[];
  rooms: Room[];
  procedures: ProcedureType[];
  dentists: Pick<User, "id" | "name" | "is_dentist">[];
  clinicHours: ClinicHours[];
  templates: MessageTemplate[];
}

const DEFAULT_HOUR_START = 8;
const DEFAULT_HOUR_END = 19;

function fmtDay(d: Date) {
  return d.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}
function fmtTitle(d: Date) {
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
function fmtMonthTitle(d: Date) {
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}
function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function toDateInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseDateInput(s: string): Date {
  const parts = s.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return new Date();
  const [y, m, d] = parts;
  return new Date(y, m - 1, d);
}
function toLocalIso(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function AgendaContent({
  domain,
  viewMode,
  resourceAxis,
  selectedDate,
  rangeStart,
  rangeEnd,
  appointments,
  monthCounts,
  blocks,
  holidays,
  rooms,
  procedures,
  dentists,
  clinicHours,
  templates,
}: AgendaContentProps) {
  const router = useRouter();
  const params = useSearchParams();

  type Prefill = {
    startsAt?: string;
    endsAt?: string;
    dentistId?: string | null;
    roomId?: string | null;
    procedureId?: string | null;
    leadId?: string;
    notes?: string;
  };

  const [creatingPrefill, setCreatingPrefill] = useState<Prefill | null>(null);
  const [pendingSlot, setPendingSlot] = useState<PendingSlot | null>(null);
  const [editing, setEditing] = useState<AppointmentDetailed | null>(null);
  const [acting, setActing] = useState<AppointmentDetailed | null>(null);
  const [noShowLeadIds, setNoShowLeadIds] = useState<Set<string>>(new Set());
  const [moveError, setMoveError] = useState<string | null>(null);

  const dateObj = useMemo(() => new Date(selectedDate), [selectedDate]);
  const startObj = useMemo(() => new Date(rangeStart), [rangeStart]);
  const endObj = useMemo(() => new Date(rangeEnd), [rangeEnd]);

  const days = useMemo(() => {
    const list: Date[] = [];
    if (viewMode === "day") {
      list.push(startObj);
      return list;
    }
    if (viewMode === "week") {
      for (let i = 0; i < 7; i++) list.push(addDays(startObj, i));
      return list;
    }
    return list;
  }, [viewMode, startObj]);

  const hoursByWeekday = useMemo(() => {
    const m = new Map<number, ClinicHours>();
    for (const h of clinicHours) m.set(h.weekday, h);
    return m;
  }, [clinicHours]);

  const gridDays = useMemo(
    () =>
      days.map((d) => ({
        date: d,
        hours: hoursByWeekday.get(d.getDay()),
      })),
    [days, hoursByWeekday]
  );

  const { hourBoundsStart, hourBoundsEnd } = useMemo(() => {
    let earliest = DEFAULT_HOUR_START * 60;
    let latest = DEFAULT_HOUR_END * 60;
    for (const h of clinicHours) {
      if (!h.is_open) continue;
      earliest = Math.min(earliest, timeToMinutes(h.opens_at));
      latest = Math.max(latest, timeToMinutes(h.closes_at));
    }
    for (const a of appointments) {
      const s = new Date(a.starts_at);
      const e = new Date(a.ends_at);
      earliest = Math.min(earliest, s.getHours() * 60 + s.getMinutes());
      latest = Math.max(
        latest,
        e.getHours() * 60 + e.getMinutes() + (e.getMinutes() % 60 === 0 ? 0 : 0)
      );
    }
    const start = Math.max(0, Math.floor(earliest / 60));
    const end = Math.min(24, Math.ceil(latest / 60));
    return { hourBoundsStart: start, hourBoundsEnd: Math.max(end, start + 1) };
  }, [clinicHours, appointments]);

  const holidayByDate = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of holidays) m.set(h.date, h.name);
    return m;
  }, [holidays]);

  function isHolidayFor(day: Date): string | null {
    const key = toDateInput(day);
    return holidayByDate.get(key) ?? null;
  }

  useEffect(() => {
    if (appointments.length === 0) return;
    let cancelled = false;
    const supabase = createClient();
    const leadIds = Array.from(new Set(appointments.map((a) => a.lead_id)));
    (async () => {
      const { data } = await supabase
        .from("appointments")
        .select("lead_id")
        .in("lead_id", leadIds)
        .eq("status", "no_show")
        .lt("starts_at", new Date().toISOString());
      if (cancelled) return;
      const set = new Set<string>();
      for (const r of (data as { lead_id: string }[] | null) ?? []) {
        set.add(r.lead_id);
      }
      setNoShowLeadIds(set);
    })();
    return () => {
      cancelled = true;
    };
  }, [appointments]);

  function navigate(nextDate: Date, nextView: ViewMode, nextResource?: ResourceAxis) {
    const p = new URLSearchParams(params.toString());
    p.set("date", toDateInput(nextDate));
    p.set("view", nextView);
    if (nextResource !== undefined) {
      if (nextResource === "none") p.delete("resource");
      else p.set("resource", nextResource);
    }
    router.push(`/${domain}/agenda?${p.toString()}`);
  }

  function moveBy(unit: number) {
    if (viewMode === "month") {
      const next = new Date(dateObj);
      next.setMonth(next.getMonth() + unit);
      navigate(next, viewMode);
      return;
    }
    const days = viewMode === "day" ? unit : unit * 7;
    navigate(addDays(dateObj, days), viewMode);
  }

  function openCreateAt(startsAt?: Date, resourceId?: string) {
    const prefill: Prefill = {
      startsAt: startsAt ? toLocalIso(startsAt) : undefined,
    };
    if (resourceId) {
      if (resourceAxis === "dentist") prefill.dentistId = resourceId;
      else if (resourceAxis === "room") prefill.roomId = resourceId;
    }
    setCreatingPrefill(prefill);
    if (startsAt) {
      const day = `${startsAt.getFullYear()}-${String(startsAt.getMonth() + 1).padStart(2, "0")}-${String(startsAt.getDate()).padStart(2, "0")}`;
      setPendingSlot({
        startsAt: startsAt.toISOString(),
        durationMin: 30,
        day,
        resourceId,
      });
    } else {
      setPendingSlot(null);
    }
  }

  async function handleMove(target: AgendaDropTarget) {
    setMoveError(null);
    const appointment = appointments.find((a) => a.id === target.appointmentId);
    if (!appointment) return;
    const oldStart = new Date(appointment.starts_at);
    const oldEnd = new Date(appointment.ends_at);
    const durationMs = oldEnd.getTime() - oldStart.getTime();

    const newStart = new Date(target.startsAt);
    const newEnd = new Date(newStart.getTime() + durationMs);

    if (newStart.getTime() === oldStart.getTime()) {
      const sameResource =
        resourceAxis === "dentist"
          ? appointment.dentist_id === (target.resourceId ?? null)
          : resourceAxis === "room"
            ? appointment.room_id === (target.resourceId ?? null)
            : true;
      if (sameResource) return;
    }

    const supabase = createClient();
    const newDentistId =
      resourceAxis === "dentist"
        ? target.resourceId ?? null
        : appointment.dentist_id;
    const newRoomId =
      resourceAxis === "room"
        ? target.resourceId ?? null
        : appointment.room_id;

    const { data: conflict, error: conflictErr } = await supabase.rpc(
      "check_appointment_conflict",
      {
        p_dentist_id: newDentistId,
        p_room_id: newRoomId,
        p_starts_at: newStart.toISOString(),
        p_ends_at: newEnd.toISOString(),
        p_exclude_id: appointment.id,
      }
    );
    if (conflictErr) {
      setMoveError(`Erro ao validar: ${conflictErr.message}`);
      router.refresh();
      return;
    }
    if (conflict === true) {
      setMoveError(
        "Conflito: dentista, sala ou bloqueio já ocupam o novo horário."
      );
      return;
    }

    const { error: updateErr } = await supabase
      .from("appointments")
      .update({
        starts_at: newStart.toISOString(),
        ends_at: newEnd.toISOString(),
        dentist_id: newDentistId,
        room_id: newRoomId,
      })
      .eq("id", appointment.id);

    if (updateErr) {
      setMoveError(`Erro ao reagendar: ${updateErr.message}`);
      router.refresh();
      return;
    }
    router.refresh();
  }

  function openReturn(a: AppointmentDetailed) {
    const next = new Date(a.ends_at);
    next.setDate(next.getDate() + 30);
    next.setHours(new Date(a.starts_at).getHours(), 0, 0, 0);
    setActing(null);
    setCreatingPrefill({
      startsAt: toLocalIso(next),
      dentistId: a.dentist_id,
      roomId: a.room_id,
      procedureId: a.procedure_type_id,
      leadId: a.lead_id,
      notes: "Retorno",
    });
  }

  const resourceList = useMemo(
    () =>
      resourceAxis === "dentist"
        ? dentists.map((d) => ({ id: d.id, name: `Dr(a). ${d.name}` }))
        : resourceAxis === "room"
          ? rooms.map((r) => ({ id: r.id, name: r.name }))
          : [],
    [resourceAxis, dentists, rooms]
  );

  const visibleAppointments = useMemo(() => {
    if (resourceAxis === "none" || resourceList.length === 0) return appointments;
    const ids = new Set(resourceList.map((r) => r.id));
    return appointments.filter((a) => {
      const id = resourceAxis === "dentist" ? a.dentist_id : a.room_id;
      return id && ids.has(id);
    });
  }, [appointments, resourceAxis, resourceList]);

  const monthAnchor = useMemo(() => {
    const a = new Date(dateObj);
    a.setDate(1);
    return a;
  }, [dateObj]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 lg:px-8">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Agenda</h1>
            <p className="text-xs text-gray-500">
              {viewMode === "day"
                ? fmtTitle(dateObj)
                : viewMode === "week"
                  ? `Semana de ${fmtDay(startObj)} a ${fmtDay(addDays(endObj, -1))}`
                  : fmtMonthTitle(monthAnchor)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openCreateAt()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              + Agendar
            </button>
          </div>
        </div>
      </header>

      <main className="p-4 lg:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Modo de visualização"
            className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5 text-xs"
          >
            {(["day", "week", "month"] as ViewMode[]).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={viewMode === v}
                onClick={() => navigate(dateObj, v)}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  viewMode === v
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {v === "day" ? "Dia" : v === "week" ? "Semana" : "Mês"}
              </button>
            ))}
          </div>

          <button
            onClick={() => moveBy(-1)}
            aria-label="Anterior"
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            ‹
          </button>
          <button
            onClick={() => navigate(new Date(), viewMode)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            Hoje
          </button>
          <button
            onClick={() => moveBy(1)}
            aria-label="Próximo"
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            ›
          </button>
          <input
            type="date"
            value={toDateInput(dateObj)}
            onChange={(e) => navigate(parseDateInput(e.target.value), viewMode)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-600"
          />

        </div>

        {viewMode === "month" ? (
          <AgendaMonth
            monthAnchor={monthAnchor}
            rangeStart={startObj}
            counts={monthCounts}
            holidays={holidays}
            onPickDay={(d) => navigate(d, "day")}
          />
        ) : (
          <AgendaGrid
            days={gridDays}
            appointments={visibleAppointments}
            blocks={blocks}
            hourBoundsStart={hourBoundsStart}
            hourBoundsEnd={hourBoundsEnd}
            resourceAxis={resourceAxis}
            resources={resourceList}
            noShowLeadIds={noShowLeadIds}
            isHoliday={isHolidayFor}
            onCreateAt={openCreateAt}
            onSelect={(a) => setActing(a)}
            onMove={handleMove}
            pendingSlot={pendingSlot}
          />
        )}

        {moveError && (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 shadow">
            <div className="flex items-center gap-3">
              <span>{moveError}</span>
              <button
                type="button"
                onClick={() => setMoveError(null)}
                className="text-rose-700/80 hover:text-rose-900"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>
          </div>
        )}
      </main>

      {creatingPrefill && (
        <AppointmentModal
          mode="create"
          rooms={rooms}
          procedures={procedures}
          dentists={dentists}
          prefill={creatingPrefill}
          onClose={() => {
            setCreatingPrefill(null);
            setPendingSlot(null);
          }}
          onSaved={() => {
            setCreatingPrefill(null);
            setPendingSlot(null);
            router.refresh();
          }}
        />
      )}

      {editing && (
        <AppointmentModal
          mode="edit"
          rooms={rooms}
          procedures={procedures}
          dentists={dentists}
          appointment={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {acting && (
        <AppointmentActions
          domain={domain}
          appointment={acting}
          templates={templates}
          onClose={() => setActing(null)}
          onChanged={() => {
            setActing(null);
            router.refresh();
          }}
          onEdit={(a) => {
            setActing(null);
            setEditing(a);
          }}
          onScheduleReturn={openReturn}
        />
      )}
    </div>
  );
}
