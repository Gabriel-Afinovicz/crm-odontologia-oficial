"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import type { ActivityDetailed, ActivityType } from "@/lib/types/database";

interface LeadTimelineProps {
  leadId: string;
  initialActivities?: ActivityDetailed[];
}

const typeConfig: Record<ActivityType, { label: string; color: string; icon: string }> = {
  note: { label: "Nota", color: "bg-gray-200 text-gray-700", icon: "📝" },
  call_inbound: { label: "Ligação recebida", color: "bg-green-200 text-green-700", icon: "📞" },
  call_outbound: { label: "Ligação realizada", color: "bg-blue-200 text-blue-700", icon: "📱" },
  whatsapp: { label: "WhatsApp", color: "bg-emerald-200 text-emerald-700", icon: "💬" },
  email: { label: "E-mail", color: "bg-yellow-200 text-yellow-700", icon: "✉️" },
  appointment: { label: "Agendamento", color: "bg-purple-200 text-purple-700", icon: "📅" },
  status_change: { label: "Mudança de status", color: "bg-orange-200 text-orange-700", icon: "🔄" },
  assignment: { label: "Atribuição", color: "bg-indigo-200 text-indigo-700", icon: "👤" },
};

export function LeadTimeline({ leadId, initialActivities }: LeadTimelineProps) {
  const { companyId } = useCurrentCompany();
  const [activities, setActivities] = useState<ActivityDetailed[]>(
    initialActivities ?? []
  );
  const [loading, setLoading] = useState(initialActivities === undefined);

  const fetchActivities = useCallback(async () => {
    if (!companyId) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("vw_activities_detailed")
      .select("*")
      .eq("company_id", companyId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setActivities(data as unknown as ActivityDetailed[]);
    }
    setLoading(false);
  }, [companyId, leadId]);

  useEffect(() => {
    if (initialActivities === undefined) {
      if (companyId) fetchActivities();
      return;
    }
    // Quando a página recarrega via router.refresh(), os novos `initialActivities`
    // chegam por props. Sincronizamos para manter o componente em dia mesmo se
    // o realtime estiver indisponível.
    setActivities(initialActivities);
    setLoading(false);
  }, [companyId, initialActivities, fetchActivities]);

  // Realtime: re-busca a timeline sempre que uma atividade desse lead for
  // criada/alterada/removida — cobre tanto o "Adicionar" manual quanto as
  // atividades automáticas (status_change, assignment, agendamento, etc.).
  useEffect(() => {
    if (!companyId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`lead-activities:${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "activities",
          filter: `lead_id=eq.${leadId}`,
        },
        () => {
          fetchActivities();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, leadId, fetchActivities]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-400">
        Nenhuma atividade registrada
      </p>
    );
  }

  return (
    <div className="relative space-y-0">
      <div className="absolute left-5 top-3 h-[calc(100%-24px)] w-px bg-gray-200" />

      {activities.map((activity) => {
        const config = typeConfig[activity.activity_type] || typeConfig.note;
        return (
          <div key={activity.id} className="relative flex gap-4 py-3">
            <div className="relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white text-lg shadow-sm ring-1 ring-gray-200">
              {config.icon}
            </div>
            <div className="flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.color}`}>
                  {config.label}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(activity.created_at).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {activity.title && (
                <p className="mt-1 text-sm font-medium text-gray-900">{activity.title}</p>
              )}
              {activity.description && (
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-600">
                  {activity.description}
                </p>
              )}
              {activity.user_name && (
                <p className="mt-1 text-xs text-gray-400">por {activity.user_name}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
