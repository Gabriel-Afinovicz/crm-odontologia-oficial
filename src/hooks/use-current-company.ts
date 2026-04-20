"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface CurrentCompanyState {
  companyId: string | null;
  loading: boolean;
}

export function useCurrentCompany(): CurrentCompanyState {
  const params = useParams<{ domain?: string }>();
  const domain = params?.domain;
  const [state, setState] = useState<CurrentCompanyState>({
    companyId: null,
    loading: true,
  });

  useEffect(() => {
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
  }, [domain]);

  return state;
}
