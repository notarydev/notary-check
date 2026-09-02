> Status: reference
> Owner: Hardyk
> Last verified: 2026-09-01
> Supersedes: —

# Notary Check — engine functionality brief (as of 2026-09-01)

This is a factual description of what is actually built and running, for sharing with an external collaborator/AI. Nothing here is aspirational — anything not listed does not exist yet.

## What the system does, end to end

1. **Input**: an AI-generated answer's text (e.g., a Claude response), plus zero or more sources the caller can actually supply (a URL, pasted excerpt, or file).
2. **Claim extraction** (`engine/src/extraction/extractClaims.ts`): a DeepSeek call decomposes the answer text into individual factual claims. Each claim gets: verbatim text, a `materiality` flag (would a review need to surface this if wrong — not a truth score), and structured fields: `entity`, `period`, `metric`, `operator` (see below), `valueUnit` (value + unit split apart), `comparatorBaseline`, `modality`, `scope`. Only material claims proceed.
3. **Evidence registration**: each source is registered as an append-only row (a URL, or inline pasted text — hashed either way).
4. **Per-claim review** (`engine/src/review/reviewFlow.ts`), for each material claim against its bound evidence:
   - **Deterministic pass first**: exact case-insensitive substring search for each claimed field's literal value inside the evidence text. Fields it can find this way are resolved for free, no model call.
   - **Judge pass for the rest**: whatever fields the deterministic pass couldn't resolve go to DeepSeek, one field at a time (see "The LLM Judge" below).
   - **Applicability check** (`engine/src/verification/applicability.ts`): compares the claim's fields against the evidence's (assembled) fields. A material mismatch on *any* field excludes the candidate — even if the number looks right. A same-field value difference (same entity/period/metric/etc., different number) is a **contradiction**, not an exclusion — that distinction is load-bearing.
   - **Normalization** (`engine/src/verification/normalization.ts`, "Tier A.5"): field comparison is typed and allow-listed, never fuzzy. Covered: case/punctuation/whitespace, corporate-suffix spelling ("Acme, Inc." ~ "ACME Inc"), percent notation, numeric separators, declared value multipliers ("$12m" ~ "$12,000,000"), fiscal-year label formatting ("FY25" ~ "fiscal 2025" — never calendar-date math). Never normalized: `metric` itself ("gross revenue" ≠ "revenue", permanently), `comparatorBaseline`, `modality`, `scope`.
   - **`metric` / `operator` split**: `metric` is the free-text noun being measured ("revenue") — never semantically normalized. `operator` is the asserted direction of change — resolved directly into a **closed vocabulary** (`increase` | `decrease` | `no_change`) by both claim extraction and the judge, rather than left as raw text needing a synonym table. This is the one field where recognizing "grew"/"rose"/"increased" as the same thing is explicitly authorized, at extraction time — not at comparison time.
   - **State assignment** (`engine/src/verification/stateMachine.ts`): fixed precedence over the relations found → `SUPPORTED`, `CONTRADICTED`, `UNSUPPORTED`, `INDETERMINATE` (with a specific reason), or `no_source`.
5. **Output**: a card with exactly 3 user-facing states (`no_issue` / `issue_found` / `could_not_check`) — the wider engine states above collapse into these three for display, but the original state/reason is preserved in what's persisted.

## The LLM Judge — exactly what it can do right now

The judge is the DeepSeek call inside `reviewFlow.ts`'s per-field residual pass (`engine/src/judge/fieldExtraction.ts` + `engine/src/judge/judgeClient.ts` + `engine/src/judge/promptTemplates.ts`). It is a **narrow field extractor**, not a general reasoning step.

**The actual API call** (`judgeClient.ts`):
```
POST https://api.deepseek.com/chat/completions
model: deepseek-v4-flash
temperature: 0
max_tokens: 1024
stream: false
response_format: { type: "json_object" }
thinking: { type: "disabled" }
```
No `tools` or `tool_choice` key exists anywhere in the request — structurally, not by instruction, the model can never be asked to browse, retrieve, or call a function.

**How the prompt is built, per field** (`promptTemplates.ts`):
- One prompt per field per call — the judge is asked about exactly one field (e.g., "metric") at a time, never the whole claim at once.
- Each field has its own question + criterion, written in the pipeline's own vocabulary (e.g., `metric`: "name the metric noun in the passage's own vocabulary; do not substitute a synonym that is not present" — vs. `operator`: explicitly told the opposite, that recognizing "grew"/"increased" as the same direction is expected here).
- The model is required to reason step-by-step before answering (no one-line verdicts), and there's an explicit anti-verbosity clause so longer answers don't score better.
- The evidence text is delimited with a random-nonce fence (`engine/src/ingestion/delimitEvidence.ts`) before it ever reaches the prompt, specifically so injected instructions inside evidence text can't be mistaken for real instructions.
- **The judge is blind**: it is never given the claim's own asserted value — only the evidence passage and the field-specific question. It cannot "confirm what it's told."

**What it's allowed to answer** — exactly one of four outcomes per field, strictly parsed (a stray `confidence` key or anything outside this shape is rejected, not silently accepted):
- `present` (with the extracted value)
- `absent`
- `ambiguous`
- `cannot_be_determined`

Two fields get a deterministic code-level correction on top of the raw model answer:
- `modality`: an `absent` outcome (no explicit marker like "estimated"/"projected") is upgraded in code to `present, "actual"` — a plain assertion structurally *is* the "actual" modality, not a missing field, and depending on the model to reliably self-correct this in-prompt turned out to be unreliable.
- `operator`: resolved directly into the closed `increase`/`decrease`/`no_change` vocabulary.

**What it explicitly cannot do**, enforced in code, not prompt wording:
- Cannot retrieve or search anything — no retrieval hook exists in the module at all.
- Cannot decide whether a source is applicable to a claim, and cannot assign a claim's final state. Both are 100% deterministic code (`applicability.ts` / `stateMachine.ts`); the judge's structured field answers are just input to that code.
- Cannot output a truth verdict or a confidence score — there is no field for either in its output contract.

**Cost/observability**: every judge call logs latency and an estimated cost (from real token counts) to structured logs, now also shipped to Datadog when configured.

## What does NOT exist yet (do not assume these)

- No "recheck a single claim" flow (`recheck_claim`) — only a full claim resubmission.
- No evidence-binding round-trip (Claude supplying a source *after* the fact, mid-conversation).
- No repair/correction regression tracking.
- No exploratory/full-transcript review — only the specific answer text and sources explicitly supplied.
- The card's "cost/method transparency line" (showing whether a result came from the deterministic pass or the judge) is designed in the spec but not built into the UI yet.
