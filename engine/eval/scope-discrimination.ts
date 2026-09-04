// Does the extractor tell a RESTRICTION from an EXPLANATION?
//
// WHY THIS EXISTS. Measured against 161 real chat answers, self-contradiction
// fired zero times — including on a deliberately planted contradiction. The
// cause was not rarity, and not a bug in either component alone:
//
//   the extractor set scope from ANY qualifying phrase, including
//   "driven by enterprise demand" (a cause) and "overall" (emphasis);
//
//   the detector requires scopes to AGREE before comparing, which is the
//   safety property that stops "revenue grew 17%" and "excluding one-time
//   items, revenue grew 12%" reading as a contradiction.
//
// Individually defensible, together they cancelled: scopes almost never
// matched, so the comparison almost never ran. Fixed in the extraction prompt
// (v3) by defining scope as something that narrows WHAT IS MEASURED, with
// causal and emphatic phrasing explicitly excluded.
//
// This runs the REAL extractor, because the distinction lives in the prompt
// and no unit test on hand-written ClaimFields can exercise it.
//
// Run: cd engine && npx tsx eval/scope-discrimination.ts

import { extractClaims } from "../src/extraction/extractClaims.ts";
import { runDetectors } from "../src/detect/registry.ts";

interface Case {
  name: string;
  text: string;
  expectFindings: number;
  why: string;
}

const CASES: Case[] = [
  {
    name: "explanatory phrasing must NOT block the comparison",
    text: "Acme Corp's revenue grew 17% in FY25, driven by enterprise demand. Looking at the full year, Acme Corp's revenue grew 12% in FY25 overall.",
    expectFindings: 1,
    why: "'driven by enterprise demand' and 'overall' explain and emphasise; neither narrows what is measured",
  },
  {
    name: "an accounting restriction must still block it",
    text: "Acme Corp's revenue grew 17% in FY25. Excluding one-time items, Acme Corp's revenue grew 12% in FY25.",
    expectFindings: 0,
    why: "a general figure and a narrowed figure can both be true — the false positive that matters most",
  },
  {
    name: "a geographic restriction must still block it",
    text: "Acme Corp's revenue grew 17% in FY25. In North America, Acme Corp's revenue grew 12% in FY25.",
    expectFindings: 0,
    why: "worldwide and regional are different populations",
  },
  {
    name: "a segment restriction must still block it",
    text: "Acme Corp's revenue grew 17% in FY25. Among enterprise customers only, Acme Corp's revenue grew 12% in FY25.",
    expectFindings: 0,
    why: "'enterprise customers only' genuinely narrows the population, unlike 'driven by enterprise demand'",
  },
];

async function main() {
  let failed = 0;
  for (const c of CASES) {
    const ex = await extractClaims(c.text, { organizationId: "eval-scope" });
    if (!ex.ok) {
      console.log(`[FAIL] ${c.name}\n       extraction failed: ${ex.reason}`);
      failed++;
      continue;
    }
    const material = ex.claims.filter((x) => x.materiality);
    const det = runDetectors({
      answerText: c.text,
      claims: material.map((x, i) => ({ id: `c${i}`, text: x.text, fields: x.claimFields, materiality: true })),
      hasResolvedEvidence: false,
    });
    const ok = det.findings.length === c.expectFindings;
    if (!ok) failed++;
    console.log(`[${ok ? "PASS" : "FAIL"}] ${c.name}`);
    console.log(`       scopes extracted: ${material.map((m) => m.claimFields.scope ?? "(unset)").join(" | ")}`);
    console.log(`       findings ${det.findings.length}, expected ${c.expectFindings} — ${c.why}`);
  }
  console.log(`\n${CASES.length - failed}/${CASES.length} correct.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
