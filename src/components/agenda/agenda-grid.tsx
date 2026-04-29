"use client";

import { useState, type CSSProperties } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type {
  AgendaBlock,
  AppointmentDetailed,
  ClinicHours,
} from "@/lib/types/database";

const PX_PER_MIN = 1.0;
const SLOT_MINUTES = 30;
const DRAG_SNAP_MINUTES = 15;

export interface GridDay {
  date: Date;
  hours: ClinicHours | undefined;
}

export type ResourceAxis = "none" | "dentist" | "room";

export interface PendingSlot {
  startsAt: string;
  durationMin: number;
  day: string;
  resourceId?: string;
}

export interface AgendaDropTarget {
  startsAt: Date;
  resourceId?: string;
  appointmentId: string;
}

interface AgendaGridProps {
  days: GridDay[];
  appointments: AppointmentDetailed[];
  blocks: AgendaBlock[];
  hourBoundsStart: number;
  hourBoundsEnd: number;
  resourceAxis: ResourceAxis;
  resources: { id: string; name: string }[];
  noShowLeadIds: Set<string>;
  isHoliday: (day: Date) => string | null;
  onCreateAt: (startsAt: Date, resourceId?: string) => void;
  onSelect: (appointment: AppointmentDetailed) => void;
  onMove: (target: AgendaDropTarget) => void;
  pendingSlot?: PendingSlot | null;
}

function fmtDay(d: Date) {
  return d.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}
function fmtHour(h: number, m: number) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function statusColor(status: string) {
  switch (status) {
    case "confirmed":
      return "bg-emerald-50 border-emerald-300 text-emerald-900";
    case "completed":
      return "bg-sky-50 border-sky-300 text-sky-900";
    case "cancelled":
      return "bg-gray-50 border-gray-300 text-gray-500 line-through";
    case "no_show":
      return "bg-rose-50 border-rose-300 text-rose-800";
    default:
      return "bg-blue-50 border-blue-300 text-blue-900";
  }
}

function colKey(dayISO: string, resourceId?: string) {
  return `col::${dayISO}::${resourceId ?? ""}`;
}
function parseColKey(id: string) {
  const parts = id.split("::");
  if (parts[0] !== "col") return null;
  const day = parts[1];
  const resourceId = parts[2] || undefined;
  return { day, resourceId };
}

function DraggableAppointment({
  appointment,
  topPx,
  heightPx,
  className,
  noShow,
  onSelect,
  isDragging,
  hidden,
  borderLeftColor,
}: {
  appointment: AppointmentDetailed;
  topPx: number;
  heightPx: number;
  className: string;
  noShow: boolean;
  onSelect: () => void;
  isDragging: boolean;
  hidden: boolean;
  borderLeftColor?: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `app::${appointment.id}`,
    data: { appointmentId: appointment.id },
  });

  const s = new Date(appointment.starts_at);
  const e = new Date(appointment.ends_at);

  const style: CSSProperties = {
    top: topPx,
    height: Math.max(22, heightPx),
    borderLeftColor: borderLeftColor ?? undefined,
    borderLeftWidth: borderLeftColor ? 4 : undefined,
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: isDragging ? 30 : undefined,
    opacity: hidden ? 0 : isDragging ? 0.85 : 1,
    cursor: isDragging ? "grabbing" : "grab",
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={(ev) => {
        ev.stopPropagation();
        if (isDragging) return;
        onSelect();
      }}
      className={`absolute left-1 right-1 rounded-md border px-2 py-1 text-left text-[11px] shadow-sm transition hover:shadow ${className}`}
      style={style}
    >
      <div className="flex items-center gap-1">
        <span className="truncate font-semibold">{appointment.lead_name}</span>
        {noShow && (
          <span
            className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-semibold text-rose-700"
            title="Histórico de falta"
          >
            !
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 text-[10px] opacity-80">
        <span>
          {fmtHour(s.getHours(), s.getMinutes())}
          {"–"}
          {fmtHour(e.getHours(), e.getMinutes())}
        </span>
        {appointment.room_name && <span>· {appointment.room_name}</span>}
      </div>
      {appointment.procedure_name && (
        <div className="truncate text-[10px] opacity-75">
          {appointment.procedure_name}
        </div>
      )}
    </button>
  );
}

function DroppableColumn({
  dropId,
  children,
  totalHeight,
  onClickEmpty,
  isOver,
}: {
  dropId: string;
  children: React.ReactNode;
  totalHeight: number;
  onClickEmpty?: (e: React.MouseEvent<HTMLDivElement>) => void;
  isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: dropId });
  return (
    <div
      ref={setNodeRef}
      className={`relative border-l border-gray-100 bg-white ${
        isOver ? "ring-2 ring-blue-300/50" : ""
      }`}
      style={{ height: totalHeight }}
      onClick={onClickEmpty}
    >
      {children}
    </div>
  );
}

