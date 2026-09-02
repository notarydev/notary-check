> Status: canonical
> Owner: Hardyk
> Last verified: 2026-09-02
> Supersedes: —

﻿# Notary — Decision Evidence Records for Consequential AI

**Status:** Canonical product definition  
**Purpose:** A complete, readable definition of what Notary is, what it establishes, how it works, who it serves, and what it does not claim.

> **How to use this document.** Part I defines Notary's product vision, meaning, authority boundaries, and non-negotiable conceptual rules. It governs if another document conflicts on what Notary is allowed to claim. Part II translates that vision into a technical contract for schema, implementation, and evaluation work; it may evolve without changing the Part I vision. This document does not replace a build backlog, API/schema specification, or the academic GDR paper. Those documents are subordinate on product vocabulary and authority boundaries, while the academic paper retains independence over its scholarly argument and evidence.

# Part I — Product vision and conceptual contract

## 1. The one sentence

> **Notary produces the durable evidence record behind one consequential AI-assisted decision: the decision, its stated reasons, the material available at the time, what each reason actually resolves to, what was missing, and what changed later.**

The record opens at the claim, case, application, transaction, or account reference a customer, examiner, counsel, or affected person actually names.

## 2. The problem

AI systems now make or materially influence decisions that can release money, deny a benefit, select or reject a person, close an alert, recommend an action, or determine how another person is treated. These decisions often leave a score, an answer, a generated rationale, a trace, or a ticket. Months later, when someone asks what happened in one case, the organisation must reconstruct a story across changing systems, unavailable staff, revised policies, and missing context.

The missing object is not another dashboard. It is the **decision artifact that already has to exist**: a claim file, determination record, credit memo, disposition narrative, selection rationale, or suitability record whose stated reasons can be inspected against the material that existed when the decision was made.

A plausible reason is not a defensible reason. A log can show that an agent ran. A model can produce an explanation. A hash can show that an artifact did not change. None alone establishes whether the reason given for this decision has an applicable, inspectable basis.

## 3. What Notary is

Notary is **artifact-production infrastructure for consequential AI decisions**.

It creates a fixed, durable Decision Evidence Record for one decision. The record contains a claim-level account of the reasons stated, the evidence boundaries, exact source locators, verification state, provenance, decision-time context, human oversight where present, and corrections or supersession.

Notary has three connected uses:

1. **Issue the artifact.** Create an evidence-bound record when an AI-assisted decision is issued.
2. **Answer one challenge.** Open the record at a business reference when someone asks for the basis of a specific decision.
3. **Find recurring breaks.** Aggregate the same records to identify missing sources, unreliable reasons, policy/version issues, dropped provenance, or incomplete capture.

The third use is not a separate governance product. It is a query over the records.

## 4. What Notary is not

Notary is not:

- a generic fact checker for consumers;
- a second chatbot or a generated explanation layer;
- a system-level AI-governance dashboard;
- a trace viewer, observability platform, or model-evaluation suite;
- a public trust seal or assurance badge;
- a tool that decides whether the customer's decision was fair, lawful, appropriate, or substantively correct;
- a claim that every relevant source was captured; or
- a universal deterministic replay system for arbitrary LLM decisions.

Notary does not replace observability, evaluation, policy/governance, or the customer's system of record. Those systems provide inputs. Notary produces a decision-specific evidence artifact they do not.

## 5. The product object

### 5.1 Decision

A **Decision** is one consequential determination or action owned by a party and keyed to the reference a later challenge uses. A new decision begins where accountability changes hands, not at every model invocation or function call.

A decision includes:

- business reference and aliases;
- party role: vendor, deployer, or integrated party;
- decision family and outcome;
- time of occurrence and time of Notary receipt/seal, kept distinct;
- decision-time state where captured: model/provider, prompt/configuration, policy, relevant tool and retrieval state;
- evidence artifacts and their provenance;
- stated claims and their verification state;
- human oversight or attestation events where present; and
- immutable revision and correction history.

### 5.2 Claim

A **Claim** is an atomic or near-atomic proposition asserted as a basis for the decision, such as "the policy was in force," "secondary income qualifies," "conservative therapy was documented," or "the reviewer saw a low-confidence flag." Claims are the unit of inspection because different reasons can rest on different evidence and fail independently.

