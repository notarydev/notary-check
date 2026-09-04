// Is an ambiguous field's ambiguity MATERIAL to the verdict?
//
// THE CASE THIS EXISTS FOR, observed live 2026-09-04:
//
//   claim:    "The Statue of Liberty is 500 feet tall."
//   passage:  "Height of copper statue (to torch): 151 feet 1 inch;
//              From ground level to torch: 305 feet 1 inch"
//
// Two readings of the same property, and the passage does not say which the
// claim means. The judge correctly answered `ambiguous`, the field counted as
// unresolved, the candidate became inapplicable, no relation was recorded, and
// the claim landed on INDETERMINATE / checks_did_not_complete.
//
// But neither reading is 500. Whichever the claim meant, it conflicts. The
// ambiguity is real and completely immaterial to the verdict, and the pipeline
// had no way to notice that.
//
// THE RULE. If the claim's value conflicts with EVERY candidate reading, the
// conflict is robust to which reading is meant, and the field is settled as a
// conflict. If ANY candidate would match or cannot be compared, the ambiguity
// stands and the claim remains INDETERMINATE.
//
// The asymmetry is the safety property, and it is the same shape as the
// entity-suffix rule: the permissive direction must be unanimous, and any
// doubt keeps the stricter outcome. Concretely, this must NOT fire on:
//
//   claim:    "revenue grew 17%"
//   passage:  "gross revenue grew 17% ... net revenue grew 12%"
//
// One candidate matches. Which reading is meant decides the verdict, so the
// ambiguity is material and INDETERMINATE is the honest state.
//
// AUTHORITY. Unchanged, and arguably sharpened. The judge still only OBSERVES
// — it reports the readings it saw and is explicitly told not to choose or
// rank them. This module, which is pure code with no model access, DECIDES
// whether they all conflict. Absent candidates (an older prompt version, or a
// model that omits them) every path here returns "material", which is exactly
// today's behaviour.

import { parseValueUnit } from "./valueUnit.ts";
import type { ValueUnit } from "./applicability.ts";

/**
 * parseValueUnit always returns a `value` — the raw string when it found no
 * number — so its output alone cannot tell us whether a numeric comparison is
 * meaningful. This does.
 */
/**
 * The comparable head of a unit string.
 *
 * A compound measurement writes the same unit with extra precision — "151 feet
 * 1 inch" is feet, and refusing to compare it with "500 feet" would defeat the
 * whole rule on the exact case it was built for. So a trailing "<number>
 * <unit>" remainder is dropped.
 *
 * Anything else is left intact, which is the point: "meters squared" does NOT
 * reduce to "meters", so a square measure is never silently compared against a
 * linear one. Only the compound-measurement shape is collapsed.
 */
function unitHead(u: string | undefined): string | undefined {
  if (u === undefined) return undefined;
  // A trailing parenthetical is a conversion note, not part of the unit. The
  // real judge returns "151 feet 1 inch (46 meters)" for exactly the case this
  // rule exists for, and comparing that against "feet" as though the metric
  // conversion were part of the unit made the rule silently do nothing —
  // caught only by running the live judge, since the unit-test fixtures used
  // an idealised "151 feet 1 inch".
  const norm = u
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const compound = /^([a-z]+)\s+\d[\d,.]*\s+[a-z]+s?$/.exec(norm);
  return compound !== null ? compound[1] : norm;
}

function numericOf(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) && v.trim().length > 0 ? n : undefined;
}

export type AmbiguityVerdict =
  /** Every reading conflicts — the field is settled as a conflict. */
  | { material: false; reason: "all_candidates_conflict"; candidateCount: number }
  /** The ambiguity decides the verdict, or we cannot tell. INDETERMINATE stands. */
  | { material: true; reason: "no_candidates" | "candidate_matches" | "incomparable" };

/**
 * Compares one claimed value against every candidate reading of a field.
 *
 * `claimed` is the claim's own asserted value; `candidates` are the competing
 * readings the judge reported. Both are compared as ValueUnits when they parse
 * as such, and as normalized strings otherwise.
 */
export function assessAmbiguity(claimed: string | ValueUnit | undefined, candidates: readonly string[] | undefined): AmbiguityVerdict {
  if (candidates === undefined || candidates.length === 0) {
    // Nothing to compare against. This is the path an older prompt version
    // takes, and it must behave exactly as before.
    return { material: true, reason: "no_candidates" };
  }
  if (claimed === undefined) {
    // The claim asserts nothing for this field, so no candidate can conflict
    // with it. Never treat that as a robust conflict.
    return { material: true, reason: "incomparable" };
  }

  const claimedUnit: ValueUnit | undefined =
    typeof claimed === "string" ? parseValueUnit(claimed) : claimed;

  for (const raw of candidates) {
    const candidate = parseValueUnit(raw);

    const a = numericOf(claimedUnit?.value);
    const b = numericOf(candidate?.value);
    if (a !== undefined && b !== undefined) {
      // Both numeric. A UNIT MISMATCH IS NOT A CONFLICT — "500 feet" against a
      // candidate in metres tells us nothing without a conversion this module
      // deliberately does not perform, so it counts as incomparable and the
      // ambiguity stands.
      const ua = unitHead(claimedUnit?.unit);
      const ub = unitHead(candidate?.unit);
      const unitsComparable = ua === undefined || ub === undefined || ua === ub;
      if (!unitsComparable) return { material: true, reason: "incomparable" };

      if (a === b) return { material: true, reason: "candidate_matches" };
      continue; // this candidate conflicts; keep checking the rest
    }

    // Not both numeric — fall back to exact normalized string comparison.
    // Deliberately strict: anything short of a clear difference must not be
    // read as a conflict, because the consequence of being wrong here is
    // asserting CONTRADICTED on a claim that may be fine.
    const ca = String(typeof claimed === "string" ? claimed : (claimed.value ?? "")).trim().toLowerCase();
    const cb = raw.trim().toLowerCase();
    if (ca.length === 0 || cb.length === 0) return { material: true, reason: "incomparable" };
    if (ca === cb || cb.includes(ca) || ca.includes(cb)) return { material: true, reason: "candidate_matches" };
  }

  return { material: false, reason: "all_candidates_conflict", candidateCount: candidates.length };
}
