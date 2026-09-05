# The road to a real SaaS

One page. What stands between the thing that works today and a product a
stranger can pay for and rely on.
## Which document does what — read this first

There are four status files and they have different jobs. Confusion between
them has been a real cost, so:

| File | Job | Time |
|---|---|---|
| **`ROADMAP.md`** (this) | The priority list. **Engine correctness and cost is priority 1; open issues are priority 2.** The index — start here. | future |
| `docs/build/whats-left.md` | The detailed queue, with stable IDs (`B1`, `O4`, `E5`…) and the full argument for each. **This file cites those IDs; it does not restate them.** | future |
| `PROGRESS.md` | The audit trail. Every review pass, every bug found. Append-only history. | past |
| `docs/build/architecture-and-progress.md` | What is *actually* built and live right now, including infra. | present |

Operational facts — hosts, domains, deploys — are in `OPERATIONS.md`. Code
layout is in `MODULES.md`. Vocabulary is in `CLAUDE.md`.

---
## Where we actually are

Notary Check works. The engine verifies claims against evidence deterministically,
Act suggests next moves, the card renders, Clerk OAuth is live, and the whole
thing runs in production on Lightsail. 439 tests, 435 passing against a real
database.

**And nobody can buy it.** That is the honest summary. The gap is not the
engine — it is everything around the engine.

---

## PRIORITY 1 — The engine: correctness and cost

**This is the top of the list. Nothing below it matters if the engine is
wrong, slow, or expensive.** Everything here is measured from production
rows, not inferred.

### E-LAT — One answer cost 286 model calls, 94 seconds and 9.5¢, and produced nothing

Measured on review `f6dd5300` (2026-09-04), the first real-world test:

| | |
|---|---|
| Claims extracted | 14 |
| Evidence rows | 4 |
| Judge calls | **286** |
| Evidence matches produced | **0** |
| Wall clock | **94s** — the tool call blocks Claude's turn the whole time |
| Cost | 9.5¢ for a single answer |

286 ≈ 14 claims × 4 evidence rows × ~5 residual fields. It is a **cartesian
product**, and on this review every single call was wasted — not one match
survived applicability.

`review/reviewFlow.ts:459` is `for (const field of row.residuals) { await
extractField(...) }` — fully sequential, nested inside a sequential loop over
evidence rows. Claims run 4-wide (that was E2), which is the only reason this
was 94 seconds rather than ten minutes. **E2 parallelised across claims, not
the inner field loop** — an external reviewer flagged exactly this and was
right.

Two fixes, in value order:

**E-LAT-a — fail fast on entity.** The bigger win, because it removes calls
rather than speeding them up. Entity disagreement alone disqualifies a
claim-evidence pair, so extract entity FIRST; if the judge cannot find it in
that source, skip the remaining ~4 fields for that pair.

> **Do not implement this as a substring pre-filter on entity.** That is the
> tempting version and it breaks `"Acme, Inc."` vs `"ACME INC"` — precisely the
> normalization case E1 exists to fix. The judge must still decide; it just
> decides that field first.

Caveat to write down when doing it: skipped fields must be recorded explicitly
(`skipped_entity_mismatch`), not left silently blank, or `rejectedCandidates`
detail in L3 quietly thins out. The claim's STATE is unchanged either way —
entity mismatch drops the row regardless.

**E-LAT-b — parallelise the residual fields.** They are independent questions
about the same text. Bounded `Promise.all`.

Expected together: 286 → ~60 calls, 94s → ~15s. Both numbers should be
re-measured from `usage_event`, not assumed.

### E-RATIO — UNSUPPORTED is 45.6% of all claims, 3.5× SUPPORTED

Production distribution over 114 claims:

```
UNSUPPORTED     52  (45.6%)   all "no_support_after_completed_checks"
INDETERMINATE   35  (30.7%)   30 of them no_source
SUPPORTED       15  (13.2%)
CONTRADICTED    12  (10.5%)
```

Either Claude genuinely makes that many unsupported claims, or the
applicability comparator is too strict and is rejecting valid claim-evidence
relationships. The same external review flagged this risk independently.

**Answerable today from rows already in the database** — no new instrumentation
needed. Start with the `rejectedCandidates` on UNSUPPORTED claims and look at
which field caused the rejection.

The state machine itself is confirmed CORRECT: no claim is reported
UNSUPPORTED when the truth is "no source" — unsourced claims route to
INDETERMINATE. That was checked directly and is not the concern here.

### E-EVID — Only 27 evidence matches for 114 claims

