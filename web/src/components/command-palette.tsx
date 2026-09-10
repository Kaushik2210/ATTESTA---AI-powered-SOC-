"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useConsoleChrome } from "@/components/console-chrome-provider";
import { useSession } from "@/components/session-context";
import { SURFACES } from "@/lib/shortcuts";
import { LogOut, Moon, Sun } from "lucide-react";
import { useMountedTheme } from "@/lib/use-mounted-theme";
import { signOutAction } from "@/app/(console)/actions";

/** The "/" command palette — docs/UI-SPEC.md rule 8. Navigation entries
 * come straight from lib/shortcuts.ts's SURFACES list, filtered by the
 * signed-in role, so the palette and the `g`-chord navigation
 * (console-chrome-provider.tsx) can never disagree about what's
 * reachable.
 */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useConsoleChrome();
  const router = useRouter();
  const session = useSession();
  const { theme, setTheme } = useMountedTheme();

  const reachableSurfaces = SURFACES.filter((s) => !s.roles || s.roles.includes(session.role));

  const go = useCallback(
    (href: string) => {
      setPaletteOpen(false);
      router.push(href);
    },
    [router, setPaletteOpen],
  );

  return (
    <CommandDialog
      open={paletteOpen}
      onOpenChange={setPaletteOpen}
      title="Command palette"
      description="Jump to a surface or run an action"
    >
      <CommandInput placeholder="Jump to a surface, or search an action…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Surfaces">
          {reachableSurfaces.map((surface) => (
            <CommandItem key={surface.href} onSelect={() => go(surface.href)}>
              <surface.icon className="size-4 text-text-secondary" aria-hidden="true" />
              <span>{surface.label}</span>
              <CommandShortcut>g {surface.chordKey}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => { setTheme(theme === "dark" ? "light" : "dark"); setPaletteOpen(false); }}>
            {theme === "dark" ? (
              <Sun className="size-4 text-text-secondary" aria-hidden="true" />
            ) : (
              <Moon className="size-4 text-text-secondary" aria-hidden="true" />
            )}
            <span>Switch to {theme === "dark" ? "light" : "dark"} theme</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setPaletteOpen(false);
              void signOutAction();
            }}
          >
            <LogOut className="size-4 text-text-secondary" aria-hidden="true" />
            <span>Sign out</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
