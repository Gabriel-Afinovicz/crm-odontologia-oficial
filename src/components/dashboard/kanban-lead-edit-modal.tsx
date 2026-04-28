"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LeadForm } from "@/components/leads/lead-form";
import type { Lead } from "@/lib/types/database";
import type { KanbanLead } from "@/lib/supabase/dashboard-data";

interface KanbanLeadEditModalProps {
  domain: string;
  leadId: string;
  onClose: () => void;
  onSaved: (updated: KanbanLead) => void;
}

const KANBAN_LEAD_FIELDS =
  "id,name,status,stage_id,specialty_id,specialty_name,specialty_color,phone,email,assigned_to,assigned_to_name,assigned_is_dentist,source_name,kanban_position,photo_url,birthdate,allergies,created_at,updated_at";

export function KanbanLeadEditModal({
  domain,
  leadId,
  onClose,
  onSaved,
}: KanbanLeadEditModalProps) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const { data, error: fetchErr } = await supabase
        .from("leads")
        .select("*")
        .eq("id", leadId)
        .single();
      if (cancelled) return;
      if (fetchErr || !data) {
        setError("Não foi possível carregar o lead.");
        setLoading(false);
        return;
      }
      setLead(data as unknown as Lead);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  async function handleSaved() {
    const supabase = createClient();
    const { data } = await supabase
      .from("vw_leads_detailed")
      .select(KANBAN_LEAD_FIELDS)
      .eq("id", leadId)
      .single();
    if (data) {
      onSaved(data as unknown as KanbanLead);
    } else {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="my-4 w-full max-w-2xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h3 className="text-base font-semibold text-gray-900">Editar lead</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Fechar"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="max-h-[80vh] overflow-y-auto px-5 py-4">
          {loading && (
            <div className="space-y-3">
              <div className="h-8 animate-pulse rounded bg-gray-100" />
              <div className="h-8 animate-pulse rounded bg-gray-100" />
              <div className="h-24 animate-pulse rounded bg-gray-100" />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && lead && (
            <LeadForm
              domain={domain}
              lead={lead}
              submitMode="stay"
              onSaved={handleSaved}
              onCancelAction={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
