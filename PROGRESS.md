# Notary Check — live progress tracker

> Informal, fast-moving status board for this build push. Not governed by
> `docs/README.md`'s status-header system (same carve-out as `HANDOFF.md`) —
> this is a scratch tracker, not product documentation. Updated in place as
> work lands, not append-only. Local file — not published anywhere.

**Last updated**: 2026-09-02, after Track 2 was promoted into the current build (product decision) and the two canonical-doc amendments were merged.

## At a glance

| Area | % complete | Status | What's left |
|---|---|---|---|
| **Track 1 — Verification engine (Evidence)** | ~75% | 🟡 Live, working, one flagship bug just fixed locally | Held-out eval gate (0% — 20 draft, unadjudicated cases, no real numbers); source-pointer round-trip now written into canonical doc, not yet built in code; 4/18 locked test cases still not covered |
| **Track 2 — Challenge ("What to pressure-test")** | 0% built | 🔴 **Promoted into current build** — spec locked in `docs/build/tier-1-build-and-operating-plan.md` | Just decided: one combined card, Track 1 (evidence record) + Track 2 (subordinate challenge layer) from one invocation, capped 2/claim + 4/invocation, no verdict field. Build starting now — engine (judge module + schema), server/ui (card rendering) |
| **Claim-ambiguity detection** | 0% | 🔴 Research spike starting | Mechanism genuinely unsettled (Part 5's open question) — prototyping the self-consideration-pass approach first, not shipping as a feature yet |
| **Engine backend for dashboard** (`GET/POST/DELETE` reviews/evidence/usage/org/api-keys/waitlist) | 100% of scoped work | 🟢 Built, tested, curl-verified | Not deployed live yet |
| **Dashboard frontend** | ~90% of scoped work | 🟢 All core pages built: overview, reviews (+detail), evidence, usage, settings (billing/api-keys/connect) | Not deployed live yet; no live Clerk session exercised end-to-end in this environment |
| **"Connect to Claude" page** | 100% | 🟢 Built this session — was previously the single biggest UX gap | Needs the real `NOTARY_MCP_CONNECTOR_URL` set once deployed |
| **Live MCP connector** (`mcp.getnotary.ai`) | Live, functional | 🟢 Confirmed working for the core review loop via direct protocol testing | Running an **older build** — no Clerk auth, doesn't have this session's fixes yet |
| **Live paraphrase-contradiction bug** | Fixed locally | 🟢 Root-caused, fixed, regression-tested (211/215 passing) | Not deployed — live endpoint still has the bug until deploy |
| **Clerk OAuth on MCP server** | ~85% built | 🟡 Code real, never live-tested against an actual Claude client | Needs a deploy + a real connector test |
| **Billing** | ~85% | 🟢 Stripe checkout real (test mode); plan display now reads real data | Still test-mode Stripe keys, not live payment |
| **Marketing site** (`getnotary.ai`) | Unknown | ⚪ Confirmed live, real, but its codebase location is unknown to me | Needs you to point me at the repo before I can scope a refresh |
| **Deploy sync** (local work → Lightsail) | 0% deployed | 🔴 Everything above is local/unstaged | Explicit go-ahead needed — see plan file, this is deliberately held back |
| **Legal (ToS/Privacy/DPA)** | 0% | 🔴 Not started | Blocks a *public* signup open, not your personal test |

## Legend
🟢 done and verified · 🟡 real but partial/unverified in one dimension · 🔴 not started · ⚪ correctly not started (not a gap)

## What changed since the last update
- **Product decision**: Track 2/Challenge promoted into the current build (was deferred). Design: one card, two registers — evidence record (unchanged, authoritative) + "what to pressure-test" (new, subordinate, typed, capped, never a verdict).
- Locked the Track 2 build contract into `docs/build/tier-1-build-and-operating-plan.md` (Product Contract section) and the design history into `docs/guide/proposals/system-definition-synthesis.md` (Part 10).
- Merged two amendments into `docs/guide/canonical-product-definition.md` (§5.2 claim-ambiguity resolution authority, §5.3 source-pointer-to-evidence sequence) — explicit sign-off given.
- Fixed: live paraphrase-contradiction bug (`engine/src/verification/applicability.ts`) — operator paraphrase + differing value now correctly reaches `CONTRADICTED` instead of `UNSUPPORTED`.
- Built: `/dashboard/reviews` (+ `[id]` detail), `/dashboard/evidence`, `/dashboard/usage`, `/dashboard` overview — all reading real engine data.
- Built: `/dashboard/settings` (index, billing migrated off `/account`, api-keys issue/revoke, connect-to-Claude instructions).
- Corrected docs: `mcp.getnotary.ai` and `clerk.getnotary.ai` are live (previously undocumented/unconfirmed); `DD_API_KEY` is live on the engine container (previously marked unconfirmed); `getnotary.ai` marketing site discovered, flagged as stale (deprioritized, needs to eventually merge with the dashboard flow).

## In progress now
- Track 2 backend: engine judge module + org feature flag + card schema (engine/).
- Track 2 frontend: card rendering for the new "what to pressure-test" register (server/ + ui/).
- Claim-ambiguity research spike: self-consideration-pass prototype (engine/, isolated from Track 2's files).

## Next candidates (not started, no agent assigned yet)
- Deploy this session's work to Lightsail (needs your go-ahead + env var updates on both container services).
- Marketing site refresh (deprioritized — needs to merge with the dashboard flow, not stay separate).
- Held-out eval set annotation (the actual product-validation blocker).
