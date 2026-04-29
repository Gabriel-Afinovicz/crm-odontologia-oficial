import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthSession, getDomainCompany } from "@/lib/supabase/cached-data";
import {
  getLeadActivities,
  getLeadSidebarData,
} from "@/lib/supabase/dashboard-data";
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
  const [{ user }, company] = await Promise.all([
    getAuthSession(),
    getDomainCompany(domain),
  ]);

  if (!user) {
    redirect(`/${domain}`);
  }

  const companyId = company?.id;

  if (!companyId) {
    redirect(`/${domain}`);
  }

  const supabase = await createClient();

  const [leadRes, activities, sidebar] = await Promise.all([
    supabase
      .from("vw_leads_detailed")
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .single(),
    getLeadActivities(companyId, id),
    getLeadSidebarData(companyId, id),
  ]);

  if (leadRes.error || !leadRes.data) {
    notFound();
  }

  const typedLead = leadRes.data as unknown as LeadDetailed;

  return (
    <div className="p-6 lg:p-8">
      <LeadHeader
        leadId={typedLead.id}
        leadName={typedLead.name}
        domain={domain}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Left column: info + tags */}
        <div className="space-y-6 lg:col-span-3">
          <LeadInfo lead={typedLead} />
          <LeadTags
            leadId={typedLead.id}
            initialAllTags={sidebar.allTags}
            initialAssignedTags={sidebar.assignedTags}
          />
          <LeadCustomFields
            leadId={typedLead.id}
            initialFields={sidebar.customFields}
            initialValues={sidebar.customFieldValues}
          />
        </div>

        {/* Right column: timeline + add note */}
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400">
              Atividades
            </h3>
            <LeadTimeline leadId={typedLead.id} initialActivities={activities} />
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
