# Notary Check — live progress tracker

> Informal, fast-moving status board for this build push. Not governed by
> `docs/README.md`'s status-header system (same carve-out as `HANDOFF.md`) —
> this is a scratch tracker, not product documentation. Local file — not
> published anywhere. **This file is the detailed audit trail** (every
> review pass, every bug found and fixed, full history). For the
> actionable, at-a-glance punch list, see `status-page/index.html` (mirrored
> to `~/Downloads/notary-check-tracker.html`) — rebuilt 2026-09-03 to lead
> with "what's left and who owns it" instead of a chronological narrative.

**Last updated**: 2026-09-03 — Two rounds of external review, both independently checked against source rather than trusted, real bugs found and fixed in each, all pushed to `origin/main`. See the two review callouts below for detail. Rounds 1 and 2 of the alpha build (all 5 audit P0s, Track 2, entitlement, billing, ops groundwork) remain complete as of 2026-09-02.

**Re-verified fresh after the push** (real local Postgres via the `notary-check-pg` container, not mocked): engine 291 tests / 199 pass / 0 fail / 92 skipped, server 3/3, `ui` build clean, all three typecheck clean. The skip count differs from the figure quoted earlier in this file (was 4, now 92) only because this shell has no live `DEEPSEEK_API_KEY` configured — those skipped tests are the live-model-gated ones, not a regression. Also found and fixed in this pass: a stale `dist/` build directory (gitignored, local-only) was causing a false failure when tests were run via bare `node --test` instead of `npm test`; deleted, re-ran clean.

**External review received and independently verified against source, same day.** 7 of 9 points checked directly against the actual code (not taken on trust); two were real, live bugs and are now fixed:
- ✅ **Fixed, real bug**: `server/src/engineClient.ts`'s card was displaying the raw internal `state_reason` code (e.g. `contradicting_applicable_relation`) as the user-facing finding text instead of prose, because `stateMachine.ts` always returns a non-null code, so the `?? "prose fallback"` pattern never actually triggered. The test fixture had fabricated prose in its mock `state_reason`, masking the bug. Fixed: `text` is now always the fixed prose, the code stays in the separate `why` field where it belongs. Added a regression test asserting the card never contains a raw snake_case code.
- ✅ **Fixed, real bug, more serious than first reported**: Track 2's engine-generated challenges were never actually reaching the card. `engine/src/routes/reviews.ts`'s response never included the `challenges` field at all (not just a stale comment, as first suspected — an actual missing field in the HTTP response), so the "what to pressure-test" register could never render regardless of the org feature flag. Fixed: the route now maps the engine's internal `ChallengeItem[]` to the locked snake_case wire contract and includes it in the response. Stale comments claiming the field was "NOT YET PRESENT" corrected in the same pass.
- ✅ **Doc bug, fixed**: `docs/build/tier-1-build-and-operating-plan.md` claimed Track 2 "runs concurrently" with Track 1 — the implementation correctly runs it immediately after (Track 2's entire input is Track 1's *resolved* finding, so true concurrency isn't possible for this feature as scoped), the doc's wording just didn't match. Corrected; true concurrency is `docs/guide/proposals/system-definition-synthesis.md` Part 11's separate "Advance" proposal, not this feature.
- ⚠️ **Real, documented, not fixed this pass**: `checkQuota()` (`engine/src/quotas/quotaCheck.ts`) is read-then-decide, not atomic — two concurrent calls can each observe "under the cap" and both proceed. Low real risk at alpha's traffic volume; needs an atomic reservation before it's a true hard cap under higher concurrency. Documented in both the code and the build plan's release-gate table rather than silently left as an overclaim.
- Confirmed correct, no action needed: the deterministic-harness/constrained-model pattern (model proposes, code decides) is intact everywhere checked, including Track 2's isolation from state-writing; the MCP-layer state compression (`could_not_check` collapsing several distinct engine-side causes) is a deliberate, already-documented lossy presentation choice, not an accidental loss — `state_reason`/`checks_completed` keep the engine's own result lossless; the live-vs-repo auth mismatch (`mcp.getnotary.ai` still on the older, non-Clerk build) was already tracked as a `you`-owned deploy gate in §C, not newly discovered.
- Already addressed by the existing proposal doc, not a new finding: the reviewer's point that the current Track 2 (Challenge) is narrower than the "Advance" thesis, and tests question-quality rather than downstream-outcome — this is exactly Part 11's Case 1/Case 2 distinction and the causal-experiment requirement, written up before this review arrived.

**Same day, separately**: a much larger successor to Track 2 ("Advance" — invocation-level, concurrent with Track 1, revises via an additional rather than replaced suggestion) was designed and written up at `docs/guide/proposals/system-definition-synthesis.md` Part 11. **It is a proposal, not a build target** — Track 2 v1 below (§B) is unaffected and remains what's shipped. Advance is gated behind an offline evaluation (real coding-agent interaction datasets + the user's own historical transcripts, explicitly not synthetic traces) that hasn't run yet, plus a causal alpha A/B test after that. Do not start building Advance's invocation/polling infrastructure without that evaluation existing first.

