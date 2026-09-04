> Status: proposal
> Owner: Hardyk
> Last verified: 2026-09-03
> Supersedes: —

# The invocation pivot

**This is a proposal. Do not build against it as final.** Per
[`../../README.md`](../../README.md), it becomes canonical only when the
owner explicitly says to merge it — not by being agreed with in
discussion. Parts of it are actively undecided and marked as such.

## The change

Today Verify is the gate. Claude is instructed to call Notary only when
its answer makes a checkable claim **and** it has an identifiable source.
Act rides along behind an already-resolved claim.

Proposed: call Notary broadly, request evidence every time, let Verify
speak only when there are real claims, and run Act unconditionally.

| | Today | Proposed |
|---|---|---|
| Trigger | claim **and** source | broad; evidence requested every time |
| Verify | gates everything | speaks only when claims exist |
| Act | fires per resolved claim | runs unconditionally |
| No source | card reports a failure | Verify silent, Act still delivers |
| Presence | silent on most turns | present on most turns, loud on few |

The governing idea: **the scarce resource is the invocation, not the
compute.** Claude decides whether to call, and we do not control that.
Once called, the round trip, the latency budget, and the user's attention
are already spent. Doing one detector's work in a moment that could carry
several wastes a fixed cost already paid.

## What this does not change

Stated explicitly, because a pivot is exactly where authority rules get
eroded by accident:

- **The authority boundary is untouched.** A model may propose; a record
  earns a state only through an evidence-bound procedure. Nothing here
  lets a detector write `Claim.state`.
- **`SUPPORTED`/`CONTRADICTED` still require a resolved locator plus
  satisfied applicability.** Broadening *when* Notary is called does not
  broaden *what* can establish a state.
- **Coverage is still not invocation.** Calling on more turns is not a
  coverage claim and must never be described as one — that remains a
  WATCH-tier property, per the canonical definition § 9.
- **The promise is unchanged.** Notary still does not promise that every
  answer was reviewed.

## The positioning hazard, named

§ Do not build yet forbids "claims of checking every answer," and
§ Promise and non-promise explicitly disclaims it. Calling Notary on most
turns does not violate that literally — Verify stays silent when there is
nothing to check. But a marker present on every turn invites users to
**infer** exhaustive checking even when nothing says it. Any ambient
marker built on this needs copy that states its own scope, not just a
count.

## Three ideas the pivot rests on

### 1. Silence must be typed, not blank

Three card states could not express "we didn't check this, and that is
neither a pass nor a failure." That gap is what made an unsourced answer
report as a Notary malfunction. Resolved by the fourth card state
(`not_checked`) now specified in the build plan — that part is **decided
and being built**, independently of the rest of this proposal.

### 2. Run every *eligible* detector, within a budget

Not "run everything." Extra detectors are not free once the invocation
occurred: they cost latency, false positives, retention, and spend.
Attention is the exception — a detector that runs and never surfaces
costs zero attention, which is the whole point of separating what is
*available* from what is *shown*.

Each detector in a registry must declare:

```text
required inputs
deterministic eligibility predicate
authority boundary   (produces / decides / may never write)
latency budget
cost per invocation
result state
surface policy
```

**"Deterministic eligibility predicate" is the load-bearing phrase.** It
puts the gate in code even when the detector's content is model-produced
— the authority split applied one level up. It does not fully solve the
problem on its own: a predicate reading `materialClaims.length > 0` is
deterministic code over a model-produced input. It becomes genuinely
deterministic only when combined with a code-side precondition over the
text itself (a claim must contain a numeral, date, proper noun, or quoted
string to count).

### 3. Layered attention

Availability and attention are different budgets:

```text
Layer 0   silence — nothing found. Common and correct.
Layer 1   ambient marker — small, near-zero attention.
Layer 2   expand on demand — showing everything is correct here,
          because the user volunteered the attention.
Layer 3   unprompted surface — the 0–2 cap belongs ONLY here.
          It is an interrupt budget, not an information budget.
```

The restraint evidence behind the current design — on-request beating
unsolicited assistance, and post-hoc beating mid-task timing — is about
*interruption*, not availability. It constrains layer 3 and says nothing
about layers 1 and 2.

## The structural blocker

`runMovesForClaim` fires per claim submission, and `reviewAnswer`
returns early when `materialClaims.length === 0` — before any submission,
therefore before any Move call. **"No claims → Verify silent, Act
still runs" is structurally impossible today.**

This is not a description change. Move must be decoupled from the claim
loop and given its own invocation path. That is also exactly what any
claim-independent detector needs, so the two collapse into one job.

## The reorganisation this forces

Stated plainly: **this is a re-architecture of the review flow, not an
addition to it.** Three places put pressure on the AI-parses/code-decides
split.

**a. Extraction gets promoted into product logic.** `materiality` is a
model-produced boolean today, filtering what is worth reporting. Under the
pivot, "are there claims?" decides whether Verify speaks *at all* — so a
model judgment becomes the product's visibility switch. This is the
biggest authority shift the pivot causes, and it happens with **no code
change**, which is why it is easy to miss. Extraction agreement has never
been measured against human judgment.

