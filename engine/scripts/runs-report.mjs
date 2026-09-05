#!/usr/bin/env node
// Runs-report dashboard — LOCAL, read-only live view of Notary production runs.
//
// Why local: the page shows claim text and evidence across ALL organizations,
// which must never be exposed on a public endpoint. This server runs on your
// machine, reads the production database read-only, and serves a page at
// http://localhost:8123 that auto-polls /api/runs every 20s. New runs appear
// without any manual step.
//
// Run:
//   PROD_DATABASE_URL="postgres://..." node scripts/runs-report.mjs
// (if PROD_DATABASE_URL is unset it is fetched from the Lightsail container
//  env via the aws CLI, like every other tool in this repo)
//
// Read-only guarantee: the only SQL executed is SELECT. Nothing here writes.

import { readFile, access } from "node:fs/promises";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const runExec = promisify(execFile);
const PORT = Number(process.env.PORT ?? 8123);
const HTML_PATH = new URL("./runs-report.html", import.meta.url).pathname;

const ASSESSMENTS = {
  f6dd5300: { name: "Baseline (pre-fix)", when: "DynamoDB-vs-Postgres answer", engine: "old engine",
    verify: "10 UNSUPPORTED + 10 INDETERMINATE over 20 claims", vpill: "mid",
    vnote: "Pre-fix build checked 4 snippet excerpts (\u2264151 chars). Verdicts not trustworthy.",
    move: "none", mpill: "none", mnote: "Move not recorded on this run.",
    shown: "Card full of \u201cunsupported / could not check\u201d." },
  "9f3958a6": { name: "05:14 egress", when: "cloud egress pricing table", engine: "cache off \u00b7 excerpts",
    verify: "11 INDETERMINATE + 1 UNSUPPORTED (12 claims)", vpill: "mid",
    vnote: "Evidence was 19\u2013224-char caller excerpts. Honest \u201ccouldn\u2019t check\u201d, not useful.",
    move: "1 clarify \u2014 \u201cAsk for source URLs\u201d", mpill: "ok",
    mnote: "Appropriate: it asked for real sources instead of guessing.",
    shown: "2 source-gaps + \u201ccould not check\u201d + one ask." },
  "891ee8f5": { name: "05:27 egress", when: "cloud egress pricing table", engine: "cache ON \u00b7 excerpts",
    verify: "18 INDETERMINATE", vpill: "mid",
    vnote: "Thin excerpts + the scope-locator bug (16/18 locator_unresolved). Root cause fixed later.",
    move: "2 clarify \u2014 \u201cask for source links\u201d, \u201cclarify request\u201d", mpill: "ok",
    mnote: "Reasonable given nothing was grounded.",
    shown: "18 \u201ccould not check\u201d + 2 asks." },
  "900530a5": { name: "10:40 Pacific", when: "Pacific Ocean volume claim", engine: "cache ON \u00b7 excerpts",
    verify: "claim 1 UNSUPPORTED \u00b7 claim 2 INDETERMINATE", vpill: "wrong",
    vnote: "Geology In & Surfertoday state 714M km\u00b3 verbatim \u2192 should be SUPPORTED. Claim 2: \u201c50.1 percent\u201d present but unresolved. The false-negative class Step 1 fixes.",
    move: "1 clarify \u2014 \u201cClarify notary request\u201d", mpill: "gen", mnote: "Harmless but unhelpful.",
    shown: "\u201cNo supplied evidence supports this claim\u201d on a TRUE claim." },
  "8b41051d": { name: "13:53 new user \u00b7 Step 1 live", when: "Pacific figure, cited CIA page", engine: "Step 1 fetch ON",
    verify: "3 UNSUPPORTED + 1 INDETERMINATE (4 claims)", vpill: "ok",
    vnote: "Checked against the FETCHED 3,411-char CIA page \u2014 a farewell article with no Pacific figures. UNSUPPORTED is the truth.",
    move: "none", mpill: "none", mnote: "Track 2 ships dark for new orgs (act_moves_enabled=false).",
    shown: "Truthful \u201cno supplied evidence supports this claim\u201d." },
  cd46912c: { name: "13:55 same source re-check", when: "Pacific figure, same CIA page", engine: "Step 1 \u00b7 cache hit",
    verify: "3 UNSUPPORTED \u00b7 0 judge calls", vpill: "ok",
    vnote: "Same fetched text, judged once \u2014 cache served every field. 0 model calls, ~0 cost, same truthful verdict.",
    move: "none", mpill: "none", mnote: "Same as above.",
    shown: "Truthful card at ~free cost." },
};
const NEUTRAL = { name: null, when: null, engine: null, verify: null, vpill: "mid",
  vnote: "Not assessed yet \u2014 read the plumbing to judge this run.", move: null, mpill: "none",
  mnote: null, shown: null };
