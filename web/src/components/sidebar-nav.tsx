"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { SURFACES } from "@/lib/shortcuts";
import { useSession } from "@/components/session-context";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** The persistent left rail — docs/UI-SPEC.md's nine surfaces, RBAC-
 * filtered by the signed-in role. Active state uses a filled left
 * indicator bar plus a text-color change, never color alone (rule 4).
 */
export function SidebarNav() {
  const pathname = usePathname();
  const session = useSession();
  const reachableSurfaces = SURFACES.filter((s) => !s.roles || s.roles.includes(session.role));

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-14 flex-col items-center gap-1 border-r border-hairline bg-surface-1 py-3"
    >
      <Link
        href="/"
        className="mb-3 flex size-8 items-center justify-center rounded-md text-accent-attesta"
        aria-label="ATTESTA — Watchfloor"
      >
        <ShieldCheck className="size-5" aria-hidden="true" />
      </Link>

      {reachableSurfaces.map((surface) => {
        const active = pathname === surface.href;
        return (
          <Tooltip key={surface.href}>
            <TooltipTrigger asChild>
              <Link
                href={surface.href}
                aria-label={surface.label}
                aria-current={active ? "page" : undefined}
                className={`relative flex size-9 items-center justify-center rounded-md transition-colors duration-fast ${
                  active
                    ? "bg-hover text-text-primary"
                    : "text-text-tertiary hover:bg-hover hover:text-text-secondary"
                }`}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute left-[-9px] h-5 w-0.5 rounded-full bg-accent-attesta"
                  />
                )}
                <surface.icon className="size-[18px]" aria-hidden="true" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">
              {surface.label}
              <span className="ml-2 font-mono text-text-tertiary">g {surface.chordKey}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}
