// The live case that motivated the immaterial-ambiguity rule, end to end
// against the REAL judge.
//
// Observed in production 2026-09-04:
//   claim:   "The Statue of Liberty is 500 feet tall."
//   passage: "Height of copper statue (to torch): 151 feet 1 inch (46 meters);
//             From ground level to torch: 305 feet 1 inch (93 meters)"
//   result:  INDETERMINATE / checks_did_not_complete / required_field_unresolved
//
// Two readings, neither of them 500. The unit tests pin the comparison logic,
// but only a live run proves the JUDGE actually reports its candidate readings
// under the v3 prompt — a rule that depends on an output field the model never
// emits would pass every unit test and do nothing in production.
//
// Run: cd engine && npx tsx eval/statue-ambiguity.ts

import { extractField } from "../src/judge/fieldExtraction.ts";
import { assessAmbiguity } from "../src/verification/immaterialAmbiguity.ts";

const PASSAGE =
  "Statue of Liberty. Height of copper statue (to torch): 151 feet 1 inch (46 meters); " +
  "From ground level to torch: 305 feet 1 inch (93 meters).";

async function main() {
  console.log("Live judge check — does it report candidate readings?\n");
  console.log(`passage: ${PASSAGE}\n`);

  const answer = await extractField(PASSAGE, "valueUnit", { organizationId: "eval" });
  console.log(`  outcome:    ${answer.outcome}`);
  console.log(`  value:      ${answer.value ?? "(none)"}`);
  console.log(`  candidates: ${answer.candidates === undefined ? "(none)" : JSON.stringify(answer.candidates)}`);

  if (answer.outcome !== "ambiguous") {
    console.log(`\nNOTE: judge did not call this ambiguous. The rule is not exercised on this input.`);
    console.log("This is a legal outcome, not a failure — but it means production behaviour here");
    console.log("depends on a path this run did not take.");
    return;
  }
  if (answer.candidates === undefined || answer.candidates.length === 0) {
    console.log("\nFAIL — judge said ambiguous but reported no candidates.");
    console.log("The rule cannot fire, and the live case stays INDETERMINATE.");
    process.exit(1);
  }

  const verdict = assessAmbiguity("500 feet", answer.candidates);
  console.log(`\n  claim "500 feet" vs those candidates -> ${verdict.material ? "MATERIAL (stays INDETERMINATE)" : "IMMATERIAL (conflict is robust)"}`);
  console.log(`  reason: ${verdict.reason}`);

  if (verdict.material) {
    console.log("\nThe judge reported candidates but the comparison found the ambiguity material.");
    console.log("Check whether the candidate strings carry units this rule can compare.");
    process.exit(1);
  }
  console.log("\nPASS — the judge reports its readings and the conflict survives the ambiguity.");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
