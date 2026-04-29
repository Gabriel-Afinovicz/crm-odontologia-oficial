"use client";

import type { StageFunnelRow } from "@/lib/types/database";

interface StageFunnelBarProps {
  rows: StageFunnelRow[];
  periodLabel: string;
}

export function StageFunnelBar({ rows, periodLabel }: StageFunnelBarProps) {
  const active = rows.filter((r) => !r.is_lost);
  const maxTotal = Math.max(...active.map((r) => r.total_leads), 1);

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-400">
        Nenhum dado de funil disponível.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="grid grid-cols-[1fr_6rem_6rem_7rem] gap-2 px-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
        <span>Etapa</span>
        <span className="text-right">Total</span>
        <span className="text-right">No período</span>
        <span className="text-right">Tempo médio</span>
      </div>

      {active.map((row) => {
        const pct = row.total_leads > 0 ? (row.total_leads / maxTotal) * 100 : 0;
        return (
          <div key={row.stage_id} className="group rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2.5 transition-colors hover:bg-white hover:shadow-sm">
            {/* Label + bar */}
            <div className="flex items-center gap-3">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.stage_color }}
              />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-gray-800">
                    {row.stage_name}
                    {row.is_won && (
                      <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        GANHO
                      </span>
                    )}
                  </span>
                  <div className="flex shrink-0 items-center gap-4 text-sm">
                    <span className="w-12 text-right font-semibold text-gray-900">
                      {row.total_leads}
                    </span>
                    <span className="w-16 text-right text-gray-500">
                      {row.new_in_period > 0 ? (
                        <span className="font-medium text-blue-600">+{row.new_in_period}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </span>
                    <span className="w-24 text-right text-gray-500">
                      {row.avg_days_in_stage != null && row.total_leads > 0
                        ? `${row.avg_days_in_stage}d`
                        : "—"}
                    </span>
                  </div>
                </div>
                {/* Barra de proporção */}
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: row.stage_color,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Etapas perdidas separadas */}
      {rows.filter((r) => r.is_lost).map((row) => (
        <div key={row.stage_id} className="rounded-lg border border-red-100 bg-red-50/40 px-3 py-2.5">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-400" />
            <div className="flex-1 flex items-center justify-between">
              <span className="text-sm font-medium text-red-700">
                {row.stage_name}
                <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
                  PERDIDO
                </span>
              </span>
              <div className="flex items-center gap-4 text-sm">
                <span className="w-12 text-right font-semibold text-red-700">{row.total_leads}</span>
                <span className="w-16 text-right text-gray-400">
                  {row.new_in_period > 0 ? `+${row.new_in_period}` : "—"}
                </span>
                <span className="w-24 text-right text-gray-400">—</span>
              </div>
            </div>
          </div>
        </div>
      ))}

      <p className="pt-1 text-right text-[11px] text-gray-400">
        Coluna "No período" = leads criados em {periodLabel} que estão nessa etapa
      </p>
    </div>
  );
}