**Second external review received (audited `dbbcc05`, one commit before the fixes above landed) and independently checked against current source, same day.** Its headline finding — "Track 2 functionally absent, challenges never reach the card" — was accurate at the commit it audited and is now **stale**: that's exactly what the previous review pass already found and fixed. Its other framing — that the current Challenge implementation "violates the approved product boundary" by not being Advance — rests on a false premise: Advance is a **proposal**, explicitly not approved or a build target (see the callout directly above, and Part 11's own status line). Track 2 v1 is not "the wrong architecture patched in" — it's the thing that was actually decided and shipped; Advance is a separate, later, not-yet-evaluated idea. Two of the review's other findings were real and are now fixed; a third is real, deliberately deferred with your explicit sign-off; two more are real but not fixed this pass:
- ✅ **Fixed, real bug**: Track 2's per-review cap (4 items/invocation) was enforced with a read-then-decide count followed by a separate, later insert transaction with a model call in between — two concurrent claim submissions for the same review could both read "under the cap" and both insert, overshooting it. Fixed in `engine/src/review/reviewFlow.ts`'s `runTrack2Challenge`: the count, the model call, and the insert now all happen on one connection inside one transaction, serialized per-review via `pg_advisory_xact_lock(hashtext(reviewId))` — a different review never blocks on this lock, only concurrent calls for the *same* review do.
- ✅ **Fixed, real bug**: `server/src/engineClient.ts`'s `reviewAnswer()` had no top-level failure boundary — `createReview()` throwing (e.g. a 502 with an HTML body, where `body.review.id` access throws) propagated as an unhandled rejection instead of degrading to a card, unlike extraction failures and per-claim submission failures, which already handled this correctly. Fixed: the whole review body is now wrapped, any failure returns `could_not_check` with a logged correlation id. New regression test added.
- **Decided with your explicit sign-off, not left ambiguous**: the migration comment for `entitlement_status.past_due` claimed a "grace period, not yet a hard lockout," while `checkEntitlement()` has always denied everything except `active` — immediate lockout on a failed payment. You chose to keep the current behavior (immediate lockout) rather than build a real grace period. Fixed the migration comment to say that plainly instead of promising something the code doesn't do.
- ⚠️ **Real, not fixed this pass**: no CI workflow exists (`.github/workflows` is absent) — confirmed by directory listing, not assumed. The general `checkQuota()` spend-cap race (documented in the previous review pass, not new) remains unfixed for the same reason as before — low risk at alpha's traffic volume, real fix needs a reservation redesign.
- ⚠️ **Real, correctly scoped, not fixed this pass**: `ui`'s pinned Vite 5.4.21 has one high + one moderate dependency advisory (confirmed via `npm audit`) — both are development-server-only exposures (`npm audit --omit=dev` shows zero), not runtime vulnerabilities in the shipped single-file bundle, but still worth a Vite major-version upgrade pass once `vite-plugin-singlefile` compatibility is checked.

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
- **Update, same day**: Rounds 1-2's work is now pushed too. All of it — audit fixes, Track 2, billing/entitlement, ops groundwork, the Advance proposal docs, and this review pass's two bug fixes — is on `origin/main` (7 commits total as of this update). Nothing local/unstaged.

