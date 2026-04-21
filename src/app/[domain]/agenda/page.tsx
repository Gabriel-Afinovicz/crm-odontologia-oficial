import { redirect } from "next/navigation";
import { getAuthSession, getDomainCompany } from "@/lib/supabase/cached-data";
import {
  getAgendaResources,
  getAppointmentsInRange,
} from "@/lib/supabase/agenda-data";
import { AgendaContent } from "./agenda-content";

interface AgendaPageProps {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ date?: string; view?: string }>;
}

function parseDateOrToday(value?: string): Date {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}

export default async function AgendaPage({
  params,
  searchParams,
}: AgendaPageProps) {
  const { domain } = await params;
  const { date, view } = await searchParams;

  const [{ user }, company] = await Promise.all([
    getAuthSession(),
    getDomainCompany(domain),
  ]);

  if (!user) redirect(`/${domain}`);
  if (!company) redirect(`/${domain}/dashboard`);

  const viewMode = view === "week" ? "week" : "day";
  const selectedDate = parseDateOrToday(date);

  const rangeStart =
    viewMode === "week" ? startOfWeek(selectedDate) : startOfDay(selectedDate);
  const rangeEnd = addDays(rangeStart, viewMode === "week" ? 7 : 1);

  const [resources, appointments] = await Promise.all([
    getAgendaResources(company.id),
    getAppointmentsInRange(
      company.id,
      rangeStart.toISOString(),
      rangeEnd.toISOString()
    ),
  ]);

  return (
    <AgendaContent
      domain={domain}
      viewMode={viewMode}
      selectedDate={selectedDate.toISOString()}
      rangeStart={rangeStart.toISOString()}
      rangeEnd={rangeEnd.toISOString()}
      appointments={appointments}
      rooms={resources.rooms}
      procedures={resources.procedures}
      dentists={resources.dentists}
    />
  );
}
