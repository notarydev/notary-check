# Notary Check — handoff brief for continuing the build

Paste this file's contents (or point at this file) when handing the work to another coding agent (opencode or otherwise). It exists so the next session doesn't have to re-derive context from this repo's commit history.

## Source of truth

The full spec is one file, not this repo: **`Notary — Tier 1 Build and Operating Plan Final 831.md`** (currently local-only, not yet in this repo — ask whether it should be added under `docs/`). Everything below is a pointer into that document. Do not re-derive product decisions, card copy, or the verification pipeline design from scratch — they're already decided and cross-referenced there.

## What's built (verified by running it, not just written)

- `server/` — MCP server (Express + `@modelcontextprotocol/sdk` + `@modelcontextprotocol/ext-apps`). Boots, responds to `initialize`, and `tools/call` on `review_source_backed_answer` correctly routes to all four mocked scenarios.
- `ui/` — the review card (React), built to a single inlined `dist/mcp-app.html`. All four card states visually confirmed correct (copy, layout, special characters) via the `?mock=` param.
- Real bugs found by building it and fixed (see `README.md` for the list) — ext-apps import path, Vite/`vite-plugin-singlefile` version incompatibility, entry-renaming approach, mock-param double-decode, charset/background.

This is **§ Phase 0** of the plan, and it is **not done** — see below.

## What's not built

**Rest of Phase 0** (§ 0.10–0.13 of the plan):
1. Expose the server publicly (Cloudflare Tunnel or ngrok) — not yet run.
2. Register the tunnel URL as a Claude custom connector and confirm all four scenarios render through a *live Claude conversation* — not yet done. The local browser test is not a substitute for this.
3. 20–30 scripted test conversations with real people, testing comprehension and perceived helpfulness — not started.

Phase 0 is not "complete" until all of § 0.12's checklist is true, including the two items above.

**All of Phase 1** (§ Delivery sequence, § Phase 1 build order — build in this order, later steps depend on earlier ones being real):
1. Source manifest binding + immutable locator/snapshot layer (§ Verification pipeline step 1; `Evidence` in § Core data model).
2. Deterministic claim-field checks + the state machine (§ Verification pipeline steps 2, 5, 8).
3. Adversarial golden fixtures for source ingestion (§ Verification pipeline step 3; locked test cases 16–17) — before the judge is added.
4. The constrained judge (§ LLM judge design — DeepSeek, Chain-of-Verification, the four-outcome extraction vocabulary in § Judge authority boundary, no raw confidence gating), measured against a held-out labeled set (§ Evaluator governance and rollback).
5. Auth, quotas, retention/deletion, observability (§ Monitoring), kill switch.
6. A tightly scoped invited cohort.

None of this exists yet — no database, no real claim extraction, no evidence fetcher, no judge integration, no auth.

**Everything after Phase 1** (Phase 2 repeat-value measurement, Phase 3 expansion, § Exploratory review, public-launch items in § Public-launch readiness — billing, self-serve onboarding, legal docs, support) — not started, and per the plan, correctly not started yet.

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
