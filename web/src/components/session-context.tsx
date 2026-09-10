"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/auth/session";

export interface SessionInfo {
  email: string;
  role: Role;
}

const SessionContext = createContext<SessionInfo | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: SessionInfo;
  children: React.ReactNode;
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** Throws if rendered outside `SessionProvider` — every consumer is
 * inside the protected `(console)` layout, which always has a session
 * by the time it renders (see (console)/layout.tsx). A silent `null`
 * fallback here would let a role check quietly no-op instead of failing
 * loudly, which is exactly the kind of RBAC bug this scaffold exists to
 * make impossible to write by accident.
 */
export function useSession(): SessionInfo {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession() called outside SessionProvider");
  }
  return session;
}
