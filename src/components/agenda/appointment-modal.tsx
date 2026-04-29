"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { AvailabilityPanel } from "./availability-panel";
import type {
  AgendaVisibility,
  AppointmentDetailed,
  AvailabilityReason,
  Lead,
  ProcedureType,
  Room,
  Specialty,
  User,
  UserRoleTag,
} from "@/lib/types/database";

const AVAILABILITY_MESSAGES: Record<AvailabilityReason, string> = {
  closed:
    "O dentista n\u00e3o est\u00e1 dispon\u00edvel neste hor\u00e1rio (fora do expediente da cl\u00ednica).",
  lunch:
    "O hor\u00e1rio escolhido cai durante o intervalo de almo\u00e7o da cl\u00ednica.",
  holiday: "Esta data \u00e9 feriado da cl\u00ednica.",
  block:
    "Este intervalo est\u00e1 bloqueado na agenda (dentista, sala ou bloqueio geral).",
  appointment:
    "J\u00e1 existe outro agendamento para este dentista ou sala neste intervalo.",
};

const VISIBILITY_LABELS: Record<AgendaVisibility, string> = {
  assigned_dentist: "Apenas o dentista atribu\u00eddo",
  role_tag: "Por fun\u00e7\u00e3o (tag)",
  clinic_wide: "Toda a cl\u00ednica",
};

const VISIBILITY_HELP: Record<AgendaVisibility, string> = {
  assigned_dentist:
    "Visivel para o dentista escolhido (e admins). Outros dentistas n\u00e3o ver\u00e3o este card.",
  role_tag:
    "Visivel para todos os usu\u00e1rios que tenham a fun\u00e7\u00e3o selecionada (e admins).",
  clinic_wide:
    "Visivel para todos os usu\u00e1rios da cl\u00ednica (recep\u00e7\u00e3o e dentistas).",
};

const ROOM_PRESET_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#6366f1",
];

