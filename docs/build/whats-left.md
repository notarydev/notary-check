> Status: snapshot
> Owner: Hardyk
> Last verified: 2026-09-05
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

## Readiness by area — what "ready" actually means

Added 2026-09-03. "Engine ready" was ambiguous because it had never been
defined: it could mean "it runs" (true) or "I would let a stranger rely on
it" (not close). Each area below states its own bar, so the answer is a
check rather than an opinion.

| Area | Ready means | Status |
|---|---|---|
| **Engine** | All 18 locked test cases pass **against the live deployment**, the pre-pilot gate has real numbers and meets them, quotas and spend caps demonstrably enforce, retention matches the canonical rule, kill switch drilled. | **Closer, still not ready.** Locked case 2 now passes live (E1, 2026-09-04) — the one disqualifying item is gone. Remaining: **B1** (no gate numbers, needs annotators), **B4** (retention violates a canonical rule), **B2a** (two-block card undiagnosed), and the other 17 locked cases have never been run against the *live* deployment, only locally. Caps meter correctly since 0015 but have never been observed to bite. |
| **Connector** (MCP server, card, auth) | Deployed at current code, Clerk auth gating, the card renders every state honestly, invocation defects fixed and measured. | **Partly.** Clerk live and verified. **E3 is now done and live** (`server.24`): the ask is widened, the description says what Notary *is* and no longer gates the trigger on having a source, and the trailing reminder is gone. **The remaining gap is the card** — it cannot render the detector bank's output. A claim with no source *and* a self-contradiction has no representation, and findings currently map onto the old four-state shape as best they can. **Nothing is measured after the change**: the widened ask exists to move invocation and omission rates, and neither has been re-measured. |
| **Billing** | Live Stripe keys, entitlement activates on payment, cancellation and refund paths exercised, webhook failures alert, receipts confirmed delivered. | **Not ready.** Test-mode keys only. The live-key swap is env-only, but no live payment has ever been taken. |
| **Account** (signup, dashboard, keys) | Signup gate enforced at both app and IdP level, account page works against live billing, key issue/revoke exercised. | **Partly.** App-level waitlist gate live. **O5 — Clerk Restricted mode not confirmed** — the hard half is unverified. |
| **Marketing site** | `getnotary.ai` reflects what the product actually does and claims nothing the engine cannot support. | **Unreconciled.** A live Cloudflare-fronted site exists that does not match this checkout's `dashboard/` at all. Flagged stale by the owner, never investigated. Highest risk of the set: it is the only surface making public claims. |
| **Ops** | Monitoring alerts (not just logs), backup schedule, restore drilled, CI, rollback drilled, named incident owner. | **Not ready.** Datadog key set, ingestion unconfirmed. Backup/restore genuinely drilled 2026-09-03. No CI. No named owner. |
| **Legal** | ToS, Privacy Policy (must disclose evidence text goes to a third-party model), DPA template, named correction/deletion contact. | **Not started.** Needs a lawyer. Blocks public self-serve signup, not an invited pilot. |

**The engine's next step is no longer the card contract.** Since this line was
written, Verify's cost/latency problem was solved and the correctness problem
moved to the top: the engine verifies against thin caller-supplied excerpts
instead of the cited page and produced a live false negative on evidence that
states the claim verbatim (Pacific Ocean, review `900530a5`, 2026-09-05). The
current engine priorities and their production measurements live in
`ROADMAP.md` **Priority 1** (E-LOC fixed, E-LAT measured, E-EVIDENCE open with
a correction to the earlier "engine honest" framing). Everything else here is
unchanged.

### What changed 2026-09-04 (second session), and what it did NOT change

Notary went from a claim-versus-source checker to two things: finding what is
blatantly wrong, and suggesting a next move. Full explanation in
`architecture-and-progress.md`. What matters for *this* doc is the honest
delta:

**Closed.** E3 (the widened ask). Act running without claims or sources —
previously it never ran at all on ~37% of real turns. The one-sentence
Verify → Act handoff, now carrying field-level detail. Gaps reaching the
caller. An ambiguous field no longer ending a check when every reading
conflicts anyway.

**Newly opened, and none of it was on this list before:**

- **The card cannot render the engine's output.** Now blocking rather than
  deferred: the engine emits findings the UI has no state for.
- **Findings are not persisted.** No `finding` table. Nothing measures which
  detectors fire in production, which is the number that would tell us whether
  any of the bank is earning its keep.
- **No ask ledger.** A gap can be reported on every invocation with nothing
  suppressing a repeat — the anti-nagging design exists on paper only.
