# Start here

This is Notary Check — the CHECK-tier product: an interactive Claude
connector (MCP App) that checks material claims in a Claude answer
against evidence actually supplied, and shows only what breaks.

`notary-check/` is a separate, unrelated codebase from `notary-platform/`
and the various `phase1-*` directories elsewhere in this workspace — those
are a different product (a forensic proof-of-mitigation / release-gate
platform for AI agents). Nothing here shares a tool contract, verification
pipeline, or judge design with them.

## Read this first

- **The rules for this docs/ folder**: [`docs/README.md`](docs/README.md)
  — governs what's canonical vs. proposed vs. current-fact, and how to
  update each as you build.

Four documents, one question each (restructured 2026-09-03):

- **Vision** — what Notary is, what it may claim, and where it's going
  (CHECK → WATCH → CAPTURE). Long-horizon; evolves slowly; **never edit
  directly**, see the last section of this file:
  [`docs/guide/canonical-product-definition.md`](docs/guide/canonical-product-definition.md)
- **Guide** — the rules code is held to (card contract, tool contract,
  verification pipeline, judge design, data model, security):
  [`docs/build/tier-1-build-and-operating-plan.md`](docs/build/tier-1-build-and-operating-plan.md)
- **What's built** — infra and what's actually live right now:
  [`docs/build/architecture-and-progress.md`](docs/build/architecture-and-progress.md)
- **What's left** — the ordered roadmap, blockers, and open decisions:
  [`docs/build/whats-left.md`](docs/build/whats-left.md)

- **Still on the path?** — whether today's build can still become the
  vision, what must not be broken, and how to keep docs and code in sync:
  [`docs/build/transition-map.md`](docs/build/transition-map.md)

Proposals that are **not** rules yet live in `docs/guide/proposals/`.
History that is no longer guidance (the Phase 0 build guide, the frozen
Track 2 v1 / Challenge design) is in
[`docs/build/phase-0-and-challenge-archive.md`](docs/build/phase-0-and-challenge-archive.md).

## The one rule that matters most

> A model may propose. A record earns a state only through an
> evidence-bound procedure.

Notary is a recorder, not a decider. Nothing in this codebase should let
a model's assertion, confidence, or citation directly create a
`SUPPORTED` or `CONTRADICTED` state — only a resolved locator plus a
satisfied applicability check, run through the deterministic pipeline,
can do that. If a change would blur that line, stop and check
`docs/guide/canonical-product-definition.md` §6 before proceeding.

## DeepSeek via opencode is available — explicit permission only

Scoped, mechanical work (well-defined, single-`docs/build/tier-1-build-and-operating-plan.md`-section
tasks — not judgment calls about product meaning or authority
boundaries) can be dispatched to DeepSeek through opencode instead of
done directly, to save tokens. The dispatch pattern is already documented
in `HANDOFF.md`:

```bash
opencode run "<scoped task, referencing docs/build/tier-1-build-and-operating-plan.md section numbers>" \
  -m deepseek/deepseek-v4-flash --auto --format json --title "<step name>"
```

**This requires explicit permission from the user each time, not a
standing default.** Don't dispatch to DeepSeek on your own judgment that
a task looks mechanical — ask first. Scope the dispatch to exactly one
step and say explicitly what it must NOT touch (auth, the judge,
billing, anything outside the named step), the same discipline
`HANDOFF.md` already documents from prior dispatches.

## When you finish a change

If it touched the schema, deploy target, auth, or anything else
`docs/build/architecture-and-progress.md` describes — update that file in
the same commit. A stale `build/` doc is a bug, not a later task.

## Keep `PROGRESS.md` current as you work

[`PROGRESS.md`](PROGRESS.md) (repo root) is a live, informal status tracker —
an at-a-glance table of what's done/partial/not-started, not governed by
`docs/README.md`'s status-header system. Update it **in place** (edit the
table, don't append a log) whenever you finish, materially advance, or
discover something that changes a row's status — the same moment you'd
otherwise just say so in chat. It exists so the person working with you has
something to look at without reconstructing state from conversation
scrollback. A stale `PROGRESS.md` is the same kind of bug as a stale
`architecture-and-progress.md` — don't let it silently drift from reality.

## Never edit canonical guide docs directly

**Never edit [`docs/guide/canonical-product-definition.md`](docs/guide/canonical-product-definition.md)
directly.** A change there only happens when the user explicitly says to
merge a named proposal from `docs/guide/proposals/`. An idea stays a
proposal — read, discussed, even mostly agreed with — until the user says
those words. This is a boundary rule, not a formatting preference: it's
the same authority discipline the product itself enforces (§ "A model may
propose..." above), applied to its own documentation.