Most claims never get a source at all. This is the product's real ceiling:
Verify can only speak when there is something to check against, and today
there usually is not. It is why the source-gap ask and Act's coverage matter
more than any additional detector.

### E-MEAS — Findings are still not persisted (was S4)

There is no `finding` table, so nothing measures which detectors ever fire in
production. After 91 reviews we cannot say whether the detector bank earns its
place. `detection.outcomes` is now logged (`detect_completed`), which is a
start but is not queryable state.

Related and now closed: move interaction telemetry exists in code — see F1, it
is built and not deployed.

### E-VERIFY — Two fixes are proven only by unit test

The **claim-level source gap** and **Act's restored context** both ship in
`engine.37` and neither has live evidence. The smoke test cannot exercise the
first, because all its claims are ungrounded and the old code would pass it
too. See F3 for the prompts written to test them.

---

## PRIORITY 2 — Open issues, half-finished work

Picked up mid-stream on 2026-09-04. None of it is blocked on a decision; it is
blocked on finishing.

### F1 — Two commits are built and NOT deployed

`origin/main` is ahead of production. Live is `:notary-check-api.engine.37` /
`:notary-check-mcp.server.38` (deployments 15 and 23), which **does** include
the Verify/Act rename, migration `0016`, claim-level source gaps, Act's
restored context, and `inputProvenance`.

It does **not** include:

| Commit | What is not live |
|---|---|
| `13a9144` | Move interaction telemetry — the `record_move_event` tool, `POST /v1/move-events`, and the invocation path persisting at all. Until this ships, `act_move_event` stays empty and every move shown to a user is still unrecorded. |
| `5c07734` | Quota test fix (test-only, no runtime effect). |

No migration is needed. `./scripts/deploy.sh both` is the whole job.

### F2 — The deploy gate fails and has not been reproduced

`./scripts/deploy.sh` runs the engine suite before building, and it failed
twice on the owner's machine with the script's own "probably the DeepSeek
flake" message. **That message has already been wrong once** — the first
failure was a real, deterministic quota-test bug (`5c07734`).

The suite passes twice consecutively here (435/435). The failing test name was
never captured, so this is unresolved rather than fixed. **Get the name
first:**

```bash
cd engine && npm test 2>&1 | grep -E '^not ok|^# (pass|fail)'
```

If it reproduces identically twice it is real, whatever file it is in.
`SKIP_TESTS=1 ./scripts/deploy.sh both` bypasses the gate if the code is
otherwise verified — but only with that reasoning stated, not by reflex.

### F3 — Live testing is underway, results not yet in

Seven scripted prompts were handed to the owner to run through the real
connector, each probing one thing with a named failure signature. The two that
matter most:

- **Mixed grounding** (one cited claim beside uncited ones). The claim-level
  source-gap fix is proven only by unit test; no live case has exercised it,
  because both claims in the smoke test are ungrounded and the old code would
  have passed too.
- **Constraint + prior attempts** — does a move respect a stated budget and
  avoid re-proposing what was already tried? Act saw neither field until
  `7584e7e`.

And the one the product actually rests on: **the closed loop** — finding →
move → Claude corrects → re-check → the original finding is gone. If that works
twice in a row it is demonstrable; nobody has yet run it end to end.

### F4 — Secrets are sitting in a settings file

`.claude/settings.local.json` contains a **live production database URL with
its password** and an `sk_live_` Clerk key, embedded in permission rules.
Rotate the Clerk key and move both out. This is unrelated to every other item
here and is the only one with a security consequence.

---

## PRIORITY 3 — Proving it works

Today "it works" rests on a passing test suite and hand-checked examples.
That is not the same claim.

| | What's missing |
|---|---|
| **B1** | **The held-out eval set is 20 unadjudicated drafts.** The pre-pilot gate's thresholds are literally blank because there is no labelled data to set them from. Needs human annotators — **no engineering path around this.** |
| **B2a** | The flagship two-block contradiction returns a single finding against the live connector. Found, never diagnosed. |
| **B5** | 17 of the 18 locked cases have never been run against the *live* deployment, only locally. |
| **S5b** | **`inputProvenance` is set but never persisted or surfaced.** The semantics are now correct in memory; no row records them and the card does not distinguish a finding computed over observed material from one computed over Claude's own report. |
| **S4** | **Findings are not persisted.** There is no `finding` table, so nothing measures which detectors ever fire in production. We cannot answer "is the detector bank earning its place." |
| ~~**O2**~~ | ~~`act_move_event` is written by nothing.~~ **RESOLVED 2026-09-04** — the card now records shown / revealed / committed / dismissed through a `record_move_event` app tool. The root cause was deeper than the missing write: the invocation-level Act path persisted nothing at all, so there was no row for an event to reference. |

