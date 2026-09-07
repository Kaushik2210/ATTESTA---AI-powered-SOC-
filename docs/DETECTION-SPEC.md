# Detection Specification

## Why we write our own rule language

Sigma is the obvious choice and it is the wrong one here. SigmaHQ rules are under **DRL-1.1**: not OSI-approved, **no patent grant**, and it requires attribution *inside match-based output messages*. Your product's alerts would carry third-party attribution text — which collides with your no-watermark rule, complicates the patent story, and creates a content dependency you do not control. Write your own.

That is not a loss. The rule language is where your detection IP lives, and having one that compiles to both a streaming engine and to SQL over history is a real capability most SIEMs do not have.

## CDL — Correlation Definition Language

One rule text, two compilation targets: streaming operators (real-time) and ClickHouse SQL (retro-hunt over 90+ days). Because it is the same source, "what would this rule have caught last quarter?" is a trustworthy question — which is exactly what Detection Studio needs.

```yaml
id: cdl.credential.auth-burst-then-success
version: 3
title: Failed authentication burst followed by success
severity: high
tactics: [credential-access, initial-access]
techniques: [T1110.001, T1078]
entity: principal                # correlation key
window: 15m
emits:
  - predicate: AUTH_FAILED_BURST
    when: failures.count >= 10
    observed: failures.count
  - predicate: AUTH_SUCCEEDED_AFTER_FAILURES
    when: success.exists and success.ts > failures.last_ts
    observed: success.ts - failures.last_ts
sources:
  failures:
    from: ocsf.authentication
    where: activity_id == 1 and status_id == 2      # logon, failure
    group_by: [actor.user.uid, src_endpoint.ip]
  success:
    from: ocsf.authentication
    where: activity_id == 1 and status_id == 1
    group_by: [actor.user.uid]
suppress:
  - when: actor.user.type == "service" and src_endpoint.ip in asset_group("ci-runners")
    reason: CI runners retry aggressively by design
tests:
  - fixture: fixtures/auth_burst_positive.jsonl
    expect: [AUTH_FAILED_BURST, AUTH_SUCCEEDED_AFTER_FAILURES]
  - fixture: fixtures/auth_burst_service_account.jsonl
    expect: []
```

**Design rules for CDL:**
- A rule emits **Claims, not alerts.** This is what wires detection into the deterministic core: severity is decided by the kernel from the full claim set, not by whichever rule happened to fire. A rule that says `severity: high` is declaring its *contribution weight*, not the outcome.
- Every rule ships with positive and negative fixtures. A rule without a negative fixture is a future false-positive storm; the compiler rejects it.
- `suppress` clauses are first-class and must carry a `reason` string. Undocumented suppression is how SOCs go blind.
- Rules are versioned and content-addressed; the rule version enters the claim's `extractor` field and therefore the manifest.

## Detection families to implement

Each maps to predicates in the registry (`policy/predicates.v1.yaml`). Build them in this order — the ordering is by ratio of detection value to implementation cost.

