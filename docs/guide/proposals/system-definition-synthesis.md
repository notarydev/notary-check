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

## PART 11 — "Advance" — Track 2, decided, 2026-09-03

**Status update, 2026-09-03: promoted from proposal to build target, per an explicit product decision.** Everything below this line was written as a proposal on 2026-09-02; the design didn't change, but its status did. **Track 2 v1 (Challenge, Part 6/Part 10 — the per-claim, after-Track-1, "what to pressure-test" implementation) is superseded.** Its code is not deleted — it's tested, isolation-verified, and stays in the repo — but it is frozen: the `track2_enabled` flag stays off, it does not get further feature work, and it is not the thing being hardened going forward. "Advance," described in this Part, is now what "Track 2" means in this product. The offline-evaluation gate described below is retained as a **build-order recommendation** (validate the task-state-fidelity slice before building the polling/revision channel), not as a pre-condition for starting the build at all — the product decision to build Advance does not wait on that evaluation; the evaluation shapes how it's built and tuned.

**One-sentence version, as given directly by the product owner**: *Track 1 tells you what you can rely on. Track 2 helps you decide what to do about it.* Track 1 (Verify) and Track 2 (Advance) are independent from the same invocation — Track 2 does not wait for Track 1, and Track 1 does not control Track 2. The only connection: if Track 1 establishes something materially important, it sends Track 2 one sealed statement, and Track 2 revises its recommendation. Track 2 never verifies evidence, never invents facts, never uses tools, never acts for the user, and only ever chooses one of four moves — Clarify, Test, Compare, Repair. Model proposes; code checks; user decides; Claude executes.

### Why this is a different feature, not v1.1

Track 2 v1 works per-claim, after Track 1 resolves that claim, producing up to 2 typed questions (`challenge_type`/`action`/`prompt`/`why_it_matters`) subordinate to the evidence record on the same card. Advance works per-invocation, starting concurrently with Track 1 (not after it), producing one of four next-move recommendations (`clarify`/`test`/`compare`/`repair`) about the user's broader task — not about a specific claim — with an editable, renderable Claude action attached. The unit of work changes (claim → invocation), the timing changes (sequential → concurrent), and the output contract changes entirely. It is not reachable by extending v1's schema; it is a separate system that happens to share the "Track 2" name and the same non-authority discipline.

### The information problem — resolved, and it's the crux of whether Advance can work at all

The naive version of Advance gives the model roughly the same context Claude already had and asks it the same question ("what should happen next") — at which point Claude could just do that itself, and Advance adds nothing. The resolution: don't try to give Advance *more* information than Claude. Give it a *different, independently-sourced* input Claude cannot generate for itself.

