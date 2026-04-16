"use client";

import Link from "next/link";
import { UserInfo } from "@/components/dashboard/user-info";
import { LeadFunnel } from "@/components/dashboard/lead-funnel";
import { RecentLeads } from "@/components/dashboard/recent-leads";

interface DashboardContentProps {
  domain: string;
  companyName: string;
}

export function DashboardContent({
  domain,
  companyName,
}: DashboardContentProps) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="px-6 py-4 lg:px-8">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-gray-900">
              {companyName}
            </h1>
            <UserInfo domain={domain} companyName={companyName} />
          </div>
        </div>
      </header>

      <main className="p-6 lg:p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
            <p className="mt-1 text-sm text-gray-500">
              Visão geral dos seus leads e atividades
            </p>
          </div>
          <Link
            href={`/${domain}/leads/new`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Novo Lead
          </Link>
        </div>

        <div className="space-y-6">
          <LeadFunnel />
          <RecentLeads domain={domain} />
        </div>
      </main>
    </div>
  );
}
