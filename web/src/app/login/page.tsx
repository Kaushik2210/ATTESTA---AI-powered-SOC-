import { signIn } from "./actions";
import { ROLES } from "@/lib/auth/session";
import { ShieldCheck } from "lucide-react";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <ShieldCheck className="size-5 text-accent-attesta" aria-hidden="true" />
          <span className="text-lg font-semibold tracking-tight text-text-primary">
            ATTESTA
          </span>
        </div>

        <div className="rounded-lg border border-hairline bg-surface-1 p-6">
          <h1 className="text-xl font-semibold text-text-primary">Sign in</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Operator console access.
          </p>

          {params.error && (
            <p
              role="alert"
              className="mt-4 rounded-md border border-severity-high/30 bg-severity-high/10 px-3 py-2 text-sm text-severity-high"
            >
              Enter a work email and select a role to continue.
            </p>
          )}

          <form action={signIn} className="mt-6 flex flex-col gap-4">
            <input type="hidden" name="from" value={params.from ?? "/"} />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium text-text-primary">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="username"
                placeholder="analyst@tenant.example"
                className="h-9 rounded-md border border-border-strong bg-surface-2 px-3 text-sm text-text-primary outline-none placeholder:text-text-tertiary focus-visible:border-accent-attesta"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="role" className="text-sm font-medium text-text-primary">
                Role
              </label>
              <select
                id="role"
                name="role"
                required
                defaultValue=""
                className="h-9 rounded-md border border-border-strong bg-surface-2 px-3 text-sm text-text-primary outline-none focus-visible:border-accent-attesta"
              >
                <option value="" disabled>
                  Select a role
                </option>
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role[0].toUpperCase() + role.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="mt-2 h-9 rounded-md bg-accent-attesta text-sm font-medium text-text-on-accent transition-colors duration-base hover:bg-accent-attesta-hover"
            >
              Continue
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
