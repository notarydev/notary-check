// Would the detector bank actually fire on real work?
//
// WHY THIS EXISTS. We designed six detectors and never asked how often any of
// them would have material to work with on a real conversation. If the answer
// is "5% of turns," the bank is tuned for content that rarely appears and the
// build order is wrong.
//
// WHAT THIS MEASURES — precondition presence, NOT findings. It answers
// "could this detector have run?", not "would it have found something." That
// is deliberate: precondition presence is an upper bound on hit rate, and an
// upper bound is enough to kill a detector. If arithmetic has material on 4%
// of turns, no amount of detector quality saves it.
//
// KNOWN BIAS, stated up front: these are Claude Code transcripts, so they are
// coding- and tooling-heavy. That is one real domain, not all of them, and it
// under-represents the research/analysis content Track 1's source-verification
// was designed for. Read the numbers as "what a coding user would see."
//
// The heuristics are deliberately generous — they look for the SHAPE a
// detector needs, and over-count rather than under-count. A low number here is
// therefore strong evidence; a high number is weak evidence.
//
// Run: cd engine && npx tsx eval/detector-hit-rate.ts [maxFiles]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = join(homedir(), ".claude", "projects");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

/** Pull plain text out of a transcript message's content, whatever shape it is. */
function textOf(msg: unknown): string {
  if (typeof msg === "string") return msg;
  if (Array.isArray(msg)) return msg.map(textOf).join("\n");
  if (msg && typeof msg === "object") {
    const o = msg as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (o.content !== undefined) return textOf(o.content);
  }
  return "";
}

/** Strip fenced code — detectors operate on prose claims, not source listings. */
function prose(s: string): string {
  return s.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
}

// --- preconditions, one per detector -------------------------------------

const NUM = /(?<![\w.])\d[\d,]*(?:\.\d+)?%?/g;

/** arithmetic: needs a COMPUTABLE relationship, not merely two numbers.
 *  Tightened after a first pass returned 61% — "changed 3 files to fix 2 bugs"
 *  has two numbers and a preposition and is not arithmetic. Requires one of:
 *  a percentage change, an explicit from->to pair, or a stated total. */
function hasArithmeticMaterial(t: string): boolean {
  const pctChange = /\d[\d,.]*\s*%[^.]{0,40}\b(increase|decrease|growth|decline|higher|lower|more|less|up|down)\b/i.test(t)
    || /\b(increase|decrease|grew|fell|rose|dropped|declined|up|down)\b[^.]{0,40}\d[\d,.]*\s*%/i.test(t);
  const fromTo = /\bfrom\s+\$?\d[\d,.]*\s*\w{0,8}\s+to\s+\$?\d[\d,.]*/i.test(t);
  const total = /\b(total|sum|altogether|combined)\b[^.]{0,60}\d[\d,.]*/i.test(t) && (t.match(NUM) ?? []).length >= 3;
  NUM.lastIndex = 0;
  return pctChange || fromTo || total;
}

/** source-verify: needs something addressable to check against. */
function hasSourceMaterial(t: string): boolean {
  return /https?:\/\/\S+/.test(t) || /\b(according to|per the|as stated in|source:|cited in|the report|the filing|the docs?)\b/i.test(t);
}

/** self-contradiction: needs >=2 assertive sentences ABOUT THE SAME SUBJECT.
 *  Tightened after a first pass returned 75% — that was measuring "is this
 *  prose," since almost any paragraph has two sentences containing "is".
 *  A contradiction requires two claims that are even comparable, so this now
 *  requires a shared capitalised subject or backticked identifier appearing in
 *  two separate assertive sentences. */
function hasSelfContradictionMaterial(t: string): boolean {
  const sentences = t.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 25);
  const assertive = sentences.filter((s) => /\b(is|are|was|were|has|have|does|will|must|cannot|returns?|requires?)\b/i.test(s));
  if (assertive.length < 2) return false;
  const subjects = new Map<string, number>();
  for (const s of assertive) {
    const seen = new Set<string>();
    for (const m of s.matchAll(/\b([A-Z][a-zA-Z]{3,})\b/g)) seen.add(m[1]);
    for (const k of seen) subjects.set(k, (subjects.get(k) ?? 0) + 1);
  }
  for (const n of subjects.values()) if (n >= 2) return true;
  return false;
}

/** requirements: the USER stated a countable constraint. */
function hasCountableRequirement(t: string): boolean {
  return (
    /\b(under|below|less than|no more than|at most|within)\s+\d[\d,]*\s*(words?|characters?|lines?|items?|bullets?|pages?)\b/i.test(t) ||
    /\b(give me|list|provide|show|write)\s+(\d+|two|three|four|five|ten)\b/i.test(t) ||
    /\b(exactly|at least)\s+\d+\b/i.test(t) ||
    /\btop\s+\d+\b/i.test(t)
  );
}

