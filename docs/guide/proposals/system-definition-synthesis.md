> Status: proposal
> Owner: Hardyk
> Last verified: 2026-09-02
> Supersedes: —

# Notary — Complete System Definition (with Track 1 / Track 2), corrected

*Synthesizes: Canonical Product Definition (Final 8-31), the GDR academic paper, the Tier 1 Build and Operating Plan (Final 8-31), the claim-ambiguity and positioning docs, and the 2026-09-01/02 engineering session — then corrected against a review that rejected the first draft's authority/ordering errors. Written so someone with zero prior context can read this alone and understand the whole system, and so it is safe to eventually fold into the canonical docs.*

**Status of this document**: internal synthesis, useful for separating built-from-designed. **Not yet suitable to merge wholesale into the Canonical Product Definition or Tier 1 plan** — see Part 9 for exactly what is accepted, what needs correction, and what stays out of canonical scope entirely.

---

## PART 0 — What Notary is, in one sentence

> **Notary produces the durable evidence record behind one consequential AI-assisted decision: the decision, its stated reasons, the material available at the time, what each reason actually resolves to, what was missing, and what changed later.**

The live product today (**CHECK**) is the narrowest slice of this: a Claude connector that checks the material factual claims in an AI answer against evidence you can actually point to, and shows only what breaks.

**What it is not**: a generic fact checker, a second chatbot, a governance dashboard, a trust score, or a claim that every answer was reviewed. Notary records and surfaces. It never decides whether the underlying decision was fair, lawful, or correct.

---

## PART 1 — The core objects

| Object | What it is |
|---|---|
| **Decision** | One consequential determination, keyed to a reference a human would actually name (a case, a claim, an answer). |
| **Claim** | One checkable proposition asserted as part of the answer — "Acme's revenue grew 17% in FY25." Decontextualized (pronouns resolved, minimum context restored) but never invented. |
| **Source pointer** | What a model or user *submits* as a possible source — a URL, a title, a described document. **Not yet evidence.** |
| **Evidence** | A source pointer becomes an evidence artifact once Notary resolves permitted content, retains a canonical representation with an addressable **coordinate system** (page/text offsets, JSON paths, timestamps — whatever the medium supports), and records provenance. This does **not** yet require a claim-specific locator — that would require knowing the locator before anything could be retrieved against it. A link with no stable, retained content is never evidence, no matter how confidently it was cited. |
| **Locator** | An exact pointer into a specific evidence artifact's coordinate system — a character range, not "the source says X." Resolved later, per claim, not at registration time. |
| **Evidence Match** | The object that actually carries a claim-specific locator: links a claim to a resolved evidence artifact + locator, carrying the resolved passage, the applicability assessment, and the relation. Evidence and Evidence Match are kept as separate objects on purpose — Evidence is registered once; Evidence Matches are created per claim as candidates are checked. |
| **Applicability** | Per-field check (entity, time, scope, metric, value/unit, comparator/baseline, modality) — `match` / `mismatch` / `not_applicable` / `indeterminate`. **A material mismatch on any field excludes the candidate, even when the number is attractive.** |

### Verification state — one ranked field, matching GDR §4.4 / Canonical §5.7 / Part II §17.1 exactly

*Correction to this document's own history*: an earlier pass of this synthesis replaced the canonical single-`state`-field model with a split `verification_relation` + separate `attestation` object, on the theory that ranking `ATTESTED` below `UNSUPPORTED` made it look like a weaker outcome. **That replacement was itself wrong** — checked directly against the source documents, not against a critique of this document. GDR §4.4 and Canonical §5.7 both specify one ranked `state` field, GDR §4.4 explicitly pre-empts exactly this objection ("This ordering prevents a supportive passage from masking contradiction or conflict... `ATTESTED` remains a distinct provenance-bearing state and cannot silently upgrade a claim to `SUPPORTED`"), and Part II §17.1's schema confirms it: `Claim` carries one `state` field; `Attestation` is a separate, independently linked entity (`attestation_id, claim_id?, decision_id, actor_id, actor_role, authority_ref, authority_valid_at, basis_ref, created_at`), not a rival field replacing `state`. Restored to the actual spec:

```
Claim.state: SUPPORTED | CONTRADICTED | CONFLICTED | UNSUPPORTED | ATTESTED | INDETERMINATE
```

