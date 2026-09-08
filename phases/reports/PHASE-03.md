# Phase 3 — CDL compiler and detection engine

**Status: gate passed**, all four CI jobs green on the first fully-compiled run.

## What was built

### `detect/expr/` — CDL's expression language

A small, real expression language (not a config-shaped stand-in) for the `where`/`when`/`observed`/`suppress.when` fields `docs/DETECTION-SPEC.md` specifies: a hand-written lexer, recursive-descent parser, and AST supporting dotted field access, `==`/`!=`/`>`/`>=`/`<`/`<=`, `and`/`or`/`not`, `+`/`-`/`*`/`/` (division always produces a float, matching ordinary true-division — everything else stays exact `int64` when both operands are), `in` against a list literal, and function calls.

The same parsed AST compiles to **two independent targets**: `Eval` (direct Go evaluation — the streaming path) and `ToSQL` (SQL text — the batch/retro-hunt path). One rule definition, two independently-executed engines, is the actual mechanism `docs/ARCHITECTURE.md` describes as making "what would this rule have caught last quarter?" a trustworthy question.

### `detect/` — the rule engine

- **`rule.go`** — the CDL schema (`id`, `version`, `entity`, `window`, `sources`, `emits`, `suppress`, `tests`) and `Validate()`, which enforces the gate's structural requirements directly: a rule with no negative fixture is rejected outright, as is a suppress clause with no reason, or an `entity` that's never actually a `group_by` field of any source.
- **`aggregate.go`** — sources are filtered, grouped views over the event stream; a **case** is one distinct combination of the *union* of every source's `group_by` fields, matching `docs/DETECTION-SPEC.md`'s own worked example exactly (failures grouped by user+IP, success grouped by user alone, correlated by projecting the finer key down to the coarser one). Aggregates expose `count`/`exists`/`first_ts`/`last_ts`/`distinct_*`/`last_*`, and — via a fallback to the case's own `group_by` values — a source's grouping fields too, so `when`, `observed`, and `suppress` clauses all use exactly one resolution mechanism, not a special-cased one for suppress.
- **`streaming.go`** — the direct execution path.
- **`sql.go`** — compiles each `emits` clause to a standalone SQL query (one CTE per source, `LEFT JOIN`ed on the anchor source's fields) and executes it against an embedded, pure-Go SQLite database (`modernc.org/sqlite`, BSD-3-Clause) — **not** a live ClickHouse, which isn't available in this environment (see Scope decision below).
- **`runner.go`** — the fixture-based test harness: `RunFixtureTests` checks a rule's positive/negative expectations; `RunEquivalence` is the gate's second requirement, running both paths over the same fixtures and comparing claim sets exactly.

### `rules/` — three shipped, tested rules across the first three detection families

| Rule | Family | Predicate(s) |
|---|---|---|
| `auth-burst-then-success.cdl.yaml` | 1 — brute force/password spray | `AUTH_FAILED_BURST`, `AUTH_SUCCEEDED_AFTER_FAILURES` |
| `token-replayed.cdl.yaml` | 2 — credential abuse | `TOKEN_REPLAYED` |
| `impossible-travel.cdl.yaml` | 3 — impossible travel | `TRAVEL_IMPOSSIBLE` |

Rule 1 reproduces `docs/DETECTION-SPEC.md`'s own worked example almost verbatim, including its suppress clause (CI-runner service accounts). Each ships a positive and a negative fixture (`rules/fixtures/`).

## Scope decisions — read this first

1. **Family 2's `AUTH_FROM_NEW_ASN` and `AUTH_OUTSIDE_BASELINE_HOURS` need Phase 4's statistical baseline layer**, which doesn't exist yet (`phases/PHASES.md` puts "Statistical layer" at Phase 4, not 3). `TOKEN_REPLAYED` is family 2's sub-predicate expressible without one — a same-session-token used from multiple distinct source IPs is a pure correlation, no baseline required. The baseline-dependent predicates are correctly deferred to Phase 4, not skipped silently.
2. **Family 3's real IP-geolocation enrichment is deferred.** `impossible-travel`'s fixtures carry a pre-computed `distance_from_prev_km` field, as if an enrichment stage already ran — that enrichment is `ingest/`'s concern (a later, incremental addition), not this phase's. What's actually under test here is the rule's own logic: the velocity threshold and the suppress-on-corporate-egress mechanism.
3. **The SQL path targets an embedded SQLite, not ClickHouse.** No ClickHouse is available in this environment (same gap Phase 0's `docker-compose.dev.yml` has always had — it provisions one but has never been run end to end here). The generated SQL is written in a portable subset intended to also be valid ClickHouse SQL, but that hasn't been verified against a live ClickHouse. This is the single most important thing to validate once one is available.
4. **CDL's `window` field is currently informational.** This reference engine computes one aggregate per case over the entire fixture rather than implementing real sliding/tumbling window bucketing (state expiry, watermarks, late data) — a substantial, separate feature. Fixtures are constructed so every case's events genuinely fall within the rule's stated window; the property this phase actually proves is streaming/SQL equivalence and correct claim emission, not continuous-stream time semantics.
5. **The SQL compiler only supports sources whose `group_by` is a subset of the most fine-grained source's** (validated explicitly, with a clear error otherwise) — sufficient for these three rules (at most two sources, one a strict superset of the other), not a fully general N-way join compiler.

## A real bug caught during review, before it ever reached CI

While writing the SQL compiler's `track_last` support (a correlated subquery computing "the value of column X from whichever matching row has the latest timestamp in this group"), I found that the correlation condition used an unqualified column name on both sides: `sub.actor_user_uid = actor_user_uid`. Since the subquery's own `FROM events sub` table has a column with that exact name, standard SQL name resolution would bind the bare, unqualified right-hand side to `sub`'s own column (the innermost scope), not the enclosing group — making the condition the tautology `sub.x = sub.x` instead of a real correlation to the current group. Fixed by explicitly aliasing the outer aggregate query's table (`FROM events AS outer_ev`) and qualifying both sides (`sub.x = outer_ev.x`), removing the ambiguity entirely. Caught by re-reading my own SQL-generation logic line by line before pushing, not by a failing test — a genuine risk of writing SQL-generating code without a way to execute it locally. CI's actual run (with the fix already applied) confirmed both paths agree on every shipped rule, including `impossible-travel`, the one exercising this exact code path.

A related design gap surfaced during the same review: suppress clauses in `docs/DETECTION-SPEC.md`'s worked example reference raw fields like `actor.user.type` that aren't necessarily part of any source's `group_by`. The initial design gave suppress its own raw-event resolution mechanism (a merged "sample event"), which worked for the streaming path but had no SQL equivalent — a column the SQL compiler had never been told to expose. Resolved by unifying suppress onto the same `<source>.<field>` aggregate resolution `when`/`observed` already use (adding the fields suppress needs to `track_last`), removing the second mechanism entirely rather than building a parallel one for SQL.

## Gate: fixtures pass; streaming/SQL equivalence; negative-fixture rejection enforced

Confirmed in CI: [run `34182482211`](https://github.com/Kaushik2210/ATTESTA---AI-powered-SOC-/actions/runs/34182482211), all four jobs green on both `ubuntu-latest` and `macos-latest`.

- `TestShippedRules_FixturesPass` — all three rules, both fixtures each, correct predicate sets.
- `TestShippedRules_StreamingAndSQLAgree` — **all three rules' streaming and SQL claim sets matched exactly**, including `impossible-travel`'s correlated-subquery `track_last` path and `auth-burst-then-success`'s two-source join.
- `TestLoadRule_RejectsRuleWithoutNegativeFixture` — the compiler genuinely refuses to load a rule missing one.
- `detect/expr`'s own test suite — hand-verified precedence/short-circuit/arithmetic behavior, plus `ToSQL` output checked against exact expected SQL strings.

## `license-auditor` note

One new Go dependency: `modernc.org/sqlite` (BSD-3-Clause, verified against its own LICENSE file before adding — a pure-Go SQLite implementation, no CGO).

## Next

Waiting for approval before Phase 4 (statistical layer and remaining detection families).
