"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  AppointmentDetailed,
  ProcedureType,
  Room,
  User,
} from "@/lib/types/database";
import { BookAppointmentModal } from "@/components/agenda/book-appointment-modal";

type ViewMode = "day" | "week";

interface AgendaContentProps {
  domain: string;
  viewMode: ViewMode;
  selectedDate: string;
  rangeStart: string;
  rangeEnd: string;
  appointments: AppointmentDetailed[];
  rooms: Room[];
  procedures: ProcedureType[];
  dentists: Pick<User, "id" | "name" | "is_dentist">[];
}

const HOUR_START = 7;
const HOUR_END = 21;
const SLOT_MINUTES = 30;
const PX_PER_MIN = 1.0;

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
function fmtHour(h: number, m: number) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function toDateInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function statusColor(status: string) {
  switch (status) {
    case "confirmed":
      return "bg-emerald-100 border-emerald-300 text-emerald-900";
    case "completed":
      return "bg-sky-100 border-sky-300 text-sky-900";
    case "cancelled":
      return "bg-gray-100 border-gray-300 text-gray-500 line-through";
    case "no_show":
      return "bg-rose-100 border-rose-300 text-rose-800";
    default:
      return "bg-blue-50 border-blue-300 text-blue-900";
  }
}

function statusLabel(status: string) {
  return (
    {
      scheduled: "agendado",
      confirmed: "confirmado",
      completed: "concluído",
      cancelled: "cancelado",
      no_show: "faltou",
    }[status] ?? status
  );
}

