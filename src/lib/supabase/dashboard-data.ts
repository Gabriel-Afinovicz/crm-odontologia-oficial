import { cache } from "react";
import { createClient } from "./server";
import type {
  ActivityDetailed,
  CustomField,
  CustomFieldValue,
  Lead,
  LeadDetailed,
  LeadFunnel,
  PipelineStage,
  Specialty,
  Tag,
  User,
} from "@/lib/types/database";

export const getDashboardData = cache(async (companyId: string) => {
  const supabase = await createClient();

  const [funnelRes, recentLeadsRes] = await Promise.all([
    supabase
      .from("vw_lead_funnel")
      .select("*")
      .eq("company_id", companyId),
    supabase
      .from("leads")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return {
    funnel: (funnelRes.data as unknown as LeadFunnel[]) ?? [],
    recentLeads: (recentLeadsRes.data as unknown as Lead[]) ?? [],
  };
});

export const getLeadActivities = cache(
  async (companyId: string, leadId: string): Promise<ActivityDetailed[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("vw_activities_detailed")
      .select("*")
      .eq("company_id", companyId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });

    return (data as unknown as ActivityDetailed[]) ?? [];
  }
);

export type KanbanLead = Pick<
  LeadDetailed,
  | "id"
  | "name"
  | "status"
  | "stage_id"
  | "specialty_id"
  | "specialty_name"
  | "specialty_color"
  | "phone"
  | "email"
  | "assigned_to"
  | "assigned_to_name"
  | "assigned_is_dentist"
  | "source_name"
  | "kanban_position"
  | "photo_url"
  | "birthdate"
  | "allergies"
  | "created_at"
  | "updated_at"
>;

export type KanbanOperator = Pick<User, "id" | "name" | "is_dentist">;

export const getKanbanData = cache(async (companyId: string) => {
  const supabase = await createClient();

  const [leadsRes, operatorsRes, stagesRes, specialtiesRes, lastActivityRes] =
    await Promise.all([
      supabase
        .from("vw_leads_detailed")
        .select(
          "id,name,status,stage_id,specialty_id,specialty_name,specialty_color,phone,email,assigned_to,assigned_to_name,assigned_is_dentist,source_name,kanban_position,photo_url,birthdate,allergies,created_at,updated_at"
        )
        .eq("company_id", companyId)
        .order("kanban_position", { ascending: true })
        .order("created_at", { ascending: false }),
      supabase
        .from("users")
        .select("id, name, is_dentist")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("pipeline_stages")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("position", { ascending: true }),
      supabase
        .from("specialties")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("activities")
        .select("lead_id, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }),
    ]);

  const lastActivityMap = new Map<string, string>();
  const rows =
    (lastActivityRes.data as { lead_id: string; created_at: string }[] | null) ??
    [];
  for (const row of rows) {
    if (!lastActivityMap.has(row.lead_id)) {
      lastActivityMap.set(row.lead_id, row.created_at);
    }
  }

  return {
    leads: (leadsRes.data as unknown as KanbanLead[]) ?? [],
    operators: (operatorsRes.data as unknown as KanbanOperator[]) ?? [],
    stages: (stagesRes.data as unknown as PipelineStage[]) ?? [],
    specialties: (specialtiesRes.data as unknown as Specialty[]) ?? [],
    lastActivityByLead: Object.fromEntries(lastActivityMap) as Record<
      string,
      string
    >,
  };
});

export const getLeadSidebarData = cache(
  async (companyId: string, leadId: string) => {
    const supabase = await createClient();

    const [allTagsRes, leadTagsRes, customFieldsRes, customValuesRes] =
      await Promise.all([
        supabase
          .from("tags")
          .select("*")
          .eq("company_id", companyId)
          .order("name"),
        supabase.from("lead_tags").select("tag_id").eq("lead_id", leadId),
        supabase
          .from("custom_fields")
          .select("*")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("display_order"),
        supabase
          .from("custom_field_values")
          .select("*")
          .eq("company_id", companyId)
          .eq("lead_id", leadId),
      ]);

    const allTags = (allTagsRes.data as unknown as Tag[]) ?? [];
    const leadTagIds = new Set(
      ((leadTagsRes.data as { tag_id: string }[] | null) ?? []).map(
        (t) => t.tag_id
      )
    );
    const assignedTags = allTags.filter((t) => leadTagIds.has(t.id));

    return {
      allTags,
      assignedTags,
      customFields: (customFieldsRes.data as unknown as CustomField[]) ?? [],
      customFieldValues:
        (customValuesRes.data as unknown as CustomFieldValue[]) ?? [],
    };
  }
);