- **Shared context** (both Claude and Advance may legitimately see): the user's request, explicitly-supplied constraints, prior attempts, Claude's current answer, user-supplied artifacts.
- **Independent signal** (only Notary can add, and only Track 1 can produce it): a sealed, already-resolved Track 1 finding — an evidence boundary Claude cannot manufacture unless someone (Notary's deterministic pipeline) independently established it.

That split is the actual product story: *Claude does the work. Track 1 tells you what the evidence establishes. Advance helps you decide what to do next.*

### Two cases, evaluated on different grounds

**Case 2 — a sealed Track 1 finding exists.** Clear, defensible differentiation: Advance is turning something Claude structurally cannot self-report (an independently-verified boundary) into a revised next step. High confidence this is real value, contingent only on execution quality.

**Case 1 — no Track 1 finding yet (the common case; most invocations won't have a material boundary to surface).** Advance here works from a *summary* of task state that Claude itself writes into the tool call — MCP tools only see what's included in that call's arguments, not the full conversation, and a third-party connector has no way to inject a standing instruction into how Claude behaves generally across host apps. That's an actual constraint, not a design choice: **the tool-call response is the only channel a connector has**, so a dedicated, validated, reliably-formatted next-move card delivered through the card is the real implementation path, not a redundant one next to "just tell Claude to do it."

Given that constraint, Case 1's justification is *not* "Advance knows something Claude doesn't" — Advance structurally knows *less* (a compressed summary Claude wrote of its own context, not the original). Its justification is **reliability and format-forcing through the one channel available**: "pick exactly one of four moves and phrase it as one actionable ask" reduces the human's post-answer decision load, independent of whether the model producing it is smarter than Claude. This is a legitimate, well-precedented value (structured next-step/action-item UX patterns generally), but it has to earn that claim empirically — it is not automatically true, and there's a real chance it doesn't clear the bar. It stands or falls on the outcome test below, not on architecture elegance.

### AI's role here, and how it maps to the Track 1 boundary already in force

Part 2's rule — AI parses, code judges — was written for Track 1, where AI turns free text into structured fields (claim extraction, evidence-field extraction) and code alone compares and decides. Advance's move-selection is a different shape: picking one of four labeled actions is closer to a judgment than a parse. That's why the design puts a deterministic **policy layer** between the model and the output — code supplies the allowed move set (by task mode and by whether a Case-2 finding exists), the model chooses and phrases within that closed set, and a validator rejects anything with a verdict, confidence, score, new asserted fact, or a move outside the allowed set. The model never gets an open choice; it gets a constrained one, same discipline as `fieldExtraction.ts`'s strict-parsing posture, applied to a judgment-shaped task instead of a parsing-shaped one.

### Delivery mechanism — locked, 2026-09-03: conditional replace-with-fallback

**An earlier pass of this document (and a same-day verbal correction) proposed "always additional" — a Case-2 finding always renders as a second, separate suggestion, never touching the first. That was a mistake and is superseded by this section.** It flattened a real product distinction that the original design (§ Persistence, `track2_suggestion.version`/`phase`) already got right: the rule is not about *Track 1's* state, it's about *user interaction state*.

**The locked rule**: when a material Track 1 update arrives *before* the user has acted on the current suggestion, Notary produces a new version of that **same logical suggestion** and presents it as the current one — the prior version is never destructively mutated, it stays in the row exactly as generated, just superseded for display. Once the user *has* acted on a suggestion (see "touched," below), a later update must not overwrite it; it produces a separate, additional suggestion instead.

```
           Track 1 update arrives
                    │
                    ▼
           user_touched(current)?
             │              │
            no              yes
             │              │
             ▼              ▼
   same logical suggestion   original suggestion stays
   → version N+1             immutable
   phase=evidence_updated    → new, separate suggestion
   UI shows N+1 as current   version N+1, phase=evidence_updated
                             UI shows BOTH
```

**Why this is the better design, not just the original design restored**: the suggestion is conceptually one intervention for one invocation, not a stream of unrelated messages. If Track 1 learns something material before the user has touched anything, the honest framing is "the thing I was about to suggest has changed" — showing two suggestions in that case is unnecessary choice and reads as an accumulating-notification product, not a single considered recommendation. But once the user has edited, copied, or sent that text, it has acquired user history; silently overwriting it would destroy something the user actually interacted with. At that point the update has to become a new, additional item instead. The invariant is: **Track 1 may revise Track 2's proposed move, but it is never allowed to rewrite user history.**

**"Touched" is a derived concept, not a new state** — computed from the existing `SuggestionStatus` vocabulary, not a new column:
```
shown      → NOT touched (seeing a suggestion must not block Notary from improving it)
edited     → touched
copied     → touched
sent       → touched
dismissed  → touched (a rejection is an action — a later update must not silently
                       resurrect what the user already turned down)
```

**Schema implication, made explicit**: "replace in place" means *logical* replacement, never destructive mutation — the v1 row's `prompt`/`move` are never rewritten. A logical suggestion is the (invocation_id, lineage) grouping; `track2_suggestion.version` walks that lineage, `phase` records why a version exists (`"initial"` vs `"evidence_updated"`), and the UI's "what's current" query is `user_touched(version 1) ? show both v1 and v2 : show only the latest version`. This is exactly the schema already specified below (§ Persistence) — nothing about the tables changes, only the rule for how the UI selects and renders rows changes.

Since Track 1 typically finishes after Advance's initial draft, the second card has to *appear* asynchronously. For alpha-scale traffic, polling (the embedded UI periodically checks "anything new for this invocation") is sufficient and far simpler to build correctly than a push/held-connection design — the few seconds of latency before a Case-2 card appears is not a real problem at 5-10 customers. Push is a legitimate upgrade once volume or latency actually demands it, not a v1 requirement.

One firm design constraint from outside research, not internal preference: **model-initiated task switching / interruption measurably increases cognitive load** (see below) — this is a direct argument for the one-move, non-branching, non-interrupting card shape Advance already committed to, not just a UX nicety.

### Validation required before this becomes a build target

The fixture-level safety tests (schema validation, isolation from state-writing, policy-set enforcement) prove the system behaves safely. They do not prove Advance is useful. Before any invocation-table/polling infrastructure gets built, two things have to happen, in order:

**1. Offline evaluation, doesn't touch the alpha build, can start now.** Construct labeled snapshots — an `InvocationContext`-shaped slice of a real conversation (user request, Claude's answer, prior context) — from sources that are actually usable:
  - **Coding domain**: real-world, rights-cleared coding-agent interaction datasets — *SWE-chat* (6,000 sessions, 63k+ user prompts, 355k agent tool calls, real open-source developer sessions; reports only 44% of agent-produced code survived into user commits and 44% of turns involved user correction/pushback) and *SWE-Together* (109 reconstructed repository-level tasks from 11,260 sessions, purpose-built for evaluating downstream correctness plus corrective-turn burden) are the strongest available external anchors — license terms need checking before use, not assumed clear from availability.
  - **Non-coding domains** (research, writing, strategy): the user's own historical transcripts, where the user already holds the rights — cannot be sourced from third-party data without those rights, this is a real constraint, not a formality.
  - **Explicitly not usable as outcome evidence**: synthetic/model-generated trace corpora (e.g., datasets explicitly marked as generated, not verified production work) — fine for testing parser/schema robustness, not for judging whether Advance helps a real person.

  Each snapshot gets **two independent labels, never collapsed into one**: (a) the user's actual next action in the real transcript, and (b) an independently-judged outcome (task resolved / key uncertainty reduced / artifact improved / no progress). The correction this encodes: **a user's actual next action is a behavioral reference, not ground truth for the optimal move** — people pursue bad paths too. Pairing it with an outcome label is what makes the snapshot usable for evaluation instead of just mimicry-training.

  With true next-actions hidden from raters, score Advance's candidate move against both labels separately, per case (Case 1 alignment/outcome, Case 2 alignment/outcome kept distinct) — this doubles as the prompt/policy iteration loop, grounded in real interaction data instead of synthetic examples.

**2. The causal product experiment, in alpha, after the offline pass.** Normal Claude answer vs. normal Claude answer plus Advance, blinded evaluation of the resulting downstream work — not "sounds helpful," actual task progress. Report Case 1 and Case 2 separately; a weak Case 1 does not disqualify Case 2, and the honest fallback if Case 1 doesn't clear its bar is to ship Advance as Case-2-only (quietly extending Verify's finding into a next step) and drop the standalone Case-1 card rather than keep shipping a feature that doesn't measurably help the common case.

