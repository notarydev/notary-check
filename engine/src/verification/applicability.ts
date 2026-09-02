// Deterministic claim-field applicability comparator (§ Verification pipeline,
// step 5). It tests whether a resolved evidence excerpt addresses the same
// entity, time/period, scope, metric, operator, value/unit,
// denominator/baseline, and modality as the claim. A material mismatch on ANY field excludes the
// candidate from support even when its wording or number is attractive — that
// strictness is the entire point of this function (the flagship wrong-entity /
// wrong-period / wrong-denominator locked test cases all turn on it).
//
// This is deliberately PURE and DETERMINISTIC: no database, no I/O, no model
// calls, and no fuzzy or semantic matching in this task. Semantic judgment is
// the judge's job, later (§ LLM judge design); the judge's per-field outcomes
// (present / absent / ambiguous / cannot_be_determined) resolve into these same
// structured fields before this comparator runs.
//
// The VALUE is handled differently from the other fields on purpose: a value
// that differs while every other field matches is not a reason the candidate
// fails to apply — it is the reason the candidate CONTRADICTS (§ locked test
// case 2: 17% vs 12%, same entity, period, metric, and baseline; the value
// conflicts). A UNIT mismatch, by contrast, is a material applicability
// failure like any other.

import { compareField, compareValueUnit } from "./normalization.ts";
import type { NormalizationRuleId } from "./normalization.ts";

// The fields tested, exactly per step 5's "entity, time, scope,
// product/population, predicate, value/unit, denominator, baseline/comparator,
// and modality" mapped onto the structured claim-field vocabulary.
export type ApplicabilityField =
  | "entity"
  | "period"
  | "metric"
  | "operator"
  | "valueUnit"
  | "comparatorBaseline"
  | "modality"
  | "scope";

// "metric" is the noun being measured ("revenue", "market share", "headcount")
// — free text, never semantically normalized (§ normalization.ts, locked case
// 10: "gross revenue" must never equal "revenue"). "operator" is the asserted
// direction of change about that metric — deliberately a small CLOSED
// vocabulary (increase | decrease | no_change), extracted directly into that
// vocabulary by both claim and evidence extraction (the judge's already-
// documented "legitimate interpretation" authority covers recognizing "grew"/
// "rose"/"climbed" as "increase" at extraction time). This is what lets
// "revenue grew 12%" and "revenue growth was 12%" compare equal via plain
// string equality — metric="revenue"+operator="increase" in both — without
// ever needing a synonym-matching normalizer for either field.

// The structured fields of one claim as produced by extraction
// (§ Verification pipeline, step 2). This task does NOT implement extraction
// (that is separate, likely model-backed, later work) — these types are the
// deterministic verifier's in-memory input contract, populated from
// already-structured claim data.
export interface ClaimFields {
  entity?: string;
  period?: string;
  metric?: string;
  operator?: string;
  valueUnit?: ValueUnit;
  comparatorBaseline?: string;
  modality?: string;
  scope?: string;
}

// The corresponding fields extracted from one resolved evidence excerpt.
export interface EvidenceFields {
  entity?: string;
  period?: string;
  metric?: string;
  operator?: string;
  valueUnit?: ValueUnit;
  comparatorBaseline?: string;
  modality?: string;
  scope?: string;
}

// A structured value plus its unit, kept separate so a UNIT mismatch is a
// material applicability failure while a VALUE difference is a contradiction.
// "17%" is value "17", unit "%"; "revenue as a share of GDP" would be a
// metric/denominator, not a unit.
export interface ValueUnit {
  value: string;
  unit?: string;
}

export type FieldStatus = "matched" | "mismatched" | "value_conflict";

export interface FieldResult {
  field: ApplicabilityField;
  status: FieldStatus;
  claimed?: string;
  evidence?: string;
  /** why a field did not match, when it did not. */
  detail?: string;
  /** Present only when a normalization rule actually ran a comparison
   * (§ Tier A.5). Comparison metadata only — never rewrites what is
   * displayed; `claimed`/`evidence` above always carry the raw text. */
  normalizedClaimed?: string;
  normalizedEvidence?: string;
  rule?: NormalizationRuleId;
}

export interface ApplicabilityResult {
  /** false when any field materially mismatches (or is unestablished). */
  applicable: boolean;
  /** every field that matched. */
  matched: ApplicabilityField[];
  /** every field that materially mismatched, by exact field name. */
  mismatched: ApplicabilityField[];
  /** true when every applicability field matched but the claimed VALUE differs. */
  valueConflicts: boolean;
  /** per-field detail, one entry per field, for display and logging. */
  fields: FieldResult[];
}

// String-valued applicability fields. valueUnit is handled separately below
// because it is structured (value + unit) and because a value difference is a
// contradiction, not an applicability failure.
type StringField = Exclude<ApplicabilityField, "valueUnit">;
const STRING_FIELDS: StringField[] = [
  "entity",
  "period",
  "metric",
  "operator",
  "comparatorBaseline",
  "modality",
  "scope",
];

