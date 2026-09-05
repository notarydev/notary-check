> Historical handoff snapshot. For current work start at [ROADMAP](ROADMAP.md);
> for verification see [DEV-001](docs/build/work/DEV-001-baseline/verification.md).

# Where things stand — 2026-09-05, ~04:15

Read this first. Everything below was measured, not assumed.

## The bug that made every test look identical

Both of your real-world tests failed the same way, and it was never the thing
we were fixing. Claim extraction ran to the `max_tokens` ceiling, got cut off
mid-object, and **one clipped claim discarded every claim that had arrived
whole**. No claims submitted → no evidence checked → "could not verify."

So the parallel judge wave, E-LOC, the moves fix — none of them ever ran. They
sat behind a gate that never opened. That is why the second test looked exactly
like the first.

Reproduced locally to within 600ms of production (17.0s vs 17.7s), which is how
it was found.

## What changed, with numbers

**Extraction is chunked and parallel.** Measured against the real model on a
claim-dense 2.6KB answer:

| | time | claims |
|---|---|---|
| before | 17.0s | 21 (truncated) |
| after | **8.3s** | **40 (all of them)** |

Half the time and twice the claims. 350-char chunks were faster still (6.3s)
and **not** chosen — at that size a claim loses the heading it depends on, and
decontextualization is what Act reasons from. Tuning to the fastest number on
one synthetic answer is optimising to a fixture.

**Truncation salvage** — a clipped response now yields every complete claim.
Partial objects are dropped, never guessed at. This is the backstop now that
chunking makes truncation rare.

**A work deadline (25s, `NOTARY_CLAIM_BUDGET_MS`).** Notary's work is
claims × sources and both are chosen by the caller, so latency was a property of
whatever Claude sent. Now it checks what fits and says so: *"12 of 40 material
claims checked — 28 not reached in time."* Not claim-capping — nothing is
silently skipped, and Claude re-invokes next turn so the rest is picked up.

**Earlier in the night, also live:** one parallel judge wave instead of eight
sequential waits; whitespace-tolerant locators (E-LOC — the reason every claim
came back INDETERMINATE against real web pages); moves no longer discarded when
Verify cannot complete; findings and gaps persisted; move telemetry;
`check_answer` instead of the raw tool name.

## Then you ran it again, and the engine was fine

That run is the most useful data of the night:

| | first run | after the fixes |
|---|---|---|
| judge calls | 358 over **129s** | 185 over **9s** |
| claim states | all INDETERMINATE | **mix of INDETERMINATE and UNSUPPORTED** |
| evidence fetch | suspected slow | 10–250ms each — never the problem |

Verification stopped being the bottleneck. The remaining cost was **tables**, and
a comparison answer is mostly table.

**The table landed whole in one chunk.** Splitting happened at blank lines and a
markdown table has none inside it, so a twelve-row table was one "paragraph".
Chunk latencies: 708ms, 9982ms, 12308ms, **13204ms**. Parallelism worked
perfectly and bought nothing, because one chunk held all the work. Oversized
blocks now split at single newlines too.

**Forty percent of your claims were silently discarded.** The model turned table
rows into prose sentences, which appear nowhere in the answer, so the verbatim
check dropped them — six of fifteen, invisible on the card. You would never have
known those claims existed.

The verbatim rule is not relaxed; it is what stops invented claims entering the
pipeline. What was missing is that a table ROW is the verbatim span for a
tabular fact, with the readable sentence in `decontextualized_form`. Local
result on the same shape: **0 dropped**, where every claim had been lost.

Live as `engine.48` / `server.49`.

## And then the two biggest changes finally shipped

Both had been committed and NOT deployed, so neither had ever run in
production. Measured locally before shipping:

| | before | after |
|---|---|---|
| chunked extraction | 17.0s, 21 claims (truncated) | **8.3s, 40 claims** |
| deterministic matching + observation cache | ~12.9 judge calls/claim | **2.5** |

They attack the two phases that dominated your last run — extraction at 13.2s
and verification at 9–21s. Also shipped: a tier or variant now extracts into
`scope`, so two pricing tiers stop being reported as a self-contradiction.

**None of this is measured in production yet.** That is the one thing the next
run settles.

## The plan is written down

`docs/build/speed-implementation-plan.md` — executable by anyone, including
DeepSeek, with no memory of last night. Read `ROADMAP.md` § Speed for the
pointer.

Two known-broken things are ahead of speed in it: 18 of 21 claims return
`checks_did_not_complete`, and the one finding Claude acted on last night was a
false positive — two GCP pricing tiers read as a contradiction because the tier
never reached the `scope` field.

## What to do first

1. **Run the egress prompt again.** The table path has never actually worked before — the last run was the first time extraction survived, and it still lost 40% of the claims to the verbatim check. This will be the first run where a table-heavy answer is fully extracted.
2. Tell me and I will pull the rows — wall clock, judge calls, claim states,
   whether moves showed, whether `act_move_event` filled on a click.

**This will be the first time the engine has ever run end to end on a real
multi-source answer.** Every previous attempt died in extraction. Treat the
result as new information, not confirmation.

## What I did NOT do, and why

**No retrieval rebuild.** The industry answer to "70 sources in 10 seconds" is
retrieve-then-verify — embed the sources once, pull the top-3 passages per
claim, cheap entailment first, expensive judge only on the residue. It is the
right long-term architecture and it is in `ROADMAP.md`.

It is also weeks of work needing a vector store and an embedding model, and it
would be built on **zero evidence about what real answers actually look like**,
before the thing has been seen working once. Decide it with a real number in
hand, not a hypothetical one.

## Still open

`ROADMAP.md` Priority 1. The honest headline: the engine is fast and mostly
correct now, and **it has still never been shown to be useful to anyone.**
That is the next question, and it is a product question rather than an
engineering one.

One security item, unrelated and unglamorous: `.claude/settings.local.json`
holds a live production database password and an `sk_live_` Clerk key. Rotate
the Clerk key.
