// ── Enums ────────────────────────────────────────────────────────────────────

export type UserRole = "admin" | "operator" | "super_admin";

export type LeadStatus =
  | "novo"
  | "agendado"
  | "atendido"
  | "finalizado"
  | "perdido";

export type ActivityType =
  | "note"
  | "call_inbound"
  | "call_outbound"
  | "whatsapp"
  | "email"
  | "appointment"
  | "status_change"
  | "assignment";

export type CustomFieldType =
  | "text"
  | "number"
  | "date"
  | "select"
  | "multi_select"
  | "boolean"
  | "phone"
  | "email"
  | "url";

// ── Tabelas ──────────────────────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  company_id: string;
  auth_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  extension_number: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  company_id: string;
  assigned_to: string | null;
  source_id: string | null;
  name: string;
  identifier: string | null;
  email: string | null;
  phone: string | null;
  status: LeadStatus;
  notes: string | null;
  lost_reason: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadSource {
  id: string;
  company_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface Activity {
  id: string;
  company_id: string;
  lead_id: string;
  user_id: string | null;
  activity_type: ActivityType;
  title: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  scheduled_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomField {
  id: string;
  company_id: string;
  name: string;
  field_type: CustomFieldType;
  options: unknown | null;
  is_required: boolean;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

export interface CustomFieldValue {
  id: string;
  company_id: string;
  lead_id: string;
  custom_field_id: string;
  value: string | null;
}

export interface Tag {
  id: string;
  company_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface LeadTag {
  lead_id: string;
  tag_id: string;
}

// ── Views ────────────────────────────────────────────────────────────────────

export interface LeadFunnel {
  company_id: string;
  status: LeadStatus;
  total: number;
  last_7_days: number;
  last_30_days: number;
}

export interface LeadDetailed extends Lead {
  assigned_to_name: string | null;
  source_name: string | null;
}

export interface ActivityDetailed extends Activity {
  user_name: string | null;
  lead_name: string | null;
}

// ── Database (Supabase typed client) ─────────────────────────────────────────

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: Company;
        Insert: Omit<Company, "id" | "created_at" | "updated_at" | "is_active" | "settings"> &
          Partial<Pick<Company, "is_active" | "settings">>;
        Update: Partial<Omit<Company, "id" | "created_at" | "updated_at">>;
      };
      users: {
        Row: User;
        Insert: Omit<User, "id" | "created_at" | "updated_at" | "role" | "is_active"> &
          Partial<Pick<User, "role" | "is_active">>;
        Update: Partial<Omit<User, "id" | "created_at" | "updated_at">>;
      };
      leads: {
        Row: Lead;
        Insert: Omit<Lead, "id" | "created_at" | "updated_at" | "status"> &
          Partial<Pick<Lead, "status">>;
        Update: Partial<Omit<Lead, "id" | "created_at" | "updated_at">>;
      };
      lead_sources: {
        Row: LeadSource;
        Insert: Omit<LeadSource, "id" | "created_at" | "is_active"> &
          Partial<Pick<LeadSource, "is_active">>;
        Update: Partial<Omit<LeadSource, "id" | "created_at">>;
      };
      activities: {
        Row: Activity;
        Insert: Omit<Activity, "id" | "created_at" | "updated_at" | "metadata"> &
          Partial<Pick<Activity, "metadata">>;
        Update: Partial<Omit<Activity, "id" | "created_at" | "updated_at">>;
      };
      custom_fields: {
        Row: CustomField;
        Insert: Omit<CustomField, "id" | "created_at" | "field_type" | "is_required" | "display_order" | "is_active"> &
          Partial<Pick<CustomField, "field_type" | "is_required" | "display_order" | "is_active">>;
        Update: Partial<Omit<CustomField, "id" | "created_at">>;
      };
      custom_field_values: {
        Row: CustomFieldValue;
        Insert: Omit<CustomFieldValue, "id">;
        Update: Partial<Omit<CustomFieldValue, "id">>;
      };
      tags: {
        Row: Tag;
        Insert: Omit<Tag, "id" | "created_at" | "color"> &
          Partial<Pick<Tag, "color">>;
        Update: Partial<Omit<Tag, "id" | "created_at">>;
      };
      lead_tags: {
        Row: LeadTag;
        Insert: LeadTag;
        Update: Partial<LeadTag>;
      };
    };
    Views: {
      vw_lead_funnel: {
        Row: LeadFunnel;
      };
      vw_leads_detailed: {
        Row: LeadDetailed;
      };
      vw_activities_detailed: {
        Row: ActivityDetailed;
      };
    };
    Functions: {
      resolve_login: {
        Args: { p_domain: string; p_extension_number: string };
        Returns: { auth_email: string }[];
      };
      create_user: {
        Args: {
          p_company_id: string;
          p_name: string;
          p_email: string;
          p_extension_number: string;
          p_password: string;
          p_role: "admin" | "operator";
        };
        Returns: string;
      };
      change_user_password: {
        Args: { p_user_id: string; p_new_password: string };
        Returns: void;
      };
      deactivate_user: {
        Args: { p_user_id: string };
        Returns: void;
      };
      reactivate_user: {
        Args: { p_user_id: string };
        Returns: void;
      };
      seed_company_defaults: {
        Args: { p_company_id: string };
        Returns: void;
      };
    };
    Enums: {
      user_role: UserRole;
      lead_status: LeadStatus;
      activity_type: ActivityType;
      custom_field_type: CustomFieldType;
    };
    CompositeTypes: Record<string, never>;
  };
}
