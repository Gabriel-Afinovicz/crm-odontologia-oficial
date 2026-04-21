"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface UserInfoProps {
  domain: string;
  companyName: string;
}

export function UserInfo({ domain, companyName }: UserInfoProps) {
  const { profile, loading, signOut } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    const isSuperAdmin = profile?.role === "super_admin";
    await signOut();
    router.push(isSuperAdmin ? "/wosnicz" : `/${domain}`);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 animate-pulse rounded-full bg-gray-200" />
        <div className="space-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
          <div className="h-3 w-24 animate-pulse rounded bg-gray-200" />
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const roleLabel =
    profile.role === "super_admin"
      ? "Super Admin"
      : profile.role === "admin"
      ? "Administrador"
      : "Operador";

  const isSuperAdmin = profile.role === "super_admin";

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
          {profile.name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div>
          <p className="font-medium text-gray-900">{profile.name}</p>
          <p className="text-sm text-gray-500">
            {roleLabel} &middot; {companyName}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isSuperAdmin && (
          <Link
            href="/wosnicz/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5 8.25 12l7.5-7.5"
              />
            </svg>
            Painel Master
          </Link>
        )}
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          Sair
        </Button>
      </div>
    </div>
  );
}
