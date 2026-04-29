import { cache } from "react";
import { createClient } from "./server";
import type {
  ActivityDetailed,
  CustomField,
  CustomFieldValue,
  DashboardAnalytics,
  Lead,
  LeadDetailed,
  PipelineStage,
  Specialty,
  StageFunnelRow,
  Tag,
  User,
} from "@/lib/types/database";

export const getDashboardData = cache(async (companyId: string) => {
  const supabase = await createClient();

  const { data: recentLeads } = await supabase
    .from("leads")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(10);

  return {
    recentLeads: (recentLeads as unknown as Lead[]) ?? [],
  };
});

export type AnalyticsPeriod = "today" | "7d" | "30d" | "month";

function periodToDates(period: AnalyticsPeriod): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setMilliseconds(999);

  switch (period) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "7d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "30d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start, end };
    }
  }
}

export async function getAnalyticsDashboard(
  companyId: string,
  period: AnalyticsPeriod = "30d"
): Promise<{ kpis: DashboardAnalytics; funnel: StageFunnelRow[] }> {
  const supabase = await createClient();
  const { start, end } = periodToDates(period);

  const [kpisRes, funnelRes] = await Promise.all([
    supabase.rpc("get_dashboard_analytics", {
      p_company_id: companyId,
      p_start: start.toISOString(),
      p_end: end.toISOString(),
    }),
    supabase.rpc("get_stage_funnel", {
      p_company_id: companyId,
      p_start: start.toISOString(),
      p_end: end.toISOString(),
    }),
  ]);

  const empty: DashboardAnalytics = {
    new_leads: 0,
    prev_new_leads: 0,
    appointments_count: 0,
    prev_appointments_count: 0,
    today_appointments: 0,
    confirmed_appointments: 0,
    no_shows: 0,
    prev_no_shows: 0,
    active_leads: 0,
    won_leads: 0,
    lost_in_period: 0,
    inactive_leads_30d: 0,
    leads_without_appointment: 0,
    confirmation_rate: 0,
    no_show_rate: 0,
  };

  return {
    kpis: (kpisRes.data as unknown as DashboardAnalytics) ?? empty,
    funnel: (funnelRes.data as unknown as StageFunnelRow[]) ?? [],
  };
}

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    leadsRes,
    operatorsRes,
    stagesRes,
    specialtiesRes,
    lastActivityRes,
    userStageOrderRes,
  ] = await Promise.all([
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
      .neq("role", "super_admin")
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
    user
      ? supabase
          .from("user_pipeline_stage_order")
          .select("stage_ids")
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
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

  const rawStages = (stagesRes.data as unknown as PipelineStage[]) ?? [];
  const userOrder =
    (userStageOrderRes.data as { stage_ids: string[] } | null)?.stage_ids ?? null;

  let stages: PipelineStage[];
  if (userOrder && userOrder.length > 0) {
    const byId = new Map(rawStages.map((s) => [s.id, s] as const));
    const ordered: PipelineStage[] = [];
    const seen = new Set<string>();
    for (const id of userOrder) {
      const stage = byId.get(id);
      if (stage) {
        ordered.push(stage);
        seen.add(id);
      }
    }
    for (const s of rawStages) {
      if (!seen.has(s.id)) ordered.push(s);
    }
    stages = ordered;
  } else {
    stages = rawStages;
  }

  return {
    leads: (leadsRes.data as unknown as KanbanLead[]) ?? [],
    operators: (operatorsRes.data as unknown as KanbanOperator[]) ?? [],
    stages,
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