| # | Family | Core predicates | Primary signal | Notes |
|---|---|---|---|---|
| 1 | **Brute force / password spray** | `AUTH_FAILED_BURST`, `AUTH_SPRAY_ACROSS_PRINCIPALS`, `AUTH_SUCCEEDED_AFTER_FAILURES` | auth logs | Spray (many users, few attempts each) needs a different correlation key than brute force (one user, many attempts). Most products conflate them and miss spray. |
| 2 | **Credential abuse / valid accounts** | `AUTH_FROM_NEW_ASN`, `AUTH_OUTSIDE_BASELINE_HOURS`, `MFA_FATIGUE_PATTERN`, `TOKEN_REPLAYED` | auth + identity | Baselines are per-principal, per-hour-of-week. |
| 3 | **Impossible travel** | `TRAVEL_IMPOSSIBLE` | auth geo | Compute required velocity between consecutive auths. **Must** suppress on known VPN/proxy ASNs and corporate egress ranges or it is pure noise. Store the computed velocity as `observed_value` so the kernel can weight by how impossible it is. |
| 4 | **Suspicious interpreter execution** | `INTERPRETER_SPAWNED_BY`, `ENCODED_COMMAND`, `DOWNLOAD_CRADLE`, `AMSI_TAMPER`, `INTERPRETER_NETWORK_EGRESS` | process + cmdline | Detect on *structure* (parent-child anomaly, encoding, cradle shape), not on keyword lists — keyword lists are trivially bypassed and generate the FP volume that makes analysts stop reading alerts. |
| 5 | **Privilege escalation** | `TOKEN_MANIPULATION`, `GROUP_MEMBERSHIP_ELEVATED`, `SUID_EXECUTION_ANOMALY`, `UAC_BYPASS_PATTERN`, `ROLE_ASSIGNED_SELF` | process + identity | Cloud role self-assignment is the highest-value modern variant. |
| 6 | **Persistence** | `PERSISTENCE_INSTALLED` (run keys, services, scheduled tasks, WMI subscriptions, cron, systemd units, LaunchAgents, IdP app consent) | process + registry + config | Consent-grant persistence in Entra/Okta is badly covered by most tools. |
| 7 | **Malware behaviour** | `PROCESS_HOLLOWING`, `REMOTE_THREAD_INJECTED`, `LSASS_ACCESSED`, `SHADOW_COPY_DELETED`, `MASS_FILE_ENTROPY_CHANGE` | endpoint kernel events | `SHADOW_COPY_DELETED` + `MASS_FILE_ENTROPY_CHANGE` inside a short window is ransomware; that should be an autonomous-isolation candidate. |
| 8 | **Lateral movement** | `REMOTE_SERVICE_CREATED`, `ADMIN_SHARE_WRITE`, `WMI_REMOTE_EXEC`, `RDP_INTERNAL_FIRST_TIME`, `KERBEROS_TICKET_ANOMALY` | auth + network + process | First-time-seen host pairs are the highest-signal, lowest-cost feature here. |
| 9 | **Data exfiltration** | `EGRESS_VOLUME_ANOMALY`, `DNS_TUNNEL_SUSPECTED`, `CLOUD_BULK_DOWNLOAD`, `ARCHIVE_STAGED`, `UPLOAD_TO_UNSANCTIONED` | network + cloud audit | DNS tunnelling: entropy + query-length distribution + subdomain cardinality per parent domain. Weight by data classification of the source when asset context provides it. |

## Statistical layer

Per-entity baselines maintained as incremental sketches so they are cheap and, importantly, **snapshot-hashable** — a baseline snapshot hash goes into the claim's extractor version, so a statistical claim is as replayable as a rule claim.

- Robust z-score (median / MAD, not mean / stddev — security data is not Gaussian and outliers are the point).
- Rare-value detection via Count-Min sketch for "this principal has never used this user-agent / ASN / process".
- First-time-seen tracking per (entity, attribute) pair with a configurable warm-up so a fresh deployment does not alert on everything for a week.
- t-digest for volume percentiles (egress bytes, request counts).

## The worked example from your brief

The scenario `43 failed logins → success → PowerShell → suspicious process → external connection` produces this claim set:

```
C1 AUTH_FAILED_BURST(user=jdoe, src=203.0.113.44)  observed=43   [ev: 43 hashes]
C2 AUTH_SUCCEEDED_AFTER_FAILURES(user=jdoe)        observed=118s [ev: 1 hash]
C3 AUTH_FROM_NEW_ASN(user=jdoe, asn=AS64500)                     [ev: 1 hash]
C4 INTERPRETER_SPAWNED_BY(parent=explorer.exe, child=powershell.exe, host=WIN-CLIENT-04)
C5 ENCODED_COMMAND(process=powershell.exe)                       [ev: 1 hash]
C6 INTERPRETER_NETWORK_EGRESS(process=powershell.exe, dst=45.61.x.x)
C7 CONNECTED_TO_INDICATOR(dst=45.61.x.x, intel=null)   ← polarity SUPPORTS, weight 0 at time T
```

The kernel evaluates: Credential Access (C1,C2,C3) → Initial Access adjacency → Execution (C4,C5) → Command & Control (C6). Chain adjacency multipliers apply because the tactics are sequential on the same principal and host within the window. Result: `CRITICAL`, techniques `T1110.001`, `T1078`, `T1059.001`, `T1071.001`, with per-claim weight attribution rendered directly in the UI.

Now the important part: **C7 carried zero weight** because at time T that IP was unknown. Three months later the IP lands in an intel feed. RVD re-adjudicates from the stored claim set — no re-ingestion, no LLM — C7's weight becomes non-zero, and every *other* case containing a C7-shaped claim against that IP flips too. One indicator update retroactively re-scores your entire history in a single kernel sweep.

That is the system working as designed, and it is what you write the paper about.