const EXTRACT_KNOWN = { "9f3958a6": 13738, "891ee8f5": 17615, "900530a5": 4202, "8b41051d": 8771, cd46912c: 11381 };

async function dbUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const { stdout } = await runExec("aws", ["lightsail", "get-container-services", "--region", "us-east-2",
    "--service-name", "notary-check-api",
    "--query", "containerServices[0].currentDeployment.containers.engine.environment.DATABASE_URL",
    "--output", "text"]);
  return stdout.trim();
}

const KNOWN_LEGACY = "f6dd5300"; // pre-2026-09-05 baseline, kept visible past the 3-day window

async function loadRuns() {
  const pool = new pg.Pool({ connectionString: await dbUrl(), max: 4 });
  try {
    // LIVE: show every review from the last 3 days (not a pinned id list — the
    // original version only listed six runs, so new runs never appeared), plus
    // the one legacy baseline. Capped at the 40 most recent.
    const { rows } = await pool.query(`
      SELECT r.id::text rid, to_char(r.created_at,'YYYY-MM-DD HH24:MI') created,
        EXTRACT(EPOCH FROM r.created_at)::int ts, r.status status, o.name org, o.act_moves_enabled act_enabled,
        EXTRACT(EPOCH FROM (r.completed_at - r.created_at))::numeric wall_s,
        (SELECT json_agg(json_build_object('ordinal',c.ordinal,'text',c.text,'state',c.state,'lifecycle',c.lifecycle_state,'detail',c.lifecycle_detail,
                                           'fields',c.claim_fields,'rejected',c.rejected_candidates) ORDER BY c.ordinal) FROM claim c WHERE c.review_id=r.id) claims,
        (SELECT json_agg(json_build_object('url',coalesce(e.canonical_url,e.submitted_url),'provenance',e.text_provenance,'len',length(e.resolved_text),'has_excerpt',(e.caller_excerpt IS NOT NULL),'parse',e.parse_status)) FROM evidence e WHERE e.review_id=r.id) evidence,
        (SELECT json_agg(json_build_object('type',u.event_type,'in',u.input_tokens,'out',u.output_tokens,'cost_mc',u.estimated_cost_millicents) ORDER BY u.created_at) FROM usage_event u WHERE u.review_id=r.id) usage,
        (SELECT EXTRACT(EPOCH FROM max(u.created_at)-r.created_at)*1000::int FROM usage_event u WHERE u.review_id=r.id AND u.event_type='judge_call') jl_ms,
        (SELECT json_agg(json_build_object('move',m.move,'label',m.short_label,'prompt',m.prompt) ORDER BY m.ordinal) FROM act_invocation i JOIN act_move m ON m.invocation_id=i.id WHERE i.review_id=r.id) moves,
        (SELECT count(*) FROM act_invocation i WHERE i.review_id=r.id) act_invocations,
        (SELECT json_agg(json_build_object('detector',f.detector,'type',f.type,'text',f.boundary_text)) FROM finding f WHERE f.review_id=r.id) findings,
        (SELECT json_agg(json_build_object('detector',g.detector,'missing',g.missing,'unblocks',g.unblocks)) FROM gap g WHERE g.review_id=r.id) gaps
      FROM (
        SELECT id FROM review
        WHERE created_at > now() - interval '3 days'
           OR id::text LIKE '${KNOWN_LEGACY}%'
        ORDER BY created_at DESC
        LIMIT 40
      ) recent
      JOIN review r ON r.id = recent.id
      LEFT JOIN organization o ON o.id = r.organization_id
      ORDER BY r.created_at ASC`);
    // Second-trip detection: consecutive reviews from the same org within 25
    // minutes are one conversational chain (Claude re-invokes Notary after a
    // finding/ask). ordinal>0 = a second+ trip; same sources then hit the cache.
    const CHAIN_GAP_S = 25 * 60;
    {
      const byOrg = new Map(); // org -> {lastTs, chain}
      for (const row of rows) {
        const key = row.org ?? row.organization_id ?? "?";
        const prev = byOrg.get(key);
        const same = prev !== undefined && row.ts - prev.lastTs <= CHAIN_GAP_S;
        if (same) {
          prev.lastTs = row.ts;
          prev.chain += 1;
          row._chain = { ordinal: prev.chain, len: 0 };
        } else {
          byOrg.set(key, { lastTs: row.ts, chain: 0 });
          row._chain = { ordinal: 0, len: 0 };
        }
      }
      // chain length = 1 + trailing zeros count backwards per org
      const last = new Map();
      for (let i = rows.length - 1; i >= 0; i--) last.set(rows[i].org ?? rows[i].organization_id ?? "?", rows[i]._chain.ordinal);
      for (const row of rows) row._chain.len = (last.get(row.org ?? row.organization_id ?? "?") ?? 0) + 1;
    }
    return rows.map((r) => {
      const rid = r.rid.slice(0, 8);
      const judge = (r.usage ?? []).filter((u) => u.type === "judge_call");
      const costMc = (r.usage ?? []).reduce((a, u) => a + (u.cost_mc ?? 0), 0);
      const a = ASSESSMENTS[rid] ?? NEUTRAL;
      const wall = r.wall_s === null ? null : Number(r.wall_s);
      const jl = r.jl_ms === null ? null : Number(r.jl_ms);
      const claims = (r.claims ?? []).map((c) => {
        let asserted = 0, unestablished = [];
        if (c.fields && typeof c.fields === "object") {
          asserted = Object.keys(c.fields).length;
          const rejected = Array.isArray(c.rejected) ? c.rejected : [];
          const mism = new Set();
          for (const rc of rejected) for (const f of rc.mismatchedFields ?? []) mism.add(f);
          if (c.lifecycle === "not_checkable" && c.detail) unestablished.push(c.detail);
          unestablished = [...mism];
        }
        return { ordinal: c.ordinal, text: c.text, state: c.state, lifecycle: c.lifecycle,
                 detail: c.detail, asserted, rejectedOn: unestablished };
      });
      return {
        rid, created: r.created, wall, org: r.org ?? null, actEnabled: r.act_enabled === true,
        chain: r._chain ?? null,
        verify_ms: jl ?? (wall !== null ? Math.round(wall * 1000) : null),
        finalize_ms: wall !== null && jl !== null ? Math.round(wall * 1000) - jl : 0,
        extract: EXTRACT_KNOWN[rid] ?? null,
        claims, evidence: r.evidence ?? [], usage: r.usage ?? [],
        moves: r.moves ?? [], findings: r.findings ?? [], gaps: r.gaps ?? [],
        act_invocations: r.act_invocations ?? 0,
        judge_calls: judge.length, cost_cents: Math.round(costMc) / 1000,
        ...a, name: a.name ?? `${rid} · ${r.created}`,
      };
    });
  } finally {
    await pool.end();
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.url === "/api/runs") {
      const runs = await loadRuns();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(runs));
      return;
    }
    await access(HTML_PATH);
    const html = await readFile(HTML_PATH, "utf8");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("error: " + (err.message ?? err));
  }
});
server.listen(PORT, () => console.log(`runs dashboard: http://localhost:${PORT}`));