export function AgendaContent({
  domain,
  viewMode,
  selectedDate,
  rangeStart,
  rangeEnd,
  appointments,
  rooms,
  procedures,
  dentists,
}: AgendaContentProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [showModal, setShowModal] = useState(false);
  const [prefill, setPrefill] = useState<{
    startsAt?: string;
    dentistId?: string | null;
  } | null>(null);

  const dateObj = useMemo(() => new Date(selectedDate), [selectedDate]);
  const startObj = useMemo(() => new Date(rangeStart), [rangeStart]);
  const endObj = useMemo(() => new Date(rangeEnd), [rangeEnd]);

  const days = useMemo(() => {
    if (viewMode === "day") return [startObj];
    const list: Date[] = [];
    for (let i = 0; i < 7; i++) list.push(addDays(startObj, i));
    return list;
  }, [viewMode, startObj]);

  function navigate(nextDate: Date, nextView: ViewMode) {
    const p = new URLSearchParams(params.toString());
    p.set("date", toDateInput(nextDate));
    p.set("view", nextView);
    router.push(`/${domain}/agenda?${p.toString()}`);
  }

  function moveBy(days: number) {
    navigate(addDays(dateObj, days), viewMode);
  }

  function groupedByDay(day: Date) {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = addDays(dayStart, 1);
    return appointments.filter((a) => {
      const s = new Date(a.starts_at);
      return s >= dayStart && s < dayEnd;
    });
  }

  function openNewAt(startsAt?: Date, dentistId?: string | null) {
    setPrefill({
      startsAt: startsAt?.toISOString(),
      dentistId: dentistId ?? null,
    });
    setShowModal(true);
  }

  const totalHeight = (HOUR_END - HOUR_START) * 60 * PX_PER_MIN;

  function renderSlot(day: Date, apps: AppointmentDetailed[]) {
    const dayStart = new Date(day);
    dayStart.setHours(HOUR_START, 0, 0, 0);
    return (
      <div
        className="relative border-l border-gray-100 bg-white"
        style={{ height: totalHeight }}
        onDoubleClick={(e) => {
          const rect = (e.target as HTMLElement).getBoundingClientRect();
          const y = e.clientY - rect.top;
          const minutes = Math.max(0, Math.floor(y / PX_PER_MIN));
          const slotStart = new Date(dayStart);
          slotStart.setMinutes(slotStart.getMinutes() + minutes);
          const rounded = new Date(slotStart);
          rounded.setMinutes(Math.round(rounded.getMinutes() / 30) * 30, 0, 0);
          openNewAt(rounded);
        }}
      >
        {Array.from({ length: (HOUR_END - HOUR_START) * (60 / SLOT_MINUTES) }).map(
          (_, i) => {
            const top = i * SLOT_MINUTES * PX_PER_MIN;
            const isHour = i % (60 / SLOT_MINUTES) === 0;
            return (
              <div
                key={i}
                className={`absolute inset-x-0 border-t ${
                  isHour ? "border-gray-200" : "border-gray-100"
                }`}
                style={{ top }}
              />
            );
          }
        )}
        {apps.map((a) => {
          const s = new Date(a.starts_at);
          const e = new Date(a.ends_at);
          const topMin = (s.getHours() - HOUR_START) * 60 + s.getMinutes();
          const durMin = (e.getTime() - s.getTime()) / 60000;
          return (
            <Link
              key={a.id}
              href={`/${domain}/leads/${a.lead_id}`}
              className={`absolute left-1 right-1 rounded-md border px-2 py-1 text-[11px] shadow-sm ${statusColor(
                a.status
              )}`}
              style={{
                top: topMin * PX_PER_MIN,
                height: Math.max(22, durMin * PX_PER_MIN - 2),
              }}
            >
              <div className="font-semibold truncate">{a.lead_name}</div>
              <div className="flex items-center gap-1 text-[10px] opacity-80">
                <span>
                  {fmtHour(s.getHours(), s.getMinutes())}
                  {"–"}
                  {fmtHour(e.getHours(), e.getMinutes())}
                </span>
                {a.room_name && <span>· {a.room_name}</span>}
              </div>
              {a.procedure_name && (
                <div className="truncate text-[10px] opacity-75">
                  {a.procedure_name}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between px-6 py-4 lg:px-8">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Agenda</h1>
            <p className="text-xs text-gray-500">
              {viewMode === "day"
                ? fmtTitle(dateObj)
                : `Semana de ${fmtDay(startObj)} a ${fmtDay(addDays(endObj, -1))}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openNewAt()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              + Agendar
            </button>
          </div>
        </div>
      </header>

      <main className="p-4 lg:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5 text-xs">
            {(["day", "week"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => navigate(dateObj, v)}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  viewMode === v
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {v === "day" ? "Dia" : "Semana"}
              </button>
            ))}
          </div>
          <button
            onClick={() => moveBy(viewMode === "day" ? -1 : -7)}
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
            onClick={() => moveBy(viewMode === "day" ? 1 : 7)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            ›
          </button>
          <input
            type="date"
            value={toDateInput(dateObj)}
            onChange={(e) => navigate(new Date(e.target.value), viewMode)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-600"
          />
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <div
            className="grid"
            style={{
              gridTemplateColumns: `60px repeat(${days.length}, minmax(200px, 1fr))`,
            }}
          >
            <div className="border-b border-r border-gray-200 bg-gray-50 p-2" />
            {days.map((d) => (
              <div
                key={d.toISOString()}
                className="border-b border-r border-gray-200 bg-gray-50 px-3 py-2 text-center"
              >
                <div className="text-[11px] uppercase text-gray-500">
                  {fmtDay(d)}
                </div>
              </div>
            ))}

            <div className="relative bg-gray-50" style={{ height: totalHeight }}>
              {Array.from({ length: HOUR_END - HOUR_START + 1 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-t border-gray-200 text-right pr-2 text-[10px] text-gray-500"
                  style={{ top: i * 60 * PX_PER_MIN - 6 }}
                >
                  {fmtHour(HOUR_START + i, 0)}
                </div>
              ))}
            </div>
            {days.map((d) => (
              <div key={d.toISOString()}>{renderSlot(d, groupedByDay(d))}</div>
            ))}
          </div>
        </div>
      </main>

      {showModal && (
        <BookAppointmentModal
          domain={domain}
          rooms={rooms}
          procedures={procedures}
          dentists={dentists}
          initialStartsAt={prefill?.startsAt}
          initialDentistId={prefill?.dentistId ?? null}
          onClose={() => {
            setShowModal(false);
            setPrefill(null);
          }}
          onCreated={() => {
            setShowModal(false);
            setPrefill(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
