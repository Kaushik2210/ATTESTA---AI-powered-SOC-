"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/** Wraps next-themes with ATTESTA's two themes — "dark" (default,
 * docs/UI-SPEC.md rule 2: "dark-first, but genuinely dark") and
 * "light" (equally complete, not an afterthought). The class next-themes
 * toggles on <html> is exactly what tokens.css's `.dark`/`.light`
 * selectors key off.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      themes={["dark", "light"]}
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
