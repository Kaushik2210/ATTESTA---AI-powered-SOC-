"use client";

import { useMountedTheme } from "@/lib/use-mounted-theme";
import { Search, Moon, Sun, HelpCircle, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConsoleChrome } from "@/components/console-chrome-provider";
import { useSession } from "@/components/session-context";
import { signOutAction } from "@/app/(console)/actions";

export function Topbar() {
  const { setPaletteOpen, setHelpOpen } = useConsoleChrome();
  const { theme, setTheme } = useMountedTheme();
  const session = useSession();

  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface-1 px-3">
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="flex h-7 w-72 items-center gap-2 rounded-md border border-hairline bg-surface-2 px-2.5 text-left text-sm text-text-tertiary transition-colors duration-fast hover:border-border-strong"
      >
        <Search className="size-3.5" aria-hidden="true" />
        <span>Jump to a surface…</span>
        <kbd className="ml-auto rounded-sm border border-border-strong bg-surface-1 px-1 font-mono text-[11px] text-text-tertiary">
          /
        </kbd>
      </button>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Keyboard shortcuts"
          onClick={() => setHelpOpen(true)}
        >
          <HelpCircle className="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" aria-label="Account menu">
              <User className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate font-mono text-xs text-text-secondary">{session.email}</span>
              <span className="text-xs capitalize text-text-tertiary">{session.role}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void signOutAction()}>
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
