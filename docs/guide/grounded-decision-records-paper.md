> Status: reference
> Owner: Hardyk
> Last verified: 2026-09-02
> Supersedes: —

# Grounded Decision Records for Consequential AI
## Claim-level evidence binding as a durable property of a decision record

**Hardyk Mehta**  
Notary AI Research  
August 2026

## Abstract

AI systems increasingly participate in decisions that affect people, accounts, transactions, and organisations. When one of these decisions is later challenged, the practical question is not only what system ran, but what was decided in the case at issue, which reasons were stated, what material was available at the time, and what can be established about the relation between each reason and that material. Existing provenance and accountability research addresses information flow and distributed responsibility; claim-verification research addresses evidence retrieval and claim–evidence relations; decision-receipt systems address durable integrity and replay of preserved decision context. Each contributes a necessary part of the problem, but none by itself specifies claim-level evidentiary grounding as a durable property of a case-addressable decision record. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:4-22</citations>

This paper proposes the **Grounded Decision Record (GDR)**: a persistent representation of one consequential decision in which each material claim is linked to addressable evidence, an exact locator, a claim-relevant applicability assessment, provenance, and a typed verification state. Models may propose claim boundaries, candidate passages, or residual semantic relations. They cannot, by assertion alone, confer a positive state. A conformant procedure must resolve the cited locator against preserved evidence, check applicable structural dimensions, preserve uncertainty and conflicts, and make the basis for its final recorded state inspectable. The GDR is deliberately not a truth, fairness, or legality adjudicator. It records a defined relationship between a claim and an evidence set, and it records when that relationship cannot be established. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

The contribution is a formal record model, a state taxonomy, an authority discipline, a cross-party boundary model, and an evaluation protocol for testing whether grounded records reduce false evidence matches and improve individual-decision review. This is a design and evaluation-protocol paper; it reports no experimental results. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

## 1. Introduction

Production AI can be observable without being reviewable at the level where a challenge occurs. A model invocation may yield a trace; an agent may yield a session; a governance programme may yield controls and approvals; a provenance system may describe information flow. These artifacts are useful, but they answer different questions from the one raised by a specific claim, application, transaction, or case. Decision-provenance research has long argued that data flows through interconnected systems must be made visible for accountability; algorithmic supply chains add the problem of distributed responsibility, incomplete visibility, and cross-organisational boundaries. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5</citations>

The narrower question is: **for this decision, what did the system assert as its basis; what evidence was available at the relevant time; where is it; and what relationship between the assertion and the evidence can an independent reader reproduce?** A durable hash can establish that a record has not changed. It cannot establish that a stated reason is supported by the evidence the system had. Conversely, a live claim-verification system can attach or repair citations, but often does not preserve a case-addressable, decision-time object for later review. RARR, for example, uses web research and revision to improve attribution in generated text; it is not a durable decision-record model. <citations>_wehavZA:1-5</citations>

The GDR joins these concerns without claiming to replace them. It is a compositional claim-level layer over a decision record. It preserves the evidence boundary and exact locators needed to inspect a stated reason later; it distinguishes structural checks from probabilistic semantic assessment; and it makes correction and supersession part of the record rather than an undocumented edit. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

### 1.1 Contributions

1. A formal model for a persistent, business-reference-addressable decision record whose internal unit of inspection is the claim–evidence relation.
2. An authority discipline that separates proposal by an AI model, independently reproducible structural checks, bounded semantic assessment, and named human attestation.
3. A verification taxonomy that keeps `SUPPORTED`, `UNSUPPORTED`, `CONTRADICTED`, `CONFLICTED`, `INDETERMINATE`, and `ATTESTED` distinct, while treating the absence of usable source material as an explicit evidence-boundary flag.
4. An applicability model that prevents a clean locator for the wrong subject, period, scope, measure, baseline, or modality from being mistaken for support.
5. A cross-party boundary model, correction/supersession rules, and an evaluation protocol designed to test false-positive evidence matches, reviewability, cost, and calibration. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

## 2. Problem formulation

### 2.1 Consequential decisions