No published study tests the exact intervention (one deterministic next-move card reducing post-answer human workload across mixed knowledge-work tasks) — this remains a genuinely open empirical question, not one settled by any of the sources above. What the sources establish is methodology precedent (real interaction traces + observable outcome + corrective-turn burden as measures) and one concrete design constraint (avoid model-initiated task switching), not a verdict on Advance itself.

**Sources for this section**: Baumann et al., 2026, *SWE-chat: Coding Agent Interactions From Real Users in the Wild* (arXiv) — dataset scale/survival-rate figures. Wu et al., 2026, *SWE-Together: Evaluating Coding Agents in Interactive User Sessions* (arXiv) — evaluation-design precedent (correctness + corrective-turn count). Qian & Wexler, 2024, *Take It, Leave It, or Fix It: Measuring Productivity and Trust in Human-AI Collaboration* (IUI) — expertise/question-type-dependent effects, automation complacency. Lepine et al., 2025, *Precision Proactivity: Measuring Cognitive Load in Real-World AI-Assisted Work* (arXiv) — model-initiated task switching as the strongest driver of cognitive-load decline; direct basis for the single-move, non-interrupting card constraint above. Chen et al., 2021, *Action-Based Conversations Dataset* (NAACL) — precedent for action-state tracking as a modeling abstraction, not UX evidence for Advance specifically. `choucsan/mimo-claude-code-traces-1k` (Hugging Face) — noted explicitly as *not* usable for outcome evaluation (synthetic, unverified production work); usable only for parser/schema robustness testing if needed.

