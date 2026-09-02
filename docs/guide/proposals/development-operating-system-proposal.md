> Status: proposal
> Owner: Hardyk
> Last verified: 2026-09-02
> Supersedes: —

# Notary development operating system — proposal

*Pasted into a working session on 2026-09-02 as a response to "we need to
clean up, this is a mess we can't keep up." Reproduced here so the
underlying idea isn't lost even though most of its heavier machinery was
declined — only saved as a file, never adopted wholesale.*

## What was adopted from this proposal

- The core diagnosis: the risk isn't lack of ideas, it's document/reality
  drift (spec describes intent, deployed code says something else).
- A two-part documentation split separating intent from fact — implemented
  as `docs/guide/` (this proposal's "Guide" idea) and `docs/build/` (this
  proposal's "Build" idea), simplified from the original four/five-folder
  canonical/roadmap/operations/research/proposals scheme.
- A status-header convention on every doc (`canonical`/`proposal`/
  `snapshot`/`reference`), with `Owner`/`Supersedes` added per review.
- The "stale `build/` doc is a bug" principle, made into the same-commit
  update rule in `docs/README.md`.
- The `roadmap.md`-creation trigger (create it once cross-track
  dependencies exist or the build plan stops matching shipped work),
  without creating the file preemptively.

## What was explicitly declined, and why

- **The full meeting cadence** (weekly product/kernel review, weekly
  shipped-reality review, biweekly design-partner review, monthly gate
  review) — sized for a team with a record-kernel group and a
  partner-facing group. Right now there's one person directing this work;
  four recurring ritual meetings would themselves become the maintenance
  burden this proposal exists to prevent.
- **The formal decision-register schema** (ID/status/owner/approver/
  migration plan/rollback rule per decision) — declined as standing
  ceremony. Agreed instead: write a decision record only when a real
  decision is actually in dispute, not as a upfront ritual with nothing
  yet to feed it.
- **A dedicated "record kernel" ownership team** and the three-track
  gating model (CHECK / record-kernel-CAPTURE-readiness / vertical pack)
  as formal tracks with named exit gates — not rejected as an idea, just
  not something to formalize before there's more than one person and at
  least one real design partner.
- **Renaming the Canonical Product Definition into a separate "Product
  Constitution" document** — declined; it's the same document, a rename
  would just be a second name for one thing.

## Original proposal text (verbatim, for the record)

Organize the work around one product spine, three execution tracks, and a
controlled decision register. The spine is the durable decision record;
CHECK is a deliberately bounded learning wedge, while CAPTURE is the
authority-bearing enterprise destination. This matches the canonical
definition: the record is opened at a business reference, and aggregate
QA/compliance outcomes are queries over the same record rather than
separately captured products.

The immediate risk is not lack of ideas. It is document and reality
drift: the core specification describes a future shared platform, while
the deployed CHECK implementation is a Node/TypeScript/Express engine
with an MCP layer and a minimal card UI. The architecture snapshot also
identifies missing deployment documentation, a non-production billing
configuration, no CI, no real payload store, and no adjudicated held-out
evaluation gate.

**Three tracks proposed**: (A) CHECK learning wedge — prove users invoke
and act on bounded evidence checks; must not claim invocation coverage or
enterprise-grade capture; exit gate is an adjudicated evaluation plus
behavioral evidence of repeat use. (B) Record kernel / CAPTURE readiness
— build the minimum durable record a named decision family can defend;
must not claim deterministic replay without captured runnable
dependencies; exit gate is one real decision family completing
ingest/locator/reject-wrong-source/supersede without historical
mutation. (C) Vertical pack and workflow — make one buyer's recurring
document/reconstruction burden operational; must not claim horizontal
"AI governance" positioning; exit gate is a design partner retrieving a
useful record by business reference.

**Five canonical documents proposed**: Product Constitution (vision/
authority), Record Kernel Contract (entities/state machine/invariants),
Product Roadmap & Gates (living backlog), Operating Baseline (live infra
truth), Vertical Pack Standard (declarative pack schema). Working
documents in `/docs/{canonical,roadmap,operations,research,proposals}`,
each with status/owner/last-verified/depends-on/supersedes headers.

**Decision register proposed**: one compact record per consequential
choice — ID/title, status, owner/approver/date, one-sentence decision,
why now, affected documents/code, invariants affected, migration plan,
validation gate, links to PRs/tests/evidence.

**Cadence proposed**: weekly product/kernel review (45 min); weekly
shipped-reality review (30 min) reconciling the operating baseline
against actual deployment; per-PR "semantic impact" check for changes
touching claim extraction, evidence/locator treatment, applicability,
state assignment, storage/erasure, correction, or user-facing language;
biweekly design-partner review with a real decision artifact; monthly
gate review deciding continue/narrow/stop/promote per track.

**30-day ordered plan proposed**: (1) establish the source-of-truth map,
(2) close the honest-product gates — adjudicate the held-out CHECK set,
define release thresholds, add CI for locked cases and migrations, (3)
write the operating baseline and runbook — confirm DB location, MCP
hosting, logging, deploy/rollback, secret rotation, backup/restore,
Cloudflare-scaffold disposition, (4) build the smallest durable-record
slice — real payload store, canonical locator scheme, append-only
revision/correction ledger, (5) run three design-partner discovery
sessions before committing to a vertical, (6) freeze public language to
earned claims — CHECK markets Tier A only.

**What to stop doing, per the original proposal**: stop producing new
holistic synthesis documents once they've been reconciled; stop mixing
deployment facts with intended architecture; stop adding QA/compliance/
examiner screens as parallel products before the record kernel is real;
stop using long plans as the backlog; stop calling CHECK "validated"
before the held-out gate is adjudicated.