- **No `responds_to`.** No way to tell whether an ask ever led to a repair, so
  the back-and-forth cannot be evaluated at all.
- **Act has no detectors** and is still one model call with four moves.
  Intent is inferred and used for exactly one thing: deciding which moves are
  legal. Every other intent-driven behaviour discussed is unbuilt.

**A rule this session established, worth stating once here because it is easy
to violate again:** behaviour guidance belongs in the tool *description*, which
the host registers as trusted configuration — never in the tool *result*. A
result is data, and instruction-shaped text inside data is the shape of a
prompt-injection attack. Claude correctly refused ours and escalated it to the
user as a security concern.

## Blocking anything being called "validated"

These are not features. Each one is a claim the product currently cannot
honestly make.

| # | Item | Why it blocks |
|---|---|---|
| **B1** | **Held-out eval set is 20 unadjudicated drafts.** `engine/eval/SCHEMA.md` says in bold it is not the gating set. | § Pre-pilot engine gate requires real numbers for false-supported rate, wrong-source acceptance, and contradiction precision. X and Y in that gate are still blank because no labeled data exists to set them from. Nothing can be called validated, and public signup stays gated, until this is annotated. Needs human annotators — no engineering path around it. |
| **B2a** | **Two-block contradiction card returns a single finding live.** The flagship Acme 17%/12% case returned "1 thing to check" against the live connector, not the two stacked findings the card contract describes. Found 2026-09-03, not diagnosed — unknown whether it is an older deployed build or a current bug. | Blocks trusting live Verify output for further UI work. Related to but distinct from B2. |
| ~~**B2**~~ | ~~Locked case 2 fails live.~~ **FIXED 2026-09-04 (E1).** Root cause was **not** the judge — it read "declined" as `decrease` correctly on every run. The claim said `Acme`, the passage said `Acme Corp`, and `normalizeEntity` canonicalised suffix *spelling* but not *presence*, so entity mismatched, the candidate was ruled inapplicable, and it was dropped before the state machine saw it. Fixed with an asymmetric optional-suffix rule. **Verified live**: `CONTRADICTED` on both the paraphrase and exact cases against `api.getnotary.ai`. | Release gate for a comparator change (§ Evaluator governance) could not be met — the held-out set is B1. Shipped on the owner's explicit call; re-score when B1 lands. |
| ~~**B3**~~ | ~~Move shipped without its adversarial eval.~~ **RESOLVED 2026-09-03.** Harness built at `engine/eval/moves-adversarial.ts` and run against live DeepSeek: **21 case-runs, 0 violations**, distribution 0:14% / 1:43% / 2:43%. Case 5 ("no useful move exists") returned 0 on all three runs — the behaviour that mattered most. Not the "always emits 2" failure Part 11 warned about. | Re-run this gate on any Move prompt or model change (`npx tsx eval/moves-adversarial.ts --repeat 3`). Layers 4 and 6 are heuristic, so a green run is evidence, not proof. |
| **B4** | **Retention violates the canonical rule.** `claim.text` and `evidence.resolved_text` are retained indefinitely, no consent, no TTL. | Directly contradicts § Security, privacy, and reliability requirements' first bullet. Also blocks the Privacy Policy in § Public-launch readiness, which has to describe a retention policy that currently doesn't exist. |

## Owed by a rule we already wrote

Small, and each one closes a gap between a stated rule and the code.

| # | Item |
|---|---|
| ~~**O1**~~ | ~~Move has no feature flag.~~ **RESOLVED 2026-09-03** — migration `0014_advance_flag.sql` adds `organization.act_moves_enabled`, `DEFAULT false` (ship dark for new orgs) with a backfill to `true` so existing orgs keep the working feature. Read in `reviewFlow.ts` before any client construction, so a disabled org costs zero model calls. Regression test asserts both no moves *and* zero model calls. **Applied to production 2026-09-03.** |
| **O2** | **`act_move_event` is written by nothing.** The table exists, tests reference it, production never writes a row. Zero interaction telemetry for Move. |
| ~~**O3**~~ | ~~Cost meter rounds to whole cents, so both spend caps summed zeros and never fired.~~ **RESOLVED 2026-09-03** — migration `0015_cost_millicents.sql`. Cost is now metered in millicents; `estimated_cost_cents` became a `GENERATED ALWAYS` column derived from it, so a writer that sets only cents gets a hard Postgres error instead of silently under-metering. Regression test proves 1,000 realistic calls accrue ~134 cents where they previously accrued 0. **Applied to production 2026-09-03**; live ledger now accruing real cost (136 millicents and rising). |
| **O4** | **Quota check is read-then-decide, not atomic** — two concurrent calls can both observe "under the cap." Already documented as a known limitation in § Locked test suite's Cost gate. Low risk at current volume. |
| **O5** | **Clerk Restricted sign-up mode not confirmed enabled** — the hard, IdP-level half of the public-signup gate. Manual dashboard action, not verifiable from this repo. |
| **O6** | **Profile Preferences copy not on the onboarding page.** Written and tested (§ Three concrete changes, item 4), never added where a user would see it. |