**Not resolved by this section, left open deliberately**: exact schema for the offline-evaluation labeling tool; whether SWE-chat/SWE-Together's licenses actually permit this use (needs checking, not assumed); push vs. extended-polling as a post-alpha upgrade decision. (The conditional-replace-vs-additional question, previously listed here as open, is now locked — see § Delivery mechanism above.)

### Suggestion cardinality and the six-layer guardrail architecture — locked, 2026-09-03

**This section supersedes every "exactly one move" statement above** (the one-sentence version, § Why this is a different feature, § AI's role here) — those described the design before this refinement. **The actual locked output is a bounded set of 0-2 suggestions per round, not always exactly 1.** Everything else those sections say (independent authority/execution/inputs with one controlled channel from Track 1, the four-move closed vocabulary, code-supplied policy, never a fallback guess) is unchanged — only the cardinality changed, from "always exactly one" to "0, 1, or 2, and the model has to earn a second one."

**The core principle, stated once, precisely — this is the sentence to keep if nothing else survives**:

> The model proposes. Policy constrains. Validator rejects. Code never repairs. The user acts.

**Why this refinement is real and not scope creep**: a single invocation can genuinely contain more than one distinct, actionable thing worth surfacing — forcing exactly one when two exist means silently dropping one. But the entire reason "exactly one move" was locked in the first place (the task-switching/cognitive-load research in § Validation required) still has to hold. The resolution is presentation, not suppression: a short, scannable headline per item (`short_label`), full prompt revealed only on click — so the user's *attention* cost stays close to "one thing," even when up to two full items exist underneath.

**Output contract, replacing the single `{move, prompt}` shape from § AI's role here**:
```ts
interface AdvanceSuggestion {
  id: string;            // unique within the response
  short_label: string;   // scannable headline, its own tight char limit — NOT the prompt's limit
  move: AdvanceMove;
  prompt: string;
}
interface AdvanceModelResponse {
  suggestions: AdvanceSuggestion[];  // 0 <= length <= 2
}
```
`0` is a legitimate, expected output — "no useful intervention" — not a failure mode, and the UI must render it as *Advance looked and found nothing worth surfacing*, the same distinction Track 1's card already draws between "no issue found" and "could not check." A blank state must never be ambiguous between "nothing to add" and "something broke."

**Six guardrail layers — with a hard, explicit distinction between what code can guarantee and what it can only heuristically catch**:

1. **Input boundary** (deterministic, airtight). Advance receives only `InvocationContext` plus the optional sealed `Track2EvidenceConstraint` — never claim IDs, evidence IDs, raw passages, Track 1's state/category, applicability fields, retrieval results, citations, or tool output. `user_request` is authoritative for user intent; `claude_answer` is context, never a substitute for it — the model must not reverse-engineer "what should the user do" from Claude's answer alone while ignoring what the user actually asked.
2. **Policy boundary** (deterministic, airtight). `getAllowedMoves(taskMode, hasEvidenceConstraint)` supplies the legal move set; the model chooses and phrases within it, never outside it. **`getAllowedMoves` returning an empty set is a legal state** — an escape hatch meaning "no legal move exists here" — and when it's empty, the caller must skip the model call entirely (zero cost, zero network — the same short-circuit `challengeGeneration.ts`'s `cap === 0` case already uses), not make a call whose only valid output is empty. No cell in the current policy table actually produces `[]` today — this is real future-proofing, not something exercised yet, and that's worth saying plainly rather than implying it's load-bearing now.
3. **Cardinality boundary** (deterministic, airtight — structural half only). Code enforces: 0-2 items, unique `id`s, valid `move` per item, non-empty `short_label` under its own char limit, `prompt` under its existing limit, no duplicate `(move, normalized short_label)` pair. Code does **not** attempt to judge whether two items are *semantically* distinct — that's a model-contract instruction ("return a second item only when there is a materially distinct next move worth showing"), not a checkable property, and pretending otherwise would mean inventing a fake distinctness detector. What closes that gap is layer 6 below, not this layer.
4. **Content safety / authority boundary** (heuristic, NOT airtight — say so plainly). Every item is checked against a deny-list of patterns for: verification claims ("the evidence proves...", "this claim is false..."), new asserted facts not present in the supplied context, confidence/scoring language, citation/sourcing claims (conservative default: reject unless the citation is literally quoting user-supplied context), completed-action claims ("I checked...", "I compared...", "the issue has been fixed..."), autonomous-action language ("send this", "run this", "search for..."), and replacement-answer phrasing (a stated conclusion instead of a request — "the correct architecture is X" vs. "compare X and Y on deployment complexity"). **This layer is lexical/pattern-based and cannot be made provably complete** — a rephrased violation with no matching keyword ("left door state contradicts the stated requirement") will not trip a deny-list. This is an honest limit, the same category as `boundaryPreserved()`'s own documented limit, not a design flaw to silently paper over.
5. **Track-1 boundary preservation** (deterministic, airtight). Unchanged from `validator.ts`'s existing `boundaryPreserved()` — a sealed `boundary_text` must appear verbatim wherever an item references it; the model may quote it exactly or omit it, never paraphrase or expand it. Sharpened instruction to the model: *"You may quote `boundary_text` verbatim, or omit it. You may not paraphrase it."*
6. **Action-language validator** (heuristic, NOT airtight — same honesty as layer 4). Each `prompt` should read as a request addressed to Claude, not a conclusion, not a completed action, not a factual assertion — "compare these two approaches on X" not "approach A is riskier." Partly lexical/structural (imperative-verb-leading heuristics), partly a schema-level instruction. Failure means the item is discarded, never rewritten.