**Decontextualization** restores only the material context required to check a claim: entity, time, scope, predicate, value/unit, comparison/baseline, and modality where relevant. Notary never invents missing context. A claim that cannot be restored without invention cannot receive a positive automated evidence state.

**Claim-side ambiguity — resolution authority.** A claim can genuinely support more than one reading on a material field (e.g., an unqualified "the weather" with no marker of current/high/low). A model may propose candidate interpretations. Only one of three things may select among them: explicit context already present in the preserved answer text (e.g., a pronoun with one unambiguous antecedent in the same text — a deterministic resolution, not a judgment call), a declared deterministic rule, or a user-confirmed revision. If disambiguation requires the model to *guess* the more likely reading rather than read it off retained context, it cannot resolve automatically — the ambiguity must surface, and a user-confirmed clarification becomes a new, explicitly linked claim revision that re-enters the verification procedure from step 1. Evidence-led reinterpretation is forbidden: a disambiguator never gets to pick the reading that happens to match available evidence — that resolves the check in the wrong direction, deciding the question the procedure exists to answer.

### 5.3 Evidence

**Evidence** is an addressable artifact with a payload or independently resolvable content plus a locator. Examples include an input document, retrieved source, tool response, policy, transcript, model output, reviewer screen, or vendor response.

Model memory, paraphrase, or a statement that "the source says X" is not evidence. A link without stable content and a locator is a pointer, not evidence.

**The source-pointer-to-evidence sequence.** When a model proposes a URL, attachment, or identifiable source as a possible basis for a claim, that proposal is a **source pointer** — a candidate, not yet evidence, and it earns no evidentiary weight on its own no matter how confidently it is offered. A model's own statement about what it used or would use is an unverified claim about its process, not a resolved artifact. The sequence that actually produces evidence: the model proposes a source pointer → Notary resolves it and retains a canonical snapshot of the actual payload → the resolved object enters the declared evidence manifest with its coordinate system and provenance recorded → a later Evidence Match resolves the claim-specific locator, per claim, not at registration time → the claim is (re)checked against the manifest as it now stands. Until a payload is retained with a coordinate system and provenance, nothing a model supplied counts as evidence, regardless of how the pointer arrived (an initial answer, a follow-up round-trip when Notary asks what source was used, or any other path) — this is the ordinary evidence-registration rule applied without exception, not a special case for any one interaction pattern.

### 5.4 Locator

A **Locator** is an exact pointer into an evidence artifact: a character range, JSON path, page plus bounding box, timestamp interval, or equivalent canonical offset. It must resolve against the retained artifact. When source text is available, Notary renders the actual resolved passage—not a generated paraphrase.

### 5.5 Evidence match

An **Evidence Match** links a claim to an evidence artifact and locator. It carries:

- the resolved source passage or structured value;
- provenance and origin;
- the verification method;
- claim-relevant applicability; and
- the resulting typed relation.

A resolved locator proves where a passage is. It does **not** prove that the passage applies to the claim.

### 5.6 Applicability

Before evidence can support or contradict a claim, Notary assesses the dimensions material to that claim:

- subject/entity;
- decision and evidence effective time;
- scope, population, jurisdiction, or product;
- predicate or measure;
- value and unit where relevant;
- comparator or baseline where relevant; and
- modality or qualification where relevant.

Each dimension is `match`, `mismatch`, `not_applicable`, or `indeterminate`. A material mismatch disqualifies the passage from support, even if the wording or number appears attractive. This prevents a correct-looking citation to the wrong entity, period, policy version, denominator, or population.

### 5.7 Verification state

Verification states describe the defined relationship between a claim and the record's evidence; they are not truth, fairness, legality, or compliance states.

- **SUPPORTED** — applicable resolved evidence establishes the stated relationship under the declared procedure.
- **UNSUPPORTED** — the procedure completed over available, applicable evidence and found no support.
- **CONTRADICTED** — applicable resolved evidence establishes an incompatible proposition.
- **CONFLICTED** — applicable resolved evidence materially disagrees and no declared, reviewable priority rule resolves it.
- **INDETERMINATE** — the procedure could not establish the relationship because a material condition failed or remained unresolved.
- **ATTESTED** — a named human supplied a basis after automated methods did not resolve the claim. Attested is distinct from evidence-derived support.

