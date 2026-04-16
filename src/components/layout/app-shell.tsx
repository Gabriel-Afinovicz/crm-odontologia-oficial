"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";

interface AppShellProps {
  domain: string;
  children: React.ReactNode;
}

export function AppShell({ domain, children }: AppShellProps) {
  const pathname = usePathname();
  const isLoginPage = pathname === `/${domain}`;

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar domain={domain} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
