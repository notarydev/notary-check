// Typed, allow-listed field normalization (§ Verification pipeline, step 5 —
// Tier A.5). Sits strictly between the judge's raw field extraction and
// applicability.ts's comparator: it changes what counts as "the same value,"
// never who decides applicability or the final state.
//
// The rule, locked by product decision: normalize REPRESENTATION, never
// normalize MEANING. Only forms whose equivalence is explicit, deterministic,
// reversible, and logged get normalized here — every other difference falls
// through to plain safe-syntax comparison and stays a mismatch. This is
// deliberately NOT fuzzy or semantic matching: "gross revenue" must never
// equal "revenue", "Acme plc" must never equal "Acme US", and "FY25" must
// never become a calendar date range. Strict equality on normalized forms is
// the only comparison this module ever performs.

import type { ApplicabilityField, ValueUnit } from "./applicability.ts";

export const NORMALIZATION_RULES = {
  SAFE_SYNTAX_V1: "safe-syntax-v1",
  ENTITY_SUFFIX_V1: "entity-corporate-suffix-v1",
  /** Bridges a present-vs-absent corporate suffix ("Acme" ~ "Acme Corp").
   *  Only fires when exactly ONE side carries a known suffix — see
   *  compareEntityAllowingOptionalSuffix for why that asymmetry is the
   *  safety property, not an implementation detail. */
  ENTITY_OPTIONAL_SUFFIX_V1: "entity-optional-corporate-suffix-v1",
  PERIOD_FISCAL_LABEL_V1: "period-fiscal-label-v1",
  VALUE_PERCENT_V1: "value-percent-v1",
  VALUE_NUMERIC_SEPARATOR_V1: "value-numeric-separator-v1",
  VALUE_DECLARED_MULTIPLIER_V1: "value-declared-multiplier-v1",
  NONE: "none",
} as const;

export type NormalizationRuleId = (typeof NORMALIZATION_RULES)[keyof typeof NORMALIZATION_RULES];

export interface NormalizedValue {
  raw: string;
  normalized: string;
  ruleId: NormalizationRuleId;
}

export interface FieldComparison {
  status: "matched" | "mismatched";
  claimed: NormalizedValue;
  evidence: NormalizedValue;
}

// ---------------------------------------------------------------------------
// Safe-syntax normalization — the only normalization measure, comparatorBaseline,
// modality, and scope ever get. Case, punctuation, whitespace, Unicode form —
// never semantics.
// ---------------------------------------------------------------------------

function safeSyntaxNormalize(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[.,](?=\s|$)/g, "")
    .replace(/\s+/g, " ");
}

export function normalizeSafeSyntax(value: string): NormalizedValue {
  return { raw: value, normalized: safeSyntaxNormalize(value), ruleId: NORMALIZATION_RULES.SAFE_SYNTAX_V1 };
}

// ---------------------------------------------------------------------------
// Entity — safe-syntax plus a fixed table of corporate-suffix spelling
// variants. Never a similarity/alias resolution beyond exact suffix-token
// canonicalization: "Acme plc" and "Acme US" stay distinct strings, because
// "plc" and "us" are different qualifiers, not spelling variants of one
// suffix.
// ---------------------------------------------------------------------------

const CORPORATE_SUFFIXES: Record<string, string> = {
  incorporated: "inc",
  "inc.": "inc",
  inc: "inc",
  corporation: "corp",
  "corp.": "corp",
  corp: "corp",
  company: "co",
  "co.": "co",
  co: "co",
  "l.l.c.": "llc",
  llc: "llc",
  limited: "ltd",
  "ltd.": "ltd",
  ltd: "ltd",
  plc: "plc",
};

function canonicalizeEntitySuffix(safeSyntax: string): { value: string; suffixApplied: boolean } {
  const tokens = safeSyntax.split(" ").filter((t) => t.length > 0);
  if (tokens.length === 0) return { value: safeSyntax, suffixApplied: false };
  const last = tokens[tokens.length - 1];
  const canonical = CORPORATE_SUFFIXES[last];
  if (canonical === undefined) return { value: tokens.join(" "), suffixApplied: false };
  const rewritten = [...tokens.slice(0, -1), canonical].join(" ");
  return { value: rewritten, suffixApplied: true };
}

