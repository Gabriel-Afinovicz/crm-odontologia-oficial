export type UserRole = "admin" | "operator";

export type LeadStatus =
  | "novo"
  | "agendado"
  | "atendido"
  | "finalizado"
  | "perdido";

export interface Company {
  id: string;
  name: string;
  domain: string;
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  company_id: string;
  auth_id: string;
  name: string;
  email: string;
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
  phone: string | null;
  status: LeadStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadSource {
  id: string;
  company_id: string;
  name: string;
  created_at: string;
}

export interface Activity {
  id: string;
  company_id: string;
  lead_id: string;
  user_id: string;
  activity_type: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Tag {
  id: string;
  company_id: string;
  name: string;
  color: string;
}

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
  user_name: string;
  lead_name: string;
}

// Supabase Database type for typed client
export interface Database {
  public: {
    Tables: {
      companies: {
        Row: Company;
        Insert: Omit<Company, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Company, "id" | "created_at" | "updated_at">>;
      };
      users: {
        Row: User;
        Insert: Omit<User, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<User, "id" | "created_at" | "updated_at">>;
      };
      leads: {
        Row: Lead;
        Insert: Omit<Lead, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Lead, "id" | "created_at" | "updated_at">>;
      };
      lead_sources: {
        Row: LeadSource;
        Insert: Omit<LeadSource, "id" | "created_at">;
        Update: Partial<Omit<LeadSource, "id" | "created_at">>;
      };
      activities: {
        Row: Activity;
        Insert: Omit<Activity, "id" | "created_at">;
        Update: Partial<Omit<Activity, "id" | "created_at">>;
      };
      tags: {
        Row: Tag;
        Insert: Omit<Tag, "id">;
        Update: Partial<Omit<Tag, "id">>;
      };
      lead_tags: {
        Row: { lead_id: string; tag_id: string };
        Insert: { lead_id: string; tag_id: string };
        Update: Partial<{ lead_id: string; tag_id: string }>;
      };
      custom_fields: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          field_type: string;
          options: unknown | null;
        };
        Insert: Omit<
          { id: string; company_id: string; name: string; field_type: string; options: unknown | null },
          "id"
        >;
        Update: Partial<
          Omit<
            { id: string; company_id: string; name: string; field_type: string; options: unknown | null },
            "id"
          >
        >;
      };
      custom_field_values: {
        Row: {
          id: string;
          company_id: string;
          lead_id: string;
          custom_field_id: string;
          value: string | null;
        };
        Insert: Omit<
          { id: string; company_id: string; lead_id: string; custom_field_id: string; value: string | null },
          "id"
        >;
        Update: Partial<
          Omit<
            { id: string; company_id: string; lead_id: string; custom_field_id: string; value: string | null },
            "id"
          >
        >;
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
          p_role: UserRole;
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
    };
    CompositeTypes: Record<string, never>;
  };
}
