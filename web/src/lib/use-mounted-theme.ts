"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

const emptySubscribe = () => () => {};

/**
 * next-themes can't know the persisted theme during SSR (it lives in
 * localStorage), so `useTheme()`'s `theme` is `undefined` on both the
 * server render and the client's first render before hydration -- and
 * only resolves to the real value after. Any component that branches on
 * `theme` without accounting for that mismatches during hydration
 * (caught via actual browser testing in this session, not the build --
 * see phases/reports/PHASE-09.md). This hook makes "has hydration
 * happened yet" the thing every consumer actually branches on, so server
 * and first-client-render always agree.
 *
 * Uses `useSyncExternalStore` rather than a `useState`+`useEffect`
 * "mounted flag" (the pattern next-themes' own docs otherwise suggest):
 * the effect-based version calls `setState` synchronously inside an
 * effect, which `eslint-plugin-react-hooks`' `set-state-in-effect` rule
 * flags for good reason in general (cascading renders) even though this
 * specific case is a legitimate, one-time exception. `useSyncExternalStore`
 * is the primitive React actually ships for "does the server snapshot
 * differ from the client snapshot" and needs no effect at all -- caught
 * by `next build`'s lint pass, not by hand.
 */
export function useMountedTheme() {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true, // client snapshot: always true once this runs
    () => false, // server snapshot: always false
  );
  const themeApi = useTheme();

  return { ...themeApi, theme: mounted ? themeApi.theme : undefined, mounted };
}