`no_source` is an evidence-boundary flag, not a verification state. It means no relevant addressable evidence existed in the record's bound evidence set. It must never be rendered as either "unsupported" or "fine."

**Not every mode uses all six states.** CHECK, being a live, single-manifest, advisory check with no human-in-the-loop, surfaces only `SUPPORTED`, `CONTRADICTED`, `UNSUPPORTED`, and `INDETERMINATE` (plus the `no_source` boundary flag). `CONFLICTED` requires multiple resolved sources materially disagreeing—rare within one bound evidence set, more relevant once a decision aggregates evidence over time. `ATTESTED` requires a named human basis, which only exists once a decision is captured. Both become live once a record reaches CAPTURE.

### 5.8 Standing

**Standing** is a computed condition of the record—not a score of the decision's truth or quality. A record may be:

- **unrecorded** — no decision object exists;
- **sealed** — record and integrity metadata exist;
- **grounded** — all in-scope claims reached a typed state; unresolved and unsupported claims remain visible rather than hidden; or
- **recomputable** — grounded, captured at the relevant boundary, and paired with an actually pinned, runnable deterministic decision function and dependencies.

Standing is earned from record conditions and cannot be assigned by a user, administrator, model, or support process.

### 5.9 Worked instance: Acme FY25 revenue

The following compact example instantiates the full object model without changing its rules.

| Object | Record value | What it establishes—and does not establish |
|---|---|---|
| **Decision** | `Acme investor-update-2025-04`; outcome: publish a FY25 performance summary; occurred 2025-04-14 | Identifies the accountable event and the reference a later reviewer can name. It does not make the summary correct. |
| **Claim** | “Acme’s revenue grew **17%** year over year in FY25.” | States one checkable reason in full context: entity = Acme; period = FY25; measure = revenue growth; baseline = prior fiscal year; value/unit = 17%. |
| **Evidence A** | A market report: “The overall market grew **17%** in FY25.” | It is real, exact, and superficially attractive—but it is not evidence about Acme. |
| **Locator A** | The exact market-report sentence | Resolves to retained text but proves only where the market statement occurs. |
| **Applicability A** | entity = `mismatch`; period = match; value/unit = match | This candidate is excluded from support. A matching number from the wrong entity cannot be positive evidence. |
| **Evidence B** | Acme FY25 annual report | Defines additional material within the same evidence manifest. |
| **Locator B** | Annual report, page 14: “Revenue increased **12%** year over year in FY25.” | Resolves to the retained passage. |
| **Evidence match B** | The claim is linked to the passage using `quoted_or_computed` verification | Makes the proposed relationship inspectable. |
| **Applicability B** | entity = match; period = match; measure = match; baseline = match; unit = match; value = mismatch | The passage is applicable refuting evidence, not merely a similar source. |
| **Verification state when A and B exist** | `CONTRADICTED` | Evidence A is visibly rejected; Evidence B establishes an incompatible proposition, so Notary cannot render the 17% claim as supported. |
| **Standing** | The decision can be `grounded` only if every in-scope claim carries a visible typed state and evidence boundary | Grounded means the record exposes the status of its reasons. It does not mean the resulting investment decision was wise, fair, or legally sufficient. |

This example contains **two different result states, not one card with a line omitted**:

- **Only Evidence A is available.** Notary says: “This source cannot support the claim—it refers to the market, not Acme. No applicable source was available to check Acme’s FY25 figure.” The result is `UNSUPPORTED` within the defined evidence boundary, or `INDETERMINATE` with the `no_source` flag where no relevant addressable evidence exists. It must not offer a replacement value or imply the Acme figure is false.
- **Evidence A and Evidence B are available.** Notary says both that Evidence A is rejected for entity mismatch and that Evidence B contradicts the claim. The result is `CONTRADICTED`, and a replacement with 12% can be proposed and rechecked.

The reader should see only the evidence relationships that actually occurred. A simple unresolved-source or arithmetic issue earns a simple single-finding card; the richer two-block card is reserved for cases that contain both a rejected attractive candidate and applicable conflicting evidence. **Card complexity scales with the record, not with a fixed template.**

## 6. The authority boundary

Notary's core rule is:

> **A model may propose. A record earns a state only through an evidence-bound procedure.**

