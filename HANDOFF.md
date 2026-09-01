# Notary Check — handoff brief for continuing the build

Paste this file's contents (or point at this file) when handing the work to another coding agent (opencode or otherwise). It exists so the next session doesn't have to re-derive context from this repo's commit history.

## Resume protocol — if this session ends, start here

This file is written so that **if this session dies mid-work and the next instruction is just "continue," any agent — Claude, or opencode running on DeepSeek — can pick up exactly where it left off without the person having to re-explain anything.**

1. **Git is ground truth, not this file.** This file is updated after every completed step, but if it's ever stale, `git log --oneline --all` and `git branch -a` on `github.com/notarydev/notary-check` tell you what's actually landed. Check `## Progress log` below first; verify against git if anything looks off.
2. **Find the next unchecked item in `## Progress log`.** Work proceeds top to bottom, in the order given — later steps depend on earlier ones being real (this is `§ Phase 1 build order`'s own stated discipline, not an arbitrary choice).
3. **Do the work on a feature branch** (`feature/<step-name>`), off `main`, following the pattern already used for `feature/evidence-manifest`.
4. **The dispatch pattern that's worked so far:**
   ```bash
   opencode run "<scoped task, referencing docs/plan.md section numbers>" \
     -m deepseek/deepseek-v4-flash --auto --format json --title "<step name>"
   ```
   Scope each dispatch to exactly one `§ Phase 1 build order` step — no more. Tell it explicitly what NOT to build (the next steps down the list, auth, the judge, etc.) so it doesn't silently expand scope.
5. **Never trust "typecheck passed" as "it works."** Every step so far has had at least one real bug that only showed up when actually run against a live dependency (a wrong relative path in the migration runner, invalid UUIDs in seed data that only failed at request-validation time). Stand up the real dependency (Postgres via `docker run`, etc.), exercise every case by hand (`curl`, not just reading the code), and only then commit.
6. **Update `## Progress log` below before ending the session** — check off what's done, note what was verified and how, note any bugs found/fixed. A step that's "done" in code but not reflected here has not actually been handed off.

## Source of truth

The full spec is one file: **`docs/plan.md`** (checked into this repo). Everything below is a pointer into that document. Do not re-derive product decisions, card copy, or the verification pipeline design from scratch — they're already decided and cross-referenced there.

## Repo structure — the engine/MCP boundary

`§ Architecture` in the plan draws a real seam between two components. This repo keeps both in one place (a monorepo, not separate repos, and not git branches — branches are for versioned changes over time, not for separating two components that run simultaneously) but enforces the boundary in code:

- **`server/` + `ui/` — the MCP layer.** Thin and stable. Its only job is: receive the tool call, forward it to `engine/`'s API, render the card. Changes rarely once the card/tool contract is locked (`§ Product contract`).
- **`engine/` — the orchestrator.** Everything in the plan's architecture diagram under "review orchestrator + queue": the evidence manifest, deterministic verifier, judge integration, Postgres data model, quotas, monitoring. This is where nearly all of `§ Phase 1 build order`'s work happens.

**Hard rule: `server/` calls `engine/` only over its HTTP API, never by importing its internals.** That's what makes a future split into separate repos (if a second client — a browser extension, the later WATCH gateway — ever needs the engine) a clean extraction instead of an untangling job. Split into separate repos only when there's an actual second consumer or a real reason for divergent deploy cadence — not preemptively.

Use normal feature branches for units of work (`feature/evidence-manifest`, `feature/deterministic-verifier`, ...), merged to `main` after review.

## Progress log — the actual resume point, keep this current

**Phase 0** (§ Phase 0 build guide) — local build done and verified; live/human steps not done:
- [x] `server/` + `ui/` scaffolded, built, and verified — MCP server boots and routes all four mocked scenarios correctly; card renders correctly (copy, layout, special characters) via the `?mock=` param. Several real bugs found and fixed along the way (ext-apps import path, Vite/`vite-plugin-singlefile` version incompatibility, entry-renaming approach, mock-param double-decode, charset/background — see `README.md`).
- [ ] Expose the server publicly (Cloudflare Tunnel or ngrok) — § 0.10.
- [ ] Register the tunnel URL as a Claude custom connector; confirm all four scenarios render through a *live Claude conversation*, not just the local browser test — § 0.11.
- [ ] 20–30 scripted test conversations with real people — § 0.12. This is a people/scheduling task, not something a coding agent can do.

**Phase 1** (§ Phase 1 build order — work top to bottom, each step depends on the last being real):
- [x] **Step 1 — source manifest binding + immutable locator/snapshot layer.** `engine/` package added: `Evidence` table exactly per § Core data model (14 fields), minimal `Organization`/`Review` stubs for FK integrity, `POST /v1/evidence` (org-scoped, append-only, inline payloads SHA-256 hashed). **Merged to `main`.** Verified for real against a live Postgres container: migrations applied, all 6 request cases exercised via `curl` (missing auth, cross-org rejection, url-only, inline-payload hashing, validation failure, invalid enum), append-only guarantee confirmed by resubmitting the same URL and checking two distinct rows landed. Two real bugs found and fixed in review: a wrong relative path in the migration runner, and non-RFC-compliant seed UUIDs that failed the route's own Zod validation.
- [x] **Step 2 — deterministic claim-field checks + the state machine** (§ Verification pipeline steps 2, 5, 8). `engine/src/verification/applicability.ts` (pure `assessApplicability()` per step 5 — a material field mismatch excludes a candidate even when its value is attractive; a differing value on an otherwise-matching candidate is a contradiction, not an applicability failure) and `stateMachine.ts` (pure `assignState()` per step 8's exact precedence; `CONFLICTED` intentionally excluded — CAPTURE-tier only). `Claim`/`EvidenceMatch` tables added (migration 0003), schema only — nothing reads/writes them yet; that's later steps. Claim *extraction* from raw text is explicitly out of scope here (separate, likely model-backed, later work) — these modules take already-structured fields. **Merged to `main`.** 17 unit tests (`node:test`, no new dependency), independently re-run (17/17 pass), typecheck/build independently re-run clean, migration independently re-verified against a fresh Postgres container. One documentation gap fixed in review: `stateMachine.ts` didn't state strongly enough that callers must check `applicable === true` before using `valueConflicts` to classify a relation — an inapplicable-but-value-differing candidate must never be wired in as "contradicts." Fixed with an explicit caller-precondition comment before merge.
- [x] **Step 3 — adversarial golden fixtures for source ingestion** (§ Verification pipeline step 3; locked test cases 16–17). `engine/src/ingestion/safeFetch.ts` — scheme allowlist, private/reserved-address denial (incl. 169.254.169.254), DNS-rebinding defense (connection pinned to the validated IP via a `lookup` override — hostname never re-resolved between validation and connect), manual redirect following re-validated on every hop, byte cap (declared + streamed), decompression-bomb protection (independent decompressed-size cap), overall wall-clock timeout, MIME allowlist per § Document-class scope for v1. `delimitEvidence.ts` — case 17's prompt-injection-safe fencing (random-nonce fence + escaping of fence-shaped content already inside the evidence; makes no claim about model behavior, only structural soundness — no model is wired in yet). `fixtures/hostilePdf.ts` — case 16's hostile-file builders, explicitly scoped to what's provable at the fetch boundary (oversized/slow), with deep parser-hardening honestly deferred since no PDF/office parser is wired in yet. **Merged to `main`.** 48 tests total, every one spinning up/tearing down a real local `node:http` server (only DNS is mocked, and only where determinism requires it) — independently re-run, 48/48 pass. Reviewed with extra scrutiny as security-critical code: read every line of both modules and both test files in full. One real bug found and fixed: `Content-Encoding: identity` (a legitimate RFC 7231 value) was being rejected as unsupported, which would have wrongly marked a real report server as unavailable — fixed, with a new test. Independently verified the DNS-rebinding test is genuinely strong (targets an RFC 2606 `.invalid` hostname, intercepts the real socket's `remoteAddress`) rather than trusting the dispatched report.
- [ ] **Step 4 — the constrained judge** (§ LLM judge design — DeepSeek, Chain-of-Verification, the four-outcome extraction vocabulary in § Judge authority boundary, no raw confidence gating), measured against a held-out labeled set (§ Evaluator governance and rollback).
- [ ] **Step 5 — auth, quotas, retention/deletion, observability (§ Monitoring), kill switch.** The `x-notary-organization-id` header in step 1's code is an explicit stub for this — replace it here, don't patch around it earlier.
- [ ] **Step 6 — a tightly scoped invited cohort.** An ops/people step, not code.

**Everything after Phase 1** (Phase 2 repeat-value measurement, Phase 3 expansion, § Exploratory review, and all of § Public-launch readiness — billing, self-serve onboarding, legal docs, support) — correctly not started. Per the plan's own sequencing, none of it should start before Phase 1 ships and proves repeat value; see `docs/plan.md § Delivery sequence` if the reason for that ordering needs re-justifying to anyone.

## Hard constraints — do not relitigate these, they're locked decisions

- **Card copy is locked language** (§ Phase 0 build guide § 0.5, § Product contract) — don't paraphrase the four scenario strings or the card states (`no_issue` / `issue_found` / `could_not_check`). No fifth state, no score, no percentage, no badge.
- **Bounded evidence only, never open-web search** (§ Cost-control rules, § Verification pipeline step 4). This is what distinguishes Notary Check from general fact-checkers like Lenz — don't add retrieval "to make it smarter."
- **The judge never decides the final state** (§ Judge authority boundary, § step 8's unmoving-filter invariant). It outputs `present` / `absent` / `ambiguous` / `cannot_be_determined` per field; deterministic code compares. No confidence-number gating — that was tried and explicitly removed for being inconsistent with the plan's own claims about LLM calibration.
- **v1 evidence classes are narrow on purpose** (§ Document-class scope for v1) — HTML/PDF corporate/financial reports and excerpts traceable to one. Anything else is `INDETERMINATE / out_of_supported_evidence_class`, not silently accepted.
- **False-supported is the error that matters most** (§ Locked test suite and release gates) — a change that improves recall but worsens false-supported or wrong-source acceptance does not ship without an explicit decision.
- **Notary Check is a separate codebase from `notary-platform`** — don't import or depend on anything from that repo; it's a different, unrelated product.

## What to hand a coding agent to actually finish building

1. **This file, plus the full plan document.** Without the plan, an agent will re-derive (and likely get wrong) the card states, the judge design, and the applicability rules — all of which are already fully specified.
2. **This repo's URL** — `https://github.com/notarydev/notary-check` (private) — and `git clone` access.
3. **A Claude account with connector/MCP App development access enabled**, to actually register the tunnel URL and test live (§ 0.1, § 0.11).
4. **A tunnel tool** — `cloudflared` or `ngrok` installed — for § 0.10.
5. **For Phase 1 only, not now**: a DeepSeek API key (§ LLM judge design), a Postgres connection and object store (§ Core data model, § Architecture), and — before real users, not before — the legal package named in § Public-launch readiness.
6. **Explicit scope for the session**: tell it whether you want it to finish Phase 0 (tunnel + live connector test + user tests) or start Phase 1's build order. Don't hand over "finish building" unscoped — the plan is large enough that an agent without a stated boundary will guess, and Phase 0's remaining steps (tunnel, live test, user interviews) are a fundamentally different kind of work than Phase 1's engineering.

## On training/test data for the engine

Short answer: **yes to test/eval data, no to fine-tuning a model** — and the plan already designed for the first, not the second.

**What the architecture actually needs is a labeled held-out evaluation set, not training data.** Notary Check's judge (DeepSeek) is used via prompting — narrow field-extraction questions, Chain-of-Verification-style — not fine-tuned. The deterministic verifier is code, not a trained model. So "make the engine stronger" here means two concrete things, both already specified:

1. **Build the § Locked test suite's 18 test packets now** — these are synthetic/adversarial fixtures (exact support, contradiction, wrong entity, wrong denominator, prompt-injection-in-evidence, adversarial source ingestion, idempotency, etc.). They don't need real users or real data; they can and should be built alongside Phase 1's engineering, per § Phase 1 build order step 3 (adversarial fixtures before the judge is added).
2. **Build a held-out labeled set via the annotation protocol** (§ Evaluator governance and rollback) — two independent annotators per packet, a written claim-boundary/applicability guide, blinded adjudication for disagreements. This becomes the standing regression suite that gates every judge prompt/model change (§ Evaluator governance) and supplies the actual X/Y numbers for the § Pre-pilot engine gate (false-supported rate, wrong-source acceptance, contradiction precision) — those thresholds were deliberately left blank in the plan until this set exists.

**What not to do:** don't feed real customer/user documents into any training or fine-tuning pipeline — § Security, privacy, and reliability requirements already states "keep customer payloads out of development, evaluation, and model-training datasets without explicit agreement," and that's a hard constraint, not a suggestion. If a genuinely stronger judge later requires fine-tuning a model (rather than better prompting), that's a real architecture change beyond what this plan specifies — treat it as its own decision requiring its own data-governance plan, not something to fold in casually while building Phase 1.