## In flight

> **Note on identifiers.** The `F1`–`F3` rows below predate `ROADMAP.md`'s
> current `F1`–`F4` (which mean different things and are the live ones). All
> three rows here describe states that were resolved days ago; they are struck
> rather than deleted so the IDs do not silently shift meaning.

| # | Item |
|---|---|
| ~~**F1**~~ | ~~`no_source` split → `not_checked`.~~ **SUPERSEDED** — shipped, deployed, and the four-state card is live. ROADMAP `F1` (main-vs-production) is the current meaning of F1. |
| ~~**F2**~~ | ~~`.server.14` never deployed.~~ **NOT AN ISSUE — verified 2026-09-03 against the Lightsail API.** |
| ~~**F3**~~ | ~~Migrations `0014`/`0015` not applied to production.~~ **DONE 2026-09-03.** Migrations are now through `0019` (see `architecture-and-progress.md`). |

## Documentation debt

| # | Item |
|---|---|
| ~~**D1**~~ | ~~`engine/README.md` says "No parsing of HTML/PDF/excerpts."~~ **RESOLVED 2026-09-03** — corrected to say what is actually absent (per-glyph PDF geometry, and a producer for structured JSON evidence). |
| ~~**D2**~~ | ~~Live `DATABASE_URL` unrecorded.~~ **RESOLVED 2026-09-03** — standalone Postgres at `<prod-db-host>:5432/notary_check`, TLS required. Recorded in `architecture-and-progress.md` § Database (credentials deliberately not written down). |
| ~~**D3**~~ | ~~`system-definition-synthesis.md` needs supersession notes.~~ **RESOLVED 2026-09-03** — banner added at the top plus an inline correction where it named Challenge as the build target. |
| **D4** | `build/engine-brief-for-external-review.md` predates migrations `0011`–`0013`, the audit fixes, and Clerk. It is the doc external reviewers read. |
| ~~**D5**~~ | ~~Cloudflare Container scaffold.~~ **RESOLVED 2026-09-03** — `wrangler.jsonc`, `worker/container.ts`, and the `@cloudflare/containers` dependency deleted after confirming the package was imported nowhere. |

## Proposed, not decided

The invocation pivot —
[`../guide/proposals/invocation-pivot.md`](../guide/proposals/invocation-pivot.md).
Call Notary broadly, request evidence every time, let Verify speak only
when claims exist, run Act unconditionally.

**It is a proposal.** Nothing below it is committed work. Per
[`../README.md`](../README.md), it becomes canonical only when the owner
says to merge it — not by being agreed with in conversation.

Its early steps are worth doing **whether or not the pivot is accepted**,
because each improves the current product on its own. They now sit in the
ordered engine queue below rather than being listed separately here.

Step "decouple the tracks" onward (a detector registry, Reconcile) is
where the re-architecture actually starts and should not begin until the
pivot is decided.

---

# Ordered work — engine

Decided 2026-09-03. Ordered so each step is independently worth doing and
the expensive re-architecture happens only after the cheap wins are banked.
Rationale for each decision lives in
[`tier-1-build-and-operating-plan.md`](tier-1-build-and-operating-plan.md);
this is the queue, not the argument.

**~~E1~~ — DONE 2026-09-04.** Fix locked case 2 (B2). The flagship contradiction returns
`UNSUPPORTED` instead of `CONTRADICTED` on the paraphrased-operator path.
Newly narrowed: the live smoke test on 2026-09-03 returned a correct
`CONTRADICTED` for the exact-value path, so locator resolution,
applicability, and the state machine are all proven working. **The failure
is in the one place a model reads** — the judge recognising "declined" as
`decrease`. Also newly testable: the deployment is now current code, which
eliminates "already fixed locally, just not deployed" as a cause.
*Was the highest priority — the example the product leads with.*

