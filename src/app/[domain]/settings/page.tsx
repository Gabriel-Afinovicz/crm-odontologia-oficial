import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/supabase/cached-data";
import { SettingsContent } from "@/components/settings/settings-content";

interface SettingsPageProps {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function SettingsPage({
  params,
  searchParams,
}: SettingsPageProps) {
  const { domain } = await params;
  const { tab } = await searchParams;
  const { user, role } = await getAuthSession();

  if (!user) {
    redirect(`/${domain}`);
  }

  if (role !== "admin" && role !== "super_admin") {
    redirect(`/${domain}/dashboard`);
  }

  return <SettingsContent canManageOperators initialTab={tab} />;
}
