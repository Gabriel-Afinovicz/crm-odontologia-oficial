import type { LeadDetailed } from "@/lib/types/database";

interface LeadInfoProps {
  lead: LeadDetailed;
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-right text-sm font-medium text-gray-900">
        {value || "—"}
      </span>
    </div>
  );
}

export function LeadInfo({ lead }: LeadInfoProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
        Informações
      </h3>
      <div className="divide-y divide-gray-100">
        <InfoRow label="Telefone" value={lead.phone} />
        <InfoRow label="E-mail" value={lead.email} />
        <InfoRow label="Fonte" value={lead.source_name} />
        <InfoRow label="Responsável" value={lead.assigned_to_name} />
        <InfoRow
          label="Criado em"
          value={new Date(lead.created_at).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        />
        {lead.converted_at && (
          <InfoRow
            label="Convertido em"
            value={new Date(lead.converted_at).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          />
        )}
        {lead.lost_reason && (
          <InfoRow label="Motivo da perda" value={lead.lost_reason} />
        )}
      </div>
      {lead.notes && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <span className="text-sm text-gray-500">Observações</span>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
            {lead.notes}
          </p>
        </div>
      )}
    </div>
  );
}
