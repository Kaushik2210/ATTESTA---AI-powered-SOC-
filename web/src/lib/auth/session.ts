/**
 * DEV-ONLY session scaffold — Phase 9 scope note (see
 * phases/reports/PHASE-09.md): there is no backend auth service yet
 * (services/api isn't built until a later phase, and real per-tenant
 * auth/RBAC binding is Phase 12's job — CLAUDE.md's tech table names
 * FastAPI + a real session store for that). This module exists so the
 * console's route protection, role-gated navigation, and sign-in flow
 * have something real to run against during UI development: an
 * HMAC-signed, httpOnly cookie carrying a role picked at sign-in from a
 * fixed list, not validated against any credential. It must be replaced
 * before this ships to a real tenant — the signing secret below is a
 * build-time placeholder, not a secret management story.
 */
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE } from "./constants";

export { SESSION_COOKIE };

export const ROLES = ["analyst", "senior", "engineer", "admin", "auditor"] as const;
export type Role = (typeof ROLES)[number];

export interface Session {
  email: string;
  role: Role;
  issuedAt: number;
}

// Placeholder only — see module doc comment. Real deployments (Phase 12)
// pull this from a secret manager, never a source-controlled literal.
const DEV_SIGNING_SECRET = "attesta-dev-only-not-a-real-secret";

function sign(payload: string): string {
  return createHmac("sha256", DEV_SIGNING_SECRET).update(payload).digest("base64url");
}

function encode(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

function decode(token: string): Session | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (typeof parsed?.email !== "string" || !ROLES.includes(parsed?.role)) return null;
    return parsed as Session;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return decode(token);
}

export async function createSession(email: string, role: Role): Promise<void> {
  const store = await cookies();
  const session: Session = { email, role, issuedAt: Date.now() };
  store.set(SESSION_COOKIE, encode(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours — a shift, not a session that outlives one
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
