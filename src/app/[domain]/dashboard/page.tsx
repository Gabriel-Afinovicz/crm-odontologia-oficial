import { redirect } from "next/navigation";
import { getAuthSession, getDomainCompany } from "@/lib/supabase/cached-data";
import { getDashboardData, getKanbanData } from "@/lib/supabase/dashboard-data";
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

  const [{ funnel, recentLeads }, kanban] = company
    ? await Promise.all([getDashboardData(company.id), getKanbanData(company.id)])
    : [
        { funnel: [], recentLeads: [] },
        {
          leads: [],
          operators: [],
          stages: [],
          specialties: [],
          lastActivityByLead: {},
        },
      ];

  return (
    <DashboardContent
      domain={domain}
      companyName={companyName}
      initialFunnel={funnel}
      initialRecentLeads={recentLeads}
      initialKanbanLeads={kanban.leads}
      initialOperators={kanban.operators}
      initialStages={kanban.stages}
      initialSpecialties={kanban.specialties}
      initialLastActivity={kanban.lastActivityByLead}
    />
  );
}
