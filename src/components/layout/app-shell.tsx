"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";

interface AppShellProps {
  domain: string;
  showSettings: boolean;
  children: React.ReactNode;
}

export function AppShell({ domain, showSettings, children }: AppShellProps) {
  const pathname = usePathname();
  const isLoginPage = pathname === `/${domain}`;
  const isPublicPage = pathname?.startsWith(`/${domain}/confirmar/`);

  if (isLoginPage || isPublicPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar domain={domain} showSettings={showSettings} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
