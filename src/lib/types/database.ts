// ── Analytics ─────────────────────────────────────────────────────────────────

export interface DashboardAnalytics {
  new_leads: number;
  prev_new_leads: number;
  appointments_count: number;
  prev_appointments_count: number;
  today_appointments: number;
  confirmed_appointments: number;
  no_shows: number;
  prev_no_shows: number;
  active_leads: number;
  won_leads: number;
  lost_in_period: number;
  inactive_leads_30d: number;
  leads_without_appointment: number;
  confirmation_rate: number;
  no_show_rate: number;
}

export interface StageFunnelRow {
  stage_id: string;
  stage_name: string;
  stage_color: string;
  stage_position: number;
  is_won: boolean;
  is_lost: boolean;
  total_leads: number;
  new_in_period: number;
  avg_days_in_stage: number;
}

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
  is_dentist: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipelineStage {
  id: string;
  company_id: string;
  name: string;
  color: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  is_active: boolean;
  legacy_status: LeadStatus | null;
  created_at: string;
  updated_at: string;
}

export interface Specialty {
  id: string;
  company_id: string;
  name: string;
  color: string;
  is_active: boolean;
  created_at: string;
}

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export interface Room {
  id: string;
  company_id: string;
  name: string;
  color: string;
  is_active: boolean;
  created_at: string;
}

export interface ProcedureType {
  id: string;
  company_id: string;
  name: string;
  default_duration_minutes: number;
  default_value: number | null;
  specialty_id: string | null;
  is_active: boolean;
  created_at: string;
}

export type AgendaVisibility = "assigned_dentist" | "role_tag" | "clinic_wide";