A **consequential decision** is a determination or action attributable to an identified party that materially affects a person, organisation, asset, account, transaction, or protected object, and for which later operational, contractual, regulatory, or dispute review may matter. The definition is intentionally broader than any one jurisdiction’s legal category. Its operational limit is not the label “AI,” but the presence of a stable decision boundary, a case identifier, an accountable party, and evidence whose availability can be bounded. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

### 2.2 The decision is the unit

A GDR is keyed to the identifier a later reader will use: an application, claim, case, transaction, account, or order reference. A trace identifier is useful implementation evidence, but it is not necessarily the identifier used by an affected person, reviewer, or dispute process. The record may include traces and spans; it is not organised around them. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

A single decision can contain several propositions. An employment screening rationale might assert that an applicant lacks supervisory experience, that the role requires it, and that a policy therefore requires rejection. A claim-adjudication rationale might assert that a policy was in force, that a loss is covered, and that a deductible does not apply. These claims can rely on different artifacts and fail independently. They must therefore be separately inspectable. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

### 2.3 Scope and non-claims

The GDR does **not** establish that a source is true, that the underlying decision was correct, fair, lawful, or wise, or that all potentially relevant evidence was captured. Its positive states are statements about defined relations within a bound evidence set. This distinction follows a broader lesson from evidence attribution: citation correctness and citation faithfulness are different properties, and attached citations may be post-rationalized rather than genuinely evidentiary. <citations>84ft7xMQ:1-6</citations>

The GDR also does not promise universal reproducibility. It distinguishes:

- **Reconstruction:** inspection of a preserved historical record;
- **Deterministic recomputation:** re-execution only when executable decision logic, dependencies, and relevant state are actually captured and runnable; and
- **Controlled re-evaluation:** a declared later run that may show stability or change but is not historical reproduction. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

## 3. Related work and position

### 3.1 Provenance, reviewability, and supply chains

Decision provenance proposes data-flow visibility as a basis for accountability in interconnected systems. <citations>ysqWwQrg:1-6</citations> Work on algorithmic supply chains shows why responsibility and visibility become difficult once systems are built, deployed, and used by different actors across organisational and jurisdictional boundaries. <citations>dkX0FGqw:0-5</citations> GDRs draw on this lineage but specialise the record around a case-level decision and the claims asserted as its basis.

### 3.2 Claim verification and attribution

Fact verification commonly separates evidence retrieval from claim verification. Retrieval quality is not an implementation detail: semantic-similarity heuristics can retrieve task-irrelevant evidence and degrade verification. <citations>s5RmLoBw:0-6</citations> Work on retrieval-augmented attribution and revision demonstrates the feasibility of decomposing generated text, locating candidate sources, and revising unsupported statements. <citations>_wehavZA:1-5</citations> PaperTrail further demonstrates a claim–evidence interface for scholarly Q&A, but its user study found that greater caution did not necessarily reduce reliance when users faced cognitively burdensome work. <citations>UvKkhTDg:0-6</citations>

The GDR adopts claim-level evidence inspection but changes the object and authority condition. The object is a preserved decision record, not only a live answer. The evidence set is time-bounded and preserved. The output includes an exact locator and applicability assessment, not merely an attached citation. The state belongs to the record and is independently re-inspectable. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

### 3.3 Decision receipts and execution integrity

Public decision-receipt specifications already bind a decision, actor, policy snapshot, evidence references, integrity hash, signature, and verification metadata into a durable portable artifact. MeshQu’s published specification is a concrete example: it describes integrity, signature, manifest, policy-snapshot replay, and chain verification, while explicitly distinguishing these properties from correctness, policy quality, and fairness. <citations>AR-_wCXQ:4-22,104-160,163-235,297-318</citations>

This is valuable prior art, and it makes a narrow distinction necessary. A receipt may bind an evidence manifest by digest and prove that the manifest has not changed; it need not say whether a particular sentence in the decision is supported by an applicable passage in that evidence. A GDR adds the claim–exact passage–applicability–state relation. It can consume an integrity-verified receipt as an evidence object, preserving its external integrity metadata rather than replacing it. <citations>AR-_wCXQ:104-160</citations>

