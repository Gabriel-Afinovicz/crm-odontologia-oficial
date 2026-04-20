"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentCompany } from "@/hooks/use-current-company";
import type { ActivityType } from "@/lib/types/database";

interface AddActivityFormProps {
  leadId: string;
}

const ACTIVITY_TYPES: { value: ActivityType; label: string }[] = [
  { value: "note", label: "Nota" },
  { value: "call_inbound", label: "Ligação recebida" },
  { value: "call_outbound", label: "Ligação realizada" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
  { value: "appointment", label: "Agendamento" },
];

export function AddActivityForm({ leadId }: AddActivityFormProps) {
  const router = useRouter();
  const { profile } = useAuth();
  const { companyId } = useCurrentCompany();
  const [activityType, setActivityType] = useState<ActivityType>("note");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);

  const needsTitle = activityType !== "note";
  const isAppointment = activityType === "appointment";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!description.trim() && !title.trim()) return;
    if (needsTitle && !title.trim()) return;

    setSaving(true);
    const supabase = createClient();

    const { error } = await supabase.from("activities").insert({
      lead_id: leadId,
      user_id: profile?.id || null,
      company_id: companyId || "",
      activity_type: activityType,
      title: title.trim() || (activityType === "note" ? "Nota adicionada" : null),
      description: description.trim() || null,
      ...(isAppointment && scheduledAt ? { scheduled_at: scheduledAt } : {}),
    });

    if (!error) {
      setTitle("");
      setDescription("");
      setScheduledAt("");
      setActivityType("note");
      router.refresh();
      window.location.reload();
    }

    setSaving(false);
  }

  const isDisabled = saving || (!description.trim() && !title.trim()) || (needsTitle && !title.trim());

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {ACTIVITY_TYPES.map((at) => (
          <button
            key={at.value}
            type="button"
            onClick={() => setActivityType(at.value)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors
              ${activityType === at.value
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
          >
            {at.label}
          </button>
        ))}
      </div>

      {needsTitle && (
        <input
          type="text"
          placeholder="Título da atividade"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      )}

      {isAppointment && (
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      )}

      <Textarea
        placeholder={activityType === "note" ? "Escreva uma nota sobre este lead..." : "Descrição (opcional)"}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
      />

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isDisabled}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Adicionar"}
        </button>
      </div>
    </form>
  );
}
