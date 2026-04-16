import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { LeadDetailed } from "@/lib/types/database";
import { LeadHeader } from "@/components/leads/lead-header";
import { LeadInfo } from "@/components/leads/lead-info";
import { LeadTags } from "@/components/leads/lead-tags";
import { LeadCustomFields } from "@/components/leads/lead-custom-fields";
import { LeadTimeline } from "@/components/leads/lead-timeline";
import { AddActivityForm } from "@/components/leads/add-activity-form";

interface LeadDetailPageProps {
  params: Promise<{ domain: string; id: string }>;
}

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const { domain, id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${domain}`);
  }

  const { data: lead, error } = await supabase
    .from("vw_leads_detailed")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !lead) {
    notFound();
  }

  const typedLead = lead as unknown as LeadDetailed;

  return (
    <div className="p-6 lg:p-8">
      <LeadHeader
        leadId={typedLead.id}
        leadName={typedLead.name}
        status={typedLead.status}
        domain={domain}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Left column: info + tags */}
        <div className="space-y-6 lg:col-span-1">
          <LeadInfo lead={typedLead} />
          <LeadTags leadId={typedLead.id} />
          <LeadCustomFields leadId={typedLead.id} />
        </div>

        {/* Right column: timeline + add note */}
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400">
              Atividades
            </h3>
            <LeadTimeline leadId={typedLead.id} />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
              Nova Atividade
            </h3>
            <AddActivityForm leadId={typedLead.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
