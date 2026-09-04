> Status: snapshot
> Owner: Hardyk
> Last verified: 2026-09-03
> Supersedes: —

# What's left

The single ordered answer to "what do we do next." Created 2026-09-03,
when the Tier 1 plan stopped matching shipped work — the exact trigger
[`../README.md`](../README.md) names for creating a roadmap.

**What this is not.** It does not restate the delivery sequence, the
release gates, or the "do not build yet" list — those are *rules about
sequencing* and stay in
[`tier-1-build-and-operating-plan.md`](tier-1-build-and-operating-plan.md).
This file tracks current status against them. It also does not duplicate
[`architecture-and-progress.md`](architecture-and-progress.md), which
records what is live. If a row here conflicts with that file, that file
wins on operational fact.

`PROGRESS.md` and `status-page/index.html` at the repo root remain the
informal, fast-moving trackers. This file is the governed one: it carries
a status header, it names blockers, and it is expected to be correct.

---

## Blocking anything being called "validated"

These are not features. Each one is a claim the product currently cannot
honestly make.

| # | Item | Why it blocks |
|---|---|---|
| **B1** | **Held-out eval set is 20 unadjudicated drafts.** `engine/eval/SCHEMA.md` says in bold it is not the gating set. | § Pre-pilot engine gate requires real numbers for false-supported rate, wrong-source acceptance, and contradiction precision. X and Y in that gate are still blank because no labeled data exists to set them from. Nothing can be called validated, and public signup stays gated, until this is annotated. Needs human annotators — no engineering path around it. |
| **B2a** | **Two-block contradiction card returns a single finding live.** The flagship Acme 17%/12% case returned "1 thing to check" against the live connector, not the two stacked findings the card contract describes. Found 2026-09-03, not diagnosed — unknown whether it is an older deployed build or a current bug. | Blocks trusting live Track 1 output for further UI work. Related to but distinct from B2. |
| **B2** | **Locked case 2 fails live.** A paraphrased contradiction ("declined 12 percent" vs "grew 17%") returns `UNSUPPORTED`, not `CONTRADICTED`. | This is the project's own flagship scenario, and it is in the locked test suite. Flagged 2026-09-02 as *"worth prioritizing over UI polish"* and still not root-caused. Three candidate causes named in `architecture-and-progress.md`; none eliminated. |
| ~~**B3**~~ | ~~Advance shipped without its adversarial eval.~~ **RESOLVED 2026-09-03.** Harness built at `engine/eval/advance-adversarial.ts` and run against live DeepSeek: **21 case-runs, 0 violations**, distribution 0:14% / 1:43% / 2:43%. Case 5 ("no useful move exists") returned 0 on all three runs — the behaviour that mattered most. Not the "always emits 2" failure Part 11 warned about. | Re-run this gate on any Advance prompt or model change (`npx tsx eval/advance-adversarial.ts --repeat 3`). Layers 4 and 6 are heuristic, so a green run is evidence, not proof. |
| **B4** | **Retention violates the canonical rule.** `claim.text` and `evidence.resolved_text` are retained indefinitely, no consent, no TTL. | Directly contradicts § Security, privacy, and reliability requirements' first bullet. Also blocks the Privacy Policy in § Public-launch readiness, which has to describe a retention policy that currently doesn't exist. |

## Owed by a rule we already wrote

Small, and each one closes a gap between a stated rule and the code.

| # | Item |
|---|---|
| ~~**O1**~~ | ~~Advance has no feature flag.~~ **RESOLVED 2026-09-03** — migration `0014_advance_flag.sql` adds `organization.advance_enabled`, `DEFAULT false` (ship dark for new orgs) with a backfill to `true` so existing orgs keep the working feature. Read in `reviewFlow.ts` before any client construction, so a disabled org costs zero model calls. Regression test asserts both no suggestions *and* zero model calls. **Not yet applied to production** — see F3. |
| **O2** | **`advance_event` is written by nothing.** The table exists, tests reference it, production never writes a row. Zero interaction telemetry for Advance. |
| ~~**O3**~~ | ~~Cost meter rounds to whole cents, so both spend caps summed zeros and never fired.~~ **RESOLVED 2026-09-03** — migration `0015_cost_millicents.sql`. Cost is now metered in millicents; `estimated_cost_cents` became a `GENERATED ALWAYS` column derived from it, so a writer that sets only cents gets a hard Postgres error instead of silently under-metering. Regression test proves 1,000 realistic calls accrue ~134 cents where they previously accrued 0. **Not applied to production** — see F3. |
| **O4** | **Quota check is read-then-decide, not atomic** — two concurrent calls can both observe "under the cap." Already documented as a known limitation in § Locked test suite's Cost gate. Low risk at current volume. |
| **O5** | **Clerk Restricted sign-up mode not confirmed enabled** — the hard, IdP-level half of the public-signup gate. Manual dashboard action, not verifiable from this repo. |
| **O6** | **Profile Preferences copy not on the onboarding page.** Written and tested (§ Three concrete changes, item 4), never added where a user would see it. |

