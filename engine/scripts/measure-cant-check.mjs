#!/usr/bin/env node
// E18 v1 — measure the false-"couldn't check" rate over real runs.
//
// The metric that matters: how often does a claim end INDETERMINATE/UNSUPPORTED
// while the figure it asserts is actually VERBATIM in an evidence row it was
// checked against? That is the signature of the architectural bug (whole-
// sentence unit + every-field-must-anchor gate), and it is what every fix in
// the E9-E18 queue should move down.
//
// What this does NOT do: it is not a correctness judge. A verbatim value can
// still legitimately be UNSUPPORTED (wrong entity/period in the evidence, or a
// claim about something the page never addresses). It flags candidates for a
// human to adjudicate — and as those adjudications are recorded here, the file
// becomes the labelled set B1 asks for.
//
// Run: node scripts/measure-cant-check.mjs   (read-only; PROD_DATABASE_URL or aws)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const runExec = promisify(execFile);

async function dbUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const { stdout } = await runExec("aws", ["lightsail", "get-container-services", "--region", "us-east-2",
    "--service-name", "notary-check-api",
    "--query", "containerServices[0].currentDeployment.containers.engine.environment.DATABASE_URL",
    "--output", "text"]);
  return stdout.trim();
}

const NUM_RE = /\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:[a-zA-Z%/]+)?/g;
function normNum(s) {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(s.replace(/[\s$,]/g, ""));
  if (!m) return "";
  const digits = m[0].replace(/,/g, "");
  return digits.length >= 3 ? digits : "";
}

const pool = new pg.Pool({ connectionString: await dbUrl(), max: 4 });
try {
  const { rows } = await pool.query(`
    SELECT left(r.id::text,8) rid, to_char(r.created_at,'MM-DD HH24:MI') created,
      (SELECT json_agg(json_build_object('ordinal',c.ordinal,'text',c.text,'state',c.state,'detail',c.lifecycle_detail) ORDER BY c.ordinal) FROM claim c WHERE c.review_id=r.id) claims,
      (SELECT json_agg(e.resolved_text) FROM evidence e WHERE e.review_id=r.id AND e.resolved_text IS NOT NULL) evid_texts
    FROM review r
    WHERE r.created_at > now() - interval '3 days' OR r.id::text LIKE 'f6dd5300%'
    ORDER BY r.created_at`);

  let flaggedTotal = 0, unresolved = 0;
  const perRun = [];
  for (const run of rows) {
    const texts = (run.evid_texts ?? []).map((t) => t.toLowerCase());
    let flags = 0, claimsN = 0;
    for (const c of run.claims ?? []) {
      claimsN += 1;
      if (c.state === "SUPPORTED" || c.state === "CONTRADICTED") continue;
      unresolved += 1;
      const nums = [...new Set((c.text.match(NUM_RE) ?? []).map(normNum).filter((n) => n.length > 0 && /\d/.test(n)))];
      const verbatim = nums.filter((n) => texts.some((t) => t.includes(n)));
      if (verbatim.length > 0) {
        flags += 1;
        flaggedTotal += 1;
        if (flaggedTotal <= 20) {
          console.log(`  FLAG ${run.rid} #${c.ordinal} [${c.state}] ${c.text.slice(0, 90)}  <= value ${verbatim[0]} present`);
        }
      }
    }
    perRun.push({ rid: run.rid, created: run.created, claims: claimsN, flags });
  }
  console.log("\nrun                        claims  verbatim-but-not-supported");
  for (const r of perRun) console.log(`  ${r.created} ${r.rid}   ${String(r.claims).padStart(4)}   ${String(r.flags).padStart(4)}`);
  console.log(`\nTOTAL unresolved: ${unresolved} | verbatim-but-not-supported candidates: ${flaggedTotal}`);
} finally {
  await pool.end();
}
