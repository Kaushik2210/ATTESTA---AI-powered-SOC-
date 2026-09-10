"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConsoleChrome } from "@/components/console-chrome-provider";
import { GLOBAL_SHORTCUTS, QUEUE_SHORTCUTS, surfaceChordShortcuts } from "@/lib/shortcuts";
import type { ShortcutEntry } from "@/lib/shortcuts";

function ShortcutRow({ entry }: { entry: ShortcutEntry }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-text-secondary">{entry.description}</span>
      <kbd className="rounded-sm border border-border-strong bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text-primary">
        {entry.keys}
      </kbd>
    </div>
  );
}

/** The "?" help overlay — docs/UI-SPEC.md rule 8: "Every shortcut
 * discoverable via `?`." Reads from lib/shortcuts.ts exclusively, so
 * this list can never drift from what the handlers actually do.
 */
export function ShortcutsHelp() {
  const { helpOpen, setHelpOpen } = useConsoleChrome();

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Triage without leaving the keyboard.</DialogDescription>
        </DialogHeader>

        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Global</h3>
          <div className="mt-1 divide-y divide-hairline">
            {GLOBAL_SHORTCUTS.map((entry) => (
              <ShortcutRow key={entry.keys} entry={entry} />
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Go to a surface</h3>
          <div className="mt-1 divide-y divide-hairline">
            {surfaceChordShortcuts.map((entry) => (
              <ShortcutRow key={entry.keys} entry={entry} />
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Watchfloor queue</h3>
          <div className="mt-1 divide-y divide-hairline">
            {QUEUE_SHORTCUTS.map((entry) => (
              <ShortcutRow key={entry.keys} entry={entry} />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