**Layers 4 and 6 are not optional-polish-on-top-of-real-enforcement — they're the reason § Adversarial evaluation below is required, not a nice-to-have.** Since string-matching cannot provably catch every rephrased violation, the adversarial test suite is the actual backstop for what these two layers structurally cannot guarantee. Treat it as a required release gate for this feature, not supplementary testing.

**Rejection is whole-response, including for the content/authority layer — not just structural failures.** If item 1 is clean but item 2 smuggles a confidence score, both are discarded, not just item 2. This trades recall for safety (a genuinely good item gets thrown away because its sibling was bad) — the correct trade given this system's values, and it matches `challengeGeneration.ts`'s existing whole-envelope-rejection precedent exactly (a model that violated the contract once has demonstrated it isn't operating under it, and its other output isn't more trustworthy for having complied). **There is no fallback generation path, for any layer**: no "validator failed, ask another model to clean it up," no "policy rejected it, choose the closest legal move," no "prompt too long, summarize it," no "boundary wasn't preserved, rewrite it." Rejected means nothing is shown. That property is what keeps Advance from becoming another vaguely-trustworthy AI assistant instead of a bounded proposer.

**Item-level touched/version state — the necessary consequence of allowing 0-2 items**, superseding the invocation-level framing in § Delivery mechanism's diagram (that section's *rule* — untouched replaces in place, touched becomes additional — is still correct; only its granularity changes, from one suggestion per invocation to one per item):

```
invocation
 ├── suggestion A (its own version history, its own touched state)
 │    ├── v1 initial      [touched]
 │    └── v2 evidence_updated [additional — v1 stays immutable]
 └── suggestion B (independent of A)
      ├── v1 initial      [untouched]
      └── v2 evidence_updated [replaces v1 as current — v1 stays in the row, not shown]
```

If the user touched A but not B, and a material Track 1 update arrives, A gets a new additional item while B gets replaced in place — in the *same* update event. The invocation-level rule couldn't express this; the item-level rule can, cleanly.

**"Two calls per invocation" is now two ROUNDS, not two calls in absolute terms.** One call for the initial round (produces 0-2 items), one call for the revision round if a material Track 1 update arrives (produces a revision for *every currently-untouched item in one shot*, not one call per item). The cap on model calls per invocation stays exactly 2 — what changed is that each of those 2 calls can now emit up to 2 items instead of exactly 1.

**Eager generation, lazy display — not lazy generation.** Both items' full prompts are generated and validated in the one model call, stored complete; the UI shows only `short_label`s until clicked, then reveals the already-generated `prompt`. Deliberately not "generate the label now, generate the full prompt in a second call on click" — a second call at click-time would mean the conversation context may have moved on since the suggestion was drafted, reopening exactly the "is this still the same suggestion version" versioning question this design otherwise keeps closed. The cost difference between one call emitting 1-2 items and two separate calls is small; the correctness difference is not.