function parseDecimal(input: string) {
  const cleaned = input.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

interface BasePrefill {
  startsAt?: string;
  endsAt?: string;
  dentistId?: string | null;
  roomId?: string | null;
  procedureId?: string | null;
  leadId?: string;
  notes?: string;
}

type AppointmentModalProps = {
  rooms: Room[];
  procedures: ProcedureType[];
  dentists: Pick<User, "id" | "name" | "is_dentist">[];
  onClose: () => void;
  onSaved?: () => void;
} & (
  | { mode: "create"; prefill?: BasePrefill; appointment?: undefined }
  | { mode: "edit"; appointment: AppointmentDetailed; prefill?: undefined }
);

function toDatetimeLocal(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function diffMinutes(startIso: string, endIso: string) {
  return Math.max(
    5,
    Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000)
  );
}

function addMinutesIso(iso: string, minutes: number) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

export function AppointmentModal(props: AppointmentModalProps) {
  const { rooms, procedures, dentists, onClose, onSaved } = props;
  const { companyId } = useCurrentCompany();
  const isEdit = props.mode === "edit";
  const initial: BasePrefill =
    props.mode === "edit"
      ? {
          startsAt: props.appointment.starts_at,
          endsAt: props.appointment.ends_at,
          dentistId: props.appointment.dentist_id,
          roomId: props.appointment.room_id,
          procedureId: props.appointment.procedure_type_id,
          leadId: props.appointment.lead_id,
          notes: props.appointment.notes ?? "",
        }
      : props.prefill ?? {};

  const initialVisibility: AgendaVisibility =
    props.mode === "edit"
      ? props.appointment.visibility ?? "assigned_dentist"
      : initial.dentistId
        ? "assigned_dentist"
        : "clinic_wide";
  const initialVisibilityTagId: string =
    props.mode === "edit"
      ? props.appointment.visibility_tag_id ?? ""
      : "";

  const [visibility, setVisibility] =
    useState<AgendaVisibility>(initialVisibility);
  const [visibilityTagId, setVisibilityTagId] =
    useState<string>(initialVisibilityTagId);
  const [tags, setTags] = useState<UserRoleTag[]>([]);

  const [startsAt, setStartsAt] = useState(toDatetimeLocal(initial.startsAt));
  const [duration, setDuration] = useState(
    initial.startsAt && initial.endsAt
      ? diffMinutes(initial.startsAt, initial.endsAt)
      : 30
  );
  const [dentistId, setDentistId] = useState<string>(initial.dentistId ?? "");
  const [roomId, setRoomId] = useState<string>(initial.roomId ?? "");
  const [procedureId, setProcedureId] = useState<string>(initial.procedureId ?? "");
  const [leadId, setLeadId] = useState<string>(initial.leadId ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [leadName, setLeadName] = useState(
    isEdit ? props.appointment.lead_name ?? "" : ""
  );
  const [leadSearch, setLeadSearch] = useState("");
  const [leadOptions, setLeadOptions] = useState<Pick<Lead, "id" | "name">[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lockedLead = isEdit || Boolean(initial.leadId);

  const [proceduresList, setProceduresList] = useState<ProcedureType[]>(procedures);
  const [roomsList, setRoomsList] = useState<Room[]>(rooms);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);

  useEffect(() => {
    setProceduresList((prev) => {
      const incomingIds = new Set(procedures.map((p) => p.id));
      const localExtras = prev.filter((p) => !incomingIds.has(p.id));
      return [...procedures, ...localExtras].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    });
  }, [procedures]);

  useEffect(() => {
    setRoomsList((prev) => {
      const incomingIds = new Set(rooms.map((r) => r.id));
      const localExtras = prev.filter((r) => !incomingIds.has(r.id));
      return [...rooms, ...localExtras].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    });
  }, [rooms]);

  const [showProcedureForm, setShowProcedureForm] = useState(false);
  const [newProcedure, setNewProcedure] = useState({
    name: "",
    duration: "30",
    value: "",
    specialtyId: "",
  });
  const [creatingProcedure, setCreatingProcedure] = useState(false);

  const [showRoomForm, setShowRoomForm] = useState(false);
  const [newRoom, setNewRoom] = useState({
    name: "",
    color: ROOM_PRESET_COLORS[0],
  });
  const [creatingRoom, setCreatingRoom] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    if (specialties.length > 0) return;
    if (!showProcedureForm) return;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("specialties")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name");
      setSpecialties((data as unknown as Specialty[]) ?? []);
    })();
  }, [companyId, showProcedureForm, specialties.length]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("user_role_tags")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name");
      if (!cancelled) {
        setTags((data as unknown as UserRoleTag[]) ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function handleCreateProcedure() {
    if (!companyId) return;
    const trimmed = newProcedure.name.trim();
    if (!trimmed) {
      setError("Informe o nome do procedimento.");
      return;
    }
    const dur = parseInt(newProcedure.duration, 10);
    if (!Number.isFinite(dur) || dur < 5) {
      setError("Duração inválida (mínimo 5 minutos).");
      return;
    }
    setError(null);
    setCreatingProcedure(true);
    const supabase = createClient();
    const value = parseDecimal(newProcedure.value);
    const { data, error: insertErr } = await supabase
      .from("procedure_types")
      .insert({
        company_id: companyId,
        name: trimmed,
        default_duration_minutes: dur,
        default_value: value,
        specialty_id: newProcedure.specialtyId || null,
      })
      .select("*")
      .single();
    setCreatingProcedure(false);
    if (insertErr || !data) {
      setError(`Erro ao cadastrar procedimento: ${insertErr?.message ?? ""}`);
      return;
    }
    const created = data as unknown as ProcedureType;
    setProceduresList((prev) =>
      [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
    );
    setProcedureId(created.id);
    if (!isEdit) setDuration(created.default_duration_minutes);
    setShowProcedureForm(false);
    setNewProcedure({ name: "", duration: "30", value: "", specialtyId: "" });
  }

  async function handleCreateRoom() {
    if (!companyId) return;
    const trimmed = newRoom.name.trim();
    if (!trimmed) {
      setError("Informe o nome da sala.");
      return;
    }
    setError(null);
    setCreatingRoom(true);
    const supabase = createClient();
    const { data, error: insertErr } = await supabase
      .from("rooms")
      .insert({
        company_id: companyId,
        name: trimmed,
        color: newRoom.color,
      })
      .select("*")
      .single();
    setCreatingRoom(false);
    if (insertErr || !data) {
      setError(`Erro ao cadastrar sala: ${insertErr?.message ?? ""}`);
      return;
    }
    const created = data as unknown as Room;
    setRoomsList((prev) =>
      [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
    );
    setRoomId(created.id);
    setShowRoomForm(false);
    setNewRoom({ name: "", color: ROOM_PRESET_COLORS[0] });
  }

  useEffect(() => {
    if (!lockedLead || isEdit || !initial.leadId || !companyId) return;
    if (leadName) return;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("leads")
        .select("name")
        .eq("id", initial.leadId!)
        .single();
      if (data) setLeadName((data as { name: string }).name);
    })();
  }, [companyId, initial.leadId, isEdit, leadName, lockedLead]);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!companyId || lockedLead) return;
    const supabase = createClient();
    const t = setTimeout(async () => {
      const q = supabase
        .from("leads")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name")
        .limit(25);
      if (leadSearch.trim()) q.ilike("name", `%${leadSearch.trim()}%`);
      const { data } = await q;
      setLeadOptions((data as unknown as Pick<Lead, "id" | "name">[]) ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [companyId, leadSearch, lockedLead]);

  function handleProcedureChange(id: string) {
    if (id === "__create__") {
      setShowProcedureForm(true);
      return;
    }
    setProcedureId(id);
    if (!isEdit) {
      const proc = proceduresList.find((p) => p.id === id);
      if (proc) setDuration(proc.default_duration_minutes);
    }
  }

  function handleRoomChange(id: string) {
    if (id === "__create__") {
      setShowRoomForm(true);
      return;
    }
    setRoomId(id);
  }

  useEffect(() => {
    const previousActive = document.activeElement as HTMLElement | null;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"])'
    );
    focusables?.[0]?.focus();
    return () => previousActive?.focus?.();
  }, []);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!companyId) {
      setError("Aguardando empresa...");
      return;
    }
    if (!leadId) {
      setError("Selecione um paciente.");
      return;
    }
    if (!startsAt) {
      setError("Informe data e hora.");
      return;
    }

    if (visibility === "assigned_dentist" && !dentistId) {
      setError(
        "Para visibilidade \u201cApenas o dentista atribu\u00eddo\u201d \u00e9 preciso selecionar um dentista, ou troque para \u201cToda a cl\u00ednica\u201d."
      );
      return;
    }
    if (visibility === "role_tag" && !visibilityTagId) {
      setError("Selecione qual fun\u00e7\u00e3o (tag) ver\u00e1 este agendamento.");
      return;
    }

    const startsIso = new Date(startsAt).toISOString();
    const endsIso = addMinutesIso(startsIso, duration);

    setSaving(true);
    const supabase = createClient();

    const { data: reasonData, error: reasonErr } = await supabase.rpc(
      "check_appointment_availability",
      {
        p_company_id: companyId,
        p_dentist_id: dentistId || null,
        p_room_id: roomId || null,
        p_starts_at: startsIso,
        p_ends_at: endsIso,
        p_exclude_id: isEdit ? props.appointment.id : null,
      }
    );

    if (reasonErr) {
      setError(`Erro ao verificar disponibilidade: ${reasonErr.message}`);
      setSaving(false);
      return;
    }
    if (reasonData) {
      const reason = reasonData as AvailabilityReason;
      setError(AVAILABILITY_MESSAGES[reason] ?? "Hor\u00e1rio indispon\u00edvel.");
      setSaving(false);
      return;
    }

    const visibilityPayload = {
      visibility,
      visibility_tag_id:
        visibility === "role_tag" ? visibilityTagId || null : null,
    };

    if (isEdit) {
      const { error: updateErr } = await supabase
        .from("appointments")
        .update({
          dentist_id: dentistId || null,
          room_id: roomId || null,
          procedure_type_id: procedureId || null,
          starts_at: startsIso,
          ends_at: endsIso,
          notes: notes.trim() || null,
          ...visibilityPayload,
        })
        .eq("id", props.appointment.id);
      if (updateErr) {
        setError(`Erro ao salvar: ${updateErr.message}`);
        setSaving(false);
        return;
      }
    } else {
      const { error: insertErr } = await supabase.from("appointments").insert({
        company_id: companyId,
        lead_id: leadId,
        dentist_id: dentistId || null,
        room_id: roomId || null,
        procedure_type_id: procedureId || null,
        starts_at: startsIso,
        ends_at: endsIso,
        notes: notes.trim() || null,
        ...visibilityPayload,
      });
      if (insertErr) {
        setError(`Erro ao agendar: ${insertErr.message}`);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSaved?.();
  }

  async function handleDelete() {
    if (!isEdit) return;
    if (!confirm("Excluir este agendamento? Essa ação não pode ser desfeita."))
      return;
    setDeleting(true);
    const supabase = createClient();
    const { error: deleteErr } = await supabase
      .from("appointments")
      .delete()
      .eq("id", props.appointment.id);
    if (deleteErr) {
      setError(`Erro ao excluir: ${deleteErr.message}`);
      setDeleting(false);
      return;
    }
    setDeleting(false);
    onSaved?.();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 id={titleId} className="text-base font-semibold text-gray-900">
              {isEdit ? "Editar consulta" : "Agendar consulta"}
            </h3>
            <p className="text-xs text-gray-500">
              O sistema bloqueia conflitos de dentista, sala e bloqueios da
              agenda no mesmo horário.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L8.94 10l-5.72 5.72a.75.75 0 1 0 1.06 1.06L10 11.06l5.72 5.72a.75.75 0 1 0 1.06-1.06L11.06 10l5.72-5.72a.75.75 0 0 0-1.06-1.06L10 8.94 4.28 3.22Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {!lockedLead ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Paciente *
              </label>
              <input
                type="text"
                value={leadSearch}
                onChange={(e) => {
                  setLeadSearch(e.target.value);
                  setLeadId("");
                }}
                placeholder="Buscar paciente..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              {leadOptions.length > 0 && !leadId && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                  {leadOptions.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => {
                        setLeadId(l.id);
                        setLeadSearch(l.name);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-blue-50"
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              )}
              {leadId && (
                <p className="mt-1 text-xs text-gray-500">
                  Selecionado:{" "}
                  <span className="font-medium text-gray-800">{leadSearch}</span>
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Paciente:{" "}
              <span className="font-medium text-gray-900">{leadName}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Data e hora *
              </label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Duração (min)
              </label>
              <input
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) =>
                  setDuration(parseInt(e.target.value, 10) || 30)
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Dentista
              </label>
              <select
                value={dentistId}
                onChange={(e) => {
                  const next = e.target.value;
                  setDentistId(next);
                  if (!next && visibility === "assigned_dentist") {
                    setVisibility("clinic_wide");
                  } else if (next && visibility === "clinic_wide" && !isEdit) {
                    setVisibility("assigned_dentist");
                  }
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Sem dentista</option>
                {dentists.map((d) => (
                  <option key={d.id} value={d.id}>
                    Dr(a). {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Sala
              </label>
              <select
                value={roomId}
                onChange={(e) => handleRoomChange(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Sem sala</option>
                {roomsList.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
                <option value="__create__">+ Cadastrar nova sala</option>
              </select>
            </div>
          </div>

          {showRoomForm && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3">
              <p className="mb-2 text-xs font-medium text-gray-700">
                Nova sala
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  placeholder="Nome da sala"
                  value={newRoom.name}
                  onChange={(e) =>
                    setNewRoom((r) => ({ ...r, name: e.target.value }))
                  }
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                  autoFocus
                />
                <div className="flex items-center gap-1.5">
                  {ROOM_PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Cor ${c}`}
                      onClick={() => setNewRoom((r) => ({ ...r, color: c }))}
                      className={`h-5 w-5 rounded-full ${
                        newRoom.color === c
                          ? "ring-2 ring-offset-1 ring-gray-400"
                          : ""
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRoomForm(false);
                    setNewRoom({ name: "", color: ROOM_PRESET_COLORS[0] });
                  }}
                  className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCreateRoom}
                  disabled={creatingRoom || !newRoom.name.trim()}
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {creatingRoom ? "Salvando..." : "Salvar sala"}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Procedimento
            </label>
            <select
              value={procedureId}
              onChange={(e) => handleProcedureChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Nenhum</option>
              {proceduresList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.default_duration_minutes}min
                </option>
              ))}
              <option value="__create__">+ Cadastrar novo procedimento</option>
            </select>
          </div>

          {showProcedureForm && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3">
              <p className="mb-2 text-xs font-medium text-gray-700">
                Novo procedimento
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  placeholder="Nome do procedimento"
                  value={newProcedure.name}
                  onChange={(e) =>
                    setNewProcedure((p) => ({ ...p, name: e.target.value }))
                  }
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                  autoFocus
                />
                <input
                  type="number"
                  min={5}
                  step={5}
                  placeholder="Duração (min)"
                  value={newProcedure.duration}
                  onChange={(e) =>
                    setNewProcedure((p) => ({ ...p, duration: e.target.value }))
                  }
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
                <input
                  type="text"
                  placeholder="Valor (opcional, ex: 250,00)"
                  value={newProcedure.value}
                  onChange={(e) =>
                    setNewProcedure((p) => ({ ...p, value: e.target.value }))
                  }
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
                <select
                  value={newProcedure.specialtyId}
                  onChange={(e) =>
                    setNewProcedure((p) => ({
                      ...p,
                      specialtyId: e.target.value,
                    }))
                  }
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Especialidade (opcional)</option>
                  {specialties.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowProcedureForm(false);
                    setNewProcedure({
                      name: "",
                      duration: "30",
                      value: "",
                      specialtyId: "",
                    });
                  }}
                  className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCreateProcedure}
                  disabled={creatingProcedure || !newProcedure.name.trim()}
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {creatingProcedure ? "Salvando..." : "Salvar procedimento"}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Observações
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Anotações sobre o agendamento..."
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Visibilidade na agenda
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  "assigned_dentist",
                  "role_tag",
                  "clinic_wide",
                ] as AgendaVisibility[]
              ).map((v) => {
                const disabled = v === "assigned_dentist" && !dentistId;
                const active = visibility === v;
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={disabled}
                    onClick={() => setVisibility(v)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      active
                        ? "border-blue-500 bg-blue-50 text-blue-800"
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <span className="block font-semibold">
                      {VISIBILITY_LABELS[v]}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-gray-500">
              {VISIBILITY_HELP[visibility]}
            </p>
            {visibility === "role_tag" && (
              <div className="mt-2">
                <select
                  value={visibilityTagId}
                  onChange={(e) => setVisibilityTagId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Selecione uma função...</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.marks_as_dentist ? " · dentista" : ""}
                    </option>
                  ))}
                </select>
                {tags.length === 0 && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    Nenhuma função cadastrada. Crie em Configurações &rsaquo; Equipe &rsaquo; Funções.
                  </p>
                )}
              </div>
            )}
          </div>

          {companyId && (
            <details className="group rounded-lg border border-gray-200 bg-white">
              <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-gray-700">
                <span>
                  Disponibilidade dos dentistas{" "}
                  <span className="text-gray-400">
                    · {startsAt ? startsAt.slice(0, 10) : "—"}
                  </span>
                </span>
                <svg
                  className="h-3.5 w-3.5 text-gray-400 transition-transform group-open:rotate-180"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m19.5 8.25-7.5 7.5-7.5-7.5"
                  />
                </svg>
              </summary>
              <div className="border-t border-gray-100 px-3 py-2">
                {startsAt ? (
                  <AvailabilityPanel
                    companyId={companyId}
                    date={startsAt.slice(0, 10)}
                    highlightDentistId={dentistId || undefined}
                  />
                ) : (
                  <p className="text-xs text-gray-500">
                    Informe data e hora para visualizar a disponibilidade.
                  </p>
                )}
              </div>
            </details>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <div>
              {isEdit && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {deleting ? "Excluindo..." : "Excluir"}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving
                  ? isEdit
                    ? "Salvando..."
                    : "Agendando..."
                  : isEdit
                    ? "Salvar"
                    : "Agendar"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
