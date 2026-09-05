# Speed work — implementation plan

**Purpose: this is written so someone else can execute it without this
session.** It assumes no memory of the conversation that produced it. Options
and rationale live in [`speed-and-streaming.md`](speed-and-streaming.md); this
is the build order and the detail.

Read first: `CLAUDE.md` (vocabulary), `MECHANISM.md` (how it works),
`MODULES.md` (layering and how to run things), `OPERATIONS.md` (deploy).

---

## Non-negotiables — break any of these and the change is wrong

1. **Only `verification/stateMachine.ts`'s `assignState()` may write
   `claim.state`, and only `review/` may call it.** Enforced by
   `engine/scripts/check-boundaries.ts`, which runs first in `npm test`.
2. **The judge must never see the claim's asserted value.** `extractField()`
   takes source text and a field name. Do not add a claim parameter. This is
   what stops the model agreeing with something it has been shown, and it is
   also what makes caching sound.
3. **Nothing may be silently skipped.** No claim capping. If work is not done,
   it is reported — as a gap, or in the scope line.
4. **Cheap checks may CONFIRM, never REJECT.** A fast path that can rule
   something out is a fast way to be wrong. A miss falls through to the
   existing judge path.
5. **Every optimisation must be measured against production rows**, not against
   the card and not against a fixture. Query `usage_event` for judge calls per
   review. Fixtures cleaner than production have hidden three separate failures
   in this codebase already.

## How to verify anything here

```bash
docker run -d --name notary-pg -p 5432:5432 \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=notary_check postgres:16
docker exec notary-pg psql -U postgres -c "CREATE ROLE $USER LOGIN SUPERUSER;"
cd engine && npm run migrate && npm test     # 449 tests, boundaries check first
cd ../server && npm test
```

A local harness against the REAL model beats reasoning. Write a throwaway
`.ts` at `engine/` root, `set -a && . ./.env && set +a`, run with
`npx tsx`, delete it after. This is how the extraction truncation bug was
found and fixed in minutes.

---

## ALREADY DONE — do not redo

- Chunked parallel extraction (`extractClaims.ts`), truncation salvage,
  table rows as verbatim claim text.
- One parallel judge wave per claim, entity fail-fast.
- Whitespace-tolerant `findExactSpan`, now used by BOTH the locator and
  `deterministicPass`.
- `evidence_field_observation` cache (migration `0018`).
- 25s claim budget with honest partial reporting.

**Committed and NOT deployed as of writing.** Check with:
```bash
aws lightsail get-container-services --region us-east-2 \
  --query 'containerServices[].{n:containerServiceName,v:currentDeployment.version,i:containers.*.image}'
git log --oneline <sha-of-live-image>..HEAD
```

---

## STEP 0 — Measure before building anything

The last two changes delete model calls. They may already be enough.

```sql
SELECT r.id, count(DISTINCT c.id) AS claims, count(u.id) AS judge_calls,
       round(count(u.id)::numeric / NULLIF(count(DISTINCT c.id),0), 1) AS per_claim
FROM review r
LEFT JOIN claim c ON c.review_id = r.id
LEFT JOIN usage_event u ON u.review_id = r.id AND u.event_type = 'judge_call'
WHERE r.created_at > now() - interval '1 day'
GROUP BY r.id ORDER BY judge_calls DESC LIMIT 10;
```

**Baseline to beat: 21 claims, 5 sources, 270 judge calls, 21s.**

If per-claim calls have dropped to ~2–3 and wall clock is acceptable, **stop.
Steps 3 and 4 are weeks of work and may be unnecessary.**

---

## STEP 1 — Correctness first (ahead of speed)

Two known-broken things. A fast wrong answer is worse than a slow one.

### 1a. `checks_did_not_complete` on 18 of 21 claims

The dominant claim state on real answers. Driven by one of four flags in
`review/reviewFlow.ts`: `quotaDeniedReason`, `hadUnparseableEvidence`,
`hadAbstainedRequiredField`, `hadUnresolvedLocator`.

**Diagnose before fixing.** Add a log line recording WHICH flag was set, deploy,
run one real answer, read the logs. Do not guess — an earlier guess in this
codebase cost a day.

### 1b. False-positive self-contradiction on table rows

Live example: `| **GCP** (Premium Tier) | $0.12 | …` flagged as contradicting
`| **GCP** (Standard Tier) | $0.085 | …`. Those are two tiers, not a conflict.
Claude acted on it and ran an unnecessary search.

