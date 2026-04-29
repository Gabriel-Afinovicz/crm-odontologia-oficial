"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import type { ClinicHours } from "@/lib/types/database";

const WEEKDAYS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

interface DraftRow {
  weekday: number;
  is_open: boolean;
  opens_at: string;
  closes_at: string;
  lunch_start: string;
  lunch_end: string;
}

function emptyDraft(weekday: number): DraftRow {
  return {
    weekday,
    is_open: weekday !== 0,
    opens_at: "08:00",
    closes_at: "18:00",
    lunch_start: "",
    lunch_end: "",
  };
}

function fromRow(row: ClinicHours): DraftRow {
  return {
    weekday: row.weekday,
    is_open: row.is_open,
    opens_at: row.opens_at.slice(0, 5),
    closes_at: row.closes_at.slice(0, 5),
    lunch_start: row.lunch_start ? row.lunch_start.slice(0, 5) : "",
    lunch_end: row.lunch_end ? row.lunch_end.slice(0, 5) : "",
  };
}

export function ClinicHoursManager() {
  const { companyId, loading: companyLoading } = useCurrentCompany();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function fetchAll() {
    if (!companyId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("clinic_hours")
      .select("*")
      .eq("company_id", companyId)
      .order("weekday");
    const existing = (data as unknown as ClinicHours[]) ?? [];
    const byWeekday = new Map(existing.map((r) => [r.weekday, r]));
    const next: DraftRow[] = [];
    for (let i = 0; i < 7; i++) {
      const found = byWeekday.get(i);
      next.push(found ? fromRow(found) : emptyDraft(i));
    }
    setRows(next);
    setLoading(false);
  }

  useEffect(() => {
    if (companyLoading) return;
    if (!companyId) {
      setRows([]);
      setLoading(false);
      return;
    }
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyLoading, companyId]);

  function update(weekday: number, patch: Partial<DraftRow>) {
    setRows((prev) =>
      prev.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r))
    );
  }

  async function handleSave() {
    if (!companyId) return;
    setError(null);
    setSaving(true);
    const supabase = createClient();
    const payload = rows.map((r) => ({
      company_id: companyId,
      weekday: r.weekday,
      is_open: r.is_open,
      opens_at: r.opens_at,
      closes_at: r.closes_at,
      lunch_start: r.lunch_start || null,
      lunch_end: r.lunch_end || null,
      updated_at: new Date().toISOString(),
    }));
    const { error: e } = await supabase
      .from("clinic_hours")
      .upsert(payload, { onConflict: "company_id,weekday" });
    setSaving(false);
    if (e) {
      setError(`Não foi possível salvar: ${e.message}`);
      return;
    }
    setSavedAt(Date.now());
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="grid grid-cols-12 gap-2 border-b border-gray-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          <div className="col-span-3">Dia</div>
          <div className="col-span-2">Aberto?</div>
          <div className="col-span-2">Abre</div>
          <div className="col-span-2">Fecha</div>
          <div className="col-span-3">Intervalo (almoço)</div>
        </div>
        {rows.map((r) => (
          <div
            key={r.weekday}
            className="grid grid-cols-12 items-center gap-2 px-4 py-2 text-sm"
          >
            <div className="col-span-3 font-medium text-gray-800">
              {WEEKDAYS[r.weekday]}
            </div>
            <div className="col-span-2">
              <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={r.is_open}
                  onChange={(e) =>
                    update(r.weekday, { is_open: e.target.checked })
                  }
                />
                {r.is_open ? "Sim" : "Não"}
              </label>
            </div>
            <div className="col-span-2">
              <input
                type="time"
                value={r.opens_at}
                disabled={!r.is_open}
                onChange={(e) => update(r.weekday, { opens_at: e.target.value })}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
              />
            </div>
            <div className="col-span-2">
              <input
                type="time"
                value={r.closes_at}
                disabled={!r.is_open}
                onChange={(e) => update(r.weekday, { closes_at: e.target.value })}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
              />
            </div>
            <div className="col-span-3 flex items-center gap-1">
              <input
                type="time"
                value={r.lunch_start}
                disabled={!r.is_open}
                onChange={(e) =>
                  update(r.weekday, { lunch_start: e.target.value })
                }
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
              />
              <span className="text-xs text-gray-400">—</span>
              <input
                type="time"
                value={r.lunch_end}
                disabled={!r.is_open}
                onChange={(e) =>
                  update(r.weekday, { lunch_end: e.target.value })
                }
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-3">
        {savedAt && (
          <span className="text-xs text-emerald-600">
            Horários salvos.
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar horários"}
        </button>
      </div>
    </div>
  );
}
