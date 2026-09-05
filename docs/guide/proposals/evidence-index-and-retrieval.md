> Status: proposal
> Owner: Hardyk
> Last verified: 2026-09-05
> Supersedes: the E-EVIDENCE "proposed fix" paragraph in `ROADMAP.md` and the
> corresponding section of `docs/build/architecture-and-progress.md` (this
> document is the full design those point at)

# Evidence index + retrieval + match

**This is a proposal. Do not build against it as final.** Per
`README.md`, it becomes canonical only when the owner explicitly says to merge
it. Parts are actively undecided and marked as such.

## The problem this exists for

Notary verifies claims against evidence the user actually supplied. Three
live failures, all measured 2026-09-05 in production, have the same shape:

1. **The cartesian product** (fixed in cost terms, unaddressed in structure):
   every claim was checked against every source row. E-LAT + the observation
   cache cut 261 → 52 judge calls by *caching repeated questions*, not by
   asking fewer questions. The structure still scales as claims × sources.
2. **Verifying against 19–224 character excerpts, not the cited page.**
   `registerEvidence` prefers a caller-supplied excerpt over the URL, so the
   page is never fetched. Result: a Pacific-Ocean claim that two excerpts state
   almost verbatim returned **UNSUPPORTED** (review `900530a5`) — a false
   negative — and an 18-claim run returned 16/18 `locator_unresolved`.
3. **The judge fusing readings.** Asked for `scope` on a passage that names two
   scopes ("Premium Tier" … "Standard Tier"), the judge answered
   `present` with a fused, non-literal value. The locator correctly refused it
   and the claim died on the wrong mechanism.

Industry has not built Notary's exact problem; it has built the pieces, and the
pieces map almost one-to-one onto this design:

