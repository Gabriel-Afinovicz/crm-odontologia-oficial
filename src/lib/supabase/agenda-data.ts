import { cache } from "react";
import { createClient } from "./server";
import type {
  Appointment,
  AppointmentDetailed,
  ProcedureType,
  Room,
  User,
} from "@/lib/types/database";

export const getAgendaResources = cache(async (companyId: string) => {
  const supabase = await createClient();
  const [roomsRes, proceduresRes, dentistsRes] = await Promise.all([
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
      .order("name"),
  ]);
  const dentists =
    ((dentistsRes.data as Pick<User, "id" | "name" | "is_dentist">[] | null) ??
      []).filter((u) => u.is_dentist);
  return {
    rooms: (roomsRes.data as unknown as Room[]) ?? [],
    procedures: (proceduresRes.data as unknown as ProcedureType[]) ?? [],
    dentists,
  };
});

export const getAppointmentsInRange = cache(
  async (
    companyId: string,
    startIso: string,
    endIso: string
  ): Promise<AppointmentDetailed[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("appointments")
      .select(
        `id, company_id, lead_id, dentist_id, room_id, procedure_type_id, starts_at, ends_at, status, notes, created_at, updated_at,
         leads!inner(name),
         users:dentist_id(name),
         rooms:room_id(name, color),
         procedure_types:procedure_type_id(name)`
      )
      .eq("company_id", companyId)
      .gte("starts_at", startIso)
      .lt("starts_at", endIso)
      .order("starts_at", { ascending: true });

    const rows =
      (data as unknown as (Appointment & {
        leads: { name: string } | null;
        users: { name: string } | null;
        rooms: { name: string; color: string } | null;
        procedure_types: { name: string } | null;
      })[] | null) ?? [];

    return rows.map((r) => ({
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
      created_at: r.created_at,
      updated_at: r.updated_at,
      lead_name: r.leads?.name ?? null,
      dentist_name: r.users?.name ?? null,
      room_name: r.rooms?.name ?? null,
      room_color: r.rooms?.color ?? null,
      procedure_name: r.procedure_types?.name ?? null,
    }));
  }
);
