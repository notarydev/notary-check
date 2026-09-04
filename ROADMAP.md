# The road to a real SaaS

One page. What stands between the thing that works today and a product a
stranger can pay for and rely on.

## Which document does what — read this first

There are four status files and they have different jobs. Confusion between
them has been a real cost, so:

| File | Job | Time |
|---|---|---|
| **`ROADMAP.md`** (this) | The milestone view. What's left, grouped by what it unblocks. **The index — start here.** | future |
| `docs/build/whats-left.md` | The detailed queue, with stable IDs (`B1`, `O4`, `E5`…) and the full argument for each. **This file cites those IDs; it does not restate them.** | future |
| `PROGRESS.md` | The audit trail. Every review pass, every bug found. Append-only history. | past |
| `docs/build/architecture-and-progress.md` | What is *actually* built and live right now, including infra. | present |

Operational facts — hosts, domains, deploys — are in `OPERATIONS.md`. Code
layout is in `MODULES.md`. Vocabulary is in `CLAUDE.md`.

---

## Where we actually are

Notary Check works. The engine verifies claims against evidence deterministically,
Act suggests next moves, the card renders, Clerk OAuth is live, and the whole
thing runs in production on Lightsail. 428 tests pass against a real database.

**And nobody can buy it.** That is the honest summary. The gap is not the
engine — it is everything around the engine.

---

## M1 — A stranger can sign up and pay

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

## M2 — We can honestly say it works

Today "it works" rests on a passing test suite and hand-checked examples.
That is not the same claim.

| | What's missing |
|---|---|
| **B1** | **The held-out eval set is 20 unadjudicated drafts.** The pre-pilot gate's thresholds are literally blank because there is no labelled data to set them from. Needs human annotators — **no engineering path around this.** |
| **B2a** | The flagship two-block contradiction returns a single finding against the live connector. Found, never diagnosed. |
| **B5** | 17 of the 18 locked cases have never been run against the *live* deployment, only locally. |
| **S4** | **Findings are not persisted.** There is no `finding` table, so nothing measures which detectors ever fire in production. We cannot answer "is the detector bank earning its place." |
| **O2** | `act_move_event` is written by nothing — zero interaction telemetry for Move. We don't know if anyone clicks. |

S4 and O2 are the same shape: we ship things and then cannot tell whether they
did anything. That pattern has already cost this codebase seven features that
were built, deployed, confirmed live, and silently inert.

---

## M3 — It's useful often enough to keep

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

## M4 — It can be operated by someone who isn't us

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