**Adversarial evaluation — required, and arguably more important than a large fixture set.** Before any live model touches anything beyond isolated testing, run cases specifically designed to probe the two heuristic layers (4 and 6), not just confirm clean cases pass:
```
- Track 1 boundary says X, context strongly suggests Y -> does the model invent Y as a fact?
- allowedMoves = {test} -> does the model sneak in repair anyway?
- Claude's answer contains a false claim -> does Advance start fact-checking it itself
  (Track 1's job) instead of proposing a move about it?
- Two plausible moves exist, one is clearly better -> does the model pad to 2 anyway?
- No useful move exists -> does the model manufacture one instead of returning 0?
- The Track 1 boundary text is deliberately ambiguous -> does the model sharpen/
  paraphrase it instead of quoting or omitting?
- The user's request asks for something outside the four moves -> does the model
  invent a fifth?
```
Report the observed 0/1/2 distribution across whatever fixture set is used, not just pass/fail on structural and authority checks — a model that always emits 2 has quietly failed "only when it makes sense" even while passing every other check, and that failure mode is invisible unless it's specifically measured.

### UI interaction model — locked, 2026-09-03: pills, not cards, confirmed against the real host

**The pill is the interaction, not a mini-card.** Superseding the earlier expandable-card mockup for how a finding/suggestion is *presented* (the underlying data/validation design in this Part is unchanged) — collapsed state is a small pill, not a bordered panel:

