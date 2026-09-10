"use server";

import { redirect } from "next/navigation";
import { createSession, ROLES, type Role } from "@/lib/auth/session";

export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const from = String(formData.get("from") ?? "/");

  if (!email || !ROLES.includes(role as Role)) {
    redirect(`/login?error=invalid`);
  }

  await createSession(email, role as Role);
  redirect(from.startsWith("/") ? from : "/");
}