/** overreach: needs a source AND certainty language to compare against it. */
function hasOverreachMaterial(t: string): boolean {
  return hasSourceMaterial(t) && /\b(will|always|never|guaranteed|certainly|proves?|definitely|ensures?)\b/i.test(t);
}

/** self-report: the answer claims something about work it DID, and there is a
 *  tool result in the same turn to check it against.
 *
 *  Added after the first run showed half of all turns have material for
 *  nothing. In agentic work the evidence is ALREADY PRESENT — Claude ran the
 *  command, the output is right there — so this needs no external source and
 *  no new adapter. It is the one place a coding conversation carries its own
 *  ground truth.
 *
 *  Directly supported by the research already in the plan: 91% of visible
 *  agent resolutions required explicit user correction, and inaccurate
 *  self-reporting grew as a share of failures over time. */
function hasSelfReportMaterial(t: string, hadToolResult: boolean): boolean {
  if (!hadToolResult) return false;
  return /\b(I(?:'ve| have)? (?:fixed|updated|added|removed|changed|created|deleted|implemented|migrated|refactored)|all (?:tests?|checks?) pass|tests? (?:now )?pass|now works?|is (?:now )?working|successfully|done|complete[d]?|verified|confirmed)\b/i.test(t);
}

/** drift: needs the answer to reference something established earlier. */
function hasDriftMaterial(t: string): boolean {
  return /\b(as (we|you) (discussed|decided|agreed|established)|earlier you|previously|we settled on|the constraint (was|is)|you said)\b/i.test(t);
}

interface Row {
  turns: number;
  arithmetic: number;
  source: number;
  selfContra: number;
  requirement: number;
  overreach: number;
  drift: number;
  selfReport: number;
  any: number;
}

function main() {
  const maxFiles = Number(process.argv[2] ?? 0) || Infinity;
  const files = walk(ROOT).slice(0, maxFiles);

  const r: Row = { turns: 0, arithmetic: 0, source: 0, selfContra: 0, requirement: 0, overreach: 0, drift: 0, selfReport: 0, any: 0 };
  let sawToolResult = false;
  let lastUserText = "";

  for (const f of files) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let d: Record<string, unknown>;
      try {
        d = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = d.type;
      if (type === "user") {
        const raw = JSON.stringify(d);
        // A tool result comes back as a user-role message in this format.
        if (raw.includes("tool_result") || raw.includes("toolUseResult")) sawToolResult = true;
        else lastUserText = prose(textOf(d.message ?? d.content ?? ""));
        continue;
      }
      if (type !== "assistant") continue;

      const answer = prose(textOf(d.message ?? d.content ?? ""));
      // Only count substantive answers — a one-line ack has nothing to check.
      if (answer.trim().length < 200) continue;

      r.turns++;
      const hits = {
        arithmetic: hasArithmeticMaterial(answer),
        source: hasSourceMaterial(answer),
        selfContra: hasSelfContradictionMaterial(answer),
        // requirements are stated by the USER, checked against the answer
        requirement: hasCountableRequirement(lastUserText),
        overreach: hasOverreachMaterial(answer),
        drift: hasDriftMaterial(answer),
        selfReport: hasSelfReportMaterial(answer, sawToolResult),
      };
      sawToolResult = false;
      for (const [k, v] of Object.entries(hits)) if (v) (r as never as Record<string, number>)[k]++;
      if (Object.values(hits).some(Boolean)) r.any++;
    }
  }

  const pct = (n: number) => `${((n / r.turns) * 100).toFixed(1)}%`;
  console.log(`transcripts: ${files.length}`);
  console.log(`substantive assistant turns (>200 chars of prose): ${r.turns}\n`);
  console.log("precondition present — an UPPER BOUND on hit rate:\n");
  const rows: Array<[string, number]> = [
    ["arithmetic", r.arithmetic],
    ["source-verify", r.source],
    ["self-contradiction", r.selfContra],
    ["requirement (countable)", r.requirement],
    ["overreach", r.overreach],
    ["drift", r.drift],
    ["self-report", r.selfReport],
  ];
  rows.sort((a, b) => b[1] - a[1]);
  for (const [name, n] of rows) {
    const bar = "█".repeat(Math.round((n / r.turns) * 40));
    console.log(`  ${name.padEnd(24)} ${pct(n).padStart(6)}  ${bar}`);
  }
  console.log(`\n  ${"ANY detector".padEnd(24)} ${pct(r.any).padStart(6)}`);
  console.log(`  ${"NO detector".padEnd(24)} ${pct(r.turns - r.any).padStart(6)}   ← Notary would have nothing to say`);
}

main();