## In progress, not an alpha blocker: "Advance" (Track 2 v2)
See `docs/guide/proposals/system-definition-synthesis.md` Part 11 for the full design. Summary: Track 2 v1 (shipped, dark) stays exactly as built. Advance is a distinct, larger feature — works per-invocation instead of per-claim, starts concurrently with Track 1 instead of after it, produces 0-2 suggestions per round (not always exactly one — zero is a legitimate "nothing useful to add" result), and (when Track 1 later finds something material) revises each currently-untouched item independently, in place, while touched items become separate additional ones. Nothing here blocks or is blocked by alpha's current punch list.

**2026-09-03 update — core unit built and live-tested**: `engine/src/advance/` now has real code — `types.ts` (the 0-2 `AdvanceSuggestion[]` contract), `policy.ts` (unchanged), `validator.ts` (all six guardrail layers: input boundary via the type shape, policy-set membership, cardinality/dedup, a heuristic content/authority deny-list, Track-1 boundary preservation, a heuristic action-language check — the two heuristic layers are explicitly documented as non-exhaustive, not oversold), `prompt.ts` (rebuilt for the array contract), `liveGenerate.ts` (one bounded live call, short-circuits to zero cost when policy computes no legal moves). 38 hand-written fixtures, all green.

Ran a real, budget-tracked (50-call) live evaluation: 7 hand-crafted adversarial cases (from Part 11's required list) plus 43 real fixtures pulled from three sources this session (your own Claude Code history, Chatbot Arena, SWE-chat). **Found and fixed one real bug the eval surfaced**: the action-language heuristic (layer 6) anchored its request-verb check to the very start of the sentence, so a real, well-formed request that opened with a clause before the verb ("Also, check whether...", "Given the ambiguity, ask which...") was wrongly rejected — and because rejection is whole-response, this was silently destroying a second, otherwise-clean suggestion too. Confirmed the failure mode and fixed it for zero additional cost (no model call needed — verified against realistic phrasings directly), re-verified against both those phrasings and the existing locked "must still reject a stated conclusion" test cases: 10/10.

Adversarial-case read, with the caveat that 2 of 7 (the boundary-narrower-than-context and outside-the-four-moves cases) got caught by the *old, buggy* layer 6 and are therefore inconclusive, not confirmed-good: the other 5 gave clean, trustworthy signals — the model didn't sneak a disallowed move into a single-legal-move state, didn't fact-check Claude's answer itself, didn't pad to 2 suggestions when one was clearly sufficient, and correctly returned 0 when there was genuinely nothing useful to add.

**Not yet done**: no persistence tables, no connector/UI wiring, and no re-confirmation run of the real suggestion-count distribution with the layer-6 fix in place — the 50-call budget authorized for this session is fully spent; that's a fresh, smaller ask for next time. engine 329/237/0/92, typecheck clean, nothing wired into any product path yet.

## Paused, waiting on you
- Held-out eval annotation, pre-pilot gate thresholds, user test plan — all `you`-owned, block everything else in alpha's Learning gate.
- Named incident/billing-support owner, Terms/Privacy content.
- Website + pricing/alpha-offer design (you're scoping UI/UX; I build once you hand it over).
- Deploy-to-Lightsail go-ahead.
- Round 3 (release versioning/health endpoints/staging env/rollback drill) — not yet started, natural next step once you're ready.