The rule applies at both input and verification boundaries.

- A model may propose claim boundaries, decontextualization, candidate evidence, locators, and residual semantic relations.
- A model may not curate the authoritative artifact Notary claims to have checked.
- A model's citation, confidence, paraphrase, or "verified" assertion cannot create `SUPPORTED` or `CONTRADICTED`.
- Only resolved, addressable evidence can create a positive or contradictory evidence state.
- A deterministic procedure assigns the final typed record state after required conditions are met.

This is a hybrid system. Notary does not replace the LLM's synthesising ability; it constrains when synthesis can acquire evidentiary authority.

**Notary is a recorder, not a decider.** Any conversation Notary facilitates — a model proposing a candidate, a model being asked to point to a source it used, even an open-ended exchange a user requests between two models — may be as extensive as it needs to be. None of it is dangerous by itself, because none of it is ever the thing that assigns a state. **The rule does not bend based on how a candidate arrived; it only ever evaluates what arrives.** A specific, structural consequence follows from this: a model may never be the one to reconcile its own proposed sub-answers into a final verdict, even when those sub-answers were independently and honestly derived. Reconciliation — turning several resolved pieces into one typed state — is the deterministic procedure's job alone, every time, with no exception for a well-reasoned model doing it instead.

## 7. The verification procedure

For each in-scope material claim:

1. **Classify.** Exit early where the artifact contains no checkable factual claim.
2. **Decontextualize.** Recover the minimum checkable context without invention.
3. **Bind the evidence set.** Search only the captured, supplied, or otherwise addressable record manifest.
4. **Retrieve candidates.** Retrieve candidates for both support and refutation. Retrieval proposes; it does not establish a result.
5. **Resolve locators.** Resolve each candidate against the stored artifact or structured payload.
6. **Apply deterministic checks.** Check exact quotation, identity, dates, temporal applicability, values, units, baselines, arithmetic, structured fields, and explicit negation.
7. **Assess applicability.** Reject candidates with material mismatch.
8. **Assess residual semantics.** Where literal checks cannot decide, a bounded semantic evaluator assesses only resolved, applicable candidate material.
9. **Assign state.** The deterministic policy maps the evidence boundary, resolved relation, applicability, and method to a typed state. The semantic evaluator never writes final status directly.
10. **Preserve.** Seal the result, evidence boundary, provenance, model/evaluator version, and any uncertainty.

A semantic acceptance threshold may be used only as an experimental, configurable operational threshold. It is not a general calibration claim, and it may never overcome an unresolved locator or material applicability mismatch.

## 8. Correction, revision, and contest

A record whose claim or locator is wrong must not be silently rewritten.

1. **Raise:** a customer, affected person, regulator, or Notary identifies an error.
2. **Classify:** extraction, locator, mapping, source, verification, or ingest error.
3. **Supersede:** write a new version linked to the old record; preserve the original sealed version.
4. **Scope:** identify other records affected by the same mapping or verification defect.
5. **Notify:** identify exports generated from superseded records and record downstream notification.
6. **Render:** make the correction and revision path visible to a reader of either version.

For changed AI text, Notary performs a claim diff. Unchanged claims retain their result only when material context is unchanged. Edited and new factual claims are decontextualized and checked. "Fixed" is not a state; Notary renders the rechecked status of the revised claim.

## 9. Capture and execution modes

The core object is constant. Its execution envelope changes.

### CHECK — explicit, advisory verification

A user asks Notary to check an AI response against evidence already addressable in the working context. CHECK is live, voluntary, and partial by design. It may arrive through a model-mediated host interface. It returns a minimal local result: no issue found within the stated scope, one material issue with exact evidence, or inability to establish the relation.

**CHECK is the interaction that proves the mechanism.** It should feel like a property of an AI answer, not a report the user must read.

### WATCH — scoped observation

Notary receives every in-scope response through a deterministic gateway, SDK middleware, host hook, or equivalent interception architecture. WATCH can make an invocation-coverage claim only because response arrival is enforced by design. It produces operational observations and identifies outputs that may warrant capture.

### CAPTURE — durable decision record

Notary deliberately captures a consequential decision at or around its boundary, preserves the evidence and state available at the time, seals the record, and supports later retrieval, correction, and controlled disclosure. CAPTURE is the authority-bearing enterprise object.

