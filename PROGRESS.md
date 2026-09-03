# Notary Check — live progress tracker

> Informal, fast-moving status board for this build push. Not governed by
> `docs/README.md`'s status-header system (same carve-out as `HANDOFF.md`) —
> this is a scratch tracker, not product documentation. Updated in place as
> work lands, not append-only. Local file — not published anywhere. Full
> scorecard detail (every item, owner-tagged) lives in `status-page/index.html`
> and mirrors `~/Downloads/notary-check-tracker.html` — this file is the
> condensed version.

**Last updated**: 2026-09-02 — Rounds 1 and 2 of the alpha build both complete and independently verified. Round 2's two background agents were cut off mid-task by a session rate limit; I finished verification myself, found and fixed three real issues left by the interruption (a stray artifact that broke the Track 2 migration, two isolation-test false-positives caused by comments that named the very functions they were asserting the absence of, and — the substantive one — the original extraction-failure `no_issue` bug (§B) had *not* actually been fixed by the card-rendering agent before it was cut off; I fixed and tested it directly). Final state: engine 291/287/0/4, server 3/3, `ui` build clean, all three subprojects typecheck clean.

**Same day, separately**: a much larger successor to Track 2 ("Advance" — invocation-level, concurrent with Track 1, revises via an additional rather than replaced suggestion) was designed and written up at `docs/guide/proposals/system-definition-synthesis.md` Part 11. **It is a proposal, not a build target** — Track 2 v1 below (§B) is unaffected and remains what's shipped. Advance is gated behind an offline evaluation (real coding-agent interaction datasets + the user's own historical transcripts, explicitly not synthetic traces) that hasn't run yet, plus a causal alpha A/B test after that. Do not start building Advance's invocation/polling infrastructure without that evaluation existing first.

## Two release targets

**Private alpha** — a **paid** product launch to 5–10 invited customers, not an internal prototype with free testers: discover on a working website → sign up → pay via live billing → connect Claude → run CHECK+Challenge → inspect evidence → act/recheck → manage account → reach support, end to end.

**Public beta** — any eligible user can self-serve sign up, use the product, and expect real operational reliability (versioning, sandboxes, monitoring, support) at scale. Doesn't wait on alpha's polish; doesn't inherit alpha's shortcuts.

Owner tags used below: **you** (decision/action only you can make), **build** (pure engineering, executable once directed), **both** (your decision first, then build).

## Target 1 — Private Alpha (paid)

**A. Website — firm alpha gate, not "can be small"**:
- `both` a real, maintained alpha site — product boundary, pricing/alpha offer, sign-up or request-access flow.
- ✅ done: connector setup ("Connect to Claude" page).
- `you` Terms/Privacy pages live.
- `both` support + status/contact paths reachable from the site; decide how this reconciles with the separate, stale `getnotary.ai` site.

**B. Product correctness (non-negotiable)** — all `build`:
- ✅ **All 5 audit P0s — done, both engine and MCP sides, fully closed.** Engine (migration `0011`): (1) real exact locators (`engine/src/evidence/locators.ts` — char-offset/JSONPath/caller-excerpt coordinate systems; PDF text now really extracted via `pdf-parse`, page-level locators, not full bounding-box — honestly scoped, not overclaimed) with every stored locator **re-dereferenced** before a match may be positive; (2) per-claim lifecycle states (`engine/src/review/lifecycle.ts`); (3) evidence status split so an uninspectable source reaches `INDETERMINATE`, never `UNSUPPORTED`; (4) revocation is a full transactional purge including `resolved_text`, refused at read time; (5) claim extraction quota-gated before any network call. MCP side (`server/src/engineClient.ts`, fixed directly after the dispatched agent was cut off before reaching it): extraction failure now renders `could_not_check`, never `no_issue` — the exact original audit finding; the mixed-review silent-drop (`continue` on a failed submission) also fixed and tested. Full chain verified: engine 291/287/0/4, server 3/3, both typecheck clean.
- ⚠️ **Quota granularity caveat found while verifying (5)**: `estimateDeepSeekCostCents` rounds each call to whole cents, so a typical extraction/judge call meters as **0 cents** and never accumulates toward either cap. Pre-existing (the judge path has always had it), but it limits how much the new gate actually bites.
- ✅ **Track 2 ships in its constrained first form — built, tested, isolation-verified.** `engine/src/judge/challengeGeneration.ts` + `challengePrompts.ts`, migration `0012` (`challenge_item` table, `organization.track2_enabled` flag, default **off** — ships dark). Statically verified to never import/call the state machine or applicability layer, hold no DB/network handle of its own, and define no verdict/confidence/score field in its output schema (`challengeIsolation.test.ts`). Card (`ui/src/App.tsx`) renders the "what to pressure-test" register, subordinate to the evidence record, per the locked contract — defensive rendering if the field is absent.

**C. End-to-end product proof (a deployment gate, not a documentation claim)**:
```
Claude OAuth → authenticated connector → engine entitlement check → review card
  → persisted exact evidence → Track 2 → action/recheck → dashboard/history
```
- `you` go-ahead to deploy the current authenticated build.
- `both` a real Claude client completes the full chain — currently the live connector is still the older unauthenticated build; dashboard/Clerk path never demonstrated live.
- `build` **new**: an engine entitlement check — verifies paid/active org status, not just API-key validity.
- `build`: release revision/migration/config versioning, health/readiness, separate staging env, one rollback drill.

**D. Operational minimum (non-negotiable)**:
- `you` named incident owner/outage contact/support inbox; alpha-scope terms/privacy disclosure.
- ✅ **done**: rate-limit middleware (300/min global, 5/min waitlist), a real backup/restore drill (run for real against live local Postgres, all 9 tables verified matching), and a kill-switch runbook grounded in the actual code (confirmed two chokepoints, not one — a stale comment in `killSwitch.ts` itself was caught and flagged).
- `both`: invitation-only enforced at both app-gate and Clerk Restricted-mode layers.

