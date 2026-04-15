"use client";

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
    await signOut();
    router.push(`/${domain}`);
    router.refresh();
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

  const roleLabel = profile.role === "admin" ? "Administrador" : "Operador";

  return (
    <div className="flex items-center justify-between">
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
      <Button variant="ghost" size="sm" onClick={handleLogout}>
        Sair
      </Button>
    </div>
  );
}