**Precedence order (GDR §4.4, normative)**, subject to the `no_source` boundary flag:
1. `CONTRADICTED` — any admissible relation establishes an incompatible proposition.
2. `CONFLICTED` — admissible evidence materially disagrees, no declared priority rule resolves it.
3. `SUPPORTED` — at least one admissible relation establishes support.
4. `UNSUPPORTED` — the procedure completed over available, applicable evidence and found no support.
5. `ATTESTED` — automated procedures didn't resolve the claim and a named human supplied a recorded basis.
6. `INDETERMINATE` — otherwise (unresolved locator, unavailable content, unresolved applicability, semantic assessment below acceptance criterion).

This is a **resolution order for which single state the record reports**, not a quality ranking of outcomes — `ATTESTED` sitting at position 5 does not mean a human basis is "worse" than automated support; it means automated evidence-derived states take precedence *when they exist*, and `ATTESTED` is the fallback used only once they don't. `no_source` remains a separate evidence-boundary flag (Part 1 below), never itself a state value and never rendered as "unsupported" or "fine." **CHECK (the live product) never reaches `ATTESTED`** — it has no human-in-the-loop path; that state only becomes reachable once a record is captured under CAPTURE (Canonical §5.7, §9).

---

## PART 2 — The one rule everything else follows

> **A model may propose. A record earns a state only through an evidence-bound procedure.**