**E. Billing — closed: LIVE Stripe, required complete for alpha**:
- ✅ **done**: `entitlement_status` column + migration `0010`, `checkEntitlement()`, wired into `POST /v1/reviews/:reviewId/claims` (402 on non-active org, tested) — this is the "engine entitlement check" from §C. `invoice.payment_failed` and `charge.refunded` webhook handling added, `POST /v1/billing/cancel` added, every webhook event now logs an outcome.
- `build`: the live-key swap itself needs zero code changes (confirmed) but does need operational steps at deploy time — re-run `bootstrapProducts.ts` against the live key, create a live-mode webhook endpoint (Stripe issues a separate signing secret per mode).
- `both` **new**: refund/credit *policy* (the webhook handling is built; the policy itself is a business decision).
- `you` **new**: named billing-support owner.
- ✅ done: plan display reads real data.

**F. Learning gate — required BEFORE alpha**:
- `you` held-out eval set real annotation (2 independent annotators + adjudication) — I can build tooling, not do the judgment calls.
- `you` numeric pre-pilot gate thresholds met (false-supported rate, wrong-source acceptance = 0, contradiction precision, no-source integrity = 100%).
- `you` scripted user test plan — people/scheduling task.
- `build`: product logs (completion/could_not_check/evidence-open/corrective-action/recheck/latency/cost).

## Target 2 — Public Beta

**A. Versioning/sandboxes/release management** (mostly `build`) — environment ladder, versioned contracts (schemas/prompts/normalization/migrations), versioned outputs, release promotion pipeline, 🟡`both` feature-flag governance, compatibility rules.

**B. Accounts/billing/lifecycle** — 🟡`both`: org roles model, API-key lifecycle redesign (short-lived tokens), production Stripe config, transactional email provider. `build`: verified signup/recovery, data export/deletion flows.

**C. Production reliability & security ops** — `build`: CI, backup/restore, rate limits/WAF, accessible failure states. 🟡`both`: monitoring/alerting tool decision, security-contact process.

**D. Product & trust boundary** — 🔵`you` held-out gate re-adjudicated at beta scale + public-language threshold. 🟡`both` published evidence policy, unified website→dashboard→connector→support journey, subprocessor disclosure. `build`: public docs matching deployed release.

## Explicitly not a gate, for either target
SOC 2/ISO/enterprise SSO, CAPTURE-grade retention/correction/decision-record features, broad PDF/document-class support (before the locator design is sound), a polished marketing rebrand. Rule: scope the promise to the controls actually operated — not indefinite deferral, not invisible scope creep either.

## What changed since the last update
- **Rounds 1 and 2 of the alpha build are both done.** All 5 audit P0s closed on both engine and MCP sides, Track 2 built and isolation-verified, entitlement check wired and gating real requests, billing webhook/cancellation lifecycle built, ops groundwork (rate limiting, backup/restore, kill-switch runbook) done.
- Two of five dispatched agents got cut off mid-task by a session-wide rate limit. I finished the verification pass myself and found three real issues left behind by the interruption — all fixed:
  1. The Track 2 migration file ended with a stray `</content>` artifact from the truncated write, breaking every DB-backed test in the suite (102 failures) until fixed — one-line fix, root cause was purely mechanical.
  2. Two of Track 2's own isolation tests failed because their target files' *comments* (explaining what the code must never do) literally named the forbidden function/pattern, tripping the tests' naive string/regex match — false positives, not real violations. Reworded the comments; the actual code was correct both times.
  3. The substantive one: the card-rendering agent fixed the mixed-review silent-drop bug but was cut off before reaching the *original* audit finding (extraction failure rendering as `no_issue`) in the same file. Fixed and tested directly.
- Restructured the entire tracker around the two release targets above, per a second external review.
- External repo audit received, 3 of its most severe P0 claims independently verified against source.
- Pushed everything from this session (before Rounds 1-2) to `origin/main` (4 commits: engine, server, dashboard, docs) — **Rounds 1-2's work is not yet committed/pushed.**

## Proposed, not a build target: "Advance" (Track 2 v2)
See `docs/guide/proposals/system-definition-synthesis.md` Part 11 for the full design. Summary: Track 2 v1 (shipped, dark) stays exactly as built. Advance is a distinct, larger feature — works per-invocation instead of per-claim, starts concurrently with Track 1 instead of after it, and (when Track 1 later finds something material) adds a second, separate suggestion rather than mutating the first. Gated on:
- an offline evaluation using real, rights-cleared coding-agent transcripts (SWE-chat, SWE-Together) plus your own historical non-coding transcripts, each snapshot labeled with (a) the real next action taken and (b) an independent outcome judgment — kept as two separate labels, not collapsed;
- then a causal in-alpha A/B test (Claude alone vs. Claude + Advance), Case 1 (no Track 1 finding) and Case 2 (Track 1 finding present) reported separately, since Case 1's value is unproven and the honest fallback if it fails is to ship Case-2-only.
Nothing here blocks or is blocked by alpha's current punch list.

## Paused, waiting on you
- Held-out eval annotation, pre-pilot gate thresholds, user test plan — all `you`-owned, block everything else in alpha's Learning gate.
- Named incident/billing-support owner, Terms/Privacy content.
- Website + pricing/alpha-offer design (you're scoping UI/UX; I build once you hand it over).
- Deploy-to-Lightsail go-ahead.
- Round 3 (release versioning/health endpoints/staging env/rollback drill) — not yet started, natural next step once you're ready.
