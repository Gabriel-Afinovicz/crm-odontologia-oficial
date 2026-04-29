"use client";

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  /** Valor do período anterior para cálculo de variação */
  prevValue?: number;
  currentValue?: number;
  /** Unidade exibida depois do valor (ex: "%" ) */
  unit?: string;
  /** Cor do ícone/acento */
  accent?: "blue" | "green" | "red" | "amber" | "purple" | "gray";
  icon: React.ReactNode;
  /** Se true, variação positiva é ruim (ex: no-shows, inativos) */
  invertTrend?: boolean;
}

const ACCENT = {
  blue:   { bg: "bg-blue-50",   icon: "text-blue-600",   ring: "ring-blue-100" },
  green:  { bg: "bg-emerald-50",icon: "text-emerald-600",ring: "ring-emerald-100" },
  red:    { bg: "bg-red-50",    icon: "text-red-600",    ring: "ring-red-100" },
  amber:  { bg: "bg-amber-50",  icon: "text-amber-600",  ring: "ring-amber-100" },
  purple: { bg: "bg-purple-50", icon: "text-purple-600", ring: "ring-purple-100" },
  gray:   { bg: "bg-gray-100",  icon: "text-gray-500",   ring: "ring-gray-200" },
};

export function KpiCard({
  title,
  value,
  subtitle,
  prevValue,
  currentValue,
  unit,
  accent = "blue",
  icon,
  invertTrend = false,
}: KpiCardProps) {
  const colors = ACCENT[accent];

  let delta: number | null = null;
  let deltaLabel = "";
  let deltaPositive = true;

  if (prevValue !== undefined && currentValue !== undefined && prevValue > 0) {
    delta = Math.round(((currentValue - prevValue) / prevValue) * 100);
    deltaLabel = `${delta >= 0 ? "+" : ""}${delta}% vs anterior`;
    deltaPositive = invertTrend ? delta <= 0 : delta >= 0;
  } else if (prevValue !== undefined && currentValue !== undefined && prevValue === 0 && currentValue > 0) {
    deltaLabel = "novo no período";
    deltaPositive = !invertTrend;
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${colors.bg} ${colors.ring}`}>
          <span className={colors.icon}>{icon}</span>
        </span>
      </div>

      <div>
        <p className="text-3xl font-bold tracking-tight text-gray-900">
          {value}
          {unit && <span className="ml-1 text-base font-medium text-gray-500">{unit}</span>}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>
        )}
      </div>

      {deltaLabel && (
        <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
          deltaPositive
            ? "bg-emerald-50 text-emerald-700"
            : "bg-red-50 text-red-700"
        }`}>
          {delta !== null && (
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d={
                delta >= 0
                  ? "M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941"
                  : "M2.25 6 9 12.75l4.306-4.306a11.95 11.95 0 0 1 5.814 5.518l2.74 1.22m0 0-5.94 2.281m5.94-2.28-2.28-5.941"
              } />
            </svg>
          )}
          {deltaLabel}
        </span>
      )}
    </div>
  );
}
