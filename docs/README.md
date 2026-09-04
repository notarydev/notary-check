> Status: reference
> Owner: Hardyk
> Last verified: 2026-09-03
> Supersedes: —

# docs/ — how this folder works

Two sections. `guide/` is intent — why Notary exists, what it's allowed to
claim, where it's going. `build/` is fact — what's actually deployed and
how to work on it right now.

## Four questions, four documents

Restructured 2026-09-03. Every doc here answers exactly one of these, and
none of them answers two:

| Question | Document | Status |
|---|---|---|
| **Vision** — what is Notary, who is it for, what may it claim? | [`guide/canonical-product-definition.md`](guide/canonical-product-definition.md) | canonical |
| **Guide** — what are the rules code is held to? | Part II of the above, plus [`build/tier-1-build-and-operating-plan.md`](build/tier-1-build-and-operating-plan.md) | canonical |
| **What's built** — what is actually live? | [`build/architecture-and-progress.md`](build/architecture-and-progress.md) | snapshot |
| **What's left** — what do we do next, in order? | [`build/whats-left.md`](build/whats-left.md) | snapshot |

A fifth doc sits between them:
[`build/transition-map.md`](build/transition-map.md) — is the current
build still shaped so it can become the vision, and are the docs and the
code still telling the same story? It carries the load-bearing structural
decisions, the foreclosure risks, and the doc/build sync procedure.

Two supporting roles: `guide/proposals/` holds ideas that are not yet
rules, and `build/phase-0-and-challenge-archive.md` holds history that is
no longer guidance.

**The vision doc is the long-horizon one and it evolves slowly.** It
carries CHECK → WATCH → CAPTURE, the Decision Evidence Record, and the
enterprise artifact — none of which the current build reaches. Read it as
where this is going, not as a description of what exists. `CLAUDE.md`
forbids editing it directly: it changes only when the owner names a
proposal to merge.

**On conflict**: guide controls product meaning, authority boundaries, and
permitted claims. build controls observed operational facts. A conflict
between them opens a decision, not an automatic winner — either the code/
build violates a canonical rule (fix the code), or the guide describes an
unratified or stale assumption (fix the guide, through a proposal, not a
silent edit).

## Every file starts with this header

    > Status: canonical | proposal | snapshot | reference
    > Owner: <name>
    > Last verified: YYYY-MM-DD
    > Supersedes: <doc name, or —>

- **canonical** — the settled rule. Disagreeing with it is a bug, not a
  legitimate choice.
- **proposal** — an idea on the table. Do not build against it as final.
- **snapshot** — true as of the date above, expected to go stale, re-check
  it before relying on it for anything time-sensitive.
- **reference** — plain facts or scholarly backing, no authority over
  product claims either way.

`Owner` is who's responsible for keeping the file honest. `Supersedes`
names a doc this one has replaced, so an old version doesn't keep getting
read as current by accident.

## Where a new doc goes

- Changes the rules of what Notary is or claims?          → `guide/proposals/`
- Describes what's actually deployed right now?            → `build/` (snapshot)
- Step-by-step instructions for building/operating something? → `build/` (canonical or reference)
- A scholarly/external argument, not a product rule?        → `guide/` (reference)

## The update rule — this is the part that actually matters

**`build/` updates in the same commit as the code change that makes it
true.** Touching the schema, the deploy target, or what's live? Touch the
matching `build/` doc in that diff. A stale `build/` doc is a bug, the
same as a failing test. (Not yet enforced by CI — worth a check later that
flags migration/deploy/auth changes with no matching `build/` diff.)

This rule only works if it's actually followed — nothing enforces it
automatically today. Run a periodic audit to catch what slipped: ask a
session to "check whether `docs/build/` still matches the actual code and
infra, flag anything stale." Cheap to run, no fixed schedule required —
before starting a new chunk of work, or every few weeks, whichever comes
first.

**`guide/` never gets edited casually alongside a code change.** An idea
starts in `guide/proposals/`, gets argued about, and only then either:
  - gets merged into `canonical-product-definition.md` (accepted), or
  - gets deleted (rejected), or
  - sits in `proposals/` (still undecided — a fine state to be in).

## The roadmap — created 2026-09-03

`build/whats-left.md` now exists. The trigger this section previously
named ("once the Tier 1 plan stops matching shipped work") fired: that
plan was deferring things that had already shipped and specifying a tool
contract that was never built.

It tracks status; it does not restate the delivery sequence, release
gates, or "do not build yet" list — those are sequencing *rules* and stay
in the Tier 1 plan.

## Current contents

```
guide/
├── canonical-product-definition.md   — canonical — the authority doc (vision + technical contract)
├── grounded-decision-records-paper.md — reference — scholarly backing, not a rule source
└── proposals/
    ├── invocation-pivot.md                 — proposal — call broadly, Verify only on claims,
    │                                         Track 2 unconditional. NOT decided.
    ├── system-definition-synthesis.md      — proposal — Track 1/2 design history; Part 11 is
    │                                         Advance's design source (Advance has since shipped
    │                                         and diverged — see the Tier 1 plan for what's real)
    ├── development-operating-system-proposal.md — proposal
    ├── claim-ambiguity-detection.md        — proposal
    └── ai-reasoning-evidence-filter.md     — proposal — positioning idea

build/
├── tier-1-build-and-operating-plan.md    — canonical — the rules and operating spec
├── architecture-and-progress.md          — snapshot — what's live, keep current
├── whats-left.md                         — snapshot — the ordered roadmap
├── transition-map.md                     — canonical — build-to-vision seam + doc/build sync
├── phase-0-and-challenge-archive.md      — reference (historical) — Phase 0 build guide and
│                                           the frozen Track 2 v1 / Challenge design
└── engine-brief-for-external-review.md   — reference — what the engine does (stale, see D4)
```

## Resolved gaps (fixed 2026-09-02)

- `HANDOFF.md` (repo root) — decision made: stays a standalone history
  log, not folded into `build/`. Now carries a pointer header directing
  readers to `CLAUDE.md` for current rules/state, since HANDOFF answers
  "what happened and why," not "what's true right now."
- `engine/README.md` — was stale (claimed no OAuth, no metrics platform,
  listed only one endpoint); updated to reflect Clerk, Stripe (test-mode),
  Datadog (optional), and the real route list, plus a pointer to
  `build/architecture-and-progress.md` as the actual live-state source.
- `dashboard/README.md` — was unmodified `create-next-app` boilerplate;
  replaced with real project-specific setup instructions.
- Every reference to the old `docs/plan.md` path (8 files across
  `HANDOFF.md`, `server/`, `engine/`, and this folder) updated to
  `docs/build/tier-1-build-and-operating-plan.md` after the move — this
  reorg itself briefly broke those references; fixed same-session.

## Known gaps still open

- `engine/eval/ANNOTATOR_GUIDE.md`, `engine/eval/SCHEMA.md`, top-level
  `README.md` — left in their component-local, conventional locations.
  Not stale, no action needed right now.
- `dashboard/AGENTS.md`, `dashboard/CLAUDE.md` — confirmed to be
  Next.js-tooling-generated (`AGENTS.md` is regenerated by `next dev`
  itself; `dashboard/CLAUDE.md` just `@`-includes it). Not project
  documentation — intentionally excluded from this structure, not an
  oversight.