function describe(valueUnit: ValueUnit): string {
  return valueUnit.unit !== undefined && valueUnit.unit !== ""
    ? `${valueUnit.value} ${valueUnit.unit}`
    : valueUnit.value;
}

function describeNormalized(normalized: {
  value: { normalized: string };
  unit: { normalized: string } | undefined;
}): string {
  return normalized.unit !== undefined && normalized.unit.normalized !== ""
    ? `${normalized.value.normalized} ${normalized.unit.normalized}`
    : normalized.value.normalized;
}

export function assessApplicability(claim: ClaimFields, evidence: EvidenceFields): ApplicabilityResult {
  const fields: FieldResult[] = [];
  const matched: ApplicabilityField[] = [];
  const mismatched: ApplicabilityField[] = [];
  let valueConflicts = false;

  const claimStrings: Omit<ClaimFields, "valueUnit"> = claim;
  const evidenceStrings: Omit<EvidenceFields, "valueUnit"> = evidence;
  for (const field of STRING_FIELDS) {
    const claimed = claimStrings[field];
    const ev = evidenceStrings[field];
    if (claimed === undefined) {
      // The claim asserts nothing for this field; there is nothing to fail.
      fields.push({ field, status: "matched", claimed, evidence: ev });
      matched.push(field);
    } else if (ev === undefined) {
      // The claim asserts a field the evidence does not address at all — the
      // candidate cannot be established to be about this claim's subject.
      fields.push({
        field,
        status: "mismatched",
        claimed,
        evidence: ev,
        detail: "unestablished: evidence does not address the claimed field",
      });
      mismatched.push(field);
    } else {
      const comparison = compareField(field, claimed, ev);
      if (comparison.status === "matched") {
        fields.push({
          field,
          status: "matched",
          claimed,
          evidence: ev,
          normalizedClaimed: comparison.claimed.normalized,
          normalizedEvidence: comparison.evidence.normalized,
          rule: comparison.claimed.ruleId,
        });
        matched.push(field);
      } else {
        fields.push({
          field,
          status: "mismatched",
          claimed,
          evidence: ev,
          detail: `material mismatch: "${claimed}" vs "${ev}"`,
          normalizedClaimed: comparison.claimed.normalized,
          normalizedEvidence: comparison.evidence.normalized,
          rule: comparison.claimed.ruleId,
        });
        mismatched.push(field);
      }
    }
  }

  const claimedValueUnit = claim.valueUnit;
  const evValueUnit = evidence.valueUnit;
  if (claimedValueUnit === undefined) {
    // The claim asserts no value; nothing to fail.
    fields.push({ field: "valueUnit", status: "matched" });
    matched.push("valueUnit");
  } else if (evValueUnit === undefined) {
    fields.push({
      field: "valueUnit",
      status: "mismatched",
      claimed: describe(claimedValueUnit),
      detail: "unestablished: evidence does not address the claimed value/unit",
    });
    mismatched.push("valueUnit");
  } else {
    const comparison = compareValueUnit(claimedValueUnit, evValueUnit);
    const normalizedClaimed = describeNormalized(comparison.claimedNormalized);
    const normalizedEvidence = describeNormalized(comparison.evidenceNormalized);
    const rule = comparison.claimedNormalized.value.ruleId;
    if (comparison.unitStatus === "mismatched") {
      fields.push({
        field: "valueUnit",
        status: "mismatched",
        claimed: describe(claimedValueUnit),
        evidence: describe(evValueUnit),
        detail: `unit mismatch: "${claimedValueUnit.unit ?? "(none)"}" vs "${evValueUnit.unit ?? "(none)"}"`,
        normalizedClaimed,
        normalizedEvidence,
        rule,
      });
      mismatched.push("valueUnit");
    } else if (!comparison.valueEqual) {
      // Same unit, different value: not an applicability failure — a
      // contradiction. The candidate applies; its value conflicts.
      // Normalization only changes what counts as "the same value" — a
      // genuinely differing figure still lands here, never silently matched.
      fields.push({
        field: "valueUnit",
        status: "value_conflict",
        claimed: describe(claimedValueUnit),
        evidence: describe(evValueUnit),
        detail: `value conflict: "${claimedValueUnit.value}" vs "${evValueUnit.value}"`,
        normalizedClaimed,
        normalizedEvidence,
        rule,
      });
      valueConflicts = true;
    } else {
      fields.push({
        field: "valueUnit",
        status: "matched",
        claimed: describe(claimedValueUnit),
        evidence: describe(evValueUnit),
        normalizedClaimed,
        normalizedEvidence,
        rule,
      });
      matched.push("valueUnit");
    }
  }

  return { applicable: mismatched.length === 0, matched, mismatched, valueConflicts, fields };
}
