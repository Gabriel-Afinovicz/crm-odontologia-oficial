/**
 * Paleta padrão para cores de etapa/coluna do pipeline. Usada por
 * `pipeline-stages-manager` (configurações) e pelo atalho de criação
 * inline dentro do kanban — manter em um único lugar evita divergência
 * entre os dois fluxos.
 */
export const PIPELINE_STAGE_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#16a34a",
  "#64748b",
] as const;