- **Fact verification lineage** (FEVER → NLI, FActScore, Google's SAFE) —
  decompose claims into checkable atoms, retrieve the evidence that bears on
  each, then judge entailment against *retrieved* passages, escalating to
  search only when a cheap check fails.
- **Grounded-generation / attribution** (ALCE; Perplexity/Bing/Copilot-style
  citations) — a model's output counts only when it cites an exact span.
  Notary already enforces this *harder* than industry (a locator must
  re-dereference). This is the moat; nothing here weakens it.
- **Hybrid retrieval** (BM25 + dense) and **table-aware QA** (TAT-QA) — most
  of Notary's real claims are rows in pricing tables; comparing them to text
  rendered from tables is strictly worse than comparing them to structured
  rows.
- **Semantic units/numbers** — `km³` ≡ "cubic kilometers", `percent` ≡ `%`,
  "12m" ≡ 12,000,000. Notary has the start of this in `normalization.ts`; it is
  a solved problem done properly.

## The change

Replace the claim-centric loop ("for each claim, for each source row, ask the
judge about every residual field") with a source-centric evidence index built
**once per source**, reused across every claim and every re-check.

### A. Intake — build the index once per source

1. **Fetch the cited page when a URL exists.** Keep the caller-supplied excerpt
   as a locator hint (find it inside the fetched text and expand to its
   semantic window) and as the fallback when the fetch fails, is paywalled, or
   no longer contains the excerpt. `safeFetch`/`resolveEvidence`/`parsePdf`
   already exist; this is a policy change at the intake boundary plus the
   fetch wiring, not new infrastructure. Measured fetches are 10–250ms.
2. **Chunk on semantic boundaries, not token counts.** Split tables into
   structured rows and sections/blocks on their own boundaries (a tier block,
   a paragraph). Fixed-window chunking is what turns "Premium Tier" and
   "Standard Tier" into one blended passage.
3. **Build a structured evidence profile per passage**: entities, metrics,
   canonicalized values+units, dates, scope labels, and a stable span locator
   for each. Deterministic extraction first (it is exactly the 
   `deterministicPass`/`normalization.ts` machinery, applied once at intake);
   the judge fills only the residue, and its answers are cached in the
   existing `evidence_field_observation` table — which this promotes from
   "cache" to "first-class evidence profile". Tables yield row-records, not
   prose.
4. **Tokenise each passage for lexical retrieval** (BM25-style). Dense
   embeddings are a later, measured decision — lexical is strong for
   exact-figure fact-checking and needs no new vendor.

The point of "once": Claude's fetch-and-recheck loop re-registers the same URL
with a new `evidence_id` every turn (measured: 15 distinct texts read
repeatedly in one 40-minute window). The index must key on content, not on the
row — the same lesson migration `0019` already learned.

### B. Review — per claim, cheap confirm, then retrieve, then judge the shortlist

1. **Deterministic confirm against the profile** (normalized value/unit/date/
   entity search over passages). Guardrail, unchanged and load-bearing: a cheap
   check may **confirm** but never **reject**; a miss falls through.
2. **Retrieve the top-k passages** for the claim from the index (k ≈ 2–3),
   scored by the claim's own field tokens (entity, metric, value, period) and
   the profile's structured keys. This is what replaces claims × sources.
3. **Judge only the shortlist**, blind, per-field, span-anchored, closed-
   vocabulary — unchanged from today, and unchanged in authority.
4. **Code decides** applicability and state, unchanged.

This is the pivot doc's "index sources once and retrieve, instead of comparing
every claim against every source — the only option that survives 70 sources",
plus SAFE's "escalate rarely", plus table-row records.

## What this does NOT change (the boundary)

- **A model may propose; a record earns a state only through an evidence-bound
  procedure.** The judge still only observes; `stateMachine.ts` still assigns
  state; `review/` remains the only caller.
- **Locators still must re-dereference.** Retrieval returns candidate passages;
  it never relaxes the span requirement. A fused or unanchored observation is
  still refused — the fix for the scope bug is the judge answering `ambiguous`
  + candidates on multi-reading passages, not looser anchors.
- **No fuzzy entity/alias matching.** The asymmetric optional-suffix rule and
  the closed, versioned alias seam stay. Retrieval scoring may rank; it never
  merges identities.
- **No LLM-opinion verdicts**, no multi-agent agreement loops, no open-ended
  retrieval. Retrieval is bounded to the evidence bound to this review.
- **Coverage is still not invocation.** An index per source is not a claim that
  every answer was checked.

## Non-goals and traps (from industry, stated so they are not re-litigated)

- Do not add a vector database "because everyone has one"; at 3–8 sources per
  review, the index discipline matters more than the ANN.
- Do not let a `present` judge answer that fails anchoring silently become a
  fabricated span. Absence/shortlist-miss must be honest states.
- Do not tune constants on single noisy runs; measure from `usage_event`.
- Do not build open retrieval before the engine has been seen correct end to
  end even once — that is the ordering this proposal assumes.

## Sequencing (each step independently worth doing)

0. **Diagnosability** — persist per claim the residual set, `claim_fields`, and
   each rejected row's `mismatchedFields`/`details` (jsonb on `claim`, or the
   existing `applicability_json` pattern), so a state is explainable from the
   DB without a replay. ~half a day. Unblocks everything else's verification.
1. **Fetch-the-page intake** (A1) with excerpt-as-hint and fallback. Fixes the
   false-negative class directly. Small–medium; needs the "what counts as
   evidence" decision below.
2. **Judge contract on `scope`/identity** — multi-reading passages must answer
   `ambiguous` + candidates; a `present` value that cannot be anchored degrades
   to `cannot_be_determined` rather than the `locator_unresolved` path.
   Prompt change + `PROMPT_VERSION` bump + a real-model regression fixture
   (the Premium-vs-Standard passage). ~half a day.
3. **Normalization routing** — run `valueUnit`/unit-equivalent forms through
   `normalization.ts` in the deterministic pass (confirm-only) before a
   residual is declared. Kills "50.1 percent"-vs-"50.1%" judge calls and fixes
   the second Pacific claim. Small.
4. **Structured evidence profile at intake** (A2–A3) — semantic chunking,
   table-rows, cached per-field observations promoted to a profile. Medium;
   this is where per-source cost becomes amortized.
5. **Retrieval + shortlist judging** (B). Medium; only pays once 4 exists.

## Open, needs a decision before merge

- **Does a pasted excerpt with a URL count as evidence on its own, or must the
  page load for a positive verdict?** Recommended: an excerpt alone may not
  establish support when a URL is present (fetch; fall back to the excerpt only
  when the fetch fails).
- **Should a too-thin excerpt be reported as a GAP** ("this is a snippet — the
  page would let me check it") rather than silently becoming INDETERMINATE?
  Probably yes either way.
- **Dense embeddings now or after lexical is measured?** Recommended: after.
- **Scope of "source":** fetch only the review's cited URLs (bounded), never
  open search. Confirm this stays true in WATCH.

## Definition of done (measured, not asserted)

Re-run the 2026-09-05 production cases and read the numbers from `usage_event`
and the DB:

- Review `900530a5` (Pacific): claim 1 returns **SUPPORTED** against the
  fetched Geology In / Surfertoday pages; claim 2 resolves via normalization.
- Judge calls per claim ≤ ~3 on a real multi-source answer with no cache
  warm-up; no re-ask when Claude re-registers the same URL.
- Every claim state is explainable from the DB alone (no replay).
- `scope` on a two-tier passage yields `ambiguous` + candidates, never a fused
  `present`.