Other public decision-record specifications reinforce the need to state the distinction precisely. AgDR, for example, specifies cryptographic and governance invariants for AI inference records, including contextual provenance, atomic commit-before-output behavior, serialization, and conformance rules. <citations>4fZFAWwA:21-35,47-73,93-105</citations> Those are important capture and integrity properties. They do not, in the public specification reviewed here, define a typed semantic relation between each reason stated in a decision and an exact applicable evidence passage. The GDR should therefore be read as a claim-grounding layer that may compose with such record formats, not as a substitute for their integrity guarantees.

### 3.4 Model-as-judge

Semantic assessment remains useful when literal or structured comparison cannot determine whether a passage entails a claim. It is not an independent authority. In domain-specific tasks, subject-matter experts and LLM judges agreed only 68% of the time in dietetics and 64% in mental-health preference judgments in one mixed-methods study, with variation across aspects. <citations>-jyj30cQ:0-8</citations> The GDR therefore allows semantic judgment only over a bounded, resolved candidate set and records its method and uncertainty. It does not turn a model’s confidence or inter-model agreement into proof.

## 4. The Grounded Decision Record

### 4.1 Formal object

Let a record be:

$$
GDR = (d, b, o, C, E, M, P, H, O, T, I, R)
$$

where:

- $$d$$ is a stable decision identifier and $$b$$ its business-facing reference;
- $$o$$ is the recorded outcome or action;
- $$C$$ is the set of claims asserted as part of the decision basis;
- $$E$$ is the set of addressable evidence artifacts available within the record boundary;
- $$M$$ is the set of claim–evidence match relations;
- $$P$$ is provenance and source-continuity information;
- $$H$$ is human oversight and attestation information;
- $$O$$ is the set of applicable obligations and their mappings where used;
- $$T$$ is decision-time state, including relevant timestamps and versions;
- $$I$$ is integrity and sealing metadata; and
- $$R$$ is the append-only revision and correction relation. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

An evidence artifact $$e \in E$$ contains, at minimum, an identifier, kind, capture or receipt time, payload reference or digest, origin, and any effective-time range known to the record. The payload must be addressable for it to support or contradict a claim. A model-generated paraphrase of a source is not evidence merely because it appeared in the decision process. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

### 4.2 Claims, locators, and matches

A claim $$c \in C$$ has a stable ordinal, text or protected-text reference, kind, and material context. **Decontextualization** restores only the minimum referent, subject, time frame, comparison, baseline, unit, and modality needed to make the claim independently checkable. If that context cannot be recovered without invention, the claim cannot receive a positive automated state. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

A match is:

$$
m = (c, e, l, q, a, r, \mu, \pi)
$$

where $$l$$ is a locator, $$q = resolve(e,l)$$ is the exact resolved evidence text or structured value, $$a$$ is applicability, $$r$$ is the relation assessment, $$\mu$$ is the verification method, and $$\pi$$ preserves provenance and evaluator/version metadata. A locator may be a character range, JSON path, page-plus-bounding-box, timestamp range, or other canonical offset into the evidence artifact. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

**Locator integrity invariant.** A record must never render generated evidence text in place of a resolvable source passage. Where text is available, the displayed quotation must equal the payload at the recorded locator. If the locator does not resolve, the match cannot supply support or contradiction. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

### 4.3 Applicability is separate from resolution

Locator resolution establishes where a passage occurs. It does not establish that the passage bears on the claim. Each match must therefore carry an applicability assessment for the dimensions material to the claim: <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

- subject/entity;
- asserted time and evidence effective time;
- scope, population, jurisdiction, or product where relevant;
- predicate or measure;
- value and unit where relevant;
- comparator or baseline where relevant; and
- modality or qualification where material. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

Each dimension is `match`, `mismatch`, `not_applicable`, or `indeterminate`. A materially mismatched relation cannot support a claim merely because it is semantically similar. This requirement directly addresses a central retrieval failure mode: false claims containing distracting entities make retrieval of refuting evidence harder than retrieval of support. <citations>_9z7vAvw:0-8</citations>

