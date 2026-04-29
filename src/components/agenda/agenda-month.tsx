"use client";

import type { ClinicHoliday } from "@/lib/types/database";

interface AgendaMonthProps {
  monthAnchor: Date;
  rangeStart: Date;
  counts: { starts_at: string; status: string }[];
  holidays: ClinicHoliday[];
  onPickDay: (day: Date) => void;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function AgendaMonth({
  monthAnchor,
  rangeStart,
  counts,
  holidays,
  onPickDay,
}: AgendaMonthProps) {
  const dayBuckets = new Map<
    string,
    { total: number; cancelled: number; completed: number; noShow: number }
  >();
  for (const c of counts) {
    const day = new Date(c.starts_at);
    const key = ymd(day);
    const cur = dayBuckets.get(key) ?? {
      total: 0,
      cancelled: 0,
      completed: 0,
      noShow: 0,
    };
    cur.total += 1;
    if (c.status === "cancelled") cur.cancelled += 1;
    else if (c.status === "completed") cur.completed += 1;
    else if (c.status === "no_show") cur.noShow += 1;
    dayBuckets.set(key, cur);
  }

  const holidayByDate = new Map(holidays.map((h) => [h.date, h]));

  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(rangeStart);
    d.setDate(d.getDate() + i);
    cells.push(d);
  }

  const monthIdx = monthAnchor.getMonth();
  const today = new Date();
  const todayKey = ymd(today);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 text-[11px] font-medium uppercase text-gray-500">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day) => {
          const key = ymd(day);
          const bucket = dayBuckets.get(key);
          const inMonth = day.getMonth() === monthIdx;
          const isToday = key === todayKey;
          const holiday = holidayByDate.get(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPickDay(day)}
              className={`flex min-h-[92px] flex-col items-stretch gap-1 border-b border-r border-gray-100 p-2 text-left transition hover:bg-blue-50/40 ${
                inMonth ? "bg-white" : "bg-gray-50/60"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-semibold ${
                    isToday
                      ? "rounded-full bg-blue-600 px-2 py-0.5 text-white"
                      : inMonth
                        ? "text-gray-700"
                        : "text-gray-400"
                  }`}
                >
                  {day.getDate()}
                </span>
                {bucket && bucket.total > 0 && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                    {bucket.total}
                  </span>
                )}
              </div>
              {holiday && (
                <div className="truncate rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                  {holiday.name}
                </div>
              )}
              {bucket && (
                <div className="mt-auto flex items-center gap-2 text-[10px] text-gray-500">
                  {bucket.completed > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                      {bucket.completed}
                    </span>
                  )}
                  {bucket.noShow > 0 && (
                    <span className="flex items-center gap-1 text-rose-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                      {bucket.noShow}
                    </span>
                  )}
                  {bucket.cancelled > 0 && (
                    <span className="flex items-center gap-1 text-gray-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                      {bucket.cancelled}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
