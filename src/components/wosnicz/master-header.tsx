"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function MasterHeader() {
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/wosnicz");
    router.refresh();
  }

  const isDashboard = pathname === "/wosnicz/dashboard";

  return (
    <header className="border-b border-slate-800 bg-slate-900 text-slate-100">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <Link
            href="/wosnicz/dashboard"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500 text-sm font-bold text-slate-900"
          >
            W
          </Link>
          <div>
            <p className="text-sm font-semibold">Painel Master</p>
            <p className="text-xs text-slate-400">Wosnicz · Super Admin</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!isDashboard && (
            <Link
              href="/wosnicz/dashboard"
              className="rounded-lg px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              Clínicas
            </Link>
          )}
          <Link
            href="/wosnicz/clinicas/nova"
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:bg-amber-400"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
            Nova Clínica
          </Link>
          <button
            onClick={handleLogout}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            Sair
          </button>
        </div>
      </div>
    </header>
  );
}
