"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface ConfirmationLookup {
  appointment_id: string;
  status: "pending" | "confirmed" | "reschedule_requested" | "expired";
  starts_at: string;
  ends_at: string;
  patient_name: string;
  dentist_name: string | null;
  clinic_name: string;
}

interface ConfirmationViewProps {
  domain: string;
  token: string;
  initial: ConfirmationLookup | null;
}

function capitalizeFirst(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function formatWeekday(iso: string) {
  return capitalizeFirst(
    new Date(iso).toLocaleDateString("pt-BR", { weekday: "long" })
  );
}

function formatCalendarDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ConfirmationView({
  domain,
  token,
  initial,
}: ConfirmationViewProps) {
  const [status, setStatus] = useState<ConfirmationLookup["status"] | null>(
    initial?.status ?? null
  );
  const [submitting, setSubmitting] = useState<"confirmed" | "reschedule_requested" | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  if (!initial) {
    return (
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <h1 className="text-lg font-semibold text-gray-900 sm:text-xl">
          Link inválido
        </h1>
        <p className="mt-2 text-sm text-gray-600 sm:text-base">
          Este link de confirmação não foi encontrado ou expirou. Entre em
          contato com a clínica para confirmar sua consulta.
        </p>
      </div>
    );
  }

  async function respond(action: "confirmed" | "reschedule_requested") {
    setError(null);
    setSubmitting(action);
    const supabase = createClient();
    const { data, error: e } = await supabase.rpc("confirmation_respond", {
      p_domain: domain,
      p_token: token,
      p_action: action,
    });
    setSubmitting(null);
    if (e) {
      setError(`Não foi possível registrar sua resposta: ${e.message}`);
      return;
    }
    if (data === "expired") {
      setStatus("expired");
      return;
    }
    setStatus(action);
  }

  const isClosed = status !== "pending";
  const weekday = formatWeekday(initial.starts_at);
  const calendarDate = formatCalendarDate(initial.starts_at);
  const time = formatTime(initial.starts_at);

  return (
    <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-8">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600 sm:text-xs">
        {initial.clinic_name}
      </p>
      <h1 className="mt-1 text-2xl font-semibold leading-tight text-gray-900 sm:text-xl">
        Olá, {initial.patient_name.split(" ")[0]}!
      </h1>
      <p className="mt-2 text-base leading-relaxed text-gray-600 sm:text-sm">
        {status === "confirmed"
          ? "Sua presença está confirmada. Obrigado!"
          : status === "reschedule_requested"
            ? "Pedido de reagendamento recebido. A recepção entrará em contato."
            : status === "expired"
              ? "Este link expirou. Entre em contato com a clínica."
              : "Podemos confirmar sua consulta?"}
      </p>

      <div className="mt-5 rounded-xl border border-gray-100 bg-gray-50 px-4 py-4 sm:py-3">
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 sm:h-8 sm:w-8"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 sm:h-4 sm:w-4"
            >
              <rect width="18" height="18" x="3" y="4" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold leading-snug text-gray-900 sm:text-sm">
              {weekday}, {calendarDate}
            </p>
            <p className="mt-0.5 text-base font-medium text-gray-800 sm:text-sm">
              às {time}
            </p>
            {initial.dentist_name && (
              <p className="mt-1.5 text-sm text-gray-600 sm:text-xs">
                com Dr(a). {initial.dentist_name}
              </p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 sm:text-xs">
          {error}
        </p>
      )}

      {!isClosed && (
        <div className="mt-6 grid gap-2.5 sm:grid-cols-2 sm:gap-2">
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => respond("confirmed")}
            className="min-h-[48px] rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 sm:min-h-0 sm:rounded-lg sm:py-2.5 sm:text-sm"
          >
            {submitting === "confirmed"
              ? "Confirmando..."
              : "Confirmar presença"}
          </button>
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => respond("reschedule_requested")}
            className="min-h-[48px] rounded-xl border border-gray-300 bg-white px-4 py-3 text-base font-semibold text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100 disabled:opacity-60 sm:min-h-0 sm:rounded-lg sm:py-2.5 sm:text-sm"
          >
            {submitting === "reschedule_requested"
              ? "Enviando..."
              : "Pedir reagendamento"}
          </button>
        </div>
      )}

      {isClosed && status === "confirmed" && (
        <div className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 sm:text-xs">
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Presença confirmada
        </div>
      )}

      <p className="mt-6 text-center text-xs text-gray-400 sm:text-[11px]">
        Em caso de dúvidas, fale diretamente com a clínica.
      </p>
    </div>
  );
}
