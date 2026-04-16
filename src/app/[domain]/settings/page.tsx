import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SettingsContent } from "@/components/settings/settings-content";

interface SettingsPageProps {
  params: Promise<{ domain: string }>;
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { domain } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${domain}`);
  }

  return <SettingsContent />;
}