S4 is the same shape as O2 was: we ship things and then cannot tell whether they
did anything. That pattern has already cost this codebase seven features that
were built, deployed, confirmed live, and silently inert.

---

## PRIORITY 4 — Making it useful more often

Measurement says Verify alone has something to say on at most ~19% of real
turns. Act was built to cover the rest. Making both fire more often, and more
usefully, is the product work.

| | What's missing |
|---|---|
| **E4** | **Ask for a missing source**, two ways — response text plus a card button. Needs an **ask ledger**: today an ignored gap would repeat on every single invocation. |
| **E5** | **Give Move a real view of the finding.** It sees one sealed sentence and must infer what kind of mismatch happened. |
| **S5** | **The intent classifier is weak** — it defaults to `general` on obviously classifiable input, which resolves to the full move set and constrains nothing. |
| **S6** | **Act has no detector bank of its own** (deferred deliberately). Verify has three detectors; Act has none. |
| **S7** | Deferred Verify detectors: arithmetic (6.7% of turns), requirement (2.3%), drift, overreach. |

---

## PRIORITY 5 — Someone can pay for it

Nothing here is hard. It is simply absent, and it is the whole difference
between a demo and a business.

| | What's missing | Detail |
|---|---|---|
| **S1** | **There is no sign-up flow.** Every call to action on `getnotary.ai` goes to a contact form. No sign-up, no pricing page, no checkout. | `OPERATIONS.md` |
| **S2** | **The dashboard is deployed nowhere.** `app.` and `dashboard.getnotary.ai` do not resolve. The Next.js app exists and builds. | `OPERATIONS.md` |
| **S3** | **Stripe is in test mode.** The live-key swap is env-only, but no live payment has ever been taken end to end. | `whats-left.md` § Billing |
| **O5** | Clerk Restricted sign-up mode not confirmed — the IdP-level half of the signup gate. Manual dashboard action. | `whats-left.md` |
| **L1** | **Terms and Privacy Policy do not exist.** Needs a lawyer. The Privacy Policy must disclose that evidence text goes to a third-party model. | `whats-left.md` § Legal |
| **B4** | **Retention violates our own canonical rule** — `claim.text` and `evidence.resolved_text` are kept indefinitely, no consent, no TTL. Blocks L1, because the policy would have to describe a retention rule that doesn't exist. | `whats-left.md` |

**M1 is blocked on L1/B4 for *public* self-serve.** An invited, paid pilot is
not — that path needs only S1–S3 and O5.

---

## PRIORITY 6 — Someone else can operate it

| | What's missing |
|---|---|
| **S8** | **No `/healthz` or `/readyz`** on either service. Nothing can tell whether a deploy is healthy except a smoke test run by hand. |
| **S9** | **No CI.** Tests run only when a human remembers. |
| **S10** | **No staging environment.** Every change is verified locally and then goes to production. |
| **S11** | **Rollback never drilled.** Lightsail rolls back on a failed deploy; we have never exercised a deliberate one. |
| **S12** | Datadog key is set; **ingestion never confirmed**. |
| **S13** | **No named incident owner, no support inbox, no billing-support owner.** |
| **O4** | Quota check is read-then-decide, not atomic. Low risk at current volume, real at scale. |

---

## Open questions that redirect the work

Not tasks — answers here change what gets built.

- **Research or coding?** Claims about code are checkable against a repo or a
  test run, not a document, and are excluded by the current claim definition.
  So for research Verify fires constantly; for coding it is near-silent. This
  determines what Notary *is*, and it has not been chosen.
- **Does silence need a marker?** Nothing tells a user that Notary ran and
  found nothing. Silence is indistinguishable from never having been called.
- **What counts as a claim?** Attributed opinion, predictions, claims about
  code, definitional statements — four unresolved cases.
- **The invocation pivot** (`docs/guide/proposals/invocation-pivot.md`) — a
  proposal, not committed work. Becomes canonical only when the owner says to
  merge it.

---

## The shortest path to revenue

If the goal is a paying customer rather than a finished product:

1. **S3** — flip Stripe to live keys and take one real payment end to end.
2. **S2** — deploy the dashboard somewhere.
3. **S1** — one sign-up entry point on the marketing site.
4. **O5** — confirm Clerk Restricted mode.

That is an *invited, paid pilot* — legally fine without L1, because the terms
can be a signed agreement rather than a public ToS. Everything in M2 still
needs doing before the product is described as validated to anyone.
