import { cache } from "react";
import { createClient } from "./server";
import type {
  AgendaBlock,
  Appointment,
  AppointmentDetailed,
  ClinicHoliday,
  ClinicHours,
  MessageTemplate,
  ProcedureType,
  Room,
  User,
} from "@/lib/types/database";

export const getAgendaResources = cache(async (companyId: string) => {
  const supabase = await createClient();
  const [roomsRes, proceduresRes, dentistsRes, hoursRes, templatesRes] =
    await Promise.all([
      supabase
        .from("rooms")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("procedure_types")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("users")
        .select("id, name, is_dentist")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .neq("role", "super_admin")
        .order("name"),
      supabase
        .from("clinic_hours")
        .select("*")
        .eq("company_id", companyId)
        .order("weekday"),
      supabase
        .from("message_templates")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
    ]);

  const dentists =
    ((dentistsRes.data as Pick<User, "id" | "name" | "is_dentist">[] | null) ??
      []).filter((u) => u.is_dentist);
  return {
    rooms: (roomsRes.data as unknown as Room[]) ?? [],
    procedures: (proceduresRes.data as unknown as ProcedureType[]) ?? [],
    dentists,
    clinicHours: (hoursRes.data as unknown as ClinicHours[]) ?? [],
    templates: (templatesRes.data as unknown as MessageTemplate[]) ?? [],
  };
});

export interface AgendaViewer {
  userId: string;
  role: "admin" | "operator" | "super_admin";
  tagIds: string[];
}

/**
 * Filtra agendamentos conforme a regra de visibilidade do card.
 * Admins (incluindo super_admin) veem tudo. Demais usuários veem:
 *   - clinic_wide
 *   - assigned_dentist quando o dentista é o próprio usuário
 *   - role_tag quando o usuário possui a tag
 *   - cards atribuídos a ele como dentista (dentist_id) sempre são visíveis
 */
function filterByVisibility(
  rows: AppointmentDetailed[],
  viewer: AgendaViewer | null
): AppointmentDetailed[] {
  if (!viewer) return rows;
  if (viewer.role === "admin" || viewer.role === "super_admin") return rows;
  const tagSet = new Set(viewer.tagIds);
  return rows.filter((a) => {
    if (a.dentist_id === viewer.userId) return true;
    switch (a.visibility) {
      case "clinic_wide":
        return true;
      case "assigned_dentist":
        return a.dentist_id === viewer.userId;
      case "role_tag":
        return a.visibility_tag_id ? tagSet.has(a.visibility_tag_id) : false;
      default:
        return true;
    }
  });
}

export const getAgendaSchedule = cache(
  async (
    companyId: string,
    startIso: string,
    endIso: string,
    viewer: AgendaViewer | null = null
  ): Promise<{
    appointments: AppointmentDetailed[];
    blocks: AgendaBlock[];
    holidays: ClinicHoliday[];
  }> => {
    const supabase = await createClient();
    const startDate = startIso.slice(0, 10);
    const endDate = endIso.slice(0, 10);

    const [appointmentsRes, blocksRes, holidaysRes] = await Promise.all([
      supabase
        .from("appointments")
        .select(
          `id, company_id, lead_id, dentist_id, room_id, procedure_type_id, starts_at, ends_at, status, notes, visibility, visibility_tag_id, created_at, updated_at,
           leads!inner(name, phone),
           users:dentist_id(name),
           rooms:room_id(name, color),
           procedure_types:procedure_type_id(name, default_duration_minutes)`
        )
        .eq("company_id", companyId)
        .gte("starts_at", startIso)
        .lt("starts_at", endIso)
        .order("starts_at", { ascending: true }),
      supabase
        .from("agenda_blocks")
        .select("*")
        .eq("company_id", companyId)
        .lt("starts_at", endIso)
        .gt("ends_at", startIso)
        .order("starts_at", { ascending: true }),
      supabase
        .from("clinic_holidays")
        .select("*")
        .eq("company_id", companyId)
        .gte("date", startDate)
        .lte("date", endDate),
    ]);

    const rows =
      (appointmentsRes.data as unknown as (Appointment & {
        leads: { name: string; phone: string | null } | null;
        users: { name: string } | null;
        rooms: { name: string; color: string } | null;
        procedure_types: {
          name: string;
          default_duration_minutes: number;
        } | null;
      })[] | null) ?? [];

    const appointments: AppointmentDetailed[] = rows.map((r) => ({
      id: r.id,
      company_id: r.company_id,
      lead_id: r.lead_id,
      dentist_id: r.dentist_id,
      room_id: r.room_id,
      procedure_type_id: r.procedure_type_id,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      status: r.status,
      notes: r.notes,
      visibility: r.visibility,
      visibility_tag_id: r.visibility_tag_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      lead_name: r.leads?.name ?? null,
      lead_phone: r.leads?.phone ?? null,
      dentist_name: r.users?.name ?? null,
      room_name: r.rooms?.name ?? null,
      room_color: r.rooms?.color ?? null,
      procedure_name: r.procedure_types?.name ?? null,
      procedure_duration_minutes:
        r.procedure_types?.default_duration_minutes ?? null,
    }));

    return {
      appointments: filterByVisibility(appointments, viewer),
      blocks: (blocksRes.data as unknown as AgendaBlock[]) ?? [],
      holidays: (holidaysRes.data as unknown as ClinicHoliday[]) ?? [],
    };
  }
);

export const getMonthAppointments = cache(
  async (
    companyId: string,
    startIso: string,
    endIso: string
  ): Promise<{ starts_at: string; status: string }[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("appointments")
      .select("starts_at, status")
      .eq("company_id", companyId)
      .gte("starts_at", startIso)
      .lt("starts_at", endIso);
    return (data as { starts_at: string; status: string }[] | null) ?? [];
  }
);