**Notary does not decide the underlying business outcome; it records and deterministically classifies the defined claim–evidence relation.** ("Recorder, not decider" is the shorthand, but taken too literally it contradicts the fact that Notary's own procedure *does* deterministically assign the relation — the thing a model never gets to do is decide, not the system as a whole.) A model can propose claim boundaries, candidate source pointers, candidate interpretations, locators, or conduct **bounded investigation within declared source, tool, round, budget, and retention limits** — none of that is dangerous by itself, because *none of it is ever the thing that assigns a relation.* Unlimited, undeclared activity is not made harmless by this rule alone — it still carries real cost, prompt-injection, retention, and product-drift risk, which is why any investigation (including Track 2, Part 6) needs explicit operating limits even though it can never write a verification state.

**The boundary this whole system rests on is *interpretation versus authority*, not "AI versus mechanics."** Track 1 is not a mechanical track that happens to call AI when it's stuck — it is a hybrid procedure that *uses* AI throughout to decipher language, and never lets AI decide anything. Concretely, in the live engine: AI parses the claim into typed fields; when literal extraction fails, AI reads one bounded evidence field at a time into the same typed vocabulary (`present`/`absent`/`ambiguous`/`cannot_be_determined` — never a status, never applicability); code alone normalizes (allow-listed only), tests applicability, and assigns the record's relation. The `metric`/`operator` split is the clean case of this: AI is trusted to recognize "grew"/"rose"/"increased" as the same `operator`, precisely because that recognition still only produces a typed field for code to compare — it never becomes the comparison itself.

**Corrected and sharpened this round**: the rule isn't just "the model doesn't decide the final state" — it's that **the model doesn't get to silently select among multiple materially different readings of anything upstream either**, not just the final verdict. That includes claim interpretation (Part 5) and source pointers (Part 5). Ordering a step before evidence-lookup does not, by itself, grant a model authority to resolve an ambiguity — see Part 5's correction for the precise rule.

---

## PART 3 — The verification procedure (10 steps)

1. **Classify** — exit early if there's no checkable claim.
2. **Decontextualize** — recover minimum checkable context, never invent it. If a claim carries a genuine multi-reading ambiguity on a material field, this step must preserve that fact rather than silently picking one (Part 5).
3. **Bind the evidence set** — search only the addressable, resolved manifest — source pointers that haven't yet been resolved into retained content are not part of this set.
4. **Retrieve candidates** — both support and refutation. Retrieval proposes, it doesn't decide.
5. **Resolve locators** — against the actual stored artifact, per candidate.
6. **Extract / normalize observable evidence fields** — deterministic exact-match first; bounded AI field interpretation only for whatever the deterministic pass couldn't resolve (this is necessarily *before* applicability — applicability needs the evidence side's own entity/period/metric/operator/etc. to compare against the claim's, so those fields have to exist first). Then apply Tier A.5 normalization (below) — typed and allow-listed only, never fuzzy.
7. **Assess applicability** — compare claim fields against the now-extracted evidence fields; reject material mismatches, no matter how attractive the number.
8. **Assess any remaining claim–passage semantic relation** — only over candidates that survived step 7 (resolved, non-disqualified); AI may interpret source language into observations, it may never determine applicability or the final relation itself.
9. **Assign state** — the deterministic policy, never the semantic evaluator, writes the final `Claim.state` per the precedence order in Part 1; `ATTESTED` is only reachable once CAPTURE's human-attestation path applies — never by CHECK.
10. **Preserve** — seal the result, evidence boundary, provenance, versions.

**Tier A.5 — typed, allow-listed normalization**, applied as part of step 6, after field extraction and before applicability: safe-syntax and declared-equivalent forms ("FY25" ↔ "fiscal 2025," "$12m" ↔ "$12,000,000," corporate-suffix spelling) are recognized as the same value *without* becoming semantic/fuzzy matching. `metric` is exempt forever — "gross revenue" must never equal "revenue," on purpose. `operator` (direction of change) is deliberately resolved into a small closed vocabulary (`increase`/`decrease`/`no_change`) at extraction time, which is why it's the one field where "grew"/"rose"/"increased" collapsing together is intentional and safe.

---

## PART 4 — CHECK's tiered scope (what it actually promises)

**Tier A (the real MVP, live today)**: unsupported assertion; false/misleading source relationship; right fact, wrong application; deterministically-checkable bad quantitative reasoning.

**Tier B (near-term, not yet built)**: internal contradiction / claim drift within one answer.

**Tier C (do not promise publicly)**: overreach beyond the evidence boundary — most likely to produce noisy false positives.

---

## PART 5 — Claim ambiguity and the source-pointer round-trip, corrected

### Claim-side ambiguity — corrected rule

The original gap diagnosis stands: claim extraction always silently commits to one reading of a material field, with no equivalent of evidence-reading's `ambiguous` outcome. **The first draft's proposed fix was wrong**: "Claude can auto-resolve its own ambiguity as long as it happens before evidence is looked at." Ordering does not solve an authority problem — a model silently picking one of several materially different readings still changes what gets checked, regardless of when it happens relative to evidence lookup.

**Corrected rule**:

> **A model may propose candidate interpretations of an ambiguous claim. Only one of three things may select among them: explicit context already captured in the preserved answer (e.g., a pronoun with one unambiguous antecedent in the same text), a declared deterministic rule, or a user-confirmed revision.**

Concretely: if disambiguation is possible from context genuinely present in the retained answer text, it's a deterministic resolution, not a model judgment call, and can happen automatically. If it requires the model to *guess* the more likely reading, it cannot resolve automatically — it must surface the ambiguity and produce a **user-confirmed clarification**, which becomes a new, explicitly linked claim revision, then re-enters the pipeline from step 1.

**Evidence-led reinterpretation stays forbidden**, as originally specified: the disambiguator never gets to pick the reading that happens to match available evidence — that's cheating the check, not clarifying it.

### The source-pointer round-trip — corrected wording

The first draft described this as Notary asking Claude "what source did you actually use?" and treated the answer as evidence-gathering. **That overstates what a model's self-report can establish** — a model's claim about what it used is still an unverified statement about its own process, not a resolved artifact.

**Corrected sequence**:

```
Claude proposes a URL, attachment, or identifiable source
   → Notary resolves it and retains a canonical snapshot of the actual payload
   → the resolved object enters the declared evidence manifest, with its
     canonical coordinate system and provenance recorded
   → a later Evidence Match resolves the claim-specific locator
   → the claim is (re)checked against the manifest as it now stands
```

Until the payload is retained with a coordinate system and provenance, what Claude supplied is a **candidate source pointer**, never evidence, and it earns no evidentiary weight on its own. The claim-specific locator itself is never assigned at this stage — consistent with Part 1's Evidence / Evidence Match separation, not a special case for the round-trip.

---

## PART 6 — Track 1 (AI-assisted evidence interpretation) / Track 2 (AI-assisted challenge) — not peers, one trust contract

### The tracks are not peers — this is the load-bearing correction to this whole section

Two real user needs, kept structurally separate because collapsing them produces either a brittle rule engine or an untrustworthy chatbot:

1. *"Can I rely on this claim given the sources I have?"* — answered only by **Track 1: Evidence**. Authoritative *within its defined boundary*. Produces a typed relation (Part 1) between a claim and inspectable material. Bounded, reproducible, quiet.
2. *"What might I be missing before I rely on it?"* — answered only by **Track 2: Challenge** (renamed from "Perspective" — "perspective" sounds soft and opinion-led; "Challenge" states exactly why it exists and keeps Notary's skeptical role legible). Explicitly non-authoritative. Helps a person notice assumptions, alternate readings, missing context, useful next checks. Its output is an invitation to investigate, never a competing factual answer.

**Track 1 alone creates automated evidence states; Track 2 creates none.** (CAPTURE's later `ATTESTED` path is the one other way a conclusion can be created, and it's explicitly not part of CHECK or Track 2 — see Part 1's precedence order.) That line, held without exception, is what makes the two-track idea good instead of dangerous. Restated with the interpretation/authority distinction above: **Track 1 — AI-assisted interpretation inside a closed verification procedure** ("what does this bounded evidence record establish about this claim?"); **Track 2 — AI-assisted questioning outside the verification procedure** ("what should we clarify, test, or add before relying on this?"). Neither track is "the AI one" — both use AI. Only Track 1 lets that AI's output become part of a resolved record.

### Track 1 — Hard facts

Unchanged: Parts 1–5 above. Deterministic-first, judge only for the residue, code alone assigns relation and basis. Background model collaboration is allowed here, but only in a narrow role:

```
Claude / another model proposes candidate claims, source pointers,
field interpretations, or candidate passages
  → Notary resolves the actual material
  → deterministic applicability + relation procedure decides
```

Models help the system *find the question*. They cannot convert their shared conclusion into evidence.

### Track 2 — naming: internal "Challenge," user-facing "Pressure-test this"

Two names, deliberately: **`Challenge` is the internal/architectural name** — it states the role accurately in the system (non-authoritative questioning, Part 2's interpretation-vs-authority distinction). **The user-facing button reads "Pressure-test this"** (or "Get a fresh take") — it tells the user why to click without implying the model found an error, and borrows a familiar coding/review instinct: *a good teammate found the one assumption most likely to bite you, and gives you the next test to run* — not "another model gives a verdict."

### Information flow between the tracks — one direction only

The separation is an **authority boundary, not an information firewall**. Hiding Track 1's actual finding from Track 2 would make it generic and useless — the whole point is helping the user respond intelligently to the real evidence state.

```
Track 1 → Track 2:  permitted, read-only context
Track 2 → Track 1:  prohibited, except through an explicit user action
```

```
Track 1 produces a sealed, read-only finding
        ↓
Track 2 reads that finding and proposes next questions/actions
        ↓
User chooses an action
        ↓
A new Track 1 check evaluates the changed claim or expanded manifest
```

What Track 2 receives is a renamed, **immutable `FindingContext`** (not a mutable "ChallengeContext"): the claim, Track 1's relation/basis/reason codes, the per-field applicability comparison, the evidence manifest's boundary, and already-renderable evidence excerpts. Track 2 gets **no source-discovery tools, no authority to alter the manifest, and no ability to persist a new evidence relationship** — read access to what already exists, nothing more.

**The rule that keeps this safe**: Track 2 may challenge the *adequacy* of the record, claim, or evidence boundary; it may never relitigate the relation by assertion. *"Maybe 17% is right after all"* is a competing opinion and is forbidden. *"Is 17% a forecast rather than a reported FY25 result? Add the forecast document if so"* is exactly the useful shape — it names a gap and routes to an action, never asserts a fact.

Applied per Track 1 outcome:
- **Contradicted** — help distinguish a genuinely wrong claim from a wrong scope, wrong time, or incomplete manifest.
- **Unsupported** — help identify the missing evidence or qualify/remove the claim; never invent a replacement fact.
- **Indeterminate / no_source** — help obtain the missing context or source pointer.
- **No issue found within scope** — pressure-test the boundary: what qualifier, alternative interpretation, or absent source could still matter — stated *within scope*, never manufacturing doubt just to seem thorough.

### Output contract — typed, bounded, no verdict field

```
challenge_type: ambiguity | missing_assumption | alternative_interpretation |
                evidence_request | adversarial_test
prompt:         a neutral, bounded question
why_it_matters: a conditional explanation tied to the existing claim/finding
action:         clarify_claim | add_source | open_evidence |
                ask_host | draft_test | leave_unchanged
```

No `answer`, `confidence`, `verdict`, or free-form transcript field, ever. The model may explain a dependency, gap, or hypothesis ("this conclusion depends on whether 'revenue' is gross or net"); it may never assert a replacement fact, a code defect, or that a claim "is wrong" outright — an apparent fact must be expressed as an action ("check whether X"), routed through the normal evidence or test path, never stated directly.

At most two or three cards per invocation, each ending in a concrete, user-controlled next move — never a vague debate. Example, after a contradiction:

```
Before replacing the number

Is the original claim intended to describe Acme's reported result,
a forecast, or the wider market?

[Qualify the claim]  [Compare the two sources]  [Leave it]
```

**Coding-context analogue** (same discipline, different domain — illustrates the pattern generalizes, not a build commitment): the second model's job is never "give your own answer," it's "make the best attempt to falsify mine" — e.g. for a refactor: *"which observable behavior could have changed despite passing unit tests?"* → generate a regression test plan; for security-sensitive code: *"where does untrusted input cross a trust boundary?"* → inspect the boundary.

**Every write Track 2 triggers is auditable but indirect** — a chosen action can create a *revision request* or *source-pointer submission* event, which then re-enters through Part 5's ordinary claim-revision or source-pointer machinery like anything else would. It never writes to the evidence manifest, applicability, or relation directly.

### Placement — optional, collapsed, downstream of CHECK, never automatic

```
CHECK result
  "No material issue found within the supplied evidence."
  [Pressure-test this]
       ↓ user clicks
A second look: 2 questions worth resolving
       ↓ user chooses one action
Claim revision or source-pointer submission
       ↓
New CHECK
```

Never opens automatically — automatic invocation makes every answer feel suspect and gives the exploratory layer visual priority over the evidence result it's supposed to serve. User-invocation is what makes it read as an intentional "pressure-test my work" move rather than the product hedging its own verdict.

**Build call**: if and when Track 2 ships, start with exactly this — a small, user-invoked action yielding up to three structured, actionable challenges (ambiguity, missing assumption, evidence request). No multi-model debate, no chat transcript, no generic reviewer mode in v1.

### Track 2 — the bad version (the failure modes that turn this into a liability)

It stops being defensible the moment any of these happen:
- it opens automatically and competes with the CHECK card for attention;
- it produces a long transcript of models debating each other;
- it silently searches for or adds evidence on its own;
- its "neutral prompts" subtly imply an answer (a leading question — *"Isn't the actual figure closer to 70?"* — smuggles an assertion while staying grammatically a question; "prompts only" is necessary but not sufficient, prompts must also be genuinely neutral);
- a second model's conclusion gets visual weight comparable to an evidence-bound relation;
- it becomes the reason users come to Notary, rather than the evidence record.

At that point what's been built is a multi-agent research assistant with an unusually strict sidebar, not a defensible evidence product.

### Scope and sequencing — unchanged from the prior correction pass

Track 2/Challenge stays a **future feature, not canonical product scope today**, and the engine as it exists has zero exploratory capability — never describe it as live. It stays exactly where the Tier 1 doc already placed "Exploratory review": explicitly deferred, gated behind the core CHECK loop proving repeat value first. "Let AI reason. Let evidence decide." stays fine as internal philosophy / a homepage line — it does not by itself license shipping Track 2 ahead of that gate.

---

## PART 7 — Reported implementation status, 2026-09-02 (not an independently audited status)

*Everything below is consistent with the supplied engine brief and the live source files read directly in this session (`server/src/server.ts`, `server/package.json`) — but claims about what's actually deployed, whether OAuth is truly pending only configuration, and the "12 of 18 tests pass" figure have not been independently re-verified via a fresh code-and-deployment audit. Treat this section as reported status, not confirmed status, until that audit happens.*

**Reported as built and live in production**:
- Full deterministic verifier + Tier A.5 normalization (`engine/src/verification/`).
- The DeepSeek judge, blind field extraction, four-outcome vocabulary (`engine/src/judge/`).
- Claim extraction with the `metric`/`operator` split.
- The `modality` structural default fix (a plain assertion IS "actual," not absent).
- Real evidence registration (fixed a bug where a supplied excerpt was silently dropped in favor of an unresolved URL).
- The full engine + MCP server, deployed on real infrastructure (AWS Lightsail, custom domains, Datadog logging).
- The card's buttons genuinely wired: Dismiss and Open Evidence work locally; Recheck calls the tool again for real; Qualify/free-text relays to Claude via `sendMessage`.
- OAuth/Clerk-based per-user org resolution: engine endpoint, server wiring, dashboard billing page built (pending Clerk dashboard configuration + final integration test).

**Reported as designed, not yet built**:
- The corrected source-pointer round-trip (Part 5) — only "no source supplied at all" works today.
- The corrected claim-ambiguity rule (Part 5) — no candidate-interpretation surfacing, no user-confirmed revision flow.
- Track 2 / "Explore this finding" (Part 6) — zero code, and per Part 6, not yet canonical scope regardless.
- The card's mechanical-vs-AI-inferred transparency line.
- `Correction`/`recheck_claim` as a real, linked, versioned flow — today a claim can only be resubmitted whole.
- `ExploratoryTranscript`, CAPTURE tier, the full GDR object model (Decision/Standing/Attestation/BoundaryEvent) — CHECK today only implements the narrow evidentiary slice, not the durable decision-record layer.
- Locked test suite: 12 of 18 cases genuinely covered and passing; 2 partial; 4 traced to features not yet built.

---

## PART 8 — The mechanism, one level deeper

**The deterministic comparator (Part 3, step 6) has zero understanding of meaning.** It checks whether two already-extracted strings are literally equal, after light cleanup and the small fixed Tier A.5 table. `metric` gets no rewriting, ever, on purpose.

**Most language interpretation currently occurs in two independent AI extraction passes** — claim extraction and evidence extraction, which never see each other's output — but not all understanding lives there: the claim schema itself, the Tier A.5 normalization table, the arithmetic/unit logic, and the applicability policy all encode real domain meaning too, in code, not in either AI call. The comparator's actual job is narrower than "understanding" — it asks whether these two independent readings landed on the same words for the same fact, under the meaning already encoded in the schema and policy layers.

**The defects found so far have been representation or extraction defects upstream of comparison** — `metric` wording drift, the `modality` default asymmetry, the temperature-value ambiguity — consistent with two AI calls lacking a shared vocabulary, not with a failure of the comparison logic itself. This is not backed by a formal defect ledger; treat it as the pattern observed so far, not an exhaustive claim.

**The fix pattern that already worked once, and generalizes**: force convergence onto a fixed vocabulary where the field allows it (`operator`), or give both readers enough shared context that they're more likely to independently land on the same words for fields that don't (still-unbuilt context-aware judge idea).

---

## PART 9 — Disposition: what to do with this document

**Accepted, ready to move toward canonical docs once written up formally**:
1. The `metric`/`operator` split (Part 3) — protects `metric` from semantic normalization while giving direction-of-change a small controlled vocabulary.
2. The Track 1 (Evidence) / Track 2 (Challenge) distinction as a *concept* (Part 6) — the tracks are not peers: Track 1 alone creates conclusions, Track 2 may only create questions. Exploratory assistance and evidence-bound verification are different activities and must never share authority. (Track 2's *scope*, however, stays experimental/future — see below.)
3. The claim-ambiguity diagnosis (Part 5) — a silent upstream interpretation can cause the system to check the wrong proposition even when everything downstream is otherwise correct.
4. The built-vs-designed inventory (Part 7) — matches the actual, verifiable state of the codebase and should be kept current as a standing discipline, not a one-time snapshot.

**Corrected in this pass, not yet merged into canonical docs**:
1. Claim-ambiguity resolution authority (Part 5) — replaced "resolve before evidence lookup" with "only context/deterministic-rule/user-confirmation may select a reading."
2. The source-pointer round-trip (Part 5) — replaced "ask Claude what it used" with "Claude proposes a pointer; only Notary's own resolution + snapshot + locator makes it evidence."
3. Track 2's scope and name (Part 6) — renamed from "Perspective" to "Challenge," narrowed from open-ended reasoning to a bounded, per-finding action producing only clarify-claim / ask-for-baseline / add-source prompts that route back through Track 1's own machinery; demoted from canonical scope to future/experimental; explicit "good version / bad version" failure-mode list added so the boundary is testable, not just asserted. Track 2 may create auditable revision-request/source-pointer-submission events — never a direct write to the evidence manifest, applicability, or relation.
4. ~~Verification relation vs. basis (Part 1)~~ — **reverted, see entry 15.** An intermediate pass of this document replaced the canonical single-`state`-field precedence chain with a split relation/basis/attestation model; checked against the actual source documents, that split was wrong and has been undone. The `no_source` boundary-flag treatment (never itself a state, never rendering as "unsupported" or "fine") is retained — it's consistent with both the intermediate pass and the canonical source, only the `ATTESTED`/state-splitting part was reverted.
5. Evidence vs. Evidence Match (Part 1) — a submitted URL is a "source pointer," not evidence, until Notary resolves/retains it with a coordinate system and provenance; a claim-specific *locator* is created later, per claim, inside an Evidence Match — not required at registration.
6. Pipeline ordering (Part 3) — evidence-side field extraction (deterministic + bounded AI) now correctly precedes applicability, since applicability needs those fields to compare against; residual semantic assessment moved to after applicability, over surviving candidates only.
7. "Interpretation vs. authority" framing (Part 2/6) — Track 1 restated as AI-assisted interpretation inside a closed procedure, not a mechanical track that merely calls AI when stuck; "recorder not decider" softened since Notary's own procedure does deterministically assign the relation — the constraint is on the model, not on the system.
8. Overclaims softened (Part 8) — "100% of understanding" and "every bug was upstream" replaced with scoped, honestly-hedged statements; Part 7 relabeled as reported-not-audited status.
9. "Open-ended exchange" language (Part 2) — replaced with "bounded investigation within declared source/tool/round/budget/retention limits," removing an internal contradiction with Part 6's rejection of long model-debate transcripts.
10. Track 2 UX and output contract (Part 6) — added the internal/user-facing name split ("Challenge" / "Pressure-test this"), a typed `challenge_type`/`prompt`/`why_it_matters`/`action` output contract with no verdict or confidence field, per-Track-1-outcome guidance, and a concrete placement flow (optional, collapsed, never automatic).
11. Track 1 ↔ Track 2 information flow (Part 6) — made explicitly one-directional: Track 1's sealed finding flows into Track 2 as an immutable, read-only `FindingContext` (renamed from a prior, more mutable-sounding "ChallengeContext"); Track 2 has no source-discovery tools and no path back into the manifest except through an explicit user action re-entering Part 5's ordinary machinery. Clarified that Track 2 may challenge the *adequacy* of a record but may never relitigate a relation by assertion.
12. Source-pointer round-trip locator wording (Part 5) — removed a leftover "enters the manifest with a locator" line that contradicted Part 1's own Evidence/Evidence Match split; the claim-specific locator is now correctly deferred to a later Evidence Match.
13. ~~`basis` data model (Part 1)~~ — **superseded by entry 15**; the `verification_relation`/`attestation`-object split this entry describes has been reverted.
14. Two small tightenings: "Track 1 alone creates conclusions" reworded to "Track 1 alone creates automated evidence states; Track 2 creates none" (leaving room for CAPTURE's distinct `ATTESTED` path); the recommended validation gate reworded to "against a labelled test set" to make it operational rather than aspirational.
15. **State model reverted to match the actual canonical source (Part 1)** — the split `verification_relation`/`basis`/`attestation`-object model introduced across entries 4 and 13 was checked directly against GDR §4.4, Canonical §5.7, and Part II §17.1 once those documents became available, and found to contradict them: the real spec uses one ranked `Claim.state` field with `ATTESTED` at precedence position 5, and GDR §4.4 explicitly pre-empts the "ranking makes it look weaker" objection that motivated the split in the first place. Reverted to the canonical single-field precedence order; `Attestation` restored as Part II's actual shape — a separate linked entity, not a rival field. This is the one correction in this document that was made against a critique of the document itself, not against the underlying system — worth remembering that a plausible-sounding review comment still needs checking against ground truth, not just internal consistency.

**Explicitly out of scope for either canonical document**: the original Part 8 "why this doesn't exist in the market" market/positioning analysis (platform novelty, foundation-model brand discomfort, competitors skipping the disciplined build) is speculation useful for investor/GTM framing, not a product or system claim — kept out of this version entirely, belongs in a positioning doc with evidence if used, not in a system definition.

**Recommended next actions, not yet executed**:
- Canonical Product Definition: add the corrected claim-interpretation rule, the corrected source-pointer-to-evidence rule, and the relation/basis separation. Do **not** add Track 2 as a product capability yet.
- Tier 1 Build Plan: add the ambiguity-investigator as a later bounded workflow (typed claim parsing, required-field policy, candidate interpretations, user-confirmed revision, source-pointer registration, end-to-end test cases); keep exploration explicitly deferred until CHECK's false-supported and false-unsupported rates are validated against a labelled test set — an operational gate, not just "validated" in the abstract.

## PART 10 — Superseded, 2026-09-02: Track 2 promoted into the current build

**The "do not add Track 2 as a product capability yet" line above (Part 9) is superseded by an explicit product decision.** Track 2/Challenge is now in scope for the current build — not gated behind proven Track 1 repeat value, per an explicit call from the product owner. This section records that decision and the design correction that made it safe, without editing the history above (Parts 1–9 stay as the record of how the thinking got here).

**What actually changed isn't the authority rule — it's the placement.** Two design iterations happened in the same conversation that produced this update:
1. First iteration: Track 2 as a separate, user-invoked, post-hoc action ("Pressure-test this" as its own button, after the fact) — this was still consistent with Part 6's original design, just moved earlier in the timeline.
2. **Final decision**: Track 1 and Track 2 are two outputs of one Notary invocation, not two user journeys. They run concurrently against the same claim set and evidence manifest, and render as **one card with two registers** — an authoritative "evidence record" (unchanged, still the only thing that can say `SUPPORTED`/`CONTRADICTED`/etc.) and a clearly subordinate "what to pressure-test" section beneath it, always in that order, never inverted.

**Why this doesn't reopen Part 6's "opens automatically" failure mode**: that failure mode describes a *second, competing surface* — a separate panel or button pulling attention away from the quiet evidence result. A single card with an explicit, fixed visual hierarchy (evidence record primary, challenge layer secondary, capped at 2 items/claim and 4/invocation, never a verdict field) is a different shape — it was always present risk to distinguish carefully rather than dismiss, which is why this section exists instead of silently editing Part 6.

**Track 2/Challenge, as decided, is explicitly not the same feature as `start_exploratory_review`** (the Tier 1 plan's open-ended Claude↔judge transcript, § Exploratory review) — that stays exactly where it was, Phase 2+, deferred. Track 2 is the typed, bounded, no-transcript, no-verdict-field alternative Part 6 already argued for over an open transcript; promoting Track 2 does not promote Exploratory Review.

**The full build contract (output schema, action routing, caps, feature-flag rollout) is now written into `docs/build/tier-1-build-and-operating-plan.md`'s Product Contract section** ("Track 2 / Challenge layer" subsection, added the same day) — that's the canonical build target from here forward; this entry is the design-history record of how the decision was reached, not a duplicate spec.

**Still true, unchanged by this decision**: the claim-ambiguity detection mechanism (Part 5's open question — how would an extractor even notice its own ambiguity) remains genuinely unsettled and is being run as a separate research spike, not shipped as a feature. Promoting Track 2 into the build did not resolve that question; it's still open.

---

## Sources synthesized

- `~/Downloads/Notary — Canonical Product Definition Final 831.md` (verified directly against, not just cited secondhand)
- `~/Downloads/Notary — Grounded Decision Records for Consequential AI Final 831.md` (verified directly against, not just cited secondhand)
- `notary-check/docs/build/tier-1-build-and-operating-plan.md` — "Notary Check — Tier 1 build and operating plan"
- `notary-check/docs/concept-claim-ambiguity-detection.md`
- `notary-check/docs/positioning-ai-reasoning-evidence-filter.md`
- `notary-check/docs/engine-brief-for-external-review.md`
- `notary-check/server/src/server.ts` and related live code
- This session's engineering work (2026-09-01/02), the multi-round review that produced Part 9's corrections, and a final verification pass against the actual canonical/GDR source files (which surfaced and reverted one incorrect correction — Part 9, entry 15)
