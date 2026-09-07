# UI Specification — The Operator Console

## Design law (non-negotiable)

1. **This is a nine-hour tool, not a landing page.** Every pixel of decoration costs an analyst attention they need for the alert. If an element does not carry information or afford an action, delete it.
2. **Dark-first, but genuinely dark** — a true dark theme with a near-black `#0A0B0D`-class canvas and elevation by surface lightness, not by drop shadow. A light theme ships too and must be equally complete (SOCs on day shift in bright rooms exist), tested at every gate.
3. **Density tier is high.** Target `--density 9` from `/ui-ux-pro-max`. Compact row heights (28–32px), 13px base for tabular data, 14–15px for prose. Never sacrifice the 4.5:1 contrast floor to get there.
4. **Color carries meaning, and only meaning.** Severity is the only thing allowed to use red/amber. Nothing decorative may be red. Never encode information by hue alone — pair with icon, label, or position (colour-blind analysts exist and the alternative is a missed critical).
5. **Motion is explanatory, never ornamental.** Motion is permitted for: spatial continuity (a node expanding into a panel), state transition (verdict sealing), attention direction (a new critical arriving), and progress. It is forbidden for: hero entrances, decorative parallax, staggered card reveals on a dashboard an analyst opens 200 times a day. Everything respects `prefers-reduced-motion`.
6. **Latency is a design property.** Optimistic UI on every mutation, skeletons that match final layout exactly (CLS < 0.1), virtualized everything over 100 rows, and a visible, honest progress state for investigations that genuinely take 30 seconds.
7. **Zero watermarks.** See `CLAUDE.md` §6. Enforced by a Playwright test that greps the rendered DOM and meta tags for a forbidden-string list.
8. **Keyboard-first.** A tier-3 analyst should be able to triage without the mouse. `j`/`k` navigate the queue, `e` escalate, `d` dismiss with reason, `i` open investigation, `/` command palette, `g` then a letter for surface navigation. Every shortcut discoverable via `?`.

## Design system generation

Run before any component work:

```bash
python3 skills/ui-ux-pro-max/scripts/search.py \
  "security operations center incident response threat investigation console dark operator dense" \
  --design-system --persist -p "ATTESTA" --variance 6 --motion 5 --density 9
```

Then per surface: `--page "watchfloor"`, `--page "investigation-canvas"`, `--page "verdict-ledger"`, `--page "drift-monitor"`, `--page "coverage-map"`.

Tokens land in `web/src/styles/tokens.css` as CSS custom properties consumed by Tailwind v4's `@theme`. **No raw hex in any component, ever** — `/design-system audit` fails the build on hardcoded values.

Motion tokens come from `/motion-foundations` (durations, springs, easings) and are the only source of animation numbers. `/motion-advanced` supplies the graph, drag, and sequence patterns.

## Surfaces

### 1. Watchfloor — the triage queue
The default landing surface. Live-updating, risk-ranked case list.

- Left: filter rail (severity, disposition, tenant, ATT&CK tactic, entity type, age, assignee) with counts.
- Center: virtualized case table. Columns: risk (a compact horizontal meter, not a number alone), title, primary entity, tactics (small ATT&CK chips), claim count, age, status, assignee. Row expands inline to a 3-line summary without navigation.
- Right: a live event ticker showing ingest rate and detector fires, so the room can see the system is alive.
- Top: a stat strip — open cases by severity, MTTD, MTTR, autonomous-close rate, drift alerts today. Every tile per `/dataviz`, with a sparkline and an explicit comparison baseline. Never a bare big number.
- Real-time via SSE with a reconnect strategy; new criticals arrive with a single 200ms attention pulse and a sound the analyst can disable.

### 2. Investigation Canvas — the evidence graph
The centerpiece, and the screen that will sell the product.

- An interactive DAG: entities as nodes (host, user, process, IP, file, session), claims as labelled edges. Layout is a time-aware hierarchical layout (left→right by first-seen), not a force-directed hairball. Force layouts look impressive in a screenshot and are useless in an investigation — do not use one.
- Must stay at 60fps with 10,000 nodes. Canvas/WebGL rendering, quadtree hit-testing, level-of-detail (labels appear below a zoom threshold), and viewport culling. React only manages the overlay chrome.
- Click a node → right panel with entity profile, prior cases, asset context. Click an edge (a claim) → the claim's predicate, interval, extractor, confidence, **and its evidence hashes, each expandable to the raw canonical event with a copyable `blake3:...` identifier and a "verify inclusion proof" action.** That hash being visible and verifiable is the product's soul; put it on screen, do not bury it.
- Claim polarity is visually distinct: SUPPORTS edges solid, REFUTES edges dashed and desaturated. Competing hypotheses render as tinted subgraph regions.
- Motion (`/motion-advanced`): node expansion uses a spring with shared-element continuity into the panel; path-drawing animation traces the kill chain when you press "replay attack path".

