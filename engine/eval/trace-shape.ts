// What real coding sessions look like, at scale.
//
// WHY. eval/detector-hit-rate.ts measured detector preconditions against 51
// local transcripts. That sample was small, single-user, and — as it turned
// out — from a different environment than the one Notary is deployed into.
// This trace is ~665k rounds across many users and projects, and while it
// carries NO message content (token counts, timing and tool names only), the
// counters it does carry answer three questions we have been guessing about:
//
//   1. How often is there tool output at all? That is the self-report
//      detector's precondition, and the number I previously took from a
//      31-transcript coding sample.
//   2. How much does the user actually say? `user_request` is Track 2's whole
//      object, and a two-character message carries no intent.
//   3. How many rounds does a session run? The back-and-forth loop needs room
//      to happen.
//
// It cannot tell us whether a detector would FIND anything — only whether it
// could have run. Same upper-bound discipline as the hit-rate harness.
//
// Run: cd engine && npx tsx eval/trace-shape.ts ~/Downloads/syfi_coding_trace.jsonl

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

interface Round {
  session_id?: string;
  round_index?: number;
  tools?: unknown[];
  current_tool_result_count?: number;
  current_user_message_count?: number;
  current_user_message_chars?: number;
  current_tool_result_chars?: number;
  output_tokens?: number;
}

/** Buckets for how much the user actually said in a round. */
const MSG_BUCKETS = [0, 1, 20, 60, 200, 600, Number.POSITIVE_INFINITY];
const MSG_LABELS = ["0 (none)", "1–19", "20–59", "60–199", "200–599", "600+"];

async function main() {
  const path = process.argv[2];
  if (path === undefined) {
    console.error("usage: trace-shape.ts <trace.jsonl>");
    process.exit(2);
  }

  let rounds = 0;
  let withToolResult = 0;
  let withUserMessage = 0;
  let substantiveOutput = 0;
  let substantiveWithTool = 0;
  const msgHist = new Array<number>(MSG_LABELS.length).fill(0);
  const toolUse = new Map<string, number>();
  const sessionMaxRound = new Map<string, number>();

  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length === 0) continue;
    let d: Round;
    try {
      d = JSON.parse(line) as Round;
    } catch {
      continue;
    }
    rounds++;

    const toolResults = d.current_tool_result_count ?? 0;
    if (toolResults > 0) withToolResult++;

    const chars = d.current_user_message_chars ?? 0;
    if ((d.current_user_message_count ?? 0) > 0) withUserMessage++;
    for (let i = 0; i < MSG_BUCKETS.length - 1; i++) {
      if (chars >= MSG_BUCKETS[i] && chars < MSG_BUCKETS[i + 1]) {
        msgHist[i]++;
        break;
      }
    }

    // A round Notary would plausibly be invoked on: the model actually wrote
    // something substantial, rather than a one-line ack or a pure tool call.
    if ((d.output_tokens ?? 0) >= 120) {
      substantiveOutput++;
      if (toolResults > 0) substantiveWithTool++;
    }

    for (const t of d.tools ?? []) {
      const name = typeof t === "string" ? t : ((t as { name?: string })?.name ?? "?");
      toolUse.set(name, (toolUse.get(name) ?? 0) + 1);
    }

    const sid = d.session_id;
    if (sid !== undefined) {
      const idx = d.round_index ?? 0;
      if ((sessionMaxRound.get(sid) ?? -1) < idx) sessionMaxRound.set(sid, idx);
    }
  }

  const pct = (n: number, of = rounds) => `${((n / of) * 100).toFixed(1)}%`;
  console.log(`rounds:   ${rounds.toLocaleString()}`);
  console.log(`sessions: ${sessionMaxRound.size.toLocaleString()}\n`);

  console.log("TOOL OUTPUT PRESENT — the self-report detector's precondition");
  console.log(`  any round:            ${pct(withToolResult)}`);
  console.log(`  substantive answers:  ${pct(substantiveWithTool, substantiveOutput)}  (of ${substantiveOutput.toLocaleString()})\n`);

  console.log("USER MESSAGE LENGTH — Track 2's whole object");
  for (let i = 0; i < MSG_LABELS.length; i++) {
    const bar = "█".repeat(Math.round((msgHist[i] / rounds) * 40));
    console.log(`  ${MSG_LABELS[i].padEnd(10)} ${pct(msgHist[i]).padStart(6)}  ${bar}`);
  }
  console.log(`  rounds carrying any user message: ${pct(withUserMessage)}\n`);

  const lens = [...sessionMaxRound.values()].map((v) => v + 1).sort((a, b) => a - b);
  const q = (p: number) => lens[Math.min(lens.length - 1, Math.floor(lens.length * p))];
  console.log("SESSION LENGTH — room for the back-and-forth loop");
  console.log(`  median ${q(0.5)} rounds · p75 ${q(0.75)} · p90 ${q(0.9)} · p99 ${q(0.99)}`);
  console.log(`  single-round sessions: ${pct(lens.filter((l) => l === 1).length, lens.length)}\n`);

  console.log("TOOLS USED (top 12)");
  for (const [name, n] of [...toolUse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${name.padEnd(24)} ${n.toLocaleString()}`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
