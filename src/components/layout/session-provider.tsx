"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { User as AppUser } from "@/lib/types/database";

export interface SessionContextValue {
  userId: string | null;
  profile: AppUser | null;
  companyId: string | null;
  companyName: string | null;
  domain: string | null;
}

const SessionContext = createContext<SessionContextValue>({
  userId: null,
  profile: null,
  companyId: null,
  companyName: null,
  domain: null,
});

export function SessionProvider({
  value,
  children,
}: {
  value: SessionContextValue;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