### 4.4 Verification states and evidence boundary

The six claim states are evidentiary states, not legal or normative judgments:

- **SUPPORTED:** at least one resolved, applicable relation establishes the claimed support relationship under the declared procedure.
- **UNSUPPORTED:** the procedure completed over available, applicable evidence and established no supporting relation.
- **CONTRADICTED:** resolved, applicable evidence establishes an incompatible proposition.
- **CONFLICTED:** multiple resolved, applicable evidence artifacts materially disagree, and no declared, reviewable evidence-priority rule resolves the conflict.
- **INDETERMINATE:** the procedure could not establish the relevant relation—for example, because a locator cannot be resolved, evidence is unavailable after retention, material applicability cannot be determined, or semantic assessment does not meet the configured acceptance criterion.
- **ATTESTED:** a named human records a basis after automated methods did not resolve the claim. It is an attestation state, not evidence-derived support, and must identify the actor, authority, timestamp, and stated basis. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

`no_source` is a separate **evidence-boundary flag**. It means no relevant addressable evidence was available in the record’s defined evidence set. It suppresses any suggestion that absence of support was established by a completed search. It is distinct from `UNSUPPORTED` and from `INDETERMINATE`. <citations>s5RmLoBw:0-6,AR-_wCXQ:163-235</citations>

**Claim-state precedence.** Subject to the `no_source` boundary flag, a claim state is derived from resolved, applicable relations in this order:

1. **CONTRADICTED** if any admissible relation establishes an incompatible proposition.
2. **CONFLICTED** if admissible evidence artifacts materially disagree and no declared, reviewable evidence-priority rule resolves the disagreement.
3. **SUPPORTED** if at least one admissible relation establishes support.
4. **UNSUPPORTED** if the defined procedure completed over available, applicable evidence and established no support.
5. **ATTESTED** if automated procedures did not resolve the claim and a named human supplied a recorded basis.
6. **INDETERMINATE** otherwise, including unresolved locators, unavailable retained content, unresolved material applicability, or a residual semantic assessment that does not meet the configured acceptance criterion. <citations>s5RmLoBw:0-6,-jyj30cQ:0-8</citations>

This ordering prevents a supportive passage from masking contradiction or conflict. `ATTESTED` remains a distinct provenance-bearing state and cannot silently upgrade a claim to `SUPPORTED`. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

### 4.5 Verification methods and authority

A record distinguishes the relation state from the method that established or proposed it:

- **quoted_or_computed:** direct quotation, structured equality, date/value/unit comparison, or reproducible derivation;
- **entailed:** bounded semantic assessment over an exact resolved candidate passage;
- **attested:** a named human basis; and
- **unresolved:** no admissible relation was established. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

The system must apply the least probabilistic method capable of resolving the relation. Structural checks occur before semantic assessment: artifact existence, schema validity, hash equality, locator resolution, identity, temporal applicability, and structured/numeric comparison. Only the unresolved residue reaches the semantic stage. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

A semantic model may propose a relation; it cannot write the final record state. A policy procedure records the final state only after verifying its required conditions. Where a semantic acceptance threshold is used, it is a configurable and experimental operating threshold, not a universal confidence calibration. It must be stored with the evaluation version and cannot convert an unresolved locator or an applicability mismatch into `SUPPORTED`. <citations>-jyj30cQ:0-8</citations>

#### Algorithm 1. Evidence-bound claim resolution

```text
resolve_claim(claim, evidence_manifest, policy):
  candidates := retrieve_support_and_refutation(claim, evidence_manifest)
  resolved := resolve_locators_against_preserved_payloads(candidates)
  applicable := retain_only_materially_applicable(resolved, claim)
  structural := evaluate_structural_relations(applicable, claim)
  residual := relations_not_decided(structural)
  semantic := assess_semantics_only_over(residual, claim, policy.evaluator)
  relations := validate_locator_and_applicability(structural ∪ semantic)
  return state_by_precedence(relations, evidence_manifest, policy)
```

