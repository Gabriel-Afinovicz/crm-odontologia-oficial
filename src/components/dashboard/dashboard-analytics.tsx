"use client";

import { useState, useTransition } from "react";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { KpiCard } from "./kpi-card";
import { StageFunnelBar } from "./stage-funnel-bar";
import type { AnalyticsPeriod } from "@/lib/supabase/dashboard-data";
import type { DashboardAnalytics, StageFunnelRow } from "@/lib/types/database";

const PERIODS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7d",    label: "7 dias" },
  { value: "30d",   label: "30 dias" },
  { value: "month", label: "Este mês" },
];

interface DashboardAnalyticsProps {
  initialKpis: DashboardAnalytics;
  initialFunnel: StageFunnelRow[];
  initialPeriod?: AnalyticsPeriod;
}

/* ── ícones inline ────────────────────────────────────────────── */
function IconLeads() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}
function IconWarning() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}
function IconTrophy() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 0 0 2.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 0 1 2.916.52 6.003 6.003 0 0 1-5.395 4.972m0 0a6.726 6.726 0 0 1-2.749 1.35m0 0a6.772 6.772 0 0 1-3.044 0" />
    </svg>
  );
}
function IconNoCalendar() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" />
    </svg>
  );
}

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  today: "hoje",
  "7d": "últimos 7 dias",
  "30d": "últimos 30 dias",
  month: "este mês",
};

export function DashboardAnalyticsPanel({
  initialKpis,
  initialFunnel,
  initialPeriod = "30d",
}: DashboardAnalyticsProps) {
  const { companyId } = useCurrentCompany();
  const [period, setPeriod] = useState<AnalyticsPeriod>(initialPeriod);
  const [kpis, setKpis] = useState<DashboardAnalytics>(initialKpis);
  const [funnel, setFunnel] = useState<StageFunnelRow[]>(initialFunnel);
  const [isPending, startTransition] = useTransition();

  async function changePeriod(p: AnalyticsPeriod) {
    if (!companyId || p === period) return;
    setPeriod(p);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/analytics/dashboard?companyId=${companyId}&period=${p}`
        );
        if (res.ok) {
          const data = (await res.json()) as { kpis: DashboardAnalytics; funnel: StageFunnelRow[] };
          setKpis(data.kpis);
          setFunnel(data.funnel);
        }
      } catch { /* silencia erros de rede */ }
    });
  }

  const pLabel = PERIOD_LABELS[period];

  const totalAppointments = kpis.appointments_count;
  const confirmationRateDisplay = totalAppointments > 0
    ? `${kpis.confirmation_rate}%`
    : "—";
  const noShowRateDisplay = totalAppointments > 0
    ? `${kpis.no_show_rate}%`
    : "—";

  return (
    <div className="space-y-6">
      {/* Seletor de período */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Mostrando dados de <span className="font-medium text-gray-800">{pLabel}</span>
          {!["today"].includes(period) && (
            <span className="text-gray-400"> · comparativo com período anterior</span>
          )}
        </p>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              disabled={isPending}
              onClick={() => changePeriod(p.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                period === p.value
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grade de KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Leads novos"
          value={kpis.new_leads}
          subtitle={`no período · ${kpis.active_leads} ativos no total`}
          currentValue={kpis.new_leads}
          prevValue={kpis.prev_new_leads}
          accent="blue"
          icon={<IconLeads />}
        />
        <KpiCard
          title="Agendamentos hoje"
          value={kpis.today_appointments}
          subtitle={`${kpis.appointments_count} agendamentos ${pLabel}`}
          currentValue={kpis.appointments_count}
          prevValue={kpis.prev_appointments_count}
          accent="purple"
          icon={<IconCalendar />}
        />
        <KpiCard
          title="Taxa de confirmação"
          value={confirmationRateDisplay}
          subtitle={`${kpis.confirmed_appointments} confirmados / realizados ${pLabel}`}
          accent="green"
          icon={<IconCheck />}
        />
        <KpiCard
          title="Taxa de no-show"
          value={noShowRateDisplay}
          subtitle={`${kpis.no_shows} faltas ${pLabel}`}
          currentValue={kpis.no_shows}
          prevValue={kpis.prev_no_shows}
          accent="red"
          invertTrend
          icon={<IconWarning />}
        />
      </div>

      {/* Segunda linha de KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          title="Leads inativos 30d+"
          value={kpis.inactive_leads_30d}
          subtitle="sem nenhuma atividade nos últimos 30 dias"
          accent="amber"
          invertTrend
          icon={<IconClock />}
        />
        <KpiCard
          title="Sem agendamento"
          value={kpis.leads_without_appointment}
          subtitle="leads ativos sem nenhuma consulta marcada"
          accent="amber"
          invertTrend
          icon={<IconNoCalendar />}
        />
        <KpiCard
          title="Convertidos (ganhos)"
          value={kpis.won_leads}
          subtitle={`${kpis.lost_in_period} perdidos no período`}
          accent="green"
          icon={<IconTrophy />}
        />
      </div>

      {/* Funil por etapa */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">Funil por etapa do pipeline</h3>
          <span className={`h-2 w-2 rounded-full ${isPending ? "animate-pulse bg-blue-400" : "bg-transparent"}`} />
        </div>
        <StageFunnelBar rows={funnel} periodLabel={pLabel} />
      </div>
    </div>
  );
}
