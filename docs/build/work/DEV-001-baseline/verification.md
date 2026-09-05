> Status: snapshot
> Owner: Hardyk
> Last verified: 2026-09-05
> Supersedes: —

# DEV-001 — Verification and next work

Work status: verified locally; included with DEV-002 in the cleanup commit, not released.
Scope: [intent](intent.md), [spec](spec.md), [plan](plan.md).

## Repository and access

- Repo: `notarydev/notary-check` (public), local main and fetched GitHub main both
  `e1b9fa8cc7ee01d9c15752c70eb8ba88902c83a0` at inspection.
- Working branch: `codex/development-baseline`. No push, merge or deployment.
- GitHub CLI reported no open PRs and no workflow runs. Remote reads prove read
  access, not push authorization. AWS STS, Docker and Lightsail access succeeded.
- Lightsail API: engine.55, deployment 28; server.49, deployment 27; both RUNNING.
  Read-only SQL independently confirmed migration `0020_diagnostics_and_page_intake.sql`.
- Existing owner work preserved: modified `engine/scripts/latest-review.ts`,
  untracked `engine/scripts/repro-pacific.ts`, and a local database backup.
  `.backups/` is now ignored; no backup was deleted or staged.

## Checks actually run

| Check | Result | Scope / limitation |
|---|---|---|
| Engine without model key | 474 tests: 466 pass, 8 skip, 0 fail | Real isolated local Postgres; boundaries included. |
| Engine with deployed model key | 474 pass, 0 skip, 0 fail | Synthetic test fixtures in local DB; real DeepSeek calls. Key stayed in child-process environment. |
| Engine typecheck | Pass | `tsc --noEmit`. |
| Server tests/typecheck | 10/10; typecheck pass | Local contract checks, not a real Claude session. |
| Card build | Pass | Vite build; no deployment. |
| Guarded verification script | Pass, offline | Full local check sequence repeated through the new entry point. |
| Database-target guard | Pass | Remote target rejected with exit 2 before running tests. |
| Dashboard | Pass | Live API loads 40 reviews with status; neutral assessments remain unassessed. Browser renders latest run with status complete and two moves. |
| Dashboard failure recovery | Pass | Isolated JS test: failed polling after loading element is absent shows stale alert; successful poll clears it. |
| Listener | Pass | `lsof` shows `127.0.0.1:8123`, not wildcard. |
| Documentation/diff | Pass | 77 local Markdown link targets resolve; `git diff --check` clean. |
| E18 read-only harness | 106 candidates / 233 unresolved | Rolling dataset; numeric overlap is not a correctness label. |

Raw logs are private local files under `.local/verification/2026-09-05/` and the
new script's timestamped directory. Test DB: `notary_check_baseline_20260905`
on the existing local `notary-pg` container. Both database environment variables
were explicitly set; no test fixtures or migrations were written to production.

## What changed

Root agent entry point, durable per-work artifacts, a reusable guarded verification
script, reference workflow, and current pointers/status corrections. Shared docs
remain in place; canonical product/guide/proposal files and applied migrations
are untouched. Historical handoffs and deployment notes remain available.

Local dashboard: loopback listener, returned review status, unassessed labels,
Verify/Act vocabulary, honest nearby-run/cache wording and visible stale errors.
These do not change engine verdicts or deployed runtime behavior.

## Findings and next work

| Finding | Next action / owner |
|---|---|
| 77 `processing` reviews in the three-day window; all over an hour old, none with completed_at. 12 complete reviews in that same window. | Investigate diagnostic/abandoned runs versus failed finalization. Do not mutate production status or call all of them outages without evidence. Agent can investigate. |
| Latest pricing run still has eight INDETERMINATE claims | E10 slice 2: write bounded extraction fixtures and negative controls before implementation; preserve qualifiers unless governed semantics authorize change. |
| Dashboard stage timings approximate; actual deploy/prompt version absent per run | Instrument explicit phase boundaries and version provenance in a separate work item. |
| Same-org/time grouping is a heuristic, not conversation identity | Add durable linked recheck/parent IDs before measuring closed-loop success. Chain-length calculation also needs review. |
| Rolling dashboard cap and E18 candidate heuristic | Freeze/redact/adjudicate fixtures before comparing releases. B1 labels and numeric thresholds still need owner/annotator involvement. |
| E14 status drift | Chunking is implemented (`a40a8a9`, `f9ca156`); extraction/verification overlap remains separate. Corrected queue. |
| E17 reported approval conflicts with unresolved queue wording | Recover exact approved A/B/C scope with owner; do not assume approval or revoke it. E11 remains owner decision. |
| Auth/credential chores in OPERATIONS | Needs owner: Clerk portal and deployed-key rotation. Local key was bypassed safely for testing, not replaced. F4 secret-bearing local settings remain open. |
| CI, staging, health/readiness, alerting, rollback drill | Explicit next operational work; not implemented by this baseline. |

A passing suite is not proof of correctness across real-world pricing tables or
of the full Claude finding → correction → re-check loop. This setup establishes
reproducibility and visibility; it does not claim a launch-ready engine.
