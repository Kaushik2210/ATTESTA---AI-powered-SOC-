/**
 * The keyboard map — docs/UI-SPEC.md rule 8: "A tier-3 analyst should be
 * able to triage without the mouse ... Every shortcut discoverable via
 * `?`." This file is the single source of truth both the "?" help
 * overlay and the actual key handlers (console-chrome-provider.tsx)
 * read from, so the two can never drift apart.
 *
 * SURFACES drives three things at once: the sidebar nav, the command
 * palette's navigation results, and the `g` + letter chord targets —
 * one list, three consumers, so adding a surface here is the only edit
 * needed for all three to pick it up.
 */
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  FileCheck2,
  GitCompareArrows,
  LayoutGrid,
  Map,
  ShieldAlert,
  SquareTerminal,
  Users,
  Waypoints,
} from "lucide-react";

export interface Surface {
  href: string;
  label: string;
  /** Second key of the `g` chord, e.g. "w" for `g w` -> Watchfloor. */
  chordKey: string;
  icon: LucideIcon;
  /** Roles permitted to see/reach this surface — docs/UI-SPEC.md 9's
   * RBAC list. Empty means every authenticated role. */
  roles?: string[];
}

export const SURFACES: Surface[] = [
  { href: "/", label: "Watchfloor", chordKey: "w", icon: LayoutGrid },
  { href: "/investigation-canvas", label: "Investigation Canvas", chordKey: "i", icon: Waypoints },
  { href: "/timeline", label: "Timeline Reconstructor", chordKey: "t", icon: Activity },
  { href: "/verdict-ledger", label: "Verdict Ledger", chordKey: "v", icon: FileCheck2 },
  { href: "/drift-monitor", label: "Drift Monitor", chordKey: "d", icon: GitCompareArrows },
  { href: "/response-console", label: "Response Console", chordKey: "r", icon: ShieldAlert },
  { href: "/coverage-map", label: "Coverage Map", chordKey: "c", icon: Map },
  { href: "/detection-studio", label: "Detection Studio", chordKey: "s", icon: SquareTerminal },
  { href: "/tenant-admin", label: "Tenant Admin", chordKey: "a", icon: Users, roles: ["admin", "auditor"] },
];

export interface ShortcutEntry {
  keys: string;
  description: string;
}

/** Watchfloor queue shortcuts — the mapping is defined and discoverable
 * here now; the queue itself (and so these handlers doing anything) is
 * Phase 10's Watchfloor build. Listed so "?" is honest about the full
 * keyboard-first design, not just what already has a live handler.
 */
export const QUEUE_SHORTCUTS: ShortcutEntry[] = [
  { keys: "j", description: "Next case in the queue" },
  { keys: "k", description: "Previous case in the queue" },
  { keys: "e", description: "Escalate the selected case" },
  { keys: "d", description: "Dismiss the selected case, with reason" },
  { keys: "i", description: "Open the selected case's investigation" },
];

export const GLOBAL_SHORTCUTS: ShortcutEntry[] = [
  { keys: "/", description: "Open the command palette" },
  { keys: "⌘/Ctrl K", description: "Open the command palette" },
  { keys: "?", description: "Show this shortcut reference" },
  { keys: "g then a letter", description: "Jump to a surface (see below)" },
  { keys: "Esc", description: "Close the open dialog or overlay" },
];

export const surfaceChordShortcuts: ShortcutEntry[] = SURFACES.map((s) => ({
  keys: `g ${s.chordKey}`,
  description: s.label,
}));