**Named future requirement, not yet built or specified further:** regulated buyers in this category will expect the standard compliance set before evaluating anything else — ISO 27001, GDPR, self-hosting, SSO/MFA, SLAs. This stays a named line item, not a build target, per the discipline of not prematurely abstracting Record/Workforce behavior before there are real callers.

### Coverage is three different things

- **Invocation coverage:** did each in-scope response arrive? Only deterministic interception can establish this.
- **Claim coverage:** which checkable claims in an arrived response were extracted and evaluated?
- **Evidence coverage:** was relevant addressable and applicable material available in the record boundary?

Never collapse these into a single percentage or make silence sound like exhaustive checking.

## 10. Vendor, deployer, and integrated records

A party role is a property of each decision, not a property of an organisation.

- **Vendor:** produced the judgment and generally holds its own reasoning inputs, prompt/configuration, tool responses, and output. It can capture the richest decision-time state but cannot attest to what occurred after handoff.
- **Deployer:** acted on a judgment and holds the business reference, final outcome, and human review, but may not hold the vendor's internal reasoning.
- **Integrated party:** produced and acted on the judgment within the same accountability boundary.

Two parties can hold records for the same business reference. They do not merge their content into a single shared narrative. They record independently captured boundary events and transferred-value commitments. A cross-party reference is a pointer, never a fetch; retention, disclosure, and correction boundaries remain separate.

## 11. Replay language

Notary must be exact about what can be repeated later.

- **Reconstruction** is always the baseline goal: display the captured decision, evidence, states, and corrections.
- **Deterministic recomputation** is available only for customer-controlled logic with captured executable version, dependencies, inputs, policy state, and environment sufficient to run it again.
- **Controlled re-evaluation** runs a declared procedure against preserved or current materials. It may reveal stability, drift, or effect of a change. It is not proof that an arbitrary historical LLM call can be reproduced.

Do not market universal "replay." Use the correct term for the actual capture level.

## 12. The enterprise product

Notary sells the **decision artifact the enterprise already owes**.

Examples include a claim file, utilization-review determination, credit memo, adverse-action rationale, alert-disposition narrative, selection rationale, or suitability record. The buyer is the owner who has to issue, disclose, defend, or reconstruct that artifact—not the person casually interested in AI governance.

The sales question is:

> "Show the last time someone asked for the basis of one AI-assisted decision. What document did you have to produce, which stated reasons did you reconstruct, and what evidence should have been inside it when it was issued?"

A valid first design partner has one decision family, one business reference, a bounded source corpus, a named owner of the artifact, a real reconstruction or disclosure burden, and authority to run a narrow paid pilot.

**Never positioned on price.** A regulated buyer choosing who preserves the record behind a consequential decision does not buy on cost — being the cheapest option is disqualifying for this buyer, not attractive. This is the opposite of CHECK's positioning, deliberately: CHECK leans into being free or near-free as an adoption wedge; the enterprise product is priced and sold on compliance and trust.

## 13. The Claude hook

The consumer/prosumer interaction is:

> **Claude says it. You ask Notary to check it. Notary checks the claim against the evidence available here, shows only a material issue, and lets you revise and recheck.**

This is not the whole enterprise business. It proves the local claim–evidence loop, makes the mechanism understandable, and tests whether checking changes a person's work before they rely on an AI-generated answer. It is valuable only if users repeatedly open evidence, revise or qualify decisions, and return to use it again.

## 14. CHECK — tiered scope and positioning

"Citation checking" undersells the mechanism — a citation is one way to obtain evidence among several (an attached report, spreadsheet, policy, or other bounded working material already present in the conversation). But the mechanism is not yet broad enough to promise everything it could plausibly do as one undifferentiated feature list, so scope is tiered explicitly rather than implied.

**The honest promise, tightened from an earlier draft that overclaimed:** Notary checks the material claims it has evidence to check, and tells you exactly what doesn't hold up. Not "checks the parts that could make you wrong" — coverage is explicitly partial (it only sees the evidence it's given, and only the claims it extracts), and the product's honesty principle depends on never implying more than that.

