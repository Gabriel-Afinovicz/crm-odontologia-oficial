import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SessionProvider } from "@/components/layout/session-provider";
import { WhatsAppPostLoginSync } from "@/components/layout/whatsapp-post-login-sync";
import { getAuthSession, getDomainCompany } from "@/lib/supabase/cached-data";

interface DomainLayoutProps {
  children: React.ReactNode;
  params: Promise<{ domain: string }>;
}

export default async function DomainLayout({
  children,
  params,
}: DomainLayoutProps) {
  const { domain } = await params;

  const [{ user, profile, role, userDomain }, company] = await Promise.all([
    getAuthSession(),
    getDomainCompany(domain),
  ]);

  // Cross-tenant guard: usuário autenticado só acessa o próprio domínio.
  // Super admin está liberado para qualquer domínio.
  if (user && role !== "super_admin" && userDomain && userDomain !== domain) {
    redirect(`/${userDomain}/dashboard`);
  }

  const canAccessSettings =
    !!user && (role === "admin" || role === "super_admin");

  return (
    <SessionProvider
      value={{
        userId: user?.id ?? null,
        profile,
        companyId: company?.id ?? null,
        companyName: company?.name ?? null,
        domain,
      }}
    >
      <AppShell domain={domain} showSettings={canAccessSettings}>
        {children}
      </AppShell>
      {/* Background WhatsApp sync apos login: roda 1x por sessao de aba,
          fora da pagina /conversas (que tem polling proprio). Nao renderiza UI. */}
      <WhatsAppPostLoginSync />
    </SessionProvider>
  );
}
