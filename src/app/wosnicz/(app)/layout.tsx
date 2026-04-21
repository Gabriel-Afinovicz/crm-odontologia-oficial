import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/supabase/cached-data";
import { MasterHeader } from "@/components/wosnicz/master-header";

export default async function WosniczAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, role, userDomain } = await getAuthSession();

  if (!user) {
    redirect("/wosnicz");
  }

  if (role !== "super_admin") {
    redirect(userDomain ? `/${userDomain}/dashboard` : "/");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <MasterHeader />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
