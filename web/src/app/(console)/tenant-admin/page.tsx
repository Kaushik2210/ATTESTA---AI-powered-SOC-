import { Users, ShieldOff } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { getSession } from "@/lib/auth/session";

const ALLOWED_ROLES = ["admin", "auditor"];

export default async function TenantAdminPage() {
  const session = await getSession();
  const allowed = session && ALLOWED_ROLES.includes(session.role);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Tenant Admin" description="Org, users, RBAC, retention, API keys, audit log" />
      {allowed ? (
        <EmptyState
          icon={Users}
          title="No tenant configuration to show"
          description="Org settings, RBAC assignment, data residency, inference endpoint binding, and the audit log all need the control-plane API this console doesn't talk to yet."
          phaseNote="Built in Phase 12 — multi-tenancy hardening and deployment"
        />
      ) : (
        <EmptyState
          icon={ShieldOff}
          title="Restricted to admin and auditor roles"
          description="Tenant Admin exposes RBAC, billing, and data-residency controls. Sign in with an admin or auditor role to reach it."
          phaseNote={`Signed in as ${session?.role ?? "unknown"}`}
        />
      )}
    </div>
  );
}