`state_by_precedence` is the only procedure permitted to write a claim state. It first records `no_source` when the defined evidence boundary contains no relevant addressable artifact; it then applies the ordered rule in Section 4.4. A proposed relation with an unresolved locator or material applicability mismatch is discarded rather than downgraded into a positive state. The procedure must preserve candidates considered, resolved locators, applicability assessments, evaluator/version metadata, and the reason for any indeterminate result. The algorithm is normative about authority and record content, not prescriptive about the retrieval model, semantic evaluator, storage system, or cryptographic scheme. <citations>s5RmLoBw:0-6,-jyj30cQ:0-8</citations>

### 4.6 Corrections and supersession

A durable record must make its own errors durable. A sealed version cannot be edited in place. If extraction, mapping, locator, source, or verification error is identified, the system creates a new superseding version that names the earlier version and correction reason. The earlier record remains retrievable as the historical artifact; downstream exports created from it can be identified for notification. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

A revised AI output requires claim-diff handling. Retained claims preserve prior results only when their material context is unchanged. Edited claims are rechecked. New factual claims have no positive state until checked. A system must not assert “fixed” merely because an edit was proposed; it may report only the rechecked state of the affected claim. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

### 4.7 Party boundaries

A GDR belongs to the party that captured and can attest to its contribution. A vendor may hold the model inputs, tools, prompt/configuration state, and produced rationale; a deployer may hold the business reference, final outcome, and human review. These are not interchangeable epistemic positions. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

Cross-party interoperability therefore uses independently captured boundary events and commitments to transferred values, not a merged cross-party narrative. Records may refer to a common business reference while retaining separate evidence, retention, and authority boundaries. This responds to supply-chain accountability gaps without turning one party’s record into an unverified assertion about another party’s conduct. <citations>dkX0FGqw:0-5</citations>

## 5. Threat model and non-goals

The GDR makes several threats visible; it does not eliminate them.

- **Evidence substitution or locator drift:** address through content hashes and exact resolution against preserved payloads.
- **Wrong-source support:** reject candidates with a material applicability mismatch even when wording or values are similar.
- **Selective capture:** detect only through scope/invocation monitoring; a voluntary tool call is not coverage.
- **Temporal leakage:** preserve decision-time artifact and policy versions; later material may not silently reconstruct the historical basis.
- **Compromised semantic evaluator:** prevent it from overriding structural checks, retain its version and inputs, and route uncertainty to `INDETERMINATE` rather than `SUPPORTED`.
- **False or unauthorised human attestation:** record actor identity, authority window, basis, and time; do not treat attestation as machine-established support.
- **Collusion or fabricated capture:** recognise that internally consistent records may still be dishonest absent independent timestamping, trust roots, or organisational controls. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

The format does not prescribe a single storage system, cryptographic primitive, retrieval model, semantic model, or user interface. It specifies the evidence and state properties a conformant record must expose. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

## 6. Evaluation protocol

### 6.1 Research questions

The empirical programme asks:

- **RQ1:** Does a GDR improve accuracy and time-to-answer for individual-decision review relative to transcripts, traces, and session-level evaluation output?
- **RQ2:** What proportion of claims can be resolved by structural and deterministic checks without semantic-model calls?
- **RQ3:** Does bounded candidate retrieval plus applicability gating reduce false-supported outcomes relative to retrieval-plus-judge or full-session judge baselines?
- **RQ4:** Does preserving `CONFLICTED`, `INDETERMINATE`, and `no_source` reduce inappropriate positive states?
- **RQ5:** Can the same captured record support operational quality, compliance, and investigation views without duplicating capture or obscuring the record boundary? <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

### 6.2 Benchmark design

The proposed **Decision Evidence Benchmark** contains decision packets rather than isolated claims. Each packet includes a business reference; a stated outcome; claimed reasons; a bound evidence manifest; preserved artifacts; candidate and gold locators; decision-time/effective-time metadata; applicability labels; evidence-state labels; and where relevant a correction or revised-output pair. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

The initial benchmark must include, at minimum:

1. direct support;
2. direct contradiction;
3. no supporting evidence after completed checking;
4. no relevant addressable source in the bound set;
5. unavailable/erased or unresolved evidence;
6. applicable-source conflict;
7. wrong subject/entity;
8. wrong period or stale policy version;
9. wrong unit, denominator, comparator, or baseline;
10. semantically similar distractors; and
11. repairs that introduce new or altered factual claims. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

