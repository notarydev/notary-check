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

## What to do first

1. **Run the egress prompt again.** It is the case that exposed everything.
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
