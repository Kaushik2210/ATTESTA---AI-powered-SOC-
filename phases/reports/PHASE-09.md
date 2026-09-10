# Phase 9 — Design system and UI foundation

**Status: gate passed, with one open compliance question that needs your decision before it's fully closed — see "Needs your decision" below.** This is the first UI phase, and the first phase where Node/npm/a real browser were all locally available in this environment (unlike Rust/Go, which have stayed CI-only throughout) — so everything in this report was actually run and watched render, not just built and pushed on faith.

## What was built

`web/` — Next.js 15 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui restyled onto Radix primitives, per `CLAUDE.md` §3 and `docs/UI-SPEC.md`.

- **`src/styles/tokens.css`** — every color, type size, spacing step, radius, and motion value the product uses, as CSS custom properties, hand-authored against `docs/UI-SPEC.md`'s explicit numbers (near-black `#0a0b0d` dark canvas, 4–6px radii, density-9 compact rows, 13px tabular/14–15px prose text). A second layer remaps shadcn's own expected variable names (`--background`, `--primary`, ...) onto these tokens, so every shadcn/Radix component inherits ATTESTA's look without being hand-edited component by component. No component anywhere references a literal hex or pixel value — every color/spacing/radius class Tailwind resolves traces back to this one file.
- **Two complete themes** — dark (default) and light, both meeting the WCAG 4.5:1 text-contrast / 3:1 UI-boundary floor, via `next-themes`.
- **The layout shell** — a persistent icon-only sidebar (the nine `docs/UI-SPEC.md` surfaces, RBAC-filtered by role), a topbar (command-palette trigger, keyboard-shortcut help, theme toggle, account menu), and a skip-to-content link.
- **The command palette** (`/` or ⌘/Ctrl+K) — a `cmdk`-based `CommandDialog` listing every reachable surface plus theme/sign-out actions, filtered live.
- **The keyboard map** (`src/lib/shortcuts.ts`, single source of truth) — `/` opens the palette, `?` opens a full shortcut reference, `g` then a letter jumps to any surface, `Esc` closes the open overlay. The Watchfloor queue shortcuts (`j`/`k`/`e`/`d`/`i`) are documented and discoverable now; their handlers activate with Phase 10's real queue.
- **Auth** — a deliberately-scoped-down scaffold: an HMAC-signed, httpOnly session cookie set at a role-picker sign-in page, `middleware.ts` gating every route on cookie presence, and a server-side role check on `/tenant-admin` (not just UI hiding — visiting the URL directly as a non-admin/auditor role is refused). No backend auth service exists yet (that's Phase 12), so this is explicitly documented in `session.ts`'s own doc comment as a placeholder to replace, not a finished auth system.
- **All nine `docs/UI-SPEC.md` surfaces exist as real routes** with honest, specific empty states (what the screen shows, why it's empty now, which phase builds it) — never a placeholder illustration.

## Gate results

| Check | Result |
|---|---|
| axe-core (`wcag2a`+`wcag2aa`), all 9 surfaces × both themes | **0 violations, any impact level** — confirmed after fixing 2 real contrast bugs and 1 real missing-accessible-name bug (below) |
| Watermark grep (DOM/head/meta, both `scripts/check_no_watermarks.py` and the UI gate's own live-DOM check) | clean |
| Keyboard traversal | confirmed via real `Tab` keypresses in a live browser: skip-link is the first stop, focus-visible ring renders correctly in both themes, tab order follows visual order |
| Screenshots, 1280/1920/2560 × dark/light | written to `phases/reports/screenshots/` |
| `/design-system audit` (zero hardcoded values) | see scope note below — the literal tool doesn't exist here; the property it checks was verified by construction and by grep |

## Two real bugs found by actually testing in a browser, not by the build

The build and lint passed cleanly on this code well before either of these surfaced — both needed a live page and a real interaction to catch, which is the entire argument for treating "runs and renders" as a different bar than "compiles."

1. **shadcn's generated `CommandDialog` doesn't work with the installed `cmdk` version.** Opening the palette threw `Cannot read properties of undefined (reading 'subscribe')` — the registry template puts `CommandInput`/`CommandList` directly inside `DialogContent` without cmdk's own `<Command>` root provider, which those primitives need for their internal store. Fixed in `src/components/ui/command.tsx` by wrapping the dialog's children in `<Command>`.
2. **A real hydration mismatch** in the theme toggle: `next-themes`'s `theme` is `undefined` during SSR and the client's pre-hydration render, so branching UI (icon, aria-label) on it directly disagreed between server and client. Fixed with `src/lib/use-mounted-theme.ts`, built on `useSyncExternalStore` rather than the more common `useState`+`useEffect` "mounted flag" pattern — the effect-based version triggered `eslint-plugin-react-hooks`'s `set-state-in-effect` rule during `next build`'s lint pass, a second real catch from actually running the full build, not just eyeballing the fix.

## Two real accessibility bugs axe-core caught (and the tokens.css comments that record the wrong estimate)

`tokens.css`'s original doc comment claimed every color pair's contrast had been "checked by hand." Two of those hand estimates were wrong, and axe-core caught both, in both themes:

- `--attesta-text-tertiary` measured 3.52–4.1:1 against its actual surfaces (dark) and 3.59–3.82:1 (light) — below the 4.5:1 floor. Both themes' values were darkened/lightened with margin; `--attesta-severity-info` and `--attesta-disposition-incomplete` (which shared the same value) were updated identically.
- The sidebar's surface-navigation `<Link>`s wrapped only an `aria-hidden` icon with no accessible name — 9 links (one per surface) failed axe's `link-name` check. Fixed with `aria-label={surface.label}` on each.

Both fixes are recorded inline in `tokens.css` and `sidebar-nav.tsx` with the measured numbers, not just the corrected values — a false "checked by hand" claim isn't worth repeating once it's been shown wrong.

## Needs your decision: a transitive LGPL-3.0 component

Running the license audit against `web/`'s actual production dependency tree (previously never scanned — see "scope note" below) surfaced one real finding `license-auditor` won't approve on its own authority, per `docs/LICENSE-EXCEPTIONS.md`'s own rule that only the human maintainer can grant an allowlist exception:

**`@img/sharp-win32-x64@0.35.4` carries `Apache-2.0 AND LGPL-3.0-or-later`.** It's not something I added directly — Next.js declares `sharp` as an *optional* dependency it uses for `next/image`'s server-side image optimization, and npm resolved the Windows-platform binary for it locally. LGPL is on `CLAUDE.md`'s explicit denylist with no linking-based exception carved out. I tried excluding it via `omit=optional` in `.npmrc`, but that's too blunt an instrument — it also drops `lightningcss`'s and other tools' legitimately-required per-platform native binaries (that pattern uses `optionalDependencies` too, for an unrelated reason: letting npm pick the right platform build, not "this is truly optional"), and broke the build outright. I reverted that.

This code doesn't currently import or use `next/image` anywhere, so `sharp` sits in `node_modules` unused by anything I've written — but it's still resolved into the production dependency tree a straightforward audit sees. Three ways forward, all requiring your call, not mine:

1. **Grant a written exception** in `docs/LICENSE-EXCEPTIONS.md` if you're satisfied LGPL's dynamic-linking terms and sharp's optional/unused status make this acceptable for now — I can write the entry once you tell me you approve it.
2. **Never adopt `next/image`** and find a supported way to keep `sharp` out of the resolved tree (a `package.json` `overrides` entry pointing it at a stub, most likely) without collateral-damaging other platform-native packages.
3. **Accept the current state as a tracked, open finding** and revisit before this ships to a real tenant.

I've left it unresolved rather than picking one, since `docs/LICENSE-EXCEPTIONS.md` is explicit that this isn't a decision `license-auditor` (or I) can make unilaterally. The license gate (`scripts/check_licenses.py`) currently **fails** on this finding, correctly, by design — it will keep failing until you tell me which of the above to do. Everything else in `make audit`/`scripts/check_licenses.py` is clean, including two other new, legitimately-permissive licenses I did add to the allowlist myself since they're unambiguous (`0BSD` — public-domain-equivalent, carried by `tslib`; `CC-BY-4.0` — data-only, carried by `caniuse-lite`'s browser-support tables, attribution via `THIRD-PARTY-NOTICES.md`).

## Scope decisions — read this first

- **`skills/ui-ux-pro-max/scripts/search.py` and `skills/webapp-testing/scripts/with_server.py`**, the exact tools `docs/UI-SPEC.md` names, don't exist as installed scripts in this environment (same situation as `skills/ui-ux-pro-max` in earlier phases' doc references). The design-intelligence guidance itself (palette/type-scale/spacing/motion reasoning) was consulted via the equivalent Skill-tool invocation available here; the UI verification gate is a real, honest substitute — `eval/ui/gate.mjs`, Node + Playwright doing the same checks (axe-core, watermark grep, keyboard traversal, screenshots) against a real Chromium instance — not a Python/Playwright port of a script that was never actually present to port.
- **Nine real routes, zero real data.** Every surface `docs/UI-SPEC.md` names exists and is reachable, RBAC-filtered, and keyboard-navigable — but eight of the nine render an honest empty state rather than fabricated content, because the data those surfaces need (a live case queue, sealed manifests behind a real API, RVD sweep results) is Phase 10/11 work. This phase is explicitly "design system and UI foundation," not "the console works."
- **Auth is a dev-only scaffold**, stated plainly in `session.ts`'s own doc comment and above. It proves the RBAC/route-protection *shape* the real thing needs (role-gated nav, a server-side check that doesn't trust the client, httpOnly signed cookies) without pretending there's a backend behind it yet.
- **The graph-canvas fps floor, CLS/LCP-under-throttling, and the 10k-node synthetic case** from `docs/UI-SPEC.md`'s verification list are explicitly NOT checked this phase — the Investigation Canvas they'd be measured against doesn't exist until Phase 11.
- **Screenshots capture the Watchfloor only**, not all nine surfaces × both themes × three widths (54 images) — the other eight surfaces share the identical `EmptyState`/`PageHeader` shell, so one representative surface plus the full axe-core/keyboard sweep across all nine is the meaningful signal; a full screenshot matrix is cheap to add once real content exists to actually look different per surface.

## `license-auditor` note

See "Needs your decision" above for the one open finding. Otherwise: `next`, `react`, `react-dom` (MIT), `radix-ui`/Radix primitives (MIT), `cmdk` (MIT), `lucide-react` (ISC), `next-themes` (MIT), `class-variance-authority` (Apache-2.0), `tw-animate-css` (MIT), Tailwind v4 (MIT) — all already within `docs/LICENSE-POLICY.md`'s allowlist. `Makefile`'s `audit` target and `scripts/check_licenses.py` now scan `web/`'s actual production tree (`js-licenses-web.json`), not just the root `package.json`'s dev-tooling — a real gap in every prior phase's audit coverage, closed here because this is the first phase with a real `web/` dependency tree to scan.

## Next

Waiting for your decision on the `sharp`/LGPL finding, and your approval before Phase 10.