/**
 * Extensibility seam for a future governed/versioned entity-alias dictionary
 * (e.g. "IBM" <-> "International Business Machines"). Deliberately unwired
 * and always returns null in v1 — no locked test case requires real alias
 * resolution, and a fuzzy/semantic lookup here would violate the "never
 * normalize meaning" rule. Do not wire this up without a real, versioned,
 * governed dictionary behind it.
 */
export function resolveEntityAlias(_value: string): string | null {
  return null;
}

export function normalizeEntity(value: string): NormalizedValue {
  const safe = safeSyntaxNormalize(value);
  const alias = resolveEntityAlias(safe);
  if (alias !== null) {
    return { raw: value, normalized: alias, ruleId: NORMALIZATION_RULES.ENTITY_SUFFIX_V1 };
  }
  const { value: canonical, suffixApplied } = canonicalizeEntitySuffix(safe);
  return {
    raw: value,
    normalized: canonical,
    ruleId: suffixApplied ? NORMALIZATION_RULES.ENTITY_SUFFIX_V1 : NORMALIZATION_RULES.SAFE_SYNTAX_V1,
  };
}

// ---------------------------------------------------------------------------
// Period — safe-syntax plus a narrow LABEL-TEXT canonicalization for fiscal
// year notation. Never calendar-date math: "FY25" and "fiscal 2025" may
// canonicalize to the same label, but nothing here ever infers an actual
// date range, and "calendar 2025" is not a fiscal-year pattern so it never
// collides with "FY25".
// ---------------------------------------------------------------------------

const FISCAL_YEAR_PATTERNS: RegExp[] = [
  /^fy\s*'?(\d{2}|\d{4})$/,
  /^fiscal\s*(?:year\s*)?'?(\d{2}|\d{4})$/,
];

function fiscalYearLabel(safeSyntax: string): string | undefined {
  for (const pattern of FISCAL_YEAR_PATTERNS) {
    const m = pattern.exec(safeSyntax);
    if (m) {
      const digits = m[1];
      const fullYear = digits.length === 2 ? `20${digits}` : digits;
      return `fy${fullYear}`;
    }
  }
  return undefined;
}

/**
 * Extensibility seam for a future issuer-specific fiscal-calendar mapping
 * (e.g. resolving "FY25" to an actual date range from a declared/versioned
 * source profile). Deliberately unwired in v1 — no such mapping exists yet,
 * and guessing one would be exactly the semantic normalization this module
 * is designed never to do.
 */
export function resolveFiscalCalendarMapping(_value: string): { start: string; end: string } | null {
  return null;
}

export function normalizePeriodLabel(value: string): NormalizedValue {
  const safe = safeSyntaxNormalize(value);
  const label = fiscalYearLabel(safe);
  if (label !== undefined) {
    return { raw: value, normalized: label, ruleId: NORMALIZATION_RULES.PERIOD_FISCAL_LABEL_V1 };
  }
  return { raw: value, normalized: safe, ruleId: NORMALIZATION_RULES.SAFE_SYNTAX_V1 };
}

// ---------------------------------------------------------------------------
// Value/unit — percent-notation folding, numeric-separator stripping, and
// explicitly-declared multiplier expansion. The multiplier is spelled out in
// the string itself ("12m" -> "12000000"), which is what makes this textual
// rather than semantic inference. No cross-currency conversion.
// ---------------------------------------------------------------------------

const PERCENT_WORDS = new Set(["percent", "pct", "per cent"]);

function normalizeUnit(value: string | undefined): NormalizedValue {
  if (value === undefined) {
    return { raw: "", normalized: "", ruleId: NORMALIZATION_RULES.NONE };
  }
  const safe = safeSyntaxNormalize(value);
  if (PERCENT_WORDS.has(safe)) {
    return { raw: value, normalized: "%", ruleId: NORMALIZATION_RULES.VALUE_PERCENT_V1 };
  }
  return { raw: value, normalized: safe, ruleId: NORMALIZATION_RULES.SAFE_SYNTAX_V1 };
}

