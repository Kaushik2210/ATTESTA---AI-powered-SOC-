# ATTESTA — Operator Console

Next.js 15 / React 19 / TypeScript / Tailwind v4, restyled shadcn/ui on Radix primitives. See `docs/UI-SPEC.md` for the design law this UI is built against, and `phases/reports/PHASE-09.md` for what shipped in the design-system/foundation phase.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in with any email and a role (`services/investigate`'s Claim Gate / RBAC roles: analyst, senior, engineer, admin, auditor) — see `src/lib/auth/session.ts` for why this is a dev-only scaffold, not real auth.

## Structure

- `src/styles/tokens.css` — every color/spacing/radius/motion value the product uses, as CSS custom properties. No component hardcodes a hex value or a raw pixel size — see that file's own doc comment.
- `src/components/` — the layout shell (sidebar, topbar, command palette, keyboard-shortcut overlay) and shared primitives (`ui/` is shadcn-generated, restyled to the token system).
- `src/app/(console)/` — the nine surfaces `docs/UI-SPEC.md` names, behind the protected layout.
- `src/lib/shortcuts.ts` — the single source of truth for the keyboard map (`?` to see it live).

## Verification

```bash
npm run lint
npm run build
node ../eval/ui/gate.mjs   # axe-core, watermark grep, keyboard traversal, screenshots — run against `npm run start`
```