**"Independent" defined operationally, so it isn't read as more than it is:** a verification service separate from the answer-generation step, using resolved source material and deterministic rules before any semantic evaluator is invoked. It does not mean an independent arbiter of truth, and it does not mean independence from every model provider — that is a claim only the cross-model architecture earns, not something asserted on its own.

### Tier A — V1 scope: build and test first

Already fully covered by the claim → evidence → verification pipeline as specified. The architecture specifies these checks; they have not yet earned "proven" in a live product or benchmark.

1. **Unsupported assertion.** A specific, important claim with no available evidence behind it — not called false, called unestablished (`unsupported`, or `no_source` if nothing relevant was available to check against).
2. **False or misleading source relationship.** The cited material is real but doesn't say what's claimed, or the link doesn't resolve — resolved deterministically: locate the exact passage, or don't.
3. **Right fact, wrong application.** The source says 17%, but it's the market, not Acme; a 2024 policy, not the 2025 one; a subgroup, not the whole population — the applicability gate, one of the most dangerous-to-miss error types because it looks sourced and precise.
4. **Bad quantitative reasoning, scoped to what's deterministically checkable.** Explicit values, units, arithmetic, percentages, thresholds, declared comparisons — checked before any model judgment is invoked. Does not extend to validating arbitrary multi-step analytical reasoning; that remains Tier C.

These four are the actual MVP — what the pitch, the demo, and the first card promise, because they're the only ones the mechanism can deliver reliably today.

### Tier B — near-term roadmap, real but not yet built

5. **Internal contradiction and claim drift.** One paragraph says a product is approved; another says it remains investigational — or an edited sentence's surrounding conclusion no longer follows. This compares a claim to *another claim in the same answer*, not to evidence — a different axis than Tier A, and a reasonable extension of the existing contradiction machinery pointed inward. Worth building next, not worth promising yet.

### Tier C — speculative, do not promise publicly until validated

6. **Overreach beyond the evidence boundary.** The source supports "associated with," the answer says "causes"; the source covers a limited population, the answer gives general advice. Judging gradations of claim strength is a materially harder, fuzzier call than anything in Tier A — exactly what the deterministic-first design exists to avoid depending on, and the category most likely to produce false positives that erode trust. Do not ship this in the pitch or the demo until tested in isolation and shown not to be noisy.

### What to market it as

Not "AI citation checking" — too narrow. **"Notary checks the claims your AI wants you to rely on"** or **"the independent check before you trust AI-generated work,"** with the honest supporting line: *checks important claims against the available evidence, numbers, and dates — and shows you exactly what needs attention.* This earns the category "AI answer quality control," not just citation checking, because Tier A alone already covers more ground than citations — and the category upgrade doesn't require Tier B or C to be true yet.

## 15. The experience

Notary is a property of the artifact, not another artifact a user must read.

- No material issue: remain quiet or give a minimal scope-bounded completion state.
- Material issue: show one local claim, exact evidence, and the reason its state is not positive.
- Question: open the source at the exact locator and show applicability and verification method.
- Correction: show the new revision and rechecked state, never silently alter history.
- Case lookup: search the business reference and open the fixed record, not a generated conversational summary.

No trust score, percentage-verified banner, green badge, or ungrounded dashboard. A reader sees positive evidence, known absence, conflict, and uncertainty in the same register.

## 16. Known limits and external controls

Notary makes failure modes visible; it does not eliminate them.

- **Evidence substitution or locator drift.** Retained payloads, exact resolution, and integrity metadata can expose whether the rendered passage is the preserved one. They cannot recover evidence that was never retained.
- **Wrong-source support.** Applicability checks reject a similar passage when its entity, time, scope, baseline, unit, or other material context does not match. The quality of decontextualization and materiality policy remains a system responsibility that must be tested.
- **Selective capture.** A voluntary CHECK request cannot establish that every relevant output was seen. Only a deliberately enforced capture boundary can support an invocation-coverage claim, and even then the declared scope matters.
- **Temporal leakage.** Preserving decision-time sources and policy versions prevents later material from silently becoming the historical basis. It cannot make an incomplete historical capture complete.
- **Compromised semantic evaluation.** Notary constrains semantic assessment to resolved, applicable residual material and preserves evaluator/version metadata. It does not make any semantic evaluator infallible; unresolved cases must remain `INDETERMINATE`.
- **False attestation, collusion, or fabricated capture.** Identity, authority window, basis, append-only correction lineage, and independent timestamps can raise the cost of deception. They do not establish that an internally consistent record is honest; organisational, legal, and external trust controls remain necessary.

