"use client";

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
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
                O
              </div>
              <h1 className="text-lg font-semibold text-gray-900">
                {companyName}
              </h1>
            </div>
            <UserInfo domain={domain} companyName={companyName} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
          <p className="mt-1 text-sm text-gray-500">
            Visão geral dos seus leads e atividades
          </p>
        </div>

        <div className="space-y-6">
          <LeadFunnel />
          <RecentLeads />
        </div>
      </main>
    </div>
  );
}
