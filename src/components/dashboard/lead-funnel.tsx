"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Linha do funil derivada de uma etapa do pipeline.
 *
 * O nome e a cor refletem exatamente a coluna correspondente do kanban,
 * de forma que adicionar/renomear/recolorir uma etapa nas configurações
 * propaga automaticamente para o funil sem nenhum mapeamento estático.
 */
export interface StageFunnelRow {
  stageId: string;
  label: string;
  color: string;
  total: number;
  last_7_days: number;
  last_30_days: number;
}

interface LeadFunnelProps {
  data: StageFunnelRow[];
}

export function LeadFunnel({ data }: LeadFunnelProps) {
  /**
   * Distribuímos as etapas em duas linhas com a mesma quantidade
   * (ou diferença máxima de 1 quando ímpar). Ambas as linhas usam o
   * mesmo número de colunas, então a largura dos cards casa entre as
   * duas linhas mesmo quando a inferior tem um item a menos.
   */
  const topCount = Math.ceil(data.length / 2);
  const topRow = data.slice(0, topCount);
  const bottomRow = data.slice(topCount);
  const useTwoRows = data.length >= 2;
  const colsForGrid = useTwoRows ? topCount : Math.max(1, data.length);
  const gridStyle = {
    gridTemplateColumns: `repeat(${colsForGrid}, minmax(0, 1fr))`,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funil de Leads</CardTitle>
      </CardHeader>
      {data.length === 0 ? (
        <p className="text-sm text-gray-500">
          Nenhuma etapa configurada. Crie colunas no kanban para visualizar o
          funil.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3" style={gridStyle}>
            {topRow.map((row) => (
              <FunnelCard key={row.stageId} row={row} />
            ))}
          </div>
          {useTwoRows && (
            <div className="grid gap-3" style={gridStyle}>
              {bottomRow.map((row) => (
                <FunnelCard key={row.stageId} row={row} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function FunnelCard({ row }: { row: StageFunnelRow }) {
  return (
    <div
      className="flex min-w-0 flex-col rounded-lg border border-gray-200 bg-white p-4 text-center shadow-sm"
      style={{ borderTopColor: row.color, borderTopWidth: 3 }}
    >
      <p className="text-2xl font-bold text-gray-900">{row.total}</p>
      <div className="mt-1 flex items-center justify-center gap-1.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: row.color }}
          aria-hidden
        />
        <p
          className="truncate text-sm font-medium text-gray-700"
          title={row.label}
        >
          {row.label}
        </p>
      </div>
      <div className="mt-2 space-y-0.5 text-xs text-gray-500">
        <p>7d: {row.last_7_days}</p>
        <p>30d: {row.last_30_days}</p>
      </div>
    </div>
  );
}