### 3. Timeline Reconstructor
Horizontal, zoomable, scrubbable. ATT&CK tactics as horizontal bands (Initial Access → Impact); events as marks positioned by time and band. Brush to zoom; the graph canvas and the timeline are linked selections. A "compress idle time" toggle collapses hours of nothing so a 3-day intrusion fits on one screen — a real analyst need that most tools miss.

### 4. Verdict Ledger — the differentiator screen
The append-only manifest log, per tenant.

- Table of manifests: investigation, verdict, model, policy version, kernel version, epoch, timestamp, chain position.
- Select one → the **verification panel**. The browser loads `attesta_kernel.wasm`, fetches the claim set, recomputes the verdict locally, and compares hashes. Show it happening: a short, honest progress sequence (fetch claims → verify evidence inclusion → run kernel → compare hash) ending in a verification seal. The seal animation is the one place in the product where a deliberate flourish is justified — it is the moment the user understands what they bought. Keep it under 900ms.
- Show the hash chain visually: `prev_manifest_hash → manifest_hash`, with a broken-chain state rendered unmistakably if verification ever fails.
- "Export evidence bundle" produces the self-contained verifiable package (manifest + claims + proofs + kernel + policy).

### 5. Drift Monitor
The RVD feed. Cases whose disposition changed on re-adjudication.

- Each row: original verdict, new verdict, the date closed, the date it flipped, and — crucially — **the single claim and policy delta responsible**, rendered as a diff. "Claim C-9 `CONNECTED_TO 45.61.x.x` now matches indicator `intel:threatfeed/2026-06-12#a91f`."
- A before/after kernel-attribution comparison: which claims contributed what weight, then and now.
- One-click reopen into a new investigation, carrying the original manifest as parent.

### 6. Response Console
Proposed actions with blast radius rendered *before* approval: affected principals, hosts, dependent services, and a criticality flag if the target is a tier-0 asset. Approve / modify / reject, each writing to the ledger. Autonomous-execution policy is edited here, per tenant, per action type, with a preview of what would have executed over the last 30 days had it been enabled — that preview is how you earn a customer's trust enough to turn it on.

### 7. Coverage Map
ATT&CK matrix heatmap: per-technique detection coverage derived from the CDL rule pack and actual fire rates over the window. Distinguish *"we have a rule"* from *"the rule has ever fired"* from *"we have telemetry that would let a rule fire"* — three different colours, because the third is what actually tells a CISO where they are blind. Attribution: `© 2026 The MITRE Corporation...` in the notices file.

### 8. Detection Studio
CDL rule authoring: editor with schema completion, a live test-against-history panel (compiles the same rule to ClickHouse SQL and shows what it would have fired on over the last 90 days, with an estimated FP rate), and a rule-versioning view.

### 9. Tenant Admin
Org, users, RBAC (analyst / senior / engineer / admin / auditor — the auditor role is read-only and can access the ledger and export bundles but not case content, which is what a compliance function actually needs), data residency, inference endpoint binding, retention, API keys, audit log.

## Component and quality bar

- shadcn/ui + Radix primitives, restyled to the token system. Not default shadcn — it must not look like every other AI-built dashboard. Distinct: sharper radii (4–6px), a single accent hue used sparingly, monospace for all identifiers and hashes, hairline 1px borders at low contrast rather than heavy card shadows.
- Data tables: TanStack Table + Virtual. Column resize, reorder, pin, saved views per user.
- Charts: `/dataviz` before any chart code. Consistent categorical palette, accessible in both themes, no chartjunk, no 3D, no pie charts with more than three slices.
- Empty states are real: what this screen shows, why it is empty, and the one action that changes it. Never an illustration with "Nothing here yet!".
- Error states name the failing subsystem and give a trace ID the analyst can quote to you.
- Loading: skeletons matching final geometry. Never a centered spinner on a full page.

## Verification at every UI gate

```bash
# Playwright via /webapp-testing
python3 skills/webapp-testing/scripts/with_server.py \
  --server "cd web && npm run dev" --port 3000 -- python eval/ui/gate.py
```

`eval/ui/gate.py` must assert:
- axe-core: zero critical/serious violations on every surface, both themes
- no forbidden watermark strings in DOM, `<head>`, or meta tags
- keyboard traversal reaches every interactive element; visible focus ring on each
- contrast sampling ≥ 4.5:1 for text, ≥ 3:1 for UI boundaries
- graph canvas sustains ≥ 55fps with a 10k-node synthetic case
- CLS < 0.1, LCP < 2.0s on a throttled profile
- screenshots at 1280 / 1920 / 2560 × both themes, written to `phases/reports/screenshots/`
