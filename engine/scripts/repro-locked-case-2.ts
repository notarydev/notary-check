// E1 / locked case 2 reproduction.
//
// Symptom (observed live 2026-09-02): the paraphrased contradiction
//   claim:    "Acme's revenue grew 17% in FY25"
//   evidence: "Acme's revenue declined 12 percent in fiscal 2025"
// returns UNSUPPORTED instead of CONTRADICTED.
//
// Already eliminated by the production smoke test on 2026-09-03: the
// exact-value path (17% vs 12%, both "increase") returns a correct
// CONTRADICTED, so locator resolution, applicability, and the state machine
// are all working.
//
// The chain that would produce this symptom, read out of applicability.ts:
//   judge fails to extract `operator` from the evidence
//     -> evidence.operator === undefined
//     -> the `evOperator === undefined` branch pushes operator to `mismatched`
//        ("unestablished: evidence does not address the claimed field")
//     -> applicable = (mismatched.length === 0) = false
//     -> the candidate is dropped before it can become a relation
//     -> no relations at all -> UNSUPPORTED
//
// Note the asymmetry that makes this specific: a *differing* operator is a
// contradiction (valueConflicts), but an *absent* one is an applicability
// failure. So a judge that reads "declined" correctly gives CONTRADICTED,
// and a judge that fails to read it at all gives UNSUPPORTED. Same evidence.
//
// This script isolates the single judge call at the centre of that chain and
// runs it several times, because the failure was intermittent when first
// observed and one green run proves nothing.
//
// Run: cd engine && npx tsx scripts/repro-locked-case-2.ts [runs]

import { extractField } from "../src/judge/fieldExtraction.ts";
import { assessApplicability } from "../src/verification/applicability.ts";
import { assignState } from "../src/verification/stateMachine.ts";
import type { ClaimFields } from "../src/verification/applicability.ts";

const EVIDENCE = "Acme Corp FY25 results. Revenue declined 12 percent in fiscal 2025.";

// The claim, as extraction would have produced it.
const CLAIM: ClaimFields = {
  entity: "Acme",
  period: "FY25",
  metric: "revenue",
  operator: "increase",
  valueUnit: { value: "17", unit: "%" },
};

const FIELDS = ["entity", "period", "metric", "operator", "valueUnit"] as const;

async function oneRun(n: number) {
  const answers = [];
  for (const f of FIELDS) {
    answers.push(await extractField(EVIDENCE, f));
  }

  const line = answers
    .map((a) => `${a.field}=${a.outcome}${a.value !== undefined ? `(${a.value})` : ""}`)
    .join("  ");
  console.log(`run ${n}: ${line}`);

  // Rebuild the evidence-side fields exactly as reviewFlow would.
  const ev: Record<string, unknown> = {};
  for (const a of answers) {
    if (a.outcome !== "present" || a.value === undefined) continue;
    if (a.field === "valueUnit") {
      const m = /^([\d.,]+)\s*(.*)$/.exec(a.value.trim());
      ev.valueUnit = m ? { value: m[1], unit: m[2] || undefined } : { value: a.value };
    } else {
      ev[a.field] = a.value;
    }
  }

  const app = assessApplicability(CLAIM, ev as never);
  const relations = app.applicable
    ? [{ relation: (app.valueConflicts ? "contradicts" : "supports") as const, evidenceId: "e1" }]
    : [];
  const state = assignState(relations, true, true);

  const opAnswer = answers.find((a) => a.field === "operator");
  console.log(
    `        operator_outcome=${opAnswer?.outcome} | applicable=${app.applicable} | valueConflicts=${app.valueConflicts} | mismatched=[${app.mismatched.join(",")}] -> ${state.state}`,
  );
  return { state: state.state, operatorOutcome: opAnswer?.outcome, mismatched: app.mismatched };
}

async function main() {
  const runs = Number(process.argv[2] ?? 3);
  console.log(`claim:    revenue INCREASE 17% (Acme, FY25)`);
  console.log(`evidence: "${EVIDENCE}"`);
  console.log(`expected: CONTRADICTED\n`);

  const results = [];
  for (let i = 1; i <= runs; i++) results.push(await oneRun(i));

  const tally: Record<string, number> = {};
  for (const r of results) tally[r.state] = (tally[r.state] ?? 0) + 1;
  console.log(`\nstates across ${runs} runs:`, JSON.stringify(tally));

  const opTally: Record<string, number> = {};
  for (const r of results) opTally[String(r.operatorOutcome)] = (opTally[String(r.operatorOutcome)] ?? 0) + 1;
  console.log(`operator outcomes:`, JSON.stringify(opTally));

  if (tally.CONTRADICTED === runs) console.log("\nAll runs CONTRADICTED — not reproduced at this layer.");
  else console.log(`\nREPRODUCED: ${runs - (tally.CONTRADICTED ?? 0)}/${runs} runs failed to reach CONTRADICTED.`);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
