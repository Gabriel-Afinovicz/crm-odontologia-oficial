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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
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
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">Link inválido</h1>
        <p className="mt-2 text-sm text-gray-600">
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

  return (
    <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-blue-600">
        {initial.clinic_name}
      </p>
      <h1 className="mt-1 text-xl font-semibold text-gray-900">
        Olá, {initial.patient_name.split(" ")[0]}!
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        {status === "confirmed"
          ? "Sua presença está confirmada. Obrigado!"
          : status === "reschedule_requested"
            ? "Pedido de reagendamento recebido. A recepção entrará em contato."
            : status === "expired"
              ? "Este link expirou. Entre em contato com a clínica."
              : "Podemos confirmar sua consulta?"}
      </p>

      <div className="mt-5 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        <p className="font-medium text-gray-900">
          {formatDate(initial.starts_at)}
        </p>
        {initial.dentist_name && (
          <p className="mt-1 text-xs text-gray-600">
            com Dr(a). {initial.dentist_name}
          </p>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {!isClosed && (
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => respond("confirmed")}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting === "confirmed" ? "Confirmando..." : "Confirmar presença"}
          </button>
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => respond("reschedule_requested")}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {submitting === "reschedule_requested"
              ? "Enviando..."
              : "Pedir reagendamento"}
          </button>
        </div>
      )}

      <p className="mt-6 text-center text-[11px] text-gray-400">
        Em caso de dúvidas, fale diretamente com a clínica.
      </p>
    </div>
  );
}