**Outcome.** The documented hypothesis was wrong and usefully so: the judge
extracted every field correctly, `operator=present(decrease)`, 3/3. The
failure was entity comparison — claim `Acme` vs passage `Acme Corp`. Both
extractions faithful; the comparator could not bridge them, so the candidate
was inapplicable and dropped, and the correctly-detected operator conflict
never mattered. Fixed in `verification/normalization.ts` with a deliberately
asymmetric rule (see the build plan). Live-verified on both cases.

**~~E2~~ — DONE 2026-09-04.** Parallelise the claim loop. `engineClient.ts` submits claims
serially and each submission internally runs a judge call and (at the time) a Move
call, so a five-claim answer is five sequential round trips while the tool
call blocks Claude's turn. Claims are fully independent. Bounded
`Promise.all`. **Biggest latency win available, and it is a precondition
for anything that adds per-claim work.**

**Outcome.** Bounded concurrency of 4. **Superseded — per-claim Move is OFF.** The connector sets `skip_claim_moves: true`; Act now runs ONCE per invocation via `/detect` → `runMovesForInvocation`, after the claim loop and independent of Verify's verdicts. The caps described below therefore apply to a path that no longer fires in production. The subtlety worth keeping: execution
fans out, accumulation stays in claim order, because the challenge/Move
caps are first-come and accumulating by completion would let network timing
decide which claim's moves survive. Regression test makes completion
order the exact reverse of claim order.

**~~E3~~ — DONE, live in `server.34`.** The tool description now says what Notary IS, no longer gates the trigger on having a source, and the trailing reminder is gone. `task_mode` was deliberately NOT added — see `act/intent.ts`: inferring intent is Act's own job, and asking Claude for it in an optional field it skips 19% of the time would make the classification unauditable. Original text follows.

**E3 — Fix the four invocation defects.** `user_request` is optional and
its own description tells the model it may be omitted; the trailing
reminder re-teaches the *narrow* trigger on every turn; the tool
description never mentions Act exists; there is no `task_mode` field,
so the six-mode policy table resolves to the full move set every time and
constrains nothing in production. Measured baseline already exists:
19% of Move invocations arrived with no `user_request`
(`scripts/move-invocation-report.ts`). Re-measure after changing the
description, before deciding whether the field must become required —
a validation error may prompt a corrected retry or may make Claude stop
calling entirely, and that is not known.

**E4 — Ask for a missing source, two ways.** Response text naming what
could not be checked, plus a card button calling `sendMessage()` so the
*user* can force the ask. Both, because they fail differently. Requires
the `(organization_id, hash(claim_text))` record for boundedness and a
**hard refusal of pasted excerpts on this path**. Full design and the
known weaknesses: § Asking for a missing source in the build plan.

**E5 — PARTIALLY DONE. Split, because striking it whole would tidy away work that never shipped.**

- **~~E5a~~ — DONE** (`engine.37`). The sealed constraint carries `field_deltas`, so Act can tell a wrong period from a wrong entity from a wrong number instead of inferring it from one sentence. Act also now receives `claude_answer`, `prior_attempts`, `explicit_constraints` and `prior_context`, which the MCP tool had been collecting and the engine had been discarding.
- **E5b — OPEN.** The constraint still carries no `state` or `state_reason`, and `act/prompt.ts` contains ZERO per-state guidance (verified: no occurrence of CONTRADICTED / UNSUPPORTED / INDETERMINATE). The adversarial re-run this step requires has not happened either. Original text follows.

**E5 — Give Move a real view of the finding.** It currently sees one
sealed sentence and has to infer what kind of mismatch occurred. Widen the
constraint so it can see state, reason, and per-field applicability, and
port Challenge's per-state guidance for CONTRADICTED / UNSUPPORTED /
INDETERMINATE. **Deliberately not porting the SUPPORTED branch** — see the
build plan for why. Re-run `eval/moves-adversarial.ts --repeat 3`
afterwards and confirm the 0/1/2 distribution has not shifted toward
padding; the pre-change production baseline is 19% / 67% / 14%.

**E6 — Retention (B4).** A canonical rule the code violates. Independent
of everything above and blocks the privacy policy.

**E7 — Decouple the tracks.** Only after E1–E5. Needs two deferred pieces
— the revision step and a channel to update the card after first render —
and neither is optional. If the goal is only latency, the cheaper interim
is to run both from the same payload and hold the response until both
finish. **E2 dominates this on latency; do not do E7 for speed.**

**E8 — Reconcile.** Depends on E7 and on the pivot being decided. Not
before.