export function AgendaGrid({
  days,
  appointments,
  blocks,
  hourBoundsStart,
  hourBoundsEnd,
  resourceAxis,
  resources,
  noShowLeadIds,
  isHoliday,
  onCreateAt,
  onSelect,
  onMove,
  pendingSlot,
}: AgendaGridProps) {
  const totalHeight = (hourBoundsEnd - hourBoundsStart) * 60 * PX_PER_MIN;
  const hasResourceAxis = resourceAxis !== "none" && resources.length > 0;

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overDropId, setOverDropId] = useState<string | null>(null);
  const [dragOffsetMin, setDragOffsetMin] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const columns: { day: Date; resourceId?: string; resourceName?: string }[] = [];
  if (hasResourceAxis) {
    for (const d of days) {
      for (const r of resources) {
        columns.push({ day: d.date, resourceId: r.id, resourceName: r.name });
      }
    }
  } else {
    for (const d of days) columns.push({ day: d.date });
  }

  function appsFor(col: (typeof columns)[number]) {
    const dayStart = new Date(col.day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    return appointments.filter((a) => {
      const s = new Date(a.starts_at);
      if (s < dayStart || s >= dayEnd) return false;
      if (!col.resourceId) return true;
      if (resourceAxis === "dentist") return a.dentist_id === col.resourceId;
      if (resourceAxis === "room") return a.room_id === col.resourceId;
      return true;
    });
  }

  function blocksFor(col: (typeof columns)[number]) {
    const dayStart = new Date(col.day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    return blocks.filter((b) => {
      const s = new Date(b.starts_at);
      const e = new Date(b.ends_at);
      if (e <= dayStart || s >= dayEnd) return false;
      if (!col.resourceId) return true;
      if (resourceAxis === "dentist")
        return b.dentist_id === col.resourceId || b.dentist_id === null;
      if (resourceAxis === "room")
        return b.room_id === col.resourceId || b.room_id === null;
      return true;
    });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(String(event.active.id));
    setDragOffsetMin(0);
  }

  function handleDragMove(event: DragMoveEvent) {
    const dy = event.delta?.y ?? 0;
    const minutes = Math.round(dy / PX_PER_MIN / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;
    setDragOffsetMin(minutes);
    const overId = event.over?.id ? String(event.over.id) : null;
    setOverDropId(overId);
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const apptId = activeId.startsWith("app::") ? activeId.slice(5) : null;
    const overId = event.over?.id ? String(event.over.id) : null;
    const dy = event.delta?.y ?? 0;

    setActiveDragId(null);
    setOverDropId(null);
    setDragOffsetMin(0);

    if (!apptId || !overId) return;
    const parsed = parseColKey(overId);
    if (!parsed) return;

    const appointment = appointments.find((a) => a.id === apptId);
    if (!appointment) return;

    const minutesDelta =
      Math.round(dy / PX_PER_MIN / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;

    const originalStart = new Date(appointment.starts_at);
    const baseDay = new Date(parsed.day);
    const newStart = new Date(baseDay);
    newStart.setHours(
      originalStart.getHours(),
      originalStart.getMinutes() + minutesDelta,
      0,
      0
    );

    onMove({
      startsAt: newStart,
      resourceId: parsed.resourceId,
      appointmentId: apptId,
    });
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveDragId(null);
          setOverDropId(null);
          setDragOffsetMin(0);
        }}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `60px repeat(${columns.length}, minmax(180px, 1fr))`,
          }}
        >
          <div className="border-b border-r border-gray-200 bg-gray-50 p-2" />
          {columns.map((col, idx) => {
            const holiday = isHoliday(col.day);
            return (
              <div
                key={`${col.day.toISOString()}-${col.resourceId ?? idx}`}
                className="border-b border-r border-gray-200 bg-gray-50 px-3 py-2 text-center"
              >
                <div className="text-[11px] uppercase text-gray-500">
                  {fmtDay(col.day)}
                </div>
                {col.resourceName && (
                  <div className="mt-0.5 truncate text-[11px] font-medium text-gray-700">
                    {col.resourceName}
                  </div>
                )}
                {holiday && (
                  <div className="mt-0.5 truncate text-[10px] text-rose-600">
                    {holiday}
                  </div>
                )}
              </div>
            );
          })}

          <div
            className="relative bg-gray-50"
            style={{ height: totalHeight }}
          >
            {Array.from({ length: hourBoundsEnd - hourBoundsStart + 1 }).map(
              (_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-t border-gray-200 pr-2 text-right text-[10px] text-gray-500"
                  style={{ top: i * 60 * PX_PER_MIN - 6 }}
                >
                  {fmtHour(hourBoundsStart + i, 0)}
                </div>
              )
            )}
          </div>

          {columns.map((col, idx) => {
            const apps = appsFor(col);
            const dayBlocks = blocksFor(col);
            const holiday = isHoliday(col.day);
            const hours = days.find(
              (d) => d.date.toDateString() === col.day.toDateString()
            )?.hours;
            const dayMinutes = (hourBoundsEnd - hourBoundsStart) * 60;

            const closedBands: { topMin: number; durMin: number }[] = [];
            if (holiday || !hours || !hours.is_open) {
              closedBands.push({ topMin: 0, durMin: dayMinutes });
            } else {
              const opens = timeToMinutes(hours.opens_at) - hourBoundsStart * 60;
              const closes =
                timeToMinutes(hours.closes_at) - hourBoundsStart * 60;
              if (opens > 0) closedBands.push({ topMin: 0, durMin: opens });
              if (closes < dayMinutes)
                closedBands.push({ topMin: closes, durMin: dayMinutes - closes });
              if (hours.lunch_start && hours.lunch_end) {
                const ls = timeToMinutes(hours.lunch_start) - hourBoundsStart * 60;
                const le = timeToMinutes(hours.lunch_end) - hourBoundsStart * 60;
                closedBands.push({ topMin: ls, durMin: le - ls });
              }
            }

            const dayISO = new Date(col.day.getFullYear(), col.day.getMonth(), col.day.getDate(), 0, 0, 0).toISOString();
            const dropId = colKey(dayISO, col.resourceId);
            const colDayKey = `${col.day.getFullYear()}-${String(col.day.getMonth() + 1).padStart(2, "0")}-${String(col.day.getDate()).padStart(2, "0")}`;

            const isOver = overDropId === dropId;
            const ghost = activeDragId
              ? appointments.find((a) => `app::${a.id}` === activeDragId)
              : null;

            const ghostInfo =
              ghost && isOver
                ? (() => {
                    const oStart = new Date(ghost.starts_at);
                    const oEnd = new Date(ghost.ends_at);
                    const dur = (oEnd.getTime() - oStart.getTime()) / 60000;
                    const newStart = new Date(col.day);
                    newStart.setHours(
                      oStart.getHours(),
                      oStart.getMinutes() + dragOffsetMin,
                      0,
                      0
                    );
                    const topMin =
                      (newStart.getHours() - hourBoundsStart) * 60 +
                      newStart.getMinutes();
                    return { topMin, durMin: dur, newStart };
                  })()
                : null;

            return (
              <DroppableColumn
                key={`col-${col.day.toISOString()}-${col.resourceId ?? idx}`}
                dropId={dropId}
                totalHeight={totalHeight}
                isOver={isOver}
                onClickEmpty={(e) => {
                  if (activeDragId) return;
                  if (holiday) return;
                  if (e.target !== e.currentTarget) return;
                  const rect = (
                    e.currentTarget as HTMLElement
                  ).getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const minutes = Math.max(0, Math.floor(y / PX_PER_MIN));
                  const slotStart = new Date(col.day);
                  slotStart.setHours(hourBoundsStart, 0, 0, 0);
                  slotStart.setMinutes(slotStart.getMinutes() + minutes);
                  const rounded = new Date(slotStart);
                  rounded.setMinutes(
                    Math.round(rounded.getMinutes() / 30) * 30,
                    0,
                    0
                  );
                  onCreateAt(rounded, col.resourceId);
                }}
              >
                {Array.from({
                  length:
                    ((hourBoundsEnd - hourBoundsStart) * 60) / SLOT_MINUTES,
                }).map((_, i) => {
                  const top = i * SLOT_MINUTES * PX_PER_MIN;
                  const isHour = i % (60 / SLOT_MINUTES) === 0;
                  return (
                    <div
                      key={i}
                      className={`pointer-events-none absolute inset-x-0 border-t ${
                        isHour ? "border-gray-200" : "border-gray-100"
                      }`}
                      style={{ top }}
                    />
                  );
                })}

                {closedBands.map((band, i) => (
                  <div
                    key={`closed-${i}`}
                    className="pointer-events-none absolute inset-x-0 bg-gray-100/70"
                    style={{
                      top: band.topMin * PX_PER_MIN,
                      height: band.durMin * PX_PER_MIN,
                      backgroundImage:
                        "repeating-linear-gradient(45deg, transparent 0 6px, rgba(0,0,0,0.04) 6px 12px)",
                    }}
                    aria-hidden
                  />
                ))}

                {dayBlocks.map((b) => {
                  const dayStart = new Date(col.day);
                  dayStart.setHours(hourBoundsStart, 0, 0, 0);
                  const sMs = Math.max(
                    0,
                    new Date(b.starts_at).getTime() - dayStart.getTime()
                  );
                  const eMs =
                    new Date(b.ends_at).getTime() - dayStart.getTime();
                  const topMin = sMs / 60000;
                  const durMin = Math.max(15, (eMs - sMs) / 60000);
                  return (
                    <div
                      key={b.id}
                      className="pointer-events-none absolute left-1 right-1 rounded-md border border-dashed border-gray-300 bg-gray-100/80 px-2 py-1 text-[11px] text-gray-600"
                      style={{
                        top: topMin * PX_PER_MIN,
                        height: durMin * PX_PER_MIN - 2,
                      }}
                    >
                      <div className="font-medium">Bloqueio</div>
                      {b.reason && (
                        <div className="truncate text-[10px] opacity-80">
                          {b.reason}
                        </div>
                      )}
                    </div>
                  );
                })}

                {pendingSlot && pendingSlot.day === colDayKey &&
                  (pendingSlot.resourceId ?? "") === (col.resourceId ?? "") && (
                  (() => {
                    const ps = new Date(pendingSlot.startsAt);
                    const topMin =
                      (ps.getHours() - hourBoundsStart) * 60 + ps.getMinutes();
                    return (
                      <div
                        className="pointer-events-none absolute left-1 right-1 rounded-md border-2 border-dashed border-blue-400 bg-blue-50/70 px-2 py-1 text-[11px] text-blue-700"
                        style={{
                          top: topMin * PX_PER_MIN,
                          height: pendingSlot.durationMin * PX_PER_MIN - 2,
                        }}
                      >
                        <div className="font-medium">Novo agendamento…</div>
                        <div className="text-[10px] opacity-75">
                          {fmtHour(ps.getHours(), ps.getMinutes())}
                        </div>
                      </div>
                    );
                  })()
                )}

                {ghostInfo && (
                  <div
                    className="pointer-events-none absolute left-1 right-1 rounded-md border-2 border-dashed border-blue-400 bg-blue-100/40"
                    style={{
                      top: ghostInfo.topMin * PX_PER_MIN,
                      height: ghostInfo.durMin * PX_PER_MIN - 2,
                    }}
                  />
                )}

                {apps.map((a) => {
                  const s = new Date(a.starts_at);
                  const e = new Date(a.ends_at);
                  const topMin =
                    (s.getHours() - hourBoundsStart) * 60 + s.getMinutes();
                  const durMin = (e.getTime() - s.getTime()) / 60000;
                  const noShow = noShowLeadIds.has(a.lead_id);
                  const isThisDragging = activeDragId === `app::${a.id}`;
                  return (
                    <DraggableAppointment
                      key={a.id}
                      appointment={a}
                      topPx={topMin * PX_PER_MIN}
                      heightPx={durMin * PX_PER_MIN - 2}
                      className={statusColor(a.status)}
                      noShow={noShow}
                      borderLeftColor={a.room_color}
                      onSelect={() => onSelect(a)}
                      isDragging={isThisDragging}
                      hidden={false}
                    />
                  );
                })}
              </DroppableColumn>
            );
          })}
        </div>
      </DndContext>
    </div>
  );
}
