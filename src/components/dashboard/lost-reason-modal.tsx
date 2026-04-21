"use client";

import { useState, type FormEvent } from "react";
import type { KanbanLead } from "@/lib/supabase/dashboard-data";

interface LostReasonModalProps {
  lead: KanbanLead;
  onConfirm: (reason: string) => Promise<void> | void;
  onCancel: () => void;
}

const SUGGESTIONS = [
  "Sem interesse",
  "Fora do orçamento",
  "Foi para concorrente",
  "Não respondeu",
  "Outro motivo",
];

export function LostReasonModal({
  lead,
  onConfirm,
  onCancel,
}: LostReasonModalProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">
          Marcar como perdido
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Por que <span className="font-medium text-gray-700">{lead.name}</span>{" "}
          foi perdido?
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setReason(s)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors
                  ${
                    reason === s
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
              >
                {s}
              </button>
            ))}
          </div>

          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Descreva o motivo..."
            rows={3}
            autoFocus
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!reason.trim() || submitting}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? "Salvando..." : "Confirmar perda"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
