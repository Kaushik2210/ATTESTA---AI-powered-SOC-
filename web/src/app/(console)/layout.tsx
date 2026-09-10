import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SessionProvider } from "@/components/session-context";
import { ConsoleChromeProvider } from "@/components/console-chrome-provider";
import { SidebarNav } from "@/components/sidebar-nav";
import { Topbar } from "@/components/topbar";
import { CommandPalette } from "@/components/command-palette";
import { ShortcutsHelp } from "@/components/shortcuts-help";
import { QueryProvider } from "@/components/query-provider";

/**
 * The protected shell — every surface in docs/UI-SPEC.md renders inside
 * this layout. middleware.ts already redirected unauthenticated requests
 * away from here on cookie presence alone; this is where the cookie's
 * HMAC signature actually gets verified (session.ts's getSession()),
 * the real security boundary for this DEV-ONLY auth scaffold.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <SessionProvider session={session}>
      <QueryProvider>
        <ConsoleChromeProvider>
          <div className="flex h-dvh">
            <SidebarNav />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar />
              <main id="main-content" className="min-h-0 flex-1 overflow-auto">
                {children}
              </main>
            </div>
          </div>
          <CommandPalette />
          <ShortcutsHelp />
        </ConsoleChromeProvider>
      </QueryProvider>
    </SessionProvider>
  );
}