### The structural rebuild queue — E9–E18 (added 2026-09-05)

Why this exists: real runs keep producing `required_field_unresolved` on
claims whose figure is verbatim on a fetched page (review `74ea42e8`,
cloud-egress pricing — "$0.09/GB for the first 10 TB" is on the page, claim
still "couldn't check"). Root cause is architectural, not a prompt issue:
the unit of verification is a whole sentence, and the applicability gate
requires every claimed field to anchor to a literal span or the claim dies.
The queue below fixes the unit and the gate, in dependency order. Index:
`ROADMAP.md` Priority 1.

**~~E9~~ — DONE, live engine.54.** parse5-based `htmlToText` (entity decode, block text, table rows as cell|cell).
`resolveEvidence.ts`'s `stripHtml` is a regex stripper: it does not decode
entities (escaped `<style>` leaked into a fetched CIA page in prod), and it
flattens tables to one text blob, so pricing rows can never be matched
structurally. Replace with a streaming HTML parser (parse5), decode
character references, drop script/style/nav, and emit table rows as
structured units (cells per row) so later steps can match claim↔row instead
of claim↔page-blob. Unit tests; keep the existing `stripHtml` test fixtures
green.

**E10 — Atomic claim decomposition + non-atom gate. PARTIAL (E10-mini live engine.55): precision hedges (approximately/about/~) no longer become modality — they were fabricating fields that sank verbatim matches (live 64bc7b05).** A sentence carries
several independently-checkable atoms; Verify should check atoms, and things
that are not claims at all ("not 714 million", "the figure should be
corrected to 670M", "AWS $913, Azure $882, GCP $1,137" as one row) must be
fused/split or flagged, never "verified". Mirrors FActScore/SAFE atomicity.
Reduces both the noise claims and the per-sentence all-or-nothing failure.

**E11 — Core vs qualifier semantics. NEEDS OWNER DECISION.** entity+metric
+value prove a figure; period/scope/tier/baseline are semantic qualifiers a
page rarely writes in the claim's words. Proposal: resolve qualifiers only
to matches/conflicts/unknown. A conflict stays a real rejection (wrong tier
caught); an *unknown qualifier no longer annihilates* a verbatim core match —
render "SUPPORTED on the figure; qualifier unverified" rather than
INDETERMINATE. Changes card semantics; the one decision that unblocks the
whole "basic facts" class.

**E12 — Derived-claim calculator.** Totals/costs ("$913 for 10 TB") are
recomputed deterministically from the row's own rate×volume, or reported as
"derived, not sourced" — never "UNSUPPORTED because no source states it".
This is where the deferred arithmetic detector (S7) gets its real job.

**~~E13~~ — DONE, live engine.53.** `mapWithLimit` caps the judge wave at 4. The
per-claim judge wave is `Promise.all(rows.map(...))` — unbounded; with many
sources it opens hundreds of parallel model calls (429s, cost, latency).
Bound it (small constant). Also bound/parallelise row resolution inside
step 1 so N sources don't serialize on N×10s fetches.

**E14 — Chunked/parallel claim extraction.** Extraction is the remaining
8–18s tail on every run (engine.48 showed 17.0s→8.3s locally splitting at
blank lines). Make production run the chunked path and parallelise with
verify once E17 lands.

**E15 — Normalization routing + $/GB unit/format layer (confirm-only).**
"0.09/GB", "$0.09 per GB", "100 GB free" should resolve through one
governed value/unit/format normaliser in the deterministic pass — confirm
only, never reject — before any residual reaches the judge. Extends
`normalization.ts` (percent→%, multipliers) to currency-per-volume forms.

**E16 — Observation cache + page storage growth.** The text-hash observation
cache and retained `resolved_text` grow without bound. Needs an eviction/TTL
policy consistent with the retention decision (B4).

**E17 — Early-return / async card. NEEDS OWNER DECISION.** STEP 2 of the
speed plan: the read side (`/state`, `/complete`), card polling and app tool
are built but inert — the server still waits for verification. Decide A/B/C
(ROADMAP / speed-implementation-plan) so users stop staring at the full e2e.

**~~E18~~ — v1 DONE.** `scripts/measure-cant-check.mjs`; current signal 98 candidates / 219 unresolved. Snapshot today's real runs
(05:14/05:27/10:40/13:53/13:55/74ea42e8) with hand labels; define the
false-"couldn't check" rate; measure every change against it. Bootstrap
ground truth so fixes stop shipping unmeasured (until B1's annotators
exist).

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