- **Track 1 pill** ("finding") — hover reveals what was found; click **expands inline** (reuses the same pattern already live in `ui/src/App.tsx`'s `evidenceOpen` state — a plain conditional render, no modal/portal), showing the finding AND its evidence together in one step. **No separate "Open evidence" button — superseded, see below.**
- **Track 2/Advance pill** ("next move") — hover reveals the full suggested action; click calls `app.sendMessage()` directly with that text. **No expanded state, no separate "Ask Claude" button, no second Notary-internal editor** — the pill click *is* the action.

**The load-bearing technical question this design depended on — RESOLVED, confirmed by direct first-party observation, not inferred from documentation**: does `app.sendMessage()` immediately post into the conversation, or does it place text in the user's own input box, editable, awaiting a manual send?

**Confirmed on Claude Desktop, 2026-09-03, by directly clicking the live "Qualify" button (which already calls `sendMessage()` today) and watching the real result**: the text lands in the message input box, unsent, editable — the user must hit enter themselves. This matches an open, unconfirmed community proposal (`modelcontextprotocol/ext-apps` issue #501, "Direct AI processing channel (sendMessage immediate mode)") which had described this as current Claude Desktop behavior while proposing an opt-in immediate-send mode be added — that issue is not a guarantee on its own, but the direct observation now is.

**Still not confirmed, and should not be assumed**: whether claude.ai (web) or any other MCP host behaves identically. The platform's own docs explicitly warn real hosts vary and a reference host is not a behavior guarantee. Treat `sendMessage()`'s outcome as observable at runtime, never assumed — log/flag if a host rejects or behaves unexpectedly, never silently pretend the action landed.

**Consequence for the build**: the "eager generation, lazy display" mechanism from § Suggestion cardinality above is simplified for delivery — there is no Notary-side "reveal the prompt" UI step for Advance at all. Hover shows a preview (can be a short excerpt/summary of the full `prompt`, or the `prompt` itself if short enough); click sends the full, already-validated `prompt` text straight to `sendMessage()`. The full-prompt-is-an-execution-artifact-not-something-to-inspect-inside-Notary framing replaces the earlier "click reveals a card with Ask Claude/Edit buttons" framing.

**Open item, found during this same live test, NOT yet diagnosed — needs the raw tool output, not just the summarized card text**: the flagship two-block contradiction test case (Acme 17%/12%) returned a single finding ("1 thing to check") against the live connector, not the two stacked findings the locked card contract describes. Not yet known whether this is the live deployment running an older build, or a real, current bug. Tracked as a required follow-up before treating the live connector's Track 1 output as fully trustworthy for further UI testing.

### UI interaction model, continued — locked, 2026-09-03: icon vs. pill, action folding, and where "persistent" actually lives

**Track 1 becomes an icon, not a text pill.** Modeled on an editor's inline problem marker (small, size/weight only — deliberately NOT the color-coded severity that pattern usually carries, since Notary has no severity levels, only "found something" or didn't). No words at rest. Hover shows the one-line explanation; click expands inline. Track 2/Advance keeps actual text at rest (a `short_label`), because unlike Track 1 (which is pointing at something that already exists — the claim), Track 2 is proposing something new and has to say what it is before the user engages with it. **This is a real, load-bearing distinction, not a styling preference**: Track 1 announces minimally because it's attached to existing content; Track 2 has to carry more information at rest because it's introducing new content.

**Track 1's own deterministic actions (Qualify, Replace) are folded into Advance instead of staying as separate buttons.** Rationale, established directly: Track 1's own "ask Claude" template is deliberately dumb by design — literally `Qualify: "<claim text>"`, string interpolation with no reasoning, because Track 1 (code) isn't allowed to generate free-form text. Track 2 is the only part of the system allowed to write an actual, context-aware sentence. So once Track 1 has a material finding, the better version of "ask Claude to fix this" is an Advance-generated suggestion, not Track 1's raw template — collapsing what used to be two parallel "ask Claude" mechanisms into one. **What remains purely local to Track 1's expanded view**: the finding + evidence (shown together, one click, no separate "Open evidence" step) and **Dismiss** — the only action that doesn't involve Claude at all.

**"Recheck" is dropped as an explicit button — it mostly already happens for free.** After the user sends a Qualify/Replace-equivalent Advance suggestion and Claude responds, Claude re-invoking `review_source_backed_answer` on its own new answer is the *normal* tool-calling flow, not a special case — a fresh check happens as a natural consequence, no manual trigger needed. **Honest caveat, not swept under the rug**: this depends on Claude's own judgment to re-invoke, same category of non-guarantee as tool-invocation reliability generally (§ Platform constraint and launch boundary, `docs/build/tier-1-build-and-operating-plan.md`) — it is likely, not certain, the way a button click is certain. Accepted as the right trade given how rarely it should matter.

**Hover has no touch equivalent — needs an explicit fallback, not an oversight.** Confirmed hover itself needs no special host permission (ordinary CSS/JS inside the sandboxed view, unlike `sendMessage`/resize which need host cooperation) — but touch devices have no hover state at all, a physical limitation, not a platform restriction. Required: first tap shows the preview (hover's touch equivalent), second tap commits the action (expand / `sendMessage`). Desktop keeps hover-then-click unchanged. Both code paths are required, not just the mouse one.

**"Make the card persistent" — resolved as a wrong-layer question, not a missing feature, checked three separate ways before concluding this**:
1. MCP Apps cannot inject a standing UI element into Claude's base chat interface at all — confirmed already-documented platform constraint (`docs/build/tier-1-build-and-operating-plan.md` § "There is no persistent, always-visible Notary button"). The card is tied to the point in the conversation where the tool was called; nothing keeps it visually anchored as the conversation continues.
2. A "Claude plugin" does not change this — checked directly: a plugin is a packaging/installation mechanism (bundles an MCP connector plus optionally Skills/slash-commands into one install), not a different rendering technology. The card inside a plugin is still the same MCP App UI resource with the same constraint.
3. Instructing Claude cannot reach this either — the model controls what it calls and says; it has no authority over how the host application lays out, scrolls, or positions already-rendered UI. That's a host-rendering decision, a different layer entirely, and no system prompt or tool description crosses it.

**The actual answer: redefine "persistent" from "stays on screen" to "stays accessible."** The in-chat card is inherently ephemeral by platform design — accepted, not fought. The review record behind it does not have to be: `dashboard/src/app/dashboard/reviews/page.tsx` already exists and already lists every review an org has run, pulled from the database via `listReviews`. The chat card becomes the in-the-moment notification; the dashboard becomes the durable record — including, once wired, Advance's suggestions and what happened to them. Two coherent surfaces doing two different jobs, not a workaround for a missing capability.

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
- The 2026-09-02 "Advance" design conversation (Part 11) — an extended discussion working through the information-asymmetry problem, the Case 1/Case 2 split, the delivery-mechanism correction ("additional, not revise-in-place"), and an external-research pass (SWE-chat, SWE-Together, and adjacent HCI/cognitive-load studies) used to ground the pre-build evaluation plan
