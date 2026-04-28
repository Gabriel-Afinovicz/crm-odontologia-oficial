import type { LeadStatus } from "@/lib/types/database";

const FALLBACK_STATUS_LABEL: Record<LeadStatus, string> = {
  novo: "Novo",
  agendado: "Agendado",
  atendido: "Atendido",
  finalizado: "Finalizado",
  perdido: "Perdido",
};

const FALLBACK_COLOR = "#9ca3af";

interface StageBadgeProps {
  /** Nome da etapa atual do lead (preferencial). */
  stageName?: string | null;
  /** Cor da etapa atual do lead (preferencial). */
  stageColor?: string | null;
  /** Status legado do lead, usado como fallback quando não há etapa. */
  fallbackStatus?: LeadStatus | string | null;
  className?: string;
}

/**
 * Chip que reflete a coluna do kanban onde o lead se encontra. Usa o
 * nome e a cor da etapa quando disponíveis e cai para o status legado
 * (com rótulos PT-BR) caso a etapa não esteja na lista.
 */
export function StageBadge({
  stageName,
  stageColor,
  fallbackStatus,
  className = "",
}: StageBadgeProps) {
  const label =
    stageName ??
    (fallbackStatus
      ? FALLBACK_STATUS_LABEL[fallbackStatus as LeadStatus] ?? fallbackStatus
      : "—");
  const color = stageColor ?? FALLBACK_COLOR;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-0.5 text-xs font-medium text-gray-700 ${className}`}
      style={{ borderColor: color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}
