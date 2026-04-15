import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardContent } from "./dashboard-content";

interface DashboardPageProps {
  params: Promise<{ domain: string }>;
}

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { domain } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${domain}`);
  }

  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("domain", domain)
    .single();

  const companyName = (company as { name: string } | null)?.name ?? domain;

  return <DashboardContent domain={domain} companyName={companyName} />;
}