The wrong-source distractor is a required acceptance case. A passage about a different entity or period that contains the answer’s attractive number cannot be counted as support. The benchmark should annotate claim relevance dimensions explicitly, rather than treating the label as an uninspectable holistic judgment. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

### 6.3 Annotation and data governance

Annotation must distinguish the evidence relationship from the substantive correctness of the decision. Annotators label only what the defined evidence set establishes. They do not label whether an insurer, lender, employer, or clinician made the right decision. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

The protocol should use at least two independent annotators for each packet, a written claim-boundary and applicability guide, blinded adjudication for disagreements, and per-class agreement reporting. Pilot data should determine final sample size and power; this paper does not assert a fixed benchmark size or effect size before a pilot establishes plausible error rates. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

Because consequential decision artifacts may contain sensitive data, the public benchmark should use synthetic or lawfully releasable, de-identified packets. The reference implementation must retain enough evidence text and locator information for independent reproduction of every published label. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

### 6.4 Baselines and ablations

Evaluate identical packets with a fixed model family where model use is compared:

- **B0: human review of ordinary artifacts** — transcript, trace, or case documents without claim-level evidence structure;
- **B1: full-context model judge** — a model assesses the complete decision context;
- **B2: retrieve plus model judge** — candidate retrieval followed by semantic assessment;
- **B3: deterministic-first GDR** — structural resolution and computation, semantic assessment only for residual cases;
- **B4: full GDR** — B3 plus applicability gating, support-and-refutation retrieval, conflict handling, evidence-boundary flag, correction/diff handling, and human-attestation representation. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

The principal comparison is not generic accuracy. It is the false-supported rate: a claim recorded as `SUPPORTED` despite missing, unresolved, or materially inapplicable evidence. Secondary outcomes are state precision/recall by class, locator validity, applicability-match accuracy, contradiction recall, abstention quality, claim coverage, model calls, latency, and cost per decision. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

### 6.5 Human review study

For RQ1, reviewers should answer standardised questions about a specific decision: what was decided, which stated reason was unsupported or contradicted, which evidence was available at decision time, what a reviewer saw, and whether a corrected version superseded the original. Measure correctness, time-to-answer, evidence located, and confidence calibration. Do not treat increased distrust alone as a successful outcome: claim-evidence interfaces can make users more cautious while leaving reliance unchanged. <citations>UvKkhTDg:3-6</citations>

## 7. Interoperability

GDRs are designed to compose with existing systems. An implementation should be able to ingest a signed execution packet or decision receipt, preserve its integrity and signature metadata, treat it as a bounded evidence artifact, attach claims to exact locators in its payload where permitted, and export a GDR without invalidating the original verifier. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

A minimal interoperability test should show that an independent verifier can: (1) validate the external artifact under its own rules; (2) resolve the GDR locator to the referenced bytes or structured value; (3) inspect the GDR applicability and state; and (4) distinguish what the external artifact proves from what the GDR relation adds. Integrity-verified external records remain complementary prior art, not evidence of claim support by themselves. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

## 8. Privacy, correction, and ethical constraints

A decision record can increase both accountability and the persistence of sensitive personal information. Implementations need access controls, minimisation, retention rules, contestation channels, and separation between durable structural metadata and erasable content. Deletion must not create a fictional continued ability to inspect deleted material: the record may retain a structural history, but it must visibly state that the payload is no longer available for independent review. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

Positive states create a specific risk of false authority. `SUPPORTED` must never render as “true,” “legal,” “fair,” or “compliant.” The record should make evidence boundaries, conflicts, and corrections as visible as positive matches. A system that turns indeterminacy into compliance or absence of support into fault would misuse the record’s authority. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

## 9. Limitations