**b. Every detector needs its own drawn line.** Move models the
discipline correctly and is the template: code supplies a closed
four-move vocabulary, the model only chooses and phrases within it, a
`CHECK` constraint enforces it independently of the validator, and there
is deliberately no verdict/confidence/score column for a smuggled field to
land in. Generalised: *every detector must declare what the model
produces, what code decides from it, and what it may never write —
enforced in schema, not convention.*

**c. The real risk is erosion by accretion.** No single detector breaks
the authority boundary. Several, each drawing the line slightly softer,
collectively turn Notary into a model that opines with extra steps —
while every individual review passes. Migrations `0012` and `0013` already
defend against this deliberately, with headers explaining which mistakes
their table separation makes structurally impossible. That practice has to
survive contact with a detector pool.

**Concretely reorganised:** extraction gains gating responsibility and
needs a calibration set it does not have; `reviewFlow` restructures from a
serial per-claim pipeline into a bounded fan-out with a claim-independent
Move path; a detector registry replaces the hardcoded two-track flow;
`policy.ts` extends from move-selection to detector-selection (and needs
`task_mode` to actually arrive first); persistence generalises to one
invocation row plus N detector results.

## Evidence requests — the hazard and the actual fix

Broadening the ask amplifies the model's failure mode under evidence
pressure: inventing a plausible URL. A fabricated source that then
resolves to a supporting state is strictly worse than no source, because
it manufactures the false confidence the product exists to prevent.

The fix is **not** asking more narrowly. Eligibility and the ask are
orthogonal — strict eligibility is what makes a broad ask safe, because a
fabricated source no longer auto-triggers a check. The real rule is that
**a supplied source must prove it was retrieved before it can support
anything**, which `evidence.retrieval_status` and `text_provenance`
(`fetched` vs `caller_supplied`) largely already do: a fabricated URL
fails retrieval and lands `unavailable`, never a match.

The one genuine hole: **`quoted_excerpt` with no URL.** Nothing fetches
it and nothing can, so it is the single path a fabrication can enter as
evidence. Narrow fix — an excerpt with no retrievable source can never
reach a supporting state.

## What counts as a claim

Currently one sentence in § Verification pipeline step 2. Under the pivot
it becomes the switch deciding whether the product speaks, so it needs a
real definition.

**Proposed test: a claim is a statement about the world that a document
could show to be false.**

In: numbers, quantities, dates, quoted text, attributions, historical and
causal assertions, factual statements about named entities.

Out: recommendations, opinions, instructions, hypotheticals, the model's
own reasoning steps, anything hedged into non-falsifiability.

Four cases the test does not settle:

| Case | Example | Proposed | Why |
|---|---|---|---|
| Attributed opinion | "Gartner rates X highest." | **Include** | Content is opinion; the attribution is fully checkable, and misattribution is a common high-value failure. |
| Predictions | "Revenue will grow 12%." | **Exclude** | Not falsifiable against a present document. Note the real hazard separately: models state forecasts in the grammar of facts. |
| Claims about code | "This returns null on empty input." | **Exclude for now** | Checkable against a repo or test run, not a document. Needs an adapter that does not exist. This exclusion decides whether Notary is useful to coding users at all. |
| Definitional | "ARR means annualised recurring revenue." | **Exclude via materiality** | Checkable in principle, near-zero value. Filter with materiality, not by narrowing the claim definition. |

## Where this is most likely wrong

1. **Research or coding has not been chosen.** The pivot's whole character
   depends on it, and by case 3 above, coding claims are excluded — so
   Verify would be near-permanently silent for coding users.
2. **It exposes the commoditizable half.** If Verify speaks rarely and
   Act speaks always, most of what users see is suggested next moves —
   which a host platform could ship natively. Verify is the part a better
   prompt cannot replicate. The pivot makes the product more present and
   less differentiated at once.
3. **Cost is plausibly 5–10× per user**, and the source gate is currently
   doing real volume limiting. Compounded by O3 in
   [`../../build/whats-left.md`](../../build/whats-left.md): the cost
   meter rounds to whole cents, so most calls meter as zero and the caps
   barely bite. "Budget per invocation" has no working meter to enforce
   against until that is fixed.
4. **Materiality as a visibility switch is unmeasured** — the gamble that
   is easiest to overlook, because it requires no code change to happen.
5. **Retention is unresolved, not settled.** It was proposed as zero and
   then reversed within one discussion, so it is currently on by default
   rather than by decision — while already violating a canonical rule
   (B4).

## Open, needs a decision before merge

- Research or coding as the target user.
- Whether to build an ambient marker, and what its copy claims.
- Whether `user_request` becomes required or stays optional with a fixed
  description — **measure the production skipped-vs-ok ratio first**;
  `act_invocation` already records it.
- The retention policy, which B4 requires regardless of this proposal.
- Whether the async-fetch path for slow detectors is even possible. The
  card iframe is cross-origin and cannot reach the host document; its
  outbound network permissions have **not** been verified.
