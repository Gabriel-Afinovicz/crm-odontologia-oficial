import { redirect } from "next/navigation";
import { getAuthSession, getDomainCompany } from "@/lib/supabase/cached-data";
import {
  getDashboardData,
  getKanbanData,
  getAnalyticsDashboard,
} from "@/lib/supabase/dashboard-data";
import { DashboardContent } from "./dashboard-content";

interface DashboardPageProps {
  params: Promise<{ domain: string }>;
}

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { domain } = await params;
  const [{ user }, company] = await Promise.all([
    getAuthSession(),
    getDomainCompany(domain),
  ]);

  if (!user) {
    redirect(`/${domain}`);
  }

  const companyName = company?.name ?? domain;

  const [{ recentLeads }, kanban, analytics] = company
    ? await Promise.all([
        getDashboardData(company.id),
        getKanbanData(company.id),
        getAnalyticsDashboard(company.id, "30d"),
      ])
    : [
        { recentLeads: [] },
        {
          leads: [],
          operators: [],
          stages: [],
          specialties: [],
          lastActivityByLead: {},
        },
        { kpis: null, funnel: [] },
      ];

  return (
    <DashboardContent
      domain={domain}
      companyName={companyName}
      initialRecentLeads={recentLeads}
      initialKanbanLeads={kanban.leads}
      initialOperators={kanban.operators}
      initialStages={kanban.stages}
      initialSpecialties={kanban.specialties}
      initialLastActivity={kanban.lastActivityByLead}
      initialAnalyticsKpis={analytics.kpis}
      initialAnalyticsFunnel={analytics.funnel}
    />
  );
}
