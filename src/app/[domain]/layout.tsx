import { AppShell } from "@/components/layout/app-shell";

interface DomainLayoutProps {
  children: React.ReactNode;
  params: Promise<{ domain: string }>;
}

export default async function DomainLayout({
  children,
  params,
}: DomainLayoutProps) {
  const { domain } = await params;

  return <AppShell domain={domain}>{children}</AppShell>;
}