First, semantic evidence support is not truth. A passage can entail a claim while being false, incomplete, stale, or improperly authoritative. Second, an applicability assessment may itself require domain knowledge and can remain indeterminate. Third, the decision boundary is domain-specific and must be governed by a documented boundary rule rather than assumed to be machine-detectable. Fourth, cross-party evidence depends on cooperation and compatible identifiers; a no-join design preserves honesty but cannot supply reasoning a party never captured. Fifth, deterministic recomputation is exceptional for LLM-mediated decisions unless complete executable dependencies are preserved. Sixth, all empirical performance claims remain hypotheses until the benchmark and study are completed. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

## 10. Discussion and conclusion

Decision records, claim verification, and execution integrity are all necessary but insufficient in isolation. The GDR proposes a narrow join: a durable, case-addressable record in which the evidentiary basis of each stated reason is inspectable as a first-class object. Its central discipline is not that a model never participates; models can efficiently propose claim boundaries and candidate relations. The discipline is that model proposals do not become positive evidence states without a preserved artifact, an exact resolved locator, claim-relevant applicability, and a declared verification procedure. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

The contribution is deliberately conservative. A GDR cannot establish universal truth or legal correctness. It can make an individual decision easier to examine without rebuilding the past from opaque logs, generated summaries, or organisational memory. It can preserve where support was found, where evidence was absent, where sources conflicted, and where a human—not an algorithm—supplied a basis. The benchmark and evaluation protocol provide the appropriate next test: whether this discipline reduces false evidence matches and improves decision-specific review enough to justify its operational cost. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

## Competing interests

This work was conducted at Notary AI Research. The author has a commercial interest in systems that implement decision-evidence and verification infrastructure. The proposed GDR format, benchmark, and reference verifier are intended to be open and independently inspectable; any production verification service is a separate implementation. No external funding sponsored this work. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

## Use of generative AI in preparation

Generative AI was used as an assistive tool for drafting, organisation, and literature synthesis. The author is responsible for the technical claims, definitions, and interpretation. Any venue-specific disclosure requirements should be followed at submission. <citations>ysqWwQrg:1-6,dkX0FGqw:0-5,s5RmLoBw:0-6,AR-_wCXQ:104-160</citations>

## References

- Singh, J., Cobbe, J., & Norval, C. *Decision Provenance: Capturing data flow for accountable systems* (2018). <citations>ysqWwQrg:0-6</citations>
- Cobbe, J., Veale, M., & Singh, J. *Understanding accountability in algorithmic supply chains* (2023). <citations>dkX0FGqw:0-5</citations>
- Zheng, L., Li, C., Zhang, X., et al. *Evidence Retrieval is almost All You Need for Fact Verification* (2024). <citations>s5RmLoBw:0-6</citations>
- Gao, L., Dai, Z., Pasupat, P., et al. *RARR: Researching and Revising What Language Models Say, Using Language Models* (2023). <citations>_wehavZA:0-5</citations>
- Wallat, J., Heuss, M., de Rijke, M., & Anand, A. *Correctness is not Faithfulness in Retrieval Augmented Generation Attributions* (2025). <citations>84ft7xMQ:1-6</citations>
- Martin-Boyle, A., Leckey, C., Brown, M., & Kaur, H. *PaperTrail: A Claim-Evidence Interface for Grounding Provenance in LLM-based Scholarly Q&A* (2026). <citations>UvKkhTDg:0-6</citations>
- Szymanski, A., Ziems, N., Eicher-Miller, H., Li, T. J.-J., Jiang, M., & Metoyer, R. *Limitations of the LLM-as-a-Judge Approach for Evaluating LLM Outputs in Expert Knowledge Tasks* (2024). <citations>-jyj30cQ:0-8</citations>
- Dong, M., Christodoulopoulos, C., Shih, S.-M., & Ma, X. *Robust Information Retrieval for False Claims with Distracting Entities in Fact Extraction and Verification* (2021). <citations>_9z7vAvw:0-8</citations>
- MeshQu. *Decision Receipt Specification*, v2 (accessed 2026). <citations>AR-_wCXQ:4-22,104-160,163-235,297-318</citations>
- Genesis Glass Foundation. *AgDR Specification*, v0.2 draft (2026). <citations>4fZFAWwA:21-35,47-73,93-105</citations>
