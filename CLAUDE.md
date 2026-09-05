# Start here

This is Notary Check — the CHECK-tier product: an interactive Claude
connector (MCP App) that checks material claims in a Claude answer
against evidence actually supplied, and shows only what breaks.

`notary-check/` is a separate, unrelated codebase from `notary-platform/`
and the various `phase1-*` directories elsewhere in this workspace — those
are a different product (a forensic proof-of-mitigation / release-gate
platform for AI agents). Nothing here shares a tool contract, verification
pipeline, or judge design with them.

## The vocabulary (renamed 2026-09-04 — nothing before this date uses it)

One Notary invocation has two halves. They used to be called "Track 1" and
"Track 2", which named an ORDER rather than a job; "Advance" separately named
both the second half AND one layer inside it. All three names are retired.

| Name | What it is | Where it lives |
|---|---|---|
| **Verify** | The deterministic half. Compares a material claim against resolved evidence and assigns a state through the state machine. A model may propose here; only an evidence-bound procedure decides. | `engine/src/verification/`, `engine/src/detect/` |
| **Act** | The judged half. Never assigns a state, never adds evidence, never alters the manifest. Two layers: | `engine/src/act/` |
| ├ **Challenge** | Bounded questions about a resolved claim ("what to pressure-test"). Built, frozen, flag-off (`act_challenge_enabled`). Also called Act v1. | `engine/src/judge/challengeGeneration.ts` |
| └ **Move** | The closed four-move next-action set — `clarify` / `test` / `compare` / `repair`. 0-2 per invocation. Also called Act v2. Was "Advance". | `engine/src/act/` |

Database objects follow the same words: `act_invocation`, `act_move`,
`act_move_event`, `organization.act_challenge_enabled`,
`organization.act_moves_enabled`, `challenge_item.verify_state`. The rename is
migration `0016_rename_verify_act.sql`; migrations `0012`-`0014` are applied
history and still contain the old words in their prose — read them as
historical, not as current vocabulary.

**If you find the words "Track 1", "Track 2", or "Advance" anywhere in this
repo, that is a bug** — everything except the applied migrations above was
renamed in one pass, and anything new carrying the old vocabulary drifted in
after it.

## Read this first

- **How the whole thing actually works**: [`MECHANISM.md`](MECHANISM.md) —
  one pass end to end as the code runs today: what Claude is told, Verify, the
  detector bank, Act, the card, and the invariants. **Read this first if you
  are new.**
- **The module map**: [`MODULES.md`](MODULES.md) — what each directory owns,
  what it may import, how to run the tests, and the handful of mistakes this
  codebase has actually made. Read it before your first edit.
- **The layering is enforced, not described**: `engine/scripts/check-boundaries.ts`
  runs as the first step of `npm test` and fails the build on an upward or
  sideways import between modules, or on anything but `review/` importing
  `verification/stateMachine.ts`. If you believe a rule is wrong, change the
  `LAYERS` table in that file deliberately — do not route around it.
- **Infrastructure, domains and how to deploy**: [`OPERATIONS.md`](OPERATIONS.md)
  — also names the three OTHER codebases (the marketing site is a separate repo
  and a separate host) and records that there is no sign-up flow yet.
- **What's left, and which status file does what**: [`ROADMAP.md`](ROADMAP.md)
  — the milestone view and the index over the other four status documents.
  **Its "In flight right now" section is the first thing to read in a new
  session** — it names the active build, the queued work, the owner
  decisions that are open, and the key/portal chores that will bite. It is
  kept current by whoever finishes a change. Starting new work before
  reading it means duplicating or undoing it.
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
Act v1 / Challenge design) is in
[`docs/build/phase-0-and-challenge-archive.md`](docs/build/phase-0-and-challenge-archive.md).

## Operational environment — read before acting on anything live (2026-09-05)

**Live prod:** `:notary-check-api.engine.55` (deployment 28) /
`:notary-check-mcp.server.49` (deployment 27), migrations through `0020`.
Verify by querying Lightsail, never by assuming a deploy succeeded
(`aws lightsail get-container-services --region us-east-2 --query
'containerServices[].{n:containerServiceName,v:currentDeployment.version,img:currentDeployment.containers.*.image}'`).
"Deployed" is not "running" — read production rows, not the card.

**Deploys:** `./scripts/deploy.sh engine|server|both [--migrate]`
(`--migrate` needs `PROD_DATABASE_URL`, fetched from the container env).
The engine test gate will FAIL if `engine/.env` still holds the invalid
`DEEPSEEK_API_KEY` — run tests/deploys with `DEEPSEEK_API_KEY=''` so the
live-model tests skip honestly (they need a real key to run). Never set
`SKIP_TESTS` without stating the reason.

**Prod DB (read-only unless you intend an action):** psql via a throwaway
`postgres:16-alpine` container against the engine's `DATABASE_URL`. That URL
carries `uselibpqcompat=true`, which libpq rejects — strip it first (see
`deploy.sh`'s `libpq_url`). Deliberate ops writes are rare; the one that
comes up: new organizations ship `act_moves_enabled=false`, so a tester who
should see Act/Move needs
`UPDATE organization SET act_moves_enabled=true WHERE id='…'`.

**Clerk & identity (operating summary; full detail in `OPERATIONS.md` § Clerk):**
- Clerk is the OAuth **authorization server** for `clerk.getnotary.ai`; the
  server/ MCP is the resource server. Keys live in local `server/.env`
  (VALID — use for admin API calls). The key in the **deployed** server env
  is INVALID (`clerk_key_invalid`) — rotate it before relying on refresh.
- Claude connects via the confidential OAuth app **"Claude (Notary
  connector)"**, `client_id = sI6NaxPkmPcFC49O`, callback
  `https://claude.ai/api/mcp/auth_callback`, full scope set. Do NOT register
  Claude with the publishable key as client_id (invalid_client), and do NOT
  create a second public OAuth app with a reduced scope set (invalid_scope).
- The **Account portal is NOT published** (`/sign-in` 404) — a browser
  sign-in inside the OAuth flow fails until the owner publishes it in the
  Clerk dashboard. No API can fix that.
- Admin API pattern: `api.clerk.com` with the valid `server/.env` secret —
  users, invitations, oauth_applications, rotate_secret.
- Orgs: `1cde4d65` production (smoke), `898a0428` primary tester,
  `88a5e76d` second identity `hms7tab@gmail.com` (Clerk user `user_3IuXV…`).

**Local tools:** runs-report dashboard (`cd engine && node
scripts/runs-report.mjs` → http://localhost:8123, read-only, auto-poll) and
the regression harness (`node scripts/measure-cant-check.mjs`).

**Docs discipline when you act:** update
`docs/build/architecture-and-progress.md` **in the same commit** as the
schema/deploy/auth change it describes; keep ROADMAP's "In flight right now"
current; update `PROGRESS.md` in place as you work. Instructions belong here
(CLAUDE.md) and in `OPERATIONS.md` — not scattered across chat or history.

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
