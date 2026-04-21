import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/supabase/cached-data";
import { SettingsContent } from "@/components/settings/settings-content";

interface SettingsPageProps {
  params: Promise<{ domain: string }>;
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { domain } = await params;
  const { user, role } = await getAuthSession();

  if (!user) {
    redirect(`/${domain}`);
  }

  if (role !== "admin" && role !== "super_admin") {
    redirect(`/${domain}/dashboard`);
  }

  return <SettingsContent canManageOperators />;
}
