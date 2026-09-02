> Status: proposal
> Owner: Hardyk
> Last verified: 2026-09-01
> Supersedes: —

# Notary positioning — "Let AI reason. Let evidence decide."

## The pitch

Most AI checkers sell you another AI's opinion. Notary doesn't.

**Mix as much AI intelligence as you want. Only evidence gets a vote on the verdict.**

Claude writes the answer. Underneath, Notary can put another model — or several — on the case: challenging the claim, asking what would prove it wrong, spotting the weak link, proposing what to check. That reasoning can be as rich, as multi-round, as AI-native as it needs to be.

None of it decides anything.

Every path — no matter how it got generated — has to cross the same hard line: **what does the actual, inspectable evidence say?** If nothing crosses that line, nothing gets reported as fact. No amount of model agreement, confidence, or clever reasoning substitutes for a resolved source.

## The line that sells it

> Let AI explore. Let evidence decide.

Or, sharper:

> Other tools sell you a second AI's opinion. Notary gives you a verdict no AI can talk its way into.

## Why this framing, not "another AI checks Claude"

"AI fact-checks AI" is table stakes now — a handful of products already do a version of it (chained models, peer-review modes, multi-model panels). It's not defensible on its own, and it invites the wrong comparison: whose model is smarter.

"Let AI reason freely, but evidence is the only thing that can move the needle" is a different claim entirely — it's not about which model, it's about a **guarantee**: the more AI you throw at a question, the more it needs a boundary that doesn't bend to match. That's the part competitors selling consensus/confidence/multi-model-agreement don't have, because their whole pitch depends on the models' agreement *being* the answer. Notary's pitch is the opposite: agreement between models proves nothing; only the evidence does.

## What this does NOT mean, and why that restraint is the actual moat

- It does not mean a visible trust score, confidence percentage, or "✅ verified" badge — that's exactly the "AI consensus theater" this framing is built to avoid, and it's a locked rule in the product spec, not a stylistic choice.
- It does not mean the reasoning-heavy version ships today. The evidence-bound interpreter (one model, one field, blind to the claim, strictly filtered) is live now and already embodies the "evidence decides" half of this line. The open-ended "AI investigates, challenges, generates hypotheses" half is real, valuable, future work — scoped, not shipped, deliberately, so the marketing promise never runs ahead of what the product actually guarantees.
- It does not mean unconstrained multi-agent cost. Every reasoning path, however elaborate, still has to terminate at the same cheap, bounded evidence check — that's what keeps "let AI reason freely" from becoming an open-ended, expensive research loop.

## One-line versions, pick by context

- **Investor/press**: "Other AI checkers sell you a second opinion. Notary gives you a verdict no opinion can override."
- **Product page hero**: "Let AI reason. Let evidence decide."
- **In-product, quiet**: "Independent evidence, not another opinion."
