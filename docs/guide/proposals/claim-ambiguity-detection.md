> Status: proposal
> Owner: Hardyk
> Last verified: 2026-09-01
> Supersedes: —

# Concept: claim-side ambiguity detection

## The gap

The pipeline already has a rule for *evidence*: when a passage genuinely doesn't clearly state something, the reader is allowed to say `ambiguous` instead of guessing. That outcome exists specifically so a coin-flip reading of a source never silently becomes a fact.

**No equivalent exists for the claim itself.** Claim extraction (the AI step that turns a raw sentence like "New York weather is 100 degrees today" into structured pieces — entity, period, metric, value) always produces exactly one interpretation. If the sentence genuinely supports more than one reading — is "the weather" the current temperature, the day's high, the low, a "feels like" figure? — the extractor doesn't flag that. It just picks one and moves on. Nothing downstream ever learns a judgment call was made at the very first step.

## Why this is upstream of everything else already discussed

Every fix considered so far (context-aware evidence reading, the metric/operator split, normalization) improves how well the evidence side is read *against whatever the claim was extracted as*. None of them touch whether that extracted claim was actually the right reading of what was said in the first place. If the claim itself was ambiguous and got silently resolved to the wrong interpretation, a perfectly accurate evidence-reading step still checks the wrong thing — the error happened before any evidence was even looked at.

## The concept

Give claim extraction the same four-outcome discipline evidence extraction already has, instead of it always returning a single confident structure:

- **Clear**: the sentence supports one reasonable reading — extract it as today.
- **Ambiguous**: the sentence genuinely supports more than one reasonable reading for a given field (e.g., "the weather" with no marker of current/high/low) — flag it, rather than silently picking one.
- When a claim (or a specific field of it) comes back ambiguous, that has to actually change what happens downstream — not get silently absorbed. Candidate directions, not decided:
  - Surface it as its own card state or finding ("this claim could be read more than one way — here's what we checked, here's the reading we used").
  - Compare *both* plausible readings against the evidence and only report a result where they agree.
  - Ask the host (Claude) to disambiguate before checking, the same way the evidence-binding round-trip already asks Claude for a missing source.

## Open questions worth digging into

1. **How would an extractor actually detect its own ambiguity?** A single extraction pass has no natural signal for "I could have read this differently." Options worth researching: asking the model to explicitly consider alternate readings before committing (closer to how the reasoning-before-answer structure already works elsewhere in this pipeline); running extraction twice with different framing and checking whether the results diverge; or a dedicated second pass whose only job is "what are the plausible readings of this sentence, if more than one."
2. **What's the right user-facing behavior when a claim is flagged ambiguous?** Silently picking a reading (today's behavior) is wrong, but so is bothering the user on every mildly-imprecise sentence — most claims aren't actually ambiguous in a way that matters.
3. **Does "ambiguous claim" ever get to look like a finding**, the same way "unsupported" or "contradicted" do — or does it live entirely at the extraction layer, invisible unless it changes the outcome?
4. **Interaction with materiality**: is an ambiguous-but-immaterial field (e.g., unclear tone/framing, not a checkable fact) worth flagging at all, or does this only matter for fields that actually feed the comparison?

## What stays true either way

Whatever the mechanism, the same invariant that governs everything else in this pipeline still applies here: the AI can flag *that* something is ambiguous and describe the candidate readings — it does not get to decide which reading is correct, or resolve the ambiguity itself and quietly move on. That decision — if one gets made at all — has to be visible, not buried inside a single extraction call.
