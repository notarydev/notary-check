# Making Notary fast — the options, plainly

Written 2026-09-05, ~04:45, after a night where every optimisation helped and
none of them solved it. **Nothing here is decided.** It is the option set, with
what each one actually buys.

## The problem in one line

We use a large language model for every step, and large language models are
slow.

Two LLM stages, both currently unavoidable:

- **Finding claims** — ~15s. A model reads the answer and writes out every claim.
- **Checking claims** — 270 model calls on a real answer. Every claim against
  every source, several fields each.

Neither is hard computation. It is text matching. We are using the most
expensive tool available for a job that mostly does not need it.

Everything below is a way of not doing that.

---

## 1. Show the work while it happens

**The idea.** Models make waiting bearable by narrating: "Searching the
web…", "Analysing results…". Notary makes people stare at nothing for
twenty seconds and then shows a card.

Stream what it is doing instead:

```
Notary · reading 5 sources
Notary · found 21 claims
Notary · checking claim 8 of 21
Notary · asking Claude for a source
Notary · done — 1 thing to check
```

**Why it works.** Perceived wait is not actual wait. A visible, moving process
reads as thorough; a frozen one reads as broken. It also teaches people what
Notary *is* — most users have no idea it reads sources and compares them, and
this is the only moment they would find out.

**What it does not do.** Nothing gets faster. If the honest answer is "this
takes 25 seconds", this makes 25 seconds tolerable rather than shorter. Do not
let it substitute for the items below.

**Needs:** a channel from engine to card after first render. Same missing piece
as **E7** in `whats-left.md`, which is currently filed as an architecture
cleanup and is actually the latency answer.

---

## 2. Return what is free immediately, verify in the background

**The idea.** Split the work by cost and stop blocking on the expensive half.

| Stage | Cost |
|---|---|
| Detector bank — self-contradiction, source gaps, self-report | **pure code, no model calls** |
| Act — the next move | one call |
| Claim extraction | ~15s |
| Evidence verification | hundreds of calls |

Return the first two straight away. Do the rest behind the card and fill it in.

**Why it works.** It is what every observability and guardrail company does:
they do not sit in the critical path. It also makes latency independent of
input size — a 70-source answer feels the same as a 2-source one.

**Honest limit.** A finding that lands after Claude has finished writing cannot
change *that* answer. It still reaches the user, and Claude re-invokes next
turn — which is the loop as designed. Async does not break the product.

**Needs:** the same card channel as #1. Build them together.

---

## 3. Match numbers before calling any model

**The idea, and the one most likely to be underrated.** A large share of real
claims are a number and a unit: "$0.09/GB", "17% in FY25", "100 GB free". Is
that string in this document, near this entity? That is **string matching —
microseconds**.

Today every such claim costs ~6 model calls to decompose into fields.

**Why it works.** It removes calls entirely rather than making them faster or
more parallel. On the egress answer this plausibly deletes most of the 270.

**Careful.** It must only ever CONFIRM cheaply, never reject cheaply. A miss
falls through to the existing judge path. Otherwise it becomes a fast way to be
wrong, and the authority rule stops meaning anything.

---

## 4. Index once, look up many

**The idea.** Stop comparing every claim against every source. Embed the sources
once, then retrieve the ~3 relevant passages per claim by similarity —
milliseconds, no model calls.

Right now this is reading every book in the library to answer one question.
Search solved it decades ago.

**Why it works.** Turns `claims × sources` into `claims × 3`. It is the only
item here that survives 70 sources, and the reason it scales is that indexing
happens once per source rather than once per claim.

**Fits the authority rule.** Retrieval is *selection, not decision* — the same
line this codebase already draws with "selection is code; wording is judgment".
Similarity picks what is worth reading; the blind judge still decides.

**Cost.** Real infrastructure — an embedding model, a vector store, a chunking
strategy. Weeks, not days.

---

## 5. A small model for the yes/no question

**The idea.** "Does this passage support this claim?" does not need a frontier
model. Purpose-built entailment models exist for exactly this — MiniCheck,
AlignScore, Vectara HHEM — at roughly **20ms instead of 2s**.

Use the expensive judge only on what the cheap one cannot settle.

**Why it works.** Two orders of magnitude on the per-check cost, and it composes
with #4: retrieve cheaply, check cheaply, escalate rarely.

**Verify before committing.** Benchmarks move; check current numbers rather than
trusting this paragraph.

---

## 6. Batch, and cache across turns

Two smaller wins worth taking whenever the code is open anyway:

- **Batch.** We make one call per field per pair. Many items per call is
  strictly fewer round trips.
- **Cache.** The judge's answer about a source does not depend on the claim —
  `extractField` never receives one. So the same (source, field) question is
  identical for every claim and every turn. 19 of 102 distinct claims in
  production already appear in more than one review.

---

## What I would do, in order

1. **#1 and #2 together** — streaming progress plus async verification. Biggest
   perceived win, and it works whatever the input size.
2. **#3** — number matching. Deletes calls rather than accelerating them.
3. **Measure.** If that lands near target, stop.
4. **#4 and #5** only if it does not — and with a real number in hand.

## What not to do

- **Do not cap claims.** Silently skipping is not checking.
- **Do not tune constants on single runs.** Identical input measured 14.6s and
  17.3s in one sitting. Anything finer is fitting noise.
- **Do not start #4 before the engine has been seen working end to end.** It is
  the right architecture and the wrong first move.
