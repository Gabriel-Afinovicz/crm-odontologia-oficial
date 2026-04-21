"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/layout/session-provider";
import type { User as AppUser } from "@/lib/types/database";
import type { User as SupabaseUser } from "@supabase/supabase-js";

interface AuthState {
  user: SupabaseUser | null;
  profile: AppUser | null;
  loading: boolean;
}

/**
 * Dentro do layout `[domain]` usa o SessionProvider (sem round-trip).
 * Fora dele (ex.: master `/wosnicz`), busca como antes.
 */
export function useAuth() {
  const session = useSession();
  const hasServerSession = session.userId !== null || session.profile !== null;

  const [state, setState] = useState<AuthState>(() =>
    hasServerSession
      ? {
          user: session.userId
            ? ({ id: session.userId } as SupabaseUser)
            : null,
          profile: session.profile,
          loading: false,
        }
      : { user: null, profile: null, loading: true }
  );

  useEffect(() => {
    if (hasServerSession) return;

    const supabase = createClient();
    let cancelled = false;

    async function hydrate() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (!user) {
        setState({ user: null, profile: null, loading: false });
        return;
      }

      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("auth_id", user.id)
        .single();

      if (cancelled) return;
      setState({
        user,
        profile: (data as AppUser | null) ?? null,
        loading: false,
      });
    }

    hydrate();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!newSession?.user) {
        setState({ user: null, profile: null, loading: false });
        return;
      }
      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("auth_id", newSession.user.id)
        .single();
      setState({
        user: newSession.user,
        profile: (data as AppUser | null) ?? null,
        loading: false,
      });
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [hasServerSession]);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setState({ user: null, profile: null, loading: false });
  }, []);

  return { ...state, signOut };
}
