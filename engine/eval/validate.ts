// Validator for eval-case files (§ eval/SCHEMA.md). SCAFFOLDING ONLY — this
// checks that a candidate eval-case file is well-formed against the DRAFT
// schema described in SCHEMA.md; it says nothing about whether the file is
// the real held-out labeled set docs/plan.md § Evaluator governance and
// rollback requires (that set only exists once real annotators have done
// blinded double-annotation on material like this).
//
// Deliberately dependency-light and pure: no I/O beyond reading the file
// passed on the command line, no network, no database. Matches the engine's
// existing style (plain functions, node:test for the accompanying tests,
// `.ts` extension imports per tsconfig's allowImportingTsExtensions).
//
// Field vocabulary is intentionally identical to, and imports directly from,
// engine/src/verification/applicability.ts — this file must never invent a
// parallel set of claim/evidence field names.

import { readFileSync } from "node:fs";
import type { ApplicabilityField } from "../src/verification/applicability.ts";

export const CHECK_STATES = ["SUPPORTED", "CONTRADICTED", "UNSUPPORTED", "INDETERMINATE"] as const;
export type CheckState = (typeof CHECK_STATES)[number];

export const OPERATORS = ["increase", "decrease", "no_change"] as const;

export const CASE_STATUSES = ["draft", "single_labeled", "double_labeled", "adjudicated"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const EVIDENCE_SOURCE_TYPES = [
  "web_page",
  "pdf_report",
  "attachment_excerpt",
  "structured_table",
  "none",
] as const;

export const DIFFICULTIES = ["flagship", "standard", "hard_ambiguous"] as const;

// Mirrors ApplicabilityField exactly (§ applicability.ts) minus valueUnit,
// which is structured separately below — same split the source file makes.
const STRING_FIELDS: Exclude<ApplicabilityField, "valueUnit">[] = [
  "entity",
  "period",
  "metric",
  "operator",
  "comparatorBaseline",
  "modality",
  "scope",
];

export interface ValidationIssue {
  caseId: string | null;
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  caseCount: number;
  issues: ValidationIssue[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isIsoDateLike(v: unknown): v is string {
  // Loose on purpose: accept a plain YYYY-MM-DD or a full ISO 8601 timestamp.
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
}

function validateClaimFieldsLike(
  value: unknown,
  caseId: string,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isPlainObject(value)) {
    issues.push({ caseId, path, message: "must be an object" });
    return;
  }
  for (const field of STRING_FIELDS) {
    const v = value[field];
    if (v !== undefined && typeof v !== "string") {
      issues.push({ caseId, path: `${path}.${field}`, message: "must be a string when present" });
    }
  }
  if (value.operator !== undefined && !(OPERATORS as readonly string[]).includes(value.operator as string)) {
    issues.push({
      caseId,
      path: `${path}.operator`,
      message: `must be one of ${OPERATORS.join(" | ")} when present, got ${JSON.stringify(value.operator)}`,
    });
  }
  if (value.valueUnit !== undefined) {
    const vu = value.valueUnit;
    if (!isPlainObject(vu) || !isNonEmptyString(vu.value)) {
      issues.push({ caseId, path: `${path}.valueUnit`, message: "must be { value: string, unit?: string }" });
    } else if (vu.unit !== undefined && typeof vu.unit !== "string") {
      issues.push({ caseId, path: `${path}.valueUnit.unit`, message: "must be a string when present" });
    }
  }
}

function validateAnnotatorLabel(value: unknown, caseId: string, path: string, issues: ValidationIssue[]): void {
  if (!isPlainObject(value)) {
    issues.push({ caseId, path, message: "must be an object" });
    return;
  }
  if (!isNonEmptyString(value.annotator_id)) {
    issues.push({ caseId, path: `${path}.annotator_id`, message: "required non-empty string" });
  }
  if (!(CHECK_STATES as readonly string[]).includes(value.state as string)) {
    issues.push({
      caseId,
      path: `${path}.state`,
      message: `must be one of ${CHECK_STATES.join(" | ")}, got ${JSON.stringify(value.state)}`,
    });
  }
  if (typeof value.no_source !== "boolean") {
    issues.push({ caseId, path: `${path}.no_source`, message: "required boolean" });
  }
  if (value.state === "INDETERMINATE" && value.reason === "no_source" && value.no_source !== true) {
    issues.push({
      caseId,
      path: `${path}.no_source`,
      message: "reason is 'no_source' but no_source flag is not true",
    });
  }
  if (value.no_source === true && value.state !== "INDETERMINATE") {
    issues.push({
      caseId,
      path: `${path}.state`,
      message: "no_source is true but state is not INDETERMINATE (§ stateMachine.ts: no_source always assigns INDETERMINATE)",
    });
  }
  if (!isNonEmptyString(value.reason)) {
    issues.push({ caseId, path: `${path}.reason`, message: "required non-empty string" });
  }
  if (!isIsoDateLike(value.labeled_at)) {
    issues.push({ caseId, path: `${path}.labeled_at`, message: "required ISO 8601 date/date-time string" });
  }
  if (value.notes !== undefined && typeof value.notes !== "string") {
    issues.push({ caseId, path: `${path}.notes`, message: "must be a string when present" });
  }
}

/** Validates one already-parsed eval case object. Pushes issues; never throws. */
export function validateCase(raw: unknown, index: number, issues: ValidationIssue[]): void {
  const path = `[${index}]`;
  if (!isPlainObject(raw)) {
    issues.push({ caseId: null, path, message: "case must be an object" });
    return;
  }
  const caseId = isNonEmptyString(raw.id) ? raw.id : `${path} (missing id)`;

  if (!isNonEmptyString(raw.id)) {
    issues.push({ caseId, path: `${path}.id`, message: "required non-empty string" });
  }

  if (raw.locked_case_type !== null && !(Number.isInteger(raw.locked_case_type) && (raw.locked_case_type as number) >= 1 && (raw.locked_case_type as number) <= 18)) {
    issues.push({
      caseId,
      path: `${path}.locked_case_type`,
      message: "must be an integer 1-18 (§ docs/plan.md Locked test suite) or null",
    });
  }

  if (!(CASE_STATUSES as readonly string[]).includes(raw.status as string)) {
    issues.push({
      caseId,
      path: `${path}.status`,
      message: `must be one of ${CASE_STATUSES.join(" | ")}, got ${JSON.stringify(raw.status)}`,
    });
  }

  if (!isNonEmptyString(raw.claim_text)) {
    issues.push({ caseId, path: `${path}.claim_text`, message: "required non-empty string" });
  }
  validateClaimFieldsLike(raw.claim_fields, caseId, `${path}.claim_fields`, issues);

  if (raw.evidence_text !== null && !isNonEmptyString(raw.evidence_text)) {
    issues.push({ caseId, path: `${path}.evidence_text`, message: "must be a non-empty string or null" });
  }
  if (!(EVIDENCE_SOURCE_TYPES as readonly string[]).includes(raw.evidence_source_type as string)) {
    issues.push({
      caseId,
      path: `${path}.evidence_source_type`,
      message: `must be one of ${EVIDENCE_SOURCE_TYPES.join(" | ")}, got ${JSON.stringify(raw.evidence_source_type)}`,
    });
  }
  // evidence_source_type "none" means no source was ever addressable at all
  // (§ locked case 4) and must pair with a null evidence_text. A null
  // evidence_text with some OTHER source type is also valid, though — it
  // means a source of that type was named/attempted but never resolved
  // (§ locked case 5: broken locator, unavailable fetch) — so only the
  // "none" direction is checked here, not the reverse.
  if (raw.evidence_text !== null && raw.evidence_source_type === "none") {
    issues.push({
      caseId,
      path: `${path}.evidence_text`,
      message: "evidence_source_type is 'none' but evidence_text is not null",
    });
  }
  if (raw.evidence_fields !== undefined) {
    validateClaimFieldsLike(raw.evidence_fields, caseId, `${path}.evidence_fields`, issues);
  }

  if (!Array.isArray(raw.annotations)) {
    issues.push({ caseId, path: `${path}.annotations`, message: "required array" });
  } else {
    if (raw.annotations.length > 2) {
      issues.push({
        caseId,
        path: `${path}.annotations`,
        message: `at most 2 independent annotators per the protocol (§ Evaluator governance and rollback), got ${raw.annotations.length}`,
      });
    }
    raw.annotations.forEach((a, i) => validateAnnotatorLabel(a, caseId, `${path}.annotations[${i}]`, issues));

    // Every DRAFT scaffold case (this file) must be explicitly unadjudicated —
    // never claim to be the real gating set's finished output.
    if (raw.status === "single_labeled" && raw.annotations.length === 1) {
      const note = (raw.annotations[0] as Record<string, unknown>).notes;
      if (typeof note !== "string" || !note.toUpperCase().includes("DRAFT")) {
        issues.push({
          caseId,
          path: `${path}.annotations[0].notes`,
          message: "single_labeled draft cases must carry a note marked DRAFT — needs independent second annotation, not yet adjudicated",
        });
      }
    }
    if (raw.status === "draft" && raw.annotations.length !== 0) {
      issues.push({
        caseId,
        path: `${path}.annotations`,
        message: "status 'draft' implies no annotations yet",
      });
    }
    if (raw.status === "single_labeled" && raw.annotations.length !== 1) {
      issues.push({
        caseId,
        path: `${path}.annotations`,
        message: "status 'single_labeled' requires exactly 1 annotation",
      });
    }
    if (raw.status === "double_labeled" && raw.annotations.length !== 2) {
      issues.push({
        caseId,
        path: `${path}.annotations`,
        message: "status 'double_labeled' requires exactly 2 annotations",
      });
    }
  }

  if (raw.status === "adjudicated") {
    if (!isPlainObject(raw.adjudicated)) {
      issues.push({ caseId, path: `${path}.adjudicated`, message: "required when status is 'adjudicated'" });
    } else {
      const adj = raw.adjudicated;
      if (!(CHECK_STATES as readonly string[]).includes(adj.state as string)) {
        issues.push({ caseId, path: `${path}.adjudicated.state`, message: `must be one of ${CHECK_STATES.join(" | ")}` });
      }
      if (typeof adj.no_source !== "boolean") {
        issues.push({ caseId, path: `${path}.adjudicated.no_source`, message: "required boolean" });
      }
      if (!isNonEmptyString(adj.reason)) {
        issues.push({ caseId, path: `${path}.adjudicated.reason`, message: "required non-empty string" });
      }
      if (!isNonEmptyString(adj.adjudicator_id)) {
        issues.push({ caseId, path: `${path}.adjudicated.adjudicator_id`, message: "required non-empty string" });
      }
      if (!isIsoDateLike(adj.adjudicated_at)) {
        issues.push({ caseId, path: `${path}.adjudicated.adjudicated_at`, message: "required ISO 8601 date/date-time string" });
      }
    }
  } else if (raw.adjudicated !== undefined) {
    issues.push({
      caseId,
      path: `${path}.adjudicated`,
      message: `must be absent unless status is 'adjudicated' (got status ${JSON.stringify(raw.status)}) — this scaffold's draft cases must never look finished`,
    });
  }

  if (!isPlainObject(raw.metadata)) {
    issues.push({ caseId, path: `${path}.metadata`, message: "required object" });
  } else {
    const meta = raw.metadata;
    if (!isNonEmptyString(meta.added_by)) {
      issues.push({ caseId, path: `${path}.metadata.added_by`, message: "required non-empty string" });
    }
    if (!isIsoDateLike(meta.added_at)) {
      issues.push({ caseId, path: `${path}.metadata.added_at`, message: "required ISO 8601 date/date-time string" });
    }
    if (!isNonEmptyString(meta.entity_domain)) {
      issues.push({ caseId, path: `${path}.metadata.entity_domain`, message: "required non-empty string" });
    }
    if (!(DIFFICULTIES as readonly string[]).includes(meta.difficulty as string)) {
      issues.push({
        caseId,
        path: `${path}.metadata.difficulty`,
        message: `must be one of ${DIFFICULTIES.join(" | ")}, got ${JSON.stringify(meta.difficulty)}`,
      });
    }
  }
}

/** Validates a whole eval-case file (already-parsed JSON array). */
export function validateEvalCases(raw: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(raw)) {
    return { valid: false, caseCount: 0, issues: [{ caseId: null, path: "$", message: "file must contain a JSON array of eval cases" }] };
  }
  raw.forEach((c, i) => validateCase(c, i, issues));

  // Duplicate-id check across the whole file.
  const seen = new Map<string, number>();
  raw.forEach((c, i) => {
    if (isPlainObject(c) && isNonEmptyString(c.id)) {
      const prior = seen.get(c.id);
      if (prior !== undefined) {
        issues.push({ caseId: c.id, path: `[${i}].id`, message: `duplicate id, also used at index ${prior}` });
      } else {
        seen.set(c.id, i);
      }
    }
  });

  return { valid: issues.length === 0, caseCount: raw.length, issues };
}

/** Reads and parses a JSON file, then validates it. Throws only on unreadable/malformed JSON. */
export function validateEvalCaseFile(filePath: string): ValidationResult {
  const text = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(text) as unknown;
  return validateEvalCases(parsed);
}

// CLI entry point: `tsx eval/validate.ts eval/draft-cases.json [more files...]`
// Mirrors the engine's other scripts (e.g. migrate.ts) — plain top-level code
// gated behind a direct-execution check, no framework.
function isMainModule(): boolean {
  return process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
}

if (isMainModule()) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: tsx eval/validate.ts <eval-case-file.json> [more files...]");
    process.exit(2);
  }
  let anyInvalid = false;
  for (const file of files) {
    let result: ValidationResult;
    try {
      result = validateEvalCaseFile(file);
    } catch (err) {
      console.error(`${file}: FAILED TO PARSE — ${(err as Error).message}`);
      anyInvalid = true;
      continue;
    }
    if (result.valid) {
      console.log(`${file}: OK — ${result.caseCount} case(s), 0 issues`);
    } else {
      anyInvalid = true;
      console.error(`${file}: ${result.issues.length} issue(s) across ${result.caseCount} case(s)`);
      for (const issue of result.issues) {
        console.error(`  [${issue.caseId ?? "?"}] ${issue.path}: ${issue.message}`);
      }
    }
  }
  process.exit(anyInvalid ? 1 : 0);
}