## In flight

| # | Item |
|---|---|
| **F1** | **`no_source` split → `not_checked`.** Committed in `29fc011`, **not yet deployed** — the MCP `server/` image still needs rebuilding and pushing. Separates "nothing to check" from "something failed" so an unsourced answer stops reporting as a Notary malfunction. Needs the fourth card state threaded through `ReviewCardData` and the UI, a regression test, and a commit. See the corrected state-mapping table in the plan. |
| ~~**F2**~~ | ~~`.server.14` never deployed.~~ **NOT AN ISSUE — verified 2026-09-03 against the Lightsail API:** `notary-check-mcp` is running `:notary-check-mcp.server.14` (deployment version 11). The belief that `.13` was live came from session recollection, not the API. |
| ~~**F3**~~ | ~~Migrations `0014`/`0015` not applied to production.~~ **DONE 2026-09-03** — verified backup taken and restore-tested, both migrations dry-run against a restored copy, then applied; engine redeployed as `:notary-check-api.engine.15` (deployment version 6). End-to-end smoke test passes against live prod: `CONTRADICTED`, 1 Advance suggestion, +53 millicents accrued. See `architecture-and-progress.md`. |

## Documentation debt

| # | Item |
|---|---|
| ~~**D1**~~ | ~~`engine/README.md` says "No parsing of HTML/PDF/excerpts."~~ **RESOLVED 2026-09-03** — corrected to say what is actually absent (per-glyph PDF geometry, and a producer for structured JSON evidence). |
| ~~**D2**~~ | ~~Live `DATABASE_URL` unrecorded.~~ **RESOLVED 2026-09-03** — standalone Postgres at `3.147.139.53:5432/notary_check`, TLS required. Recorded in `architecture-and-progress.md` § Database (credentials deliberately not written down). |
| ~~**D3**~~ | ~~`system-definition-synthesis.md` needs supersession notes.~~ **RESOLVED 2026-09-03** — banner added at the top plus an inline correction where it named Challenge as the build target. |
| **D4** | `build/engine-brief-for-external-review.md` predates migrations `0011`–`0013`, the audit fixes, and Clerk. It is the doc external reviewers read. |
| ~~**D5**~~ | ~~Cloudflare Container scaffold.~~ **RESOLVED 2026-09-03** — `wrangler.jsonc`, `worker/container.ts`, and the `@cloudflare/containers` dependency deleted after confirming the package was imported nowhere. |

## Proposed, not decided

The invocation pivot —
[`../guide/proposals/invocation-pivot.md`](../guide/proposals/invocation-pivot.md).
Call Notary broadly, request evidence every time, let Verify speak only
when claims exist, run Track 2 unconditionally.

**It is a proposal.** Nothing below it is committed work. Per
[`../README.md`](../README.md), it becomes canonical only when the owner
says to merge it — not by being agreed with in conversation.

Its first four steps are worth doing **whether or not the pivot is
accepted**, because each improves the current product on its own:

1. **Parallelise the claim loop.** `engineClient.ts` submits claims
   serially, and each submission internally runs a judge call and an
   Advance call. A five-claim answer is five sequential round trips while
   the tool call blocks Claude's turn. Claims are independent; there is no
   ordering dependency.
2. **Fix the ask.** `user_request` effectively required, the trailing
   reminder unqualified, Track 2 named in the description, `task_mode`
   added so the policy table stops being inert. Before changing the
   schema, query production for the `advance_invocation` skipped-vs-ok
   ratio — that instrumentation already exists and answers "how often
   does Claude actually omit it" with no build.
3. **Return what we could not check, and why.** One response field. The
   only lever we have on our own invocation frequency.
4. **Land F1 properly** — regression test, commit, deploy, and finish F2.

Step 5 onward (decoupling Advance from the claim loop, a detector
registry, Reconcile) is where the re-architecture actually starts and
should not begin until the pivot is decided.

## Open questions that change the plan

Not tasks. Answers here redirect work.

- **Research or coding?** Claims about code are checkable against a repo
  or a test run, not a document, and are excluded by the current claim
  definition. So for research and analysis Verify fires constantly; for
  coding it is near-permanently silent. This has not been chosen, and it
  determines what Notary is.
- **Does silence need a marker?** Nothing today tells a user that Notary
  ran and found nothing — silence is indistinguishable from never having
  been called. The `not_checked` counts are retained specifically so an
  ambient marker *can* be built; whether to build one is undecided.
- **What counts as a claim?** § Verification pipeline step 2 says only
  "exclude greetings, creative writing, uncheckable opinion, and
  transitions." Four cases are unresolved: attributed opinion
  ("Gartner rates X highest" — the attribution is checkable), predictions,
  claims about code, and definitional statements. Under the pivot this
  definition becomes the switch deciding whether the product speaks at
  all, which raises the stakes on getting it written down.
