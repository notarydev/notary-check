// Safety check for the E1 entity fix (entity-optional-corporate-suffix-v1).
//
// WHY THIS EXISTS. E1 made entity comparison LOOSER: a bare name now matches
// the same name carrying a corporate suffix. Loosening an applicability gate
// is exactly the change class that can raise the **false-supported rate** —
// the primary product-quality error (§ Locked test suite: "it matters more
// than a missed issue").
//
// § Evaluator governance would normally require scoring this against the
// held-out labelled set. That set does not exist yet (whats-left.md B1), so
// this is the honest substitute, not a replacement: a fixed adversarial set
// of entity pairs run end to end through the REAL judge, checking that every
// pair which must stay separate still does.
//
// The unit tests in normalization.test.ts already pin the comparator against
// hand-written strings. This is different and complementary: it runs the
// actual extraction, so it catches the case where the judge normalises a name
// on its way out ("Apple Hospitality REIT" -> "Apple") and defeats a
// comparator rule that is correct in isolation.
//
// A pass here is evidence, not proof. It cannot produce the gate's number.
//
// Run: cd engine && npx tsx eval/entity-suffix-safety.ts

import { extractField } from "../src/judge/fieldExtraction.ts";
import { assessApplicability } from "../src/verification/applicability.ts";
import { assignState } from "../src/verification/stateMachine.ts";
import type { ClaimFields, EvidenceFields } from "../src/verification/applicability.ts";

interface Case {
  name: string;
  claimEntity: string;
  evidence: string;
  /** true  = these are the SAME company and the candidate should be applicable
   *  false = these are DIFFERENT and it must stay inapplicable */
  shouldMatch: boolean;
  why: string;
}

const CASES: Case[] = [
  // --- must MATCH (what E1 fixed) --------------------------------------
  {
    name: "bare vs corp suffix",
    claimEntity: "Acme",
    evidence: "Acme Corp FY25 results. Revenue increased 17 percent in fiscal 2025.",
    shouldMatch: true,
    why: "the E1 case — answers use short names, filings use legal names",
  },
  {
    name: "bare vs inc suffix",
    claimEntity: "Apple",
    evidence: "Apple Inc. FY25 results. Revenue increased 17 percent in fiscal 2025.",
    shouldMatch: true,
    why: "same shape, real-world naming",
  },

  // --- must NOT match (the false-supported risk) ------------------------
  {
    name: "locked case 6 — market vs company",
    claimEntity: "Acme",
    evidence: "The overall market grew 17 percent in fiscal 2025.",
    shouldMatch: false,
    why: "the flagship wrong-entity distractor; an attractive matching value from the wrong subject",
  },
  {
    name: "different suffixes",
    claimEntity: "Acme Corp",
    evidence: "Acme Inc. FY25 results. Revenue increased 17 percent in fiscal 2025.",
    shouldMatch: false,
    why: "Corp and Inc can be genuinely different legal entities — the dangerous case for this rule",
  },
  {
    name: "non-suffix qualifier",
    claimEntity: "Acme",
    evidence: "Acme Holdings FY25 results. Revenue increased 17 percent in fiscal 2025.",
    shouldMatch: false,
    why: "'Holdings' is not a corporate suffix; a parent is not the operating company",
  },
  {
    name: "regional qualifier",
    claimEntity: "Acme",
    evidence: "Acme Europe FY25 results. Revenue increased 17 percent in fiscal 2025.",
    shouldMatch: false,
    why: "a regional subsidiary is a different reporting entity",
  },
  {
    name: "shared first word, different company",
    claimEntity: "Apple",
    evidence: "Apple Hospitality REIT FY25 results. Revenue increased 17 percent in fiscal 2025.",
    shouldMatch: false,
    why: "real-world trap: an unrelated company whose name begins with the same token",
  },
  {
    name: "unrelated company",
    claimEntity: "Acme",
    evidence: "Beta Corp FY25 results. Revenue increased 17 percent in fiscal 2025.",
    shouldMatch: false,
    why: "baseline — must never match",
  },
];

const FIELDS = ["entity", "period", "metric", "operator", "valueUnit"] as const;

async function run(c: Case) {
  const claim: ClaimFields = {
    entity: c.claimEntity,
    period: "FY25",
    metric: "revenue",
    operator: "increase",
    valueUnit: { value: "17", unit: "%" },
  };

  const ev: Record<string, unknown> = {};
  let extractedEntity = "(none)";
  for (const f of FIELDS) {
    const a = await extractField(c.evidence, f);
    if (a.outcome !== "present" || a.value === undefined) continue;
    if (a.field === "entity") extractedEntity = a.value;
    if (a.field === "valueUnit") {
      const m = /^([\d.,]+)\s*(.*)$/.exec(a.value.trim());
      ev.valueUnit = m ? { value: m[1], unit: m[2] || undefined } : { value: a.value };
    } else {
      ev[a.field] = a.value;
    }
  }

  const app = assessApplicability(claim, ev as EvidenceFields);
  const relations = app.applicable
    ? [{ relation: (app.valueConflicts ? "contradicts" : "supports") as const, evidenceId: "e" }]
    : [];
  const state = assignState(relations, true, true);

  // The failure that matters: a candidate that should have been excluded
  // instead reaching a positive state. That is the false-supported error.
  const ok = c.shouldMatch ? app.applicable : !app.applicable;
  const falseSupported = !c.shouldMatch && state.state === "SUPPORTED";

  console.log(
    `[${ok ? "pass" : "FAIL"}] ${c.name.padEnd(34)} claim="${c.claimEntity}" judge_read="${extractedEntity}" applicable=${String(app.applicable).padEnd(5)} -> ${state.state}`,
  );
  if (!ok) console.log(`        expected ${c.shouldMatch ? "APPLICABLE" : "INAPPLICABLE"} — ${c.why}`);
  if (falseSupported) console.log(`        *** FALSE-SUPPORTED: a wrong-entity candidate reached SUPPORTED ***`);
  return { ok, falseSupported };
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("DEEPSEEK_API_KEY is not set.");
    process.exit(2);
  }
  console.log(`Entity-suffix safety set — ${CASES.length} cases against the real judge\n`);
  const results = [];
  for (const c of CASES) results.push(await run(c));

  const failed = results.filter((r) => !r.ok).length;
  const fs = results.filter((r) => r.falseSupported).length;
  console.log(`\n${CASES.length - failed}/${CASES.length} correct.`);
  console.log(`false-supported: ${fs}  (this is the number that must be 0)`);
  if (fs > 0 || failed > 0) process.exitCode = 1;
  else console.log("\nPASS — the optional-suffix rule did not open a wrong-entity path.");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