Cause: claim `text` is now the table row (correct — it is the verbatim span),
but the tier qualifier does not reach `claim_fields.scope`, so
`selfContradiction.ts`'s `couldCompare` sees two comparable claims.

**Fix:** extraction prompt in `extractClaims.ts` — when a row or sentence
carries a variant, tier, plan or segment qualifier, it must go in `scope`.
`scope` already exists for exactly this ("excluding one-time items").

**Verify:** a local harness with a two-tier pricing table must produce zero
findings.

---

## STEP 2 — Async verification (the big latency win)

**Goal:** return in under a second with what is free; finish verification behind
the card.

Work splits cleanly by cost:

| Stage | Cost | Return |
|---|---|---|
| Detector bank (`detect/`) | pure code, no model calls | immediately |
| Act / Move | one call | immediately |
| Claim extraction | ~8–15s | background |
| Evidence verification | many calls | background |

**Why this is the real fix:** it makes latency independent of input size. Every
other item makes an expensive path cheaper; this one stops waiting on it.

### The missing piece

Notary cannot push to Claude — MCP is request/response. **But the card is a live
iframe and can poll.** This is filed as `E7` in `whats-left.md` as an
architecture cleanup; it is actually the latency answer.

### Build order

1. **Engine: `GET /v1/reviews/:id/card`** returning current state — the same
   shape `engineClient.ts` builds today, plus a `complete: boolean`.
2. **Engine: make review runs resumable.** Reviews, claims, findings and gaps
   are already persisted, so most of this exists. The claim loop must be
   startable without a caller waiting on it.
3. **Server: return early.** `reviewAnswer()` returns detector-bank findings and
   moves as soon as they exist, with `review_id` in the payload.
4. **UI: poll.** `App.tsx` polls that endpoint until `complete`, re-rendering as
   results land. Use the existing `record_move_event` app-tool pattern for the
   call — the card already talks to its own server that way.

### Constraints

- A poll must be cheap: read persisted rows, never recompute.
- The card must be correct at every intermediate state, never claiming more than
  it knows. "Checking…" is honest; an empty findings list rendered as "nothing
  flagged" is not.
- A finding landing after Claude finished cannot change that answer. It still
  reaches the user, and Claude re-invokes next turn. That is the loop as
  designed, not a compromise.

---

## STEP 3 — Retrieval (only if Step 0 says it is needed)

**Goal:** stop comparing every claim against every source.

Today: `claims × sources` pairs. With retrieval: `claims × ~3`.

1. Chunk each resolved source into passages (~500–1000 chars, on sentence
   boundaries).
2. Embed passages once per evidence row, store them, key on the evidence id.
   Immutable text means they never need invalidating.
3. Embed claims (one batched call).
4. Retrieve top-k (k≈3) passages per claim by cosine similarity.
5. Run the existing blind field-extraction judge on those pairs only.

**This does not violate the authority rule.** Retrieval is *selection, not
decision* — the same line `rankActionCandidates` already draws. Similarity picks
what is worth reading; `assignState()` still decides.

**Needs a decision on infrastructure:** embedding model (API vs local), vector
storage (pgvector is the obvious fit — Postgres is already there), chunking
strategy. Weeks, not days.

---

## STEP 4 — Small entailment model

**Goal:** "does this passage support this claim?" in ~20ms instead of ~2s.

Candidates: MiniCheck, AlignScore, Vectara HHEM. **Re-check current benchmarks
rather than trusting this paragraph.**

Use as a cascade: cheap model filters, blind judge adjudicates only what it
cannot settle. Per non-negotiable #4, the cheap stage may narrow but never
reject outright.

Needs model hosting — the largest infrastructure commitment here.

---

## STEP 5 — Streaming progress (deliberately last)

**Goal:** show the work instead of a frozen card.

```
Notary · reading 5 sources
Notary · found 21 claims
Notary · checking claim 8 of 21
Notary · done — 1 thing to check
```

**Why last:** it makes nothing faster. It makes waiting tolerable, and it is the
only moment a user learns what Notary does. Doing it first would disguise the
latency problem instead of fixing it.

Cheap once Step 2 exists — the poll endpoint returns progress alongside results.
The card's `notary-working` state (already built, in `App.tsx`) becomes the
place it renders.

---

## Definition of done

- A real multi-source answer returns a visible card in **under 2 seconds**.
- Full verification completes and the card updates without a reload.
- Judge calls per claim are in **single digits**.
- No claim is dropped without being reported.
- 449+ tests pass, boundaries check clean, and the numbers above are read from
  `usage_event` rather than asserted.
