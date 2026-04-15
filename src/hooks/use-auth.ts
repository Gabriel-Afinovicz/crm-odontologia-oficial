"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User as AppUser } from "@/lib/types/database";
import type { User as SupabaseUser } from "@supabase/supabase-js";

interface AuthState {
  user: SupabaseUser | null;
  profile: AppUser | null;
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    loading: true,
  });

  const supabase = createClient();

  const fetchProfile = useCallback(
    async (authUser: SupabaseUser) => {
      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("auth_id", authUser.id)
        .single();

      setState({
        user: authUser,
        profile: data as AppUser | null,
        loading: false,
      });
    },
    [supabase]
  );

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        fetchProfile(user);
      } else {
        setState({ user: null, profile: null, loading: false });
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        fetchProfile(session.user);
      } else {
        setState({ user: null, profile: null, loading: false });
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase.auth, fetchProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setState({ user: null, profile: null, loading: false });
  }, [supabase.auth]);

  return { ...state, signOut };
}
