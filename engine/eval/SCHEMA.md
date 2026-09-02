# Eval-case schema — DRAFT scaffold, not the gating set

**Status: scaffolding, not the artifact docs/plan.md requires.**

`docs/plan.md`, § Evaluator governance and rollback, requires a **held-out
labeled evaluation set** built via the GDR paper's annotation protocol: two
independent annotators per packet, a written claim-boundary and applicability
guide, blinded adjudication for disagreements, per-class agreement reporting.
That set becomes the standing regression suite that gates every judge
prompt/model change (same section) and supplies the actual numbers for
§ Pre-pilot engine gate (false-supported rate ≤ X%, wrong-source acceptance
= 0, contradiction precision ≥ Y%, no-source integrity = 100%) — currently
left blank in the plan on purpose, until this set exists.

**This directory is not that set.** Two independent human annotators doing
blinded double-annotation is a people/process requirement, not something an
AI agent can substitute for or fabricate. What lives here is the scaffolding
a human annotation team would use to actually build it: a file format, a
guide operationalizing the plan's own applicability rules, an initial batch
of unlabeled/single-draft-labeled candidate cases to react to instead of a
blank page, and a validator. Every case in `draft-cases.json` is either
unlabeled or carries a label explicitly marked `DRAFT — needs independent
second annotation, not yet adjudicated`. None of it may be used to compute
the § Pre-pilot engine gate numbers until real annotation and adjudication
has happened.

## File format

One eval file is a JSON array of `EvalCase` objects (see `draft-cases.json`).
Field shapes reuse existing engine vocabulary rather than inventing a
parallel one:

- `claim_fields` / `evidence_fields` mirror `ClaimFields` / `EvidenceFields`
  in `engine/src/verification/applicability.ts` exactly — same eight fields
  (`entity`, `period`, `metric`, `operator`, `valueUnit`, `comparatorBaseline`,
  `modality`, `scope`), same `ValueUnit { value, unit? }` shape, same
  `operator` closed vocabulary (`increase | decrease | no_change`).
- Annotator `state` labels reuse the four CHECK-visible states from
  `engine/src/verification/stateMachine.ts` / § Verification pipeline step 8:
  `SUPPORTED | CONTRADICTED | UNSUPPORTED | INDETERMINATE`, plus the
  `no_source` flag (a separate boolean in the plan and in `RunReviewResult`,
  not a fifth state value — see `reviewFlow.ts`'s `noSource` field).
- Annotator `reason` reuses `AssignStateResult.reason` values from
  `stateMachine.ts` (`no_source`, `contradicting_applicable_relation`,
  `supporting_applicable_relation`, `no_support_after_completed_checks`,
  `checks_did_not_complete`) where one of those literally applies, or a short
  free-text applicability reason (e.g. `"wrong entity"`, `"unit mismatch"`)
  drawn from `ApplicabilityField` names / `FieldResult.detail` phrasing
  otherwise — never a new incompatible vocabulary.
- `locked_case_type` is an integer 1–18 referencing § Locked test suite's
  numbered list in `docs/plan.md`, or `null` for a genuinely hard/ambiguous
  case added beyond the locked 18 to stress-test the annotation guide itself.

```ts
// Mirrors engine/src/verification/applicability.ts — do not diverge.
interface ValueUnit {
  value: string;
  unit?: string;
}

interface ClaimFieldsLike {
  entity?: string;
  period?: string;
  metric?: string;
  operator?: "increase" | "decrease" | "no_change";
  valueUnit?: ValueUnit;
  comparatorBaseline?: string;
  modality?: string;
  scope?: string;
}

type CheckState = "SUPPORTED" | "CONTRADICTED" | "UNSUPPORTED" | "INDETERMINATE";

// One annotator's independent judgment on one case, produced blind to the
// other annotator's label (§ Evaluator governance and rollback's annotation
// protocol: "two independent annotators per packet ... blinded adjudication
// for disagreements").
interface AnnotatorLabel {
  annotator_id: string;       // pseudonymous id or initials, not a real name
  state: CheckState;
  no_source: boolean;         // true only when state is INDETERMINATE with reason "no_source"
  reason: string;              // see "reuses AssignStateResult.reason" above
  notes?: string;               // free text: what drove the call, edge cases noticed
  labeled_at: string;           // ISO 8601 date
}

interface EvalCase {
  id: string;                              // stable slug, e.g. "wrong-entity-001"
  locked_case_type: number | null;         // 1-18 from § Locked test suite, or null
  status: "draft" | "single_labeled" | "double_labeled" | "adjudicated";

  claim_text: string;                       // the literal sentence as it would appear in answer_text
  claim_fields: ClaimFieldsLike;

  evidence_text: string;                    // the resolved passage as preserved evidence would show it
  evidence_source_type:
    | "web_page" | "pdf_report" | "attachment_excerpt" | "structured_table" | "none";
  evidence_fields?: ClaimFieldsLike;         // optional pre-extracted evidence-side fields, same shape

  // Annotation — 0, 1, or 2 entries depending on `status`. Never more than 2:
  // the protocol is two independent annotators, not an open pool.
  annotations: AnnotatorLabel[];

  // Present only once status is "adjudicated" — a blinded third read (or a
  // documented resolution) when the two annotations disagree, or the
  // single shared label when they agreed outright.
  adjudicated?: {
    state: CheckState;
    no_source: boolean;
    reason: string;
    adjudicator_id: string;
    adjudicated_at: string;
    disagreement_notes?: string;             // required when annotations disagreed
  };

  metadata: {
    added_by: string;          // "draft-scaffold" for every case in this initial batch
    added_at: string;           // ISO 8601 date
    entity_domain: string;      // e.g. "SaaS", "retail", "healthcare" — for coverage tracking
    difficulty: "flagship" | "standard" | "hard_ambiguous";
    source_note?: string;       // where the claim/evidence text was drawn from or how it was constructed
  };
}
```

## What "DRAFT" means in `draft-cases.json`

Every case in the initial batch has `status: "draft"` and `annotations: []`
(no annotator has looked at it yet), OR — for a small number where a single
plausible label is offered to anchor discussion — `status: "single_labeled"`
with exactly one `AnnotatorLabel` whose `notes` field is prefixed
`"DRAFT — needs independent second annotation, not yet adjudicated."` No case
in this file has `status: "double_labeled"` or `"adjudicated"`; those states
exist in the schema for the real set this scaffold is meant to seed, not for
anything produced here.
