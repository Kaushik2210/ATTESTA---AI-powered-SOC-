"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { SURFACES } from "@/lib/shortcuts";
import { useSession } from "@/components/session-context";

interface ConsoleChromeState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
}

const ConsoleChromeContext = createContext<ConsoleChromeState | null>(null);

export function useConsoleChrome(): ConsoleChromeState {
  const ctx = useContext(ConsoleChromeContext);
  if (!ctx) throw new Error("useConsoleChrome() called outside ConsoleChromeProvider");
  return ctx;
}

const CHORD_TIMEOUT_MS = 900;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable || tag === "SELECT";
}

/** Owns the command palette / help-overlay open state and the global
 * keydown handler that implements docs/UI-SPEC.md rule 8's keyboard map
 * (lib/shortcuts.ts is the single source of truth for what each key
 * does). Mounted once, inside the protected (console) layout, so every
 * surface shares one listener instead of each page wiring its own.
 */
export function ConsoleChromeProvider({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const router = useRouter();
  const session = useSession();
  const chordActiveRef = useRef(false);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reachableSurfaces = SURFACES.filter((s) => !s.roles || s.roles.includes(session.role));

  const clearChord = useCallback(() => {
    chordActiveRef.current = false;
    if (chordTimerRef.current) {
      clearTimeout(chordTimerRef.current);
      chordTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;

      if (event.key === "Escape") {
        setPaletteOpen(false);
        setHelpOpen(false);
        clearChord();
        return;
      }

      const editable = isEditableTarget(event.target);

      // The chord's second key is read even from a non-editable focus
      // target, but never while an overlay is already open (Escape
      // handles closing those) and never while typing in a field.
      if (chordActiveRef.current && !editable) {
        clearChord();
        const surface = reachableSurfaces.find((s) => s.chordKey === event.key.toLowerCase());
        if (surface) {
          event.preventDefault();
          router.push(surface.href);
        }
        return;
      }

      if (editable || event.metaKey || event.ctrlKey || event.altKey) {
        // Cmd/Ctrl+K still opens the palette even from a field.
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          setPaletteOpen(true);
        }
        return;
      }

      switch (event.key) {
        case "/":
          event.preventDefault();
          setPaletteOpen(true);
          break;
        case "?":
          event.preventDefault();
          setHelpOpen(true);
          break;
        case "g":
          chordActiveRef.current = true;
          chordTimerRef.current = setTimeout(clearChord, CHORD_TIMEOUT_MS);
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearChord();
    };
  }, [clearChord, reachableSurfaces, router]);

  return (
    <ConsoleChromeContext.Provider value={{ paletteOpen, setPaletteOpen, helpOpen, setHelpOpen }}>
      {children}
    </ConsoleChromeContext.Provider>
  );
}
