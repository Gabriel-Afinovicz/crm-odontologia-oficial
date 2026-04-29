"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send-from-client";
import type {
  AppointmentDetailed,
  AppointmentStatus,
  MessageTemplate,
} from "@/lib/types/database";

interface AppointmentActionsProps {
  domain: string;
  appointment: AppointmentDetailed;
  templates: MessageTemplate[];
  onClose: () => void;
  onChanged: () => void;
  onEdit: (a: AppointmentDetailed) => void;
  onScheduleReturn: (a: AppointmentDetailed) => void;
}

const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: "scheduled", label: "Agendado" },
  { value: "confirmed", label: "Confirmado" },
  { value: "completed", label: "Concluído" },
  { value: "no_show", label: "Faltou" },
  { value: "cancelled", label: "Cancelado" },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function applyTemplate(
  body: string,
  ctx: {
    paciente: string;
    dentista: string;
    data: string;
    clinica: string;
    link: string;
  }
) {
  return body
    .replaceAll("{{paciente}}", ctx.paciente)
    .replaceAll("{{dentista}}", ctx.dentista)
    .replaceAll("{{data}}", ctx.data)
    .replaceAll("{{clinica}}", ctx.clinica)
    .replaceAll("{{link}}", ctx.link);
}

function randomToken() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function AppointmentActions({
  domain,
  appointment,
  templates,
  onClose,
  onChanged,
  onEdit,
  onScheduleReturn,
}: AppointmentActionsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ message: string; chatId?: string } | null>(
    null
  );
  const [confirmationLink, setConfirmationLink] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"])'
    );
    focusables?.[0]?.focus();
    return () => previous?.focus?.();
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

  async function changeStatus(status: AppointmentStatus) {
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error: e } = await supabase
      .from("appointments")
      .update({ status })
      .eq("id", appointment.id);
    setBusy(false);
    if (e) {
      setError(`Erro ao alterar status: ${e.message}`);
      return;
    }
    onChanged();
  }

  async function ensureConfirmationLink(): Promise<string | null> {
    setError(null);
    const supabase = createClient();
    const { data: existing } = await supabase
      .from("appointment_confirmations")
      .select("token")
      .eq("appointment_id", appointment.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let token: string | null = (existing as { token: string } | null)?.token ?? null;
    if (!token) {
      const newToken = randomToken();
      const { error: insertErr } = await supabase
        .from("appointment_confirmations")
        .insert({
          appointment_id: appointment.id,
          company_id: appointment.company_id,
          token: newToken,
        });
      if (insertErr) {
        setError(`Não foi possível gerar link: ${insertErr.message}`);
        return null;
      }
      token = newToken;
    }
    const link = `${window.location.origin}/${domain}/confirmar/${token}`;
    setConfirmationLink(link);
    return link;
  }

  async function sendReminder(template?: MessageTemplate) {
    setBusy(true);
    setError(null);
    setInfo(null);
    const link = await ensureConfirmationLink();
    if (!link) {
      setBusy(false);
      return;
    }

    const ctx = {
      paciente: appointment.lead_name ?? "paciente",
      dentista: appointment.dentist_name ?? "nosso dentista",
      data: formatDate(appointment.starts_at),
      clinica: domain,
      link,
    };
    const fallback = `Olá ${ctx.paciente}, podemos confirmar sua consulta em ${ctx.data} com ${ctx.dentista}? Confirme em: ${link}`;
    const body = template ? applyTemplate(template.body, ctx) : fallback;

    const phone = (appointment.lead_phone ?? "").replace(/\D+/g, "");
    const result = await sendWhatsAppMessage({
      text: body,
      leadId: appointment.lead_id,
      phone: phone || undefined,
    });
    setBusy(false);

    if (result.kind === "sent") {
      setInfo({
        message: "Mensagem enviada pelo WhatsApp da clinica.",
        chatId: result.chatId,
      });
      return;
    }
    if (result.kind === "fallback") {
      setInfo({ message: result.message });
      return;
    }
    if (!phone) {
      navigator.clipboard?.writeText(body).catch(() => undefined);
    }
    setError(result.message);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Ações para ${appointment.lead_name ?? "consulta"}`}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              Consulta
            </p>
            <h3 className="text-base font-semibold text-gray-900">
              {appointment.lead_name ?? "Paciente"}
            </h3>
            <p className="mt-0.5 text-xs text-gray-600">
              {formatDate(appointment.starts_at)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
              {appointment.dentist_name && (
                <span>Dr(a). {appointment.dentist_name}</span>
              )}
              {appointment.room_name && <span>· {appointment.room_name}</span>}
              {appointment.procedure_name && (
                <span>· {appointment.procedure_name}</span>
              )}
            </div>
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

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        {info && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <span>{info.message}</span>
            {info.chatId && (
              <Link
                href={`/${domain}/conversas?chat=${info.chatId}`}
                className="rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
              >
                Ver conversa
              </Link>
            )}
          </div>
        )}

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Status
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.map((opt) => {
              const active = appointment.status === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={busy || active}
                  onClick={() => changeStatus(opt.value)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    active
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Lembrete (WhatsApp)
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => sendReminder()}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              Enviar lembrete padrão
            </button>
            {templates
              .filter((t) =>
                ["confirmation", "reminder", "custom"].includes(t.kind)
              )
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={busy}
                  onClick={() => sendReminder(t)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  {t.name}
                </button>
              ))}
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const link = await ensureConfirmationLink();
                if (link) {
                  await navigator.clipboard?.writeText(link);
                }
              }}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              Copiar link
            </button>
          </div>
          {confirmationLink && (
            <p className="mt-2 break-all rounded-lg bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600">
              {confirmationLink}
            </p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => onEdit(appointment)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Editar / mover
          </button>
          <button
            type="button"
            onClick={() => onScheduleReturn(appointment)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Agendar retorno
          </button>
          <Link
            href={`/${domain}/leads/${appointment.lead_id}`}
            className="rounded-lg border border-gray-200 px-3 py-2 text-center text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Ver paciente
          </Link>
        </div>
      </div>
    </div>
  );
}
