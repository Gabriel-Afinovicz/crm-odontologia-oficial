import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MasterHeader } from "@/components/wosnicz/master-header";

export default async function WosniczAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/wosnicz");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role, companies(domain)")
    .eq("auth_id", user.id)
    .single();

  const record = profile as {
    role: string | null;
    companies: { domain: string | null } | null;
  } | null;

  if (record?.role !== "super_admin") {
    const userDomain = record?.companies?.domain;
    redirect(userDomain ? `/${userDomain}/dashboard` : "/");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <MasterHeader />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
