"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  DentistAvailabilityRow,
  DentistAvailabilityInterval,
} from "@/lib/types/database";

interface AvailabilityPanelProps {
  companyId: string;
  /** Data no formato yyyy-MM-dd (local) */
  date: string;
  /** ID do dentista selecionado no formul\u00e1rio (para destaque) */
  highlightDentistId?: string;
}

function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ratioColor(busy: number, total: number) {
  if (total === 0) return "bg-gray-300";
  const pct = busy / total;
  if (pct >= 0.85) return "bg-rose-400";
  if (pct >= 0.5) return "bg-amber-400";
  return "bg-emerald-400";
}

export function AvailabilityPanel({
  companyId,
  date,
  highlightDentistId,
}: AvailabilityPanelProps) {
  const [rows, setRows] = useState<DentistAvailabilityRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase.rpc("get_dentist_availability", {
        p_company_id: companyId,
        p_date: date,
      });
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setRows([]);
      } else {
        setRows((data as unknown as DentistAvailabilityRow[]) ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, date]);

  if (loading) {
    return (
      <div className="space-y-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-9 animate-pulse rounded-lg bg-gray-100"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-red-600">
        N\u00e3o foi poss\u00edvel carregar disponibilidade: {error}
      </p>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <p className="text-xs text-gray-500">
        Nenhum dentista cadastrado.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const total = r.busy_minutes + r.free_minutes;
        const isOpen = r.is_open;
        const isHighlighted = highlightDentistId === r.dentist_id;
        const isExpanded = expanded === r.dentist_id;

        return (
          <div
            key={r.dentist_id}
            className={`rounded-lg border ${
              isHighlighted
                ? "border-blue-300 bg-blue-50/40"
                : "border-gray-200 bg-white"
            }`}
          >
            <button
              type="button"
              onClick={() =>
                setExpanded(isExpanded ? null : r.dentist_id)
              }
              className="flex w-full items-center gap-3 px-3 py-2 text-left"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  isOpen ? ratioColor(r.busy_minutes, total) : "bg-gray-300"
                }`}
              />
              <span className="flex-1 truncate text-sm font-medium text-gray-800">
                Dr(a). {r.dentist_name}
              </span>
              {isOpen ? (
                <span className="shrink-0 text-xs text-gray-500">
                  <span className="font-medium text-emerald-600">
                    {fmtMinutes(r.free_minutes)}
                  </span>
                  <span className="text-gray-400"> livres</span>
                  {r.busy_minutes > 0 && (
                    <>
                      {" \u00b7 "}
                      <span className="text-gray-500">
                        {fmtMinutes(r.busy_minutes)} ocupados
                      </span>
                    </>
                  )}
                </span>
              ) : (
                <span className="shrink-0 text-xs text-gray-400">Fechado</span>
              )}
              <svg
                className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${
                  isExpanded ? "rotate-180" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m19.5 8.25-7.5 7.5-7.5-7.5"
                />
              </svg>
            </button>

            {isExpanded && (
              <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-600">
                {!isOpen ? (
                  <p className="text-gray-500">
                    Cl\u00ednica fechada ou feriado neste dia.
                  </p>
                ) : r.busy_intervals.length === 0 ? (
                  <p className="text-emerald-700">
                    Dia totalmente livre ({r.opens_at?.slice(0, 5)} \u2013{" "}
                    {r.closes_at?.slice(0, 5)}).
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {r.busy_intervals.map(
                      (it: DentistAvailabilityInterval, idx) => (
                        <li
                          key={idx}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="font-mono text-gray-700">
                            {fmtTime(it.starts_at)} \u2013 {fmtTime(it.ends_at)}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                              it.kind === "block"
                                ? "bg-gray-100 text-gray-600"
                                : "bg-blue-50 text-blue-700"
                            }`}
                          >
                            {it.kind === "block"
                              ? it.label || "Bloqueio"
                              : it.label || "Consulta"}
                          </span>
                        </li>
                      )
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
