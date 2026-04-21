"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/layout/session-provider";

interface CurrentCompanyState {
  companyId: string | null;
  loading: boolean;
}

/**
 * Sempre que estiver dentro do layout `[domain]`, o `companyId` vem do
 * SessionProvider (zero round-trips). O fetch só ocorre fora desse layout.
 */
export function useCurrentCompany(): CurrentCompanyState {
  const session = useSession();
  const params = useParams<{ domain?: string }>();
  const domain = params?.domain;

  const [state, setState] = useState<CurrentCompanyState>({
    companyId: null,
    loading: true,
  });

  useEffect(() => {
    if (session.companyId !== null || session.userId !== null) {
      setState({ companyId: session.companyId, loading: false });
      return;
    }

    if (!domain) {
      setState({ companyId: null, loading: false });
      return;
    }

    let cancelled = false;
    async function fetchCompany() {
      const supabase = createClient();
      const { data } = await supabase
        .from("companies")
        .select("id")
        .eq("domain", domain)
        .single();

      if (cancelled) return;
      setState({
        companyId: (data as { id: string } | null)?.id ?? null,
        loading: false,
      });
    }

    fetchCompany();
    return () => {
      cancelled = true;
    };
  }, [domain, session.companyId, session.userId]);

  if (session.companyId !== null || session.userId !== null) {
    return { companyId: session.companyId, loading: false };
  }

  return state;
}
