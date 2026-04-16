import type { HTMLAttributes } from "react";

type BadgeVariant =
  | "default"
  | "novo"
  | "agendado"
  | "atendido"
  | "finalizado"
  | "perdido";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  color?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-gray-100 text-gray-700",
  novo: "bg-blue-100 text-blue-700",
  agendado: "bg-yellow-100 text-yellow-700",
  atendido: "bg-green-100 text-green-700",
  finalizado: "bg-purple-100 text-purple-700",
  perdido: "bg-red-100 text-red-700",
};

const variantLabels: Record<string, string> = {
  novo: "Novo",
  agendado: "Agendado",
  atendido: "Atendido",
  finalizado: "Finalizado",
  perdido: "Perdido",
};

export function Badge({
  variant = "default",
  color,
  className = "",
  children,
  ...props
}: BadgeProps) {
  const style = color
    ? { backgroundColor: `${color}20`, color }
    : undefined;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
        ${color ? "" : variantStyles[variant]} ${className}`}
      style={style}
      {...props}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const variant = (
    Object.keys(variantStyles).includes(status) ? status : "default"
  ) as BadgeVariant;

  return (
    <Badge variant={variant}>
      {variantLabels[status] || status}
    </Badge>
  );
}