# Part II — Technical contract and implementation appendix

> **Implementation instruction.** This part exists so engineers and AI collaborators can translate the vision into systems without reopening the product's authority claims. It defines the minimum technical objects, invariants, and first-flow acceptance conditions. It must not broaden what Part I says Notary proves. If a technical implementation conflicts with Part I, change the implementation or explicitly amend Part I first.

## 17. Technical appendix: minimum implementation contract

### 17.1 Required entities

```text
Decision
  decision_id, org_id, business_ref, external_refs[], party_role, family
  outcome_ref, occurred_at, sealed_at, evidence_manifest_ref
  decision_time_state, revision, supersedes_ref, integrity_ref

Evidence
  evidence_id, decision_id, kind, origin, payload_ref, payload_hash
  captured_at, effective_from, effective_to, parsed_by, redaction_state

Claim
  claim_id, decision_id, ordinal, text_ref/text_hash, kind
  decontextualized_form, materiality, state, evidence_boundary, method

EvidenceMatch
  match_id, claim_id, evidence_id, locator, resolved_payload_hash
  resolved_quote_or_value, applicability{}, relation, method
  evaluator_version, evaluated_at

Attestation
  attestation_id, claim_id?, decision_id, actor_id, actor_role
  authority_ref, authority_valid_at, basis_ref, created_at

Correction
  correction_id, decision_id, prior_decision_id, reason, scope
  affected_rule_or_mapping_version, notified_at

BoundaryEvent
  event_id, decision_id, direction, counterparty, transferred_value_ref
  provenance_present, limitations_present, recorded_at
```

### 17.2 Invariants

1. A positive or contradictory state requires addressable evidence and an exact resolved locator.
2. Rendered source text equals the retained payload at the locator when payload text is available.
3. A material applicability mismatch cannot support a claim.
4. `UNSUPPORTED` requires a completed defined check over available, applicable evidence.
5. `INDETERMINATE` and `no_source` cannot render as failure, compliance, or success.
6. `CONFLICTED` cannot silently collapse into support in CAPTURE records.
7. No actor or model can directly assign standing.
8. A confirmed mapping is required before automated capture writes decisions from a new data shape.
9. Sealed records are append-only; corrections create linked superseding versions.
10. `business_ref` and aliases resolve only within an organisation boundary.
11. External tool output is candidate material unless its actual payload and locator are captured and re-resolved.
12. Invocation is never coverage; coverage claims name their scope and enforcement mechanism.

### 17.3 Tiered verification path

```text
claim extraction
  → decontextualization
  → bounded candidate retrieval (support + refutation)
  → locator resolution
  → structural + applicability checks
  → residual semantic assessment
  → typed state assignment
  → seal / correction lineage
```

### 17.4 Definition of done for the first real flow

A first decision family is ready only when Notary can:

- ingest or capture a real decision and its business reference;
- preserve the source artifacts that existed at the relevant decision boundary;
- display at least one exact resolved claim–evidence locator;
- reject a topically similar but wrong-entity, wrong-period, wrong-baseline, or wrong-scope candidate;
- preserve `unsupported`, `indeterminate`, `no_source`, and `conflicted` without turning them into positive states;
- issue a fixed record readable at the reference;
- create a superseding correction without editing the historical record; and
- state exactly what the record does and does not establish.

## 18. Open empirical questions

Notary’s central product claims remain hypotheses until the following questions are answered in a benchmark and live decision flows:

1. Does the full claim–locator–applicability procedure reduce false-supported matches relative to cited-RAG and retrieval-plus-judge baselines?
2. Does CHECK cause users to revise work they would otherwise rely on, and do they return to it?
3. Can the same captured record reduce the time and error of producing a decision artifact enterprises already owe?
4. Which decision families provide a paid, repeated artifact-production problem rather than generic interest in AI assurance?
5. Under what capture conditions does deterministic recomputation become possible and useful enough to justify its cost?

The GDR paper carries the scholarly rationale and evaluation protocol for the first question. CHECK pilots and design-partner evidence must answer the remaining product questions.