export interface Appointment {
  id: string;
  company_id: string;
  lead_id: string;
  dentist_id: string | null;
  room_id: string | null;
  procedure_type_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  notes: string | null;
  visibility: AgendaVisibility;
  visibility_tag_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentDetailed extends Appointment {
  lead_name: string | null;
  lead_phone: string | null;
  dentist_name: string | null;
  room_name: string | null;
  room_color: string | null;
  procedure_name: string | null;
  procedure_duration_minutes: number | null;
}

export interface ClinicHours {
  id: string;
  company_id: string;
  weekday: number;
  is_open: boolean;
  opens_at: string;
  closes_at: string;
  lunch_start: string | null;
  lunch_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClinicHoliday {
  id: string;
  company_id: string;
  date: string;
  name: string;
  created_at: string;
}

export interface AgendaBlock {
  id: string;
  company_id: string;
  dentist_id: string | null;
  room_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string;
}

export type AvailabilityReason =
  | "closed"
  | "lunch"
  | "holiday"
  | "block"
  | "appointment";

export interface DentistAvailabilityInterval {
  starts_at: string;
  ends_at: string;
  kind: "appointment" | "block";
  label: string;
}

export interface DentistAvailabilityRow {
  dentist_id: string;
  dentist_name: string;
  is_open: boolean;
  opens_at: string | null;
  closes_at: string | null;
  busy_minutes: number;
  free_minutes: number;
  busy_intervals: DentistAvailabilityInterval[];
}

export type MessageTemplateKind =
  | "confirmation"
  | "reminder"
  | "post_visit"
  | "birthday"
  | "custom";

export interface MessageTemplate {
  id: string;
  company_id: string;
  kind: MessageTemplateKind;
  name: string;
  body: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type AppointmentConfirmationStatus =
  | "pending"
  | "confirmed"
  | "reschedule_requested"
  | "expired";

export interface AppointmentConfirmation {
  id: string;
  appointment_id: string;
  company_id: string;
  token: string;
  status: AppointmentConfirmationStatus;
  created_at: string;
  responded_at: string | null;
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
  stage_id: string;
  specialty_id: string | null;
  notes: string | null;
  lost_reason: string | null;
  converted_at: string | null;
  kanban_position: number;
  photo_url: string | null;
  birthdate: string | null;
  gender: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  allergies: string | null;
  clinical_notes: string | null;
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

export interface UserRoleTag {
  id: string;
  company_id: string;
  name: string;
  color: string;
  marks_as_dentist: boolean;
  is_active: boolean;
  created_at: string;
}

export interface UserRoleTagAssignment {
  user_id: string;
  tag_id: string;
}

export type WhatsAppInstanceStatus =
  | "disconnected"
  | "connecting"
  | "connected";

export interface WhatsAppInstance {
  id: string;
  company_id: string;
  instance_name: string;
  status: WhatsAppInstanceStatus;
  phone_number: string | null;
  evolution_token: string | null;
  connected_at: string | null;
  // Timestamp do ultimo sync automatico disparado apos login. Cooldown
  // server-side evita rajadas a Evolution quando varios operadores logam
  // ao mesmo tempo ou recarregam o app.
  last_post_login_sync_at: string | null;
  // Timestamp do ultimo sync manual (botao Sincronizar em Settings).
  // Cooldown server-side de 60s sobrevive a F5/sessao nova/multi-aba e
  // protege as chamadas mais sensiveis (whatsappNumbers em batches).
  last_manual_sync_at: string | null;
  // Heartbeat do webhook da Evolution. Atualizado pelo proprio handler do
  // webhook com throttle server-side de 15s (condicional no WHERE da query).
  // O cliente (`useWhatsAppHealth`) usa para detectar que o webhook esta
  // vivo e suspender o polling de fallback em `conversas-content`. Null
  // significa que nenhum webhook foi recebido ainda — comportamento
  // equivalente ao "nao confio no webhook ainda" do cliente.
  webhook_last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppChat {
  id: string;
  company_id: string;
  instance_id: string;
  remote_jid: string;
  name: string | null;
  lead_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  /**
   * `true` quando a ultima mensagem do chat foi enviada por mim (operador
   * via CRM ou pelo celular do dono da instancia). `false` se foi recebida
   * do contato. `null` apenas para chats antigos sem backfill.
   *
   * Usado pela UI da lista lateral para decidir se mostra os checks de
   * WhatsApp ao lado da previa (so quando `true`, igual o app oficial).
   */
  last_message_from_me: boolean | null;
  /**
   * Status (`pending`/`sent`/`delivered`/`read`/`failed`) da ultima
   * mensagem do chat. Significativo apenas quando `last_message_from_me`
   * e `true`. Atualizado pelo webhook `messages.update` quando o
   * destinatario confirma recebimento/leitura.
   */
  last_message_status: WhatsAppMessageStatus | null;
  unread_count: number;
  is_archived: boolean;
  profile_picture_url: string | null;
  created_at: string;
  updated_at: string;
}

export type WhatsAppMessageDirection = "in" | "out";
export type WhatsAppMessageMediaType =
  | "text"
  | "image"
  | "audio"
  | "document"
  | "sticker"
  | "video"
  | "location"
  | "contact"
  | "unknown";
export type WhatsAppMessageStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

// Reacao ao estilo WhatsApp: cada reator pode ter no maximo UMA reacao ativa
// por mensagem (ao reagir de novo, substitui a anterior; ao enviar string
// vazia, remove). Guardamos um array porque em chat individual podem coexistir
// reacao do operador e reacao do contato na mesma mensagem.
//
// - `emoji`: emoji escolhido (string vazia significa remocao e nao deve ser
//   persistida — `mergeReactions` filtra).
// - `from_me`: true quando a reacao foi feita pela clinica (via CRM ou
//   celular do operador); false quando foi o contato. Conta como heuristica
//   de cor/posicao na bolha.
// - `reactor_jid`: JID de quem reagiu (quando disponivel pelo Baileys). Em
//   chat individual e quase sempre `remoteJid` do chat (para `from_me=false`)
//   ou o JID da nossa instancia. Em chats `@lid` pode vir o `@lid` ou o
//   `remoteJidAlt` real. Usado para `mergeReactions` decidir override.
// - `ts`: timestamp ISO de quando a reacao foi observada — desempata reacoes
//   atualizadas em rajada (cliente envia, webhook chega depois).
export interface WhatsAppMessageReaction {
  emoji: string;
  from_me: boolean;
  reactor_jid: string | null;
  ts: string;
}

export interface WhatsAppMessage {
  id: string;
  company_id: string;
  chat_id: string;
  evolution_message_id: string | null;
  direction: WhatsAppMessageDirection;
  from_me: boolean;
  body: string | null;
  media_type: WhatsAppMessageMediaType;
  media_url: string | null;
  media_mime_type: string | null;
  status: WhatsAppMessageStatus;
  error_message: string | null;
  sent_at: string | null;
  received_at: string | null;
  sender_user_id: string | null;
  // Reply ao estilo WhatsApp: snapshot do que foi citado. Sem FK para a
  // mensagem original porque ela pode nao existir no banco (mensagem antiga
  // que ainda nao foi sincronizada). quoted_evolution_message_id e a chave
  // soft para tentar localizar a mensagem original quando precisarmos rolar
  // ate ela na UI.
  quoted_evolution_message_id: string | null;
  quoted_body: string | null;
  quoted_from_me: boolean | null;
  // Reacoes acumuladas. Webhook (entrada) e a rota /react (saida) usam
  // `mergeReactions` para manter no maximo 1 emoji por reator. UI agrega
  // por emoji para mostrar badges abaixo da bolha.
  reactions: WhatsAppMessageReaction[];
  // Edicao de mensagem (Leva 3 — maio/2026). Quando a Evolution entrega
  // MESSAGES_EDITED, o webhook atualiza `body` com o novo texto e popula
  // estes campos. `original_body` guarda o texto antes da primeira edicao;
  // `edit_count` conta quantas vezes a mensagem foi editada.
  edited_at: string | null;
  original_body: string | null;
  edit_count: number;
  created_at: string;
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
  assigned_is_dentist: boolean | null;
  source_name: string | null;
  stage_name: string | null;
  stage_color: string | null;
  stage_position: number | null;
  stage_is_won: boolean | null;
  stage_is_lost: boolean | null;
  specialty_name: string | null;
  specialty_color: string | null;
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
        Insert: Omit<
          Lead,
          "id" | "created_at" | "updated_at" | "status" | "specialty_id" | "kanban_position"
        > &
          Partial<Pick<Lead, "status" | "specialty_id" | "kanban_position">>;
        Update: Partial<Omit<Lead, "id" | "created_at" | "updated_at">>;
      };
      pipeline_stages: {
        Row: PipelineStage;
        Insert: Omit<
          PipelineStage,
          "id" | "created_at" | "updated_at" | "is_active" | "is_won" | "is_lost" | "color" | "position"
        > &
          Partial<
            Pick<
              PipelineStage,
              "id" | "is_active" | "is_won" | "is_lost" | "color" | "position" | "legacy_status"
            >
          >;
        Update: Partial<Omit<PipelineStage, "id" | "created_at" | "updated_at">>;
      };
      specialties: {
        Row: Specialty;
        Insert: Omit<Specialty, "id" | "created_at" | "is_active" | "color"> &
          Partial<Pick<Specialty, "is_active" | "color">>;
        Update: Partial<Omit<Specialty, "id" | "created_at">>;
      };
      rooms: {
        Row: Room;
        Insert: Omit<Room, "id" | "created_at" | "is_active" | "color"> &
          Partial<Pick<Room, "is_active" | "color">>;
        Update: Partial<Omit<Room, "id" | "created_at">>;
      };
      procedure_types: {
        Row: ProcedureType;
        Insert: Omit<
          ProcedureType,
          "id" | "created_at" | "is_active" | "default_duration_minutes" | "default_value" | "specialty_id"
        > &
          Partial<
            Pick<
              ProcedureType,
              "is_active" | "default_duration_minutes" | "default_value" | "specialty_id"
            >
          >;
        Update: Partial<Omit<ProcedureType, "id" | "created_at">>;
      };
      appointments: {
        Row: Appointment;
        Insert: Omit<
          Appointment,
          "id" | "created_at" | "updated_at" | "status" | "notes"
        > &
          Partial<Pick<Appointment, "status" | "notes">>;
        Update: Partial<Omit<Appointment, "id" | "created_at" | "updated_at">>;
      };
      clinic_hours: {
        Row: ClinicHours;
        Insert: Omit<ClinicHours, "id" | "created_at" | "updated_at"> &
          Partial<Pick<ClinicHours, "is_open" | "lunch_start" | "lunch_end">>;
        Update: Partial<Omit<ClinicHours, "id" | "created_at" | "updated_at">>;
      };
      clinic_holidays: {
        Row: ClinicHoliday;
        Insert: Omit<ClinicHoliday, "id" | "created_at">;
        Update: Partial<Omit<ClinicHoliday, "id" | "created_at">>;
      };
      agenda_blocks: {
        Row: AgendaBlock;
        Insert: Omit<AgendaBlock, "id" | "created_at">;
        Update: Partial<Omit<AgendaBlock, "id" | "created_at">>;
      };
      message_templates: {
        Row: MessageTemplate;
        Insert: Omit<MessageTemplate, "id" | "created_at" | "updated_at" | "is_active"> &
          Partial<Pick<MessageTemplate, "is_active">>;
        Update: Partial<Omit<MessageTemplate, "id" | "created_at" | "updated_at">>;
      };
      appointment_confirmations: {
        Row: AppointmentConfirmation;
        Insert: Omit<AppointmentConfirmation, "id" | "created_at" | "responded_at" | "status"> &
          Partial<Pick<AppointmentConfirmation, "status" | "responded_at">>;
        Update: Partial<Omit<AppointmentConfirmation, "id" | "created_at">>;
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
      user_role_tags: {
        Row: UserRoleTag;
        Insert: Omit<UserRoleTag, "id" | "created_at" | "is_active" | "color" | "marks_as_dentist"> &
          Partial<Pick<UserRoleTag, "is_active" | "color" | "marks_as_dentist">>;
        Update: Partial<Omit<UserRoleTag, "id" | "created_at">>;
      };
      user_role_tag_assignments: {
        Row: UserRoleTagAssignment;
        Insert: UserRoleTagAssignment;
        Update: Partial<UserRoleTagAssignment>;
      };
      whatsapp_instances: {
        Row: WhatsAppInstance;
        Insert: Omit<
          WhatsAppInstance,
          | "id"
          | "created_at"
          | "updated_at"
          | "status"
          | "phone_number"
          | "evolution_token"
          | "connected_at"
          | "last_post_login_sync_at"
          | "last_manual_sync_at"
          | "webhook_last_seen_at"
        > &
          Partial<
            Pick<
              WhatsAppInstance,
              | "status"
              | "phone_number"
              | "evolution_token"
              | "connected_at"
              | "last_post_login_sync_at"
              | "last_manual_sync_at"
              | "webhook_last_seen_at"
            >
          >;
        Update: Partial<Omit<WhatsAppInstance, "id" | "created_at">>;
      };
      whatsapp_chats: {
        Row: WhatsAppChat;
        Insert: Omit<
          WhatsAppChat,
          | "id"
          | "created_at"
          | "updated_at"
          | "unread_count"
          | "is_archived"
          | "name"
          | "last_message_at"
          | "last_message_preview"
          | "lead_id"
          | "profile_picture_url"
        > &
          Partial<
            Pick<
              WhatsAppChat,
              | "unread_count"
              | "is_archived"
              | "name"
              | "last_message_at"
              | "last_message_preview"
              | "lead_id"
              | "profile_picture_url"
            >
          >;
        Update: Partial<Omit<WhatsAppChat, "id" | "created_at">>;
      };
      whatsapp_messages: {
        Row: WhatsAppMessage;
        Insert: Omit<
          WhatsAppMessage,
          | "id"
          | "created_at"
          | "from_me"
          | "media_type"
          | "status"
          | "evolution_message_id"
          | "body"
          | "media_url"
          | "media_mime_type"
          | "error_message"
          | "sent_at"
          | "received_at"
          | "sender_user_id"
          | "quoted_evolution_message_id"
          | "quoted_body"
          | "quoted_from_me"
          | "edited_at"
          | "original_body"
          | "edit_count"
        > &
          Partial<
            Pick<
              WhatsAppMessage,
              | "from_me"
              | "media_type"
              | "status"
              | "evolution_message_id"
              | "body"
              | "media_url"
              | "media_mime_type"
              | "error_message"
              | "sent_at"
              | "received_at"
              | "sender_user_id"
              | "quoted_evolution_message_id"
              | "quoted_body"
              | "quoted_from_me"
              | "edited_at"
              | "original_body"
              | "edit_count"
            >
          >;
        Update: Partial<Omit<WhatsAppMessage, "id" | "created_at">>;
      };
      user_pipeline_stage_order: {
        Row: {
          user_id: string;
          company_id: string;
          stage_ids: string[];
          updated_at: string;
        };
        Insert: {
          user_id: string;
          company_id: string;
          stage_ids: string[];
          updated_at?: string;
        };
        Update: Partial<{
          user_id: string;
          company_id: string;
          stage_ids: string[];
          updated_at: string;
        }>;
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
      find_lead_by_phone: {
        Args: { p_company_id: string; p_phone: string };
        Returns: string | null;
      };
      apply_kanban_move: {
        Args: {
          p_lead_id: string;
          p_from_status: LeadStatus;
          p_to_status: LeadStatus;
          p_dest_ordered_ids: string[];
          p_source_ordered_ids: string[];
        };
        Returns: void;
      };
      check_appointment_conflict: {
        Args: {
          p_dentist_id: string | null;
          p_room_id: string | null;
          p_starts_at: string;
          p_ends_at: string;
          p_exclude_id?: string | null;
        };
        Returns: boolean;
      };
      check_appointment_availability: {
        Args: {
          p_company_id: string;
          p_dentist_id: string | null;
          p_room_id: string | null;
          p_starts_at: string;
          p_ends_at: string;
          p_exclude_id?: string | null;
        };
        Returns: AvailabilityReason | null;
      };
      get_dentist_availability: {
        Args: {
          p_company_id: string;
          p_date: string;
        };
        Returns: DentistAvailabilityRow[];
      };
      apply_kanban_move_v2: {
        Args: {
          p_lead_id: string;
          p_from_stage_id: string;
          p_to_stage_id: string;
          p_dest_ordered_ids: string[];
          p_source_ordered_ids: string[];
          p_specialty_id?: string | null;
          p_lost_reason?: string | null;
        };
        Returns: void;
      };
      reorder_pipeline_stages: {
        Args: {
          p_ordered_ids: string[];
        };
        Returns: void;
      };
      confirmation_lookup: {
        Args: { p_domain: string; p_token: string };
        Returns: {
          appointment_id: string;
          status: AppointmentConfirmationStatus;
          starts_at: string;
          ends_at: string;
          patient_name: string;
          dentist_name: string | null;
          clinic_name: string;
        }[];
      };
      confirmation_respond: {
        Args: { p_domain: string; p_token: string; p_action: string };
        Returns: string;
      };
      get_dashboard_analytics: {
        Args: {
          p_company_id: string;
          p_start: string;
          p_end: string;
        };
        Returns: DashboardAnalytics;
      };
      get_stage_funnel: {
        Args: {
          p_company_id: string;
          p_start: string;
          p_end: string;
        };
        Returns: StageFunnelRow[];
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