const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  bn: 1e9,
  b: 1e9,
  billion: 1e9,
};

function normalizeValue(value: string): NormalizedValue {
  const safe = safeSyntaxNormalize(value).replace(/^\$/, "");

  // Strip numeric grouping separators (commas/thin-spaces between digit
  // groups of three) so "12,000,000" and "12000000" compare equal.
  const separatorStripped = safe.replace(/[,\s](?=\d{3}(?:\D|$))/g, "");
  if (separatorStripped !== safe && /^\d+(\.\d+)?$/.test(separatorStripped)) {
    return {
      raw: value,
      normalized: separatorStripped,
      ruleId: NORMALIZATION_RULES.VALUE_NUMERIC_SEPARATOR_V1,
    };
  }

  // Explicitly-declared multiplier suffix, e.g. "12m" -> "12000000". The
  // multiplier word is present verbatim in the value being compared — this is
  // textual expansion, not inferred/semantic knowledge.
  const multiplierMatch = /^([\d.]+)\s*(k|thousand|mm|m|bn|b|million|billion)$/.exec(safe);
  if (multiplierMatch) {
    const [, numberPart, unitWord] = multiplierMatch;
    const multiplier = MULTIPLIERS[unitWord];
    const expanded = Number(numberPart) * multiplier;
    if (Number.isFinite(expanded)) {
      return {
        raw: value,
        normalized: String(expanded),
        ruleId: NORMALIZATION_RULES.VALUE_DECLARED_MULTIPLIER_V1,
      };
    }
  }

  return { raw: value, normalized: safe, ruleId: NORMALIZATION_RULES.SAFE_SYNTAX_V1 };
}

