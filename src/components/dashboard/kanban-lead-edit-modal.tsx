"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { LeadForm } from "@/components/leads/lead-form";
import type { CustomField, CustomFieldValue, Lead, LeadDetailed } from "@/lib/types/database";
import type { KanbanLead } from "@/lib/supabase/dashboard-data";

interface KanbanLeadEditModalProps {
  domain: string;
  leadId: string;
  onClose: () => void;
  onSaved: (updated: KanbanLead) => void;
}

const KANBAN_LEAD_FIELDS =
  "id,name,status,stage_id,specialty_id,specialty_name,specialty_color,phone,email,assigned_to,assigned_to_name,assigned_is_dentist,source_name,kanban_position,photo_url,birthdate,allergies,created_at,updated_at";

const GENDER_LABELS: Record<string, string> = {
  feminino: "Feminino",
  masculino: "Masculino",
  outro: "Outro",
  nao_informar: "Prefiro não informar",
};

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</span>
      {value ? (
        <span className="text-sm text-gray-800">{value}</span>
      ) : (
        <span className="text-sm text-gray-400 italic">Não preenchido</span>
      )}
    </div>
  );
}

export function KanbanLeadEditModal({
  domain,
  leadId,
  onClose,
  onSaved,
}: KanbanLeadEditModalProps) {
  const [detailed, setDetailed] = useState<LeadDetailed | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<CustomFieldValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const [detailedRes, leadRes] = await Promise.all([
        supabase
          .from("vw_leads_detailed")
          .select("*")
          .eq("id", leadId)
          .single(),
        supabase
          .from("leads")
          .select("*")
          .eq("id", leadId)
          .single(),
      ]);

      if (cancelled) return;
      if (detailedRes.error || !detailedRes.data || leadRes.error || !leadRes.data) {
        setError("Não foi possível carregar o lead.");
        setLoading(false);
        return;
      }

      const typedDetailed = detailedRes.data as unknown as LeadDetailed;
      const typedLead = leadRes.data as unknown as Lead;
      setDetailed(typedDetailed);
      setLead(typedLead);

      // Carrega campos adicionais
      const [fieldsRes, valuesRes] = await Promise.all([
        supabase
          .from("custom_fields")
          .select("*")
          .eq("company_id", typedLead.company_id)
          .eq("is_active", true)
          .order("display_order"),
        supabase
          .from("custom_field_values")
          .select("*")
          .eq("lead_id", leadId)
          .eq("company_id", typedLead.company_id),
      ]);

      if (!cancelled) {
        setCustomFields((fieldsRes.data as unknown as CustomField[]) || []);
        setCustomValues((valuesRes.data as unknown as CustomFieldValue[]) || []);
      }

      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
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

  const valuesMap: Record<string, string> = {};
  customValues.forEach((v) => {
    if (v.value) valuesMap[v.custom_field_id] = v.value;
  });

  const filledCustomFields = customFields.filter((f) => valuesMap[f.id]);

  const formattedBirthdate = detailed?.birthdate
    ? new Date(detailed.birthdate + "T12:00:00").toLocaleDateString("pt-BR")
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="my-4 w-full max-w-2xl rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h3 className="text-base font-semibold text-gray-900">
            {editing ? "Editar lead" : (detailed?.name ?? "Lead")}
          </h3>
          <div className="flex items-center gap-2">
            {!editing && !loading && !error && (
              <>
                <Link
                  href={`/${domain}/leads/${leadId}`}
                  onClick={onClose}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Detalhes
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </Link>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                  </svg>
                  Editar
                </button>
              </>
            )}
            {editing && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancelar edição
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              aria-label="Fechar"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
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

          {/* Modo visualização */}
          {!loading && !error && detailed && !editing && (
            <div className="space-y-5">
              {/* Bloco principal */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  Informações gerais
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoRow label="Telefone" value={detailed.phone} />
                  <InfoRow label="E-mail" value={detailed.email} />
                  <InfoRow label="Fonte" value={detailed.source_name} />
                  <InfoRow
                    label="Responsável"
                    value={
                      detailed.assigned_to_name
                        ? detailed.assigned_is_dentist
                          ? `Dr(a). ${detailed.assigned_to_name}`
                          : detailed.assigned_to_name
                        : null
                    }
                  />
                  <InfoRow label="Especialidade" value={detailed.specialty_name} />
                </div>
              </div>

              {/* Dados pessoais */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  Dados pessoais
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoRow label="Data de nascimento" value={formattedBirthdate} />
                  <InfoRow label="Gênero" value={detailed.gender ? GENDER_LABELS[detailed.gender] ?? detailed.gender : null} />
                </div>
              </div>

              {/* Responsável (menores) */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  Responsável (para menores)
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoRow label="Nome" value={detailed.guardian_name} />
                  <InfoRow label="Telefone" value={detailed.guardian_phone} />
                </div>
              </div>

              {/* Clínico */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  Clínico
                </p>
                <InfoRow label="Alergias" value={detailed.allergies} />
                <InfoRow label="Observações clínicas" value={detailed.clinical_notes} />
              </div>

              {/* Campos adicionais */}
              {customFields.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                  <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                    Campos adicionais
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {customFields.map((field) => (
                      <InfoRow key={field.id} label={field.name} value={valuesMap[field.id] ?? null} />
                    ))}
                  </div>
                </div>
              )}

              {/* Observações gerais */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                <InfoRow label="Observações gerais" value={detailed.notes} />
              </div>

              {/* Rodapé com data de criação */}
              <p className="text-center text-xs text-gray-400">
                Lead criado em{" "}
                {new Date(detailed.created_at).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>
          )}

          {/* Modo edição */}
          {!loading && !error && lead && editing && (
            <LeadForm
              domain={domain}
              lead={lead}
              submitMode="stay"
              onSaved={() => {
                setEditing(false);
                handleSaved();
              }}
              onCancelAction={() => setEditing(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
