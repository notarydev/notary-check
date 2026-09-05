> Status: reference
> Owner: Hardyk
> Last verified: 2026-09-05
> Supersedes: —

# Development workflow

Start at [ROADMAP → In flight right now](../../ROADMAP.md#in-flight-right-now--read-this-first-in-a-new-session).
The baseline and outstanding gaps are in [DEV-001 verification](work/DEV-001-baseline/verification.md).

## Scope and completion checks

Use the [change map](change-map.md) before editing and follow its closeout steps.
Run `node scripts/check-hygiene.mjs` during work, or pass a base commit for a
branch diff. `--staged` reads staged content only. Hygiene checks are structural;
reviewers still assess the requirement, test quality and approval evidence.

Install the local hook in a fresh clone with `git config core.hooksPath .githooks`
after inspecting any existing hooks configuration. Do not overwrite another hook
setup blindly. GitHub's Verify workflow runs hygiene and offline engine/server/card
checks using disposable Postgres. Live-model, customer-dashboard, real-host and
release checks remain change-dependent per the map. Required branch protection
is not configured by this workflow file; remote CI starts only after pushing it.

## One work item, one evidence trail

Use `docs/build/work/<stable-id>-<short-name>/` for substantial changes:

| File | Owns |
|---|---|
| `intent.md` | Owner's problem/outcome, source attribution, constraints and open decisions. Mark reconstructed intent as inference. |
| `spec.md` | Behavior, acceptance cases, non-goals and relevant canonical references. |
| `plan.md` | Files, order, risks and commands/cases that prove the change. Update when implementation departs from it. |
| `verification.md` | Base/reviewed commits, actual checks, skips/failures, limitations, PR/deployment evidence if applicable. |

Use the existing document header and a separate `Work status` line: draft,
authorized, in progress, implemented locally, verified, released, or superseded.
These describe workflow, not canonical authority. Record who approved what and
where; an agent-written spec does not manufacture owner approval. Routine work
within the owner's authorized scope can proceed without repeated permission.
Small fixes may use one linked work record instead of four empty documents.

Shared references remain authoritative in their existing homes: product meaning
in the canonical guides, operational procedure in [OPERATIONS](../../OPERATIONS.md),
mechanism in [MECHANISM](../../MECHANISM.md), queue in [whats-left](whats-left.md).
The roadmap is the index; do not copy full specs into it. Update current facts in
place. Keep old deployment narratives and handoffs explicitly historical.

## Reproduce local verification

A local `notary-pg` container already runs on port 5432. The setup created the
separate database `notary_check_baseline_20260905`; it contains test fixtures only.
For another machine, follow [local Postgres setup](../../OPERATIONS.md#local-development),
then create a dedicated database with `docker exec notary-pg createdb -U postgres notary_check_test`.

From the repo root on this machine:

```bash
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/notary_check_baseline_20260905 scripts/verify-local.sh
```

The script rejects remote targets, production-style database names and URL query
overrides. Do not use an SSH tunnel/forward to production. It sets both database
environment variables explicitly, disables live model calls by default, runs
boundaries/tests/typechecks/card build, and saves ignored logs under `.local/`.
Database existence and Docker readiness are prerequisites; tests apply migrations.

For live-model verification, obtain the valid deployed engine key as described in
[access checklist](../../OPERATIONS.md#environment--access-for-a-fresh-agent--session-start-checklist),
keep it in process environment only, and pass `live`. This incurs real model usage
against synthetic local test fixtures. Never print the key or commit raw logs.
An offline pass with skips is distinct from a live pass. A green suite is not B1
adjudication or proof that the Claude correction/re-check loop works.

## Observe production

```bash
cd engine
node scripts/runs-report.mjs
# http://127.0.0.1:8123 — reuse the existing listener if it is running
node scripts/measure-cant-check.mjs
```

The dashboard reads production across organizations. Keep it local, never expose
or publish its API, and keep exports/screenshots private. It polls every 20 seconds,
queries a rolling three-day window plus a historical baseline, and caps the API
at 40 reviews. “Show all” means all loaded reviews, not all production history.

Inspect run status, claims/states/lifecycle reasons, source provenance, calls,
cost, findings/gaps and moves together. A running container does not prove a
successful review. Manual historical assessments do not adjudicate new runs.
Timing bars are estimates; nearby same-organization runs do not prove a linked
conversation, and no judge calls does not prove a cache hit. Poll failures show
staleness; this dashboard is an operator inspection tool, not an alerting service.

E18 flags numeric overlaps anywhere in a review's sources, not necessarily a bound
applicable evidence row. Its rolling dataset, substring matches and numeric-length
filter prevent treating its count as a correctness rate. Before using it as a
release gate, freeze/redact fixtures, adjudicate field applicability, version
labels, and measure false-supported, wrong-source acceptance, contradiction
precision and abstention separately. Preserve the canonical release gates.

## Next development

1. **E10 slice 2:** reproduce scope/metric extraction failures with retained,
   redacted pricing fixtures; write acceptance cases including wrong-tier,
   wrong-period and attractive-number distractors before changing extraction.
2. **Monitoring:** durable run/deploy provenance, measured stage times, real
   recheck linkage, freshness/error alerts and a tested read-only DB role.
3. **E9b:** structured table rows after a bounded design; retain source coordinates.
4. **E11:** owner semantics decision. **E17:** reconcile the roadmap's reported
   approval with the queue's unresolved A/B/C decision before activating async behavior.

CI configuration now exists locally; remote execution remains pending push.
Health/readiness, staging and rollback drills remain explicit operational work. Each future change updates its proof and the roadmap. No automatic monitor,
deploy or recurring task was enabled by this setup.