export function normalizeValueUnit(vu: ValueUnit): { value: NormalizedValue; unit: NormalizedValue | undefined } {
  return {
    value: normalizeValue(vu.value),
    unit: vu.unit !== undefined ? normalizeUnit(vu.unit) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Entry points — called from applicability.ts in place of its old bare
// normalize() calls. Strict equality on normalized forms only, always.
// ---------------------------------------------------------------------------

const FIELD_NORMALIZERS: Partial<Record<ApplicabilityField, (value: string) => NormalizedValue>> = {
  entity: normalizeEntity,
  period: normalizePeriodLabel,
};

function normalizeStringField(field: Exclude<ApplicabilityField, "valueUnit">, value: string): NormalizedValue {
  const normalizer = FIELD_NORMALIZERS[field];
  return normalizer ? normalizer(value) : normalizeSafeSyntax(value);
}

/**
 * Entity comparison across a PRESENT-vs-ABSENT corporate suffix.
 *
 * WHY THIS EXISTS — locked case 2, root-caused 2026-09-03.
 *
 * The claim side and the evidence side are extracted by different prompts from
 * different texts, and they legitimately disagree on how much of a company's
 * name to include. An answer says "Acme's revenue grew 17%"; the filing says
 * "Acme Corp FY25 results". Both extractions are faithful. Neither is wrong.
 *
 * But `normalizeEntity` canonicalizes the SPELLING of a suffix ("Corporation"
 * -> "corp"), not its PRESENCE — so "acme" and "acme corp" stayed different
 * strings, entity landed in `mismatched`, the whole candidate was ruled
 * inapplicable, and it was dropped before the state machine ever saw it. The
 * live symptom was UNSUPPORTED where CONTRADICTED was correct, on the
 * project's own flagship example. Reproduced 3/3 with the judge extracting
 * every field correctly, including "declined" -> decrease.
 *
 * This is the normal case, not an edge case: answers use short names and
 * primary sources use full legal names ("Apple" vs "Apple Inc.").
 *
 * THE RULE IS DELIBERATELY ASYMMETRIC, and the asymmetry is the safety:
 *
 *   - neither side has a known suffix -> compare as-is.
 *     "market" vs "Acme" still mismatches (locked case 6 — the flagship
 *     wrong-entity distractor — is unaffected).
 *   - BOTH sides have a known suffix  -> compare in full, suffix included.
 *     "Acme Corp" vs "Acme Inc" still MISMATCHES. Those can be genuinely
 *     different legal entities and this function must not merge them.
 *   - exactly ONE side has a known suffix -> compare base names only.
 *     "Acme" == "Acme Corp". This is the only new match, and it is the one
 *     the failure was actually about.
 *
 * Still never a similarity or alias resolution: the suffix must be an exact
 * token in the existing CORPORATE_SUFFIXES table. "Acme Holdings" and
 * "Acme US" keep their qualifiers and continue to mismatch a bare "Acme",
 * because "holdings" and "us" are not corporate suffixes.
 */
function compareEntityAllowingOptionalSuffix(
  claimed: NormalizedValue,
  evidence: NormalizedValue,
): { status: "matched" | "mismatched"; ruleApplied: boolean } {
  if (claimed.normalized === evidence.normalized) return { status: "matched", ruleApplied: false };

  const split = (normalized: string): { base: string; hasSuffix: boolean } => {
    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.length < 2) return { base: normalized, hasSuffix: false };
    const last = tokens[tokens.length - 1];
    // Compare against the CANONICAL suffix values, because `normalized` has
    // already been through canonicalizeEntitySuffix ("Corporation" -> "corp").
    const isSuffix = Object.values(CORPORATE_SUFFIXES).includes(last);
    return isSuffix ? { base: tokens.slice(0, -1).join(" "), hasSuffix: true } : { base: normalized, hasSuffix: false };
  };

  const c = split(claimed.normalized);
  const e = split(evidence.normalized);

  // Exactly one side carries a suffix — and only then.
  if (c.hasSuffix === e.hasSuffix) return { status: "mismatched", ruleApplied: false };
  if (c.base.length === 0 || e.base.length === 0) return { status: "mismatched", ruleApplied: false };

  return c.base === e.base ? { status: "matched", ruleApplied: true } : { status: "mismatched", ruleApplied: false };
}

export function compareField(
  field: Exclude<ApplicabilityField, "valueUnit">,
  claimedRaw: string,
  evidenceRaw: string,
): FieldComparison {
  const claimed = normalizeStringField(field, claimedRaw);
  const evidence = normalizeStringField(field, evidenceRaw);

  if (field === "entity") {
    const { status, ruleApplied } = compareEntityAllowingOptionalSuffix(claimed, evidence);
    // Record the rule on both sides when it fired, so a stored EvidenceMatch
    // shows WHY two differently-written names were treated as one entity.
    // Auditability is the point: this is the one entity rule that can make
    // unequal strings match, so it must never be invisible in the record.
    if (ruleApplied) {
      return {
        status,
        claimed: { ...claimed, ruleId: NORMALIZATION_RULES.ENTITY_OPTIONAL_SUFFIX_V1 },
        evidence: { ...evidence, ruleId: NORMALIZATION_RULES.ENTITY_OPTIONAL_SUFFIX_V1 },
      };
    }
    return { status, claimed, evidence };
  }

  return {
    status: claimed.normalized === evidence.normalized ? "matched" : "mismatched",
    claimed,
    evidence,
  };
}

export interface ValueUnitComparison {
  unitStatus: "matched" | "mismatched";
  valueEqual: boolean;
  claimedNormalized: { value: NormalizedValue; unit: NormalizedValue | undefined };
  evidenceNormalized: { value: NormalizedValue; unit: NormalizedValue | undefined };
}

export function compareValueUnit(claimed: ValueUnit, evidence: ValueUnit): ValueUnitComparison {
  const claimedNormalized = normalizeValueUnit(claimed);
  const evidenceNormalized = normalizeValueUnit(evidence);

  // A claimed unit with no evidence unit at all is a hard mismatch — there is
  // nothing to normalize an absent value against.
  const unitStatus: "matched" | "mismatched" =
    claimed.unit !== undefined && evidence.unit === undefined
      ? "mismatched"
      : claimed.unit !== undefined &&
          evidence.unit !== undefined &&
          claimedNormalized.unit?.normalized !== evidenceNormalized.unit?.normalized
        ? "mismatched"
        : "matched";

  const valueEqual = claimedNormalized.value.normalized === evidenceNormalized.value.normalized;

  return { unitStatus, valueEqual, claimedNormalized, evidenceNormalized };
}
