// Deterministic split of a value string into a ValueUnit.
//
// WHY THIS IS ITS OWN MODULE, IN verification/.
//
// This function used to live in judge/fieldExtraction.ts, and
// verification/immaterialAmbiguity.ts imported it from there. That made
// verification/ — the deterministic bottom layer, the one place a model's
// output is never trusted — depend on the module whose entire job is calling a
// model. The dependency was type-safe and behaviourally harmless (the function
// is pure, does no I/O, and calls nothing), but the DIRECTION was wrong, and
// direction is the property the layering exists to guarantee: verification/
// must be readable and auditable without reading any judge code, because
// "a model may propose, only an evidence-bound procedure decides" is enforced
// by that separation and nothing else.
//
// scripts/check-boundaries.ts now fails the build on verification/ → judge/,
// so this file is what makes that rule satisfiable rather than aspirational.
//
// WHAT IT IS NOT. Not claim-side extraction, and not a unit conversion. It only
// separates a leading signed number from its unit so assessApplicability's
// unit-vs-value distinction (applicability.ts) can do its exact comparison.
// Matches the convention used in applicability.test.ts ('17%' → value '17',
// unit '%').

import type { ValueUnit } from "./applicability.ts";

export function parseValueUnit(extracted: string): ValueUnit {
  const raw = extracted.trim();
  const stripped = raw.replace(/^[$£€¥]/, "").trim();
  const match = /^([+-]?(?:\d[\d,]*)(?:\.\d+)?)\s*(.*)$/.exec(stripped);
  if (!match) {
    return { value: raw };
  }
  const value = match[1].replace(/,/g, "");
  const unit = match[2].trim().replace(/\s+/g, " ").replace(/[.,;:]$/, "").trim();
  return unit.length > 0 ? { value, unit } : { value };
}
