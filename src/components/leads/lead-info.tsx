import type { LeadDetailed } from "@/lib/types/database";

interface LeadInfoProps {
  lead: LeadDetailed;
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      {value ? (
        <span className="text-sm text-gray-800">{value}</span>
      ) : (
        <span className="text-sm italic text-gray-400">Não preenchido</span>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-gray-400">
        {title}
      </p>
      {children}
    </div>
  );
}

const GENDER_LABELS: Record<string, string> = {
  feminino: "Feminino",
  masculino: "Masculino",
  outro: "Outro",
  nao_informar: "Prefiro não informar",
};

export function LeadInfo({ lead }: LeadInfoProps) {
  const formattedBirthdate = lead.birthdate
    ? new Date(lead.birthdate + "T12:00:00").toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  const formattedCreatedAt = new Date(lead.created_at).toLocaleDateString(
    "pt-BR",
    { day: "2-digit", month: "long", year: "numeric" }
  );

  const formattedConvertedAt = lead.converted_at
    ? new Date(lead.converted_at).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  const assignedLabel = lead.assigned_to_name
    ? lead.assigned_is_dentist
      ? `Dr(a). ${lead.assigned_to_name}`
      : lead.assigned_to_name
    : null;

  const genderLabel = lead.gender
    ? (GENDER_LABELS[lead.gender] ?? lead.gender)
    : null;

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-800">Informações</h3>

      {/* Informações gerais */}
      <Section title="Geral">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <InfoRow label="Telefone" value={lead.phone} />
          <InfoRow label="E-mail" value={lead.email} />
          <InfoRow label="Fonte" value={lead.source_name} />
          <InfoRow label="Responsável" value={assignedLabel} />
          <InfoRow label="Especialidade" value={lead.specialty_name} />
          <InfoRow label="Etapa" value={lead.stage_name} />
          {lead.lost_reason && (
            <InfoRow label="Motivo da perda" value={lead.lost_reason} />
          )}
        </div>
      </Section>

      {/* Dados pessoais */}
      <Section title="Dados pessoais">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <InfoRow label="Data de nascimento" value={formattedBirthdate} />
          <InfoRow label="Gênero" value={genderLabel} />
        </div>
      </Section>

      {/* Responsável legal */}
      <Section title="Responsável (para menores)">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <InfoRow label="Nome" value={lead.guardian_name} />
          <InfoRow label="Telefone" value={lead.guardian_phone} />
        </div>
      </Section>

      {/* Clínico */}
      <Section title="Clínico">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <InfoRow label="Alergias" value={lead.allergies} />
          <InfoRow label="Observações clínicas" value={lead.clinical_notes} />
        </div>
      </Section>

      {/* Observações gerais */}
      {lead.notes && (
        <Section title="Observações gerais">
          <p className="whitespace-pre-wrap text-sm text-gray-800">
            {lead.notes}
          </p>
        </Section>
      )}

      {/* Rodapé */}
      <div className="space-y-1 border-t border-gray-100 pt-3">
        <InfoRow label="Criado em" value={formattedCreatedAt} />
        {formattedConvertedAt && (
          <InfoRow label="Convertido em" value={formattedConvertedAt} />
        )}
      </div>
    </div>
  );
}
