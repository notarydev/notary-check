// Captures the RAW model output when claim extraction fails to parse.
//
// The Arena run reports model_output_unparseable on a large fraction of real
// chat answers, and the production log records only "model output is not a
// valid JSON object" without the output itself — so the cause is invisible from
// telemetry alone. This replicates the exact call extractClaims makes and
// prints what actually came back.

import { execFileSync } from "node:child_process";
import { buildClaimPrompt, CLAIM_EXTRACTION_PROMPT_VERSION, parseExtractionOutput } from "../src/extraction/extractClaims.ts";
import { createJudgeClient } from "../src/judge/judgeClient.ts";
import type { JudgeCallInput } from "../src/judge/judgeClient.ts";

const PARQUET = `${process.env.HOME}/Downloads/train-00000-of-00001-cced8514c7ed782a.parquet`;

function load(n: number): Array<{ answer: string }> {
  const py = `
import pyarrow.parquet as pq, json, random
random.seed(7)
t = pq.read_table(${JSON.stringify(PARQUET)}, columns=["language","conversation_a"])
rows = [r for r in t.to_pylist() if r["language"] == "English"]
random.shuffle(rows)
out = []
for r in rows:
    a = next((m["content"] for m in r["conversation_a"] if m["role"] == "assistant"), None)
    if a and len(a) > 200: out.append({"answer": a})
    if len(out) >= ${n}: break
print(json.dumps(out))
`;
  return JSON.parse(execFileSync("python3", ["-c", py], { maxBuffer: 256 * 1024 * 1024 }).toString());
}

async function main() {
  const samples = load(Number(process.argv[2] ?? 10));
  const client = createJudgeClient();
  let failures = 0;
  let okCount = 0;
  const lengths: Array<{ chars: number; tokens: number; answerChars: number }> = [];

  for (const [i, s] of samples.entries()) {
    const { system, user, question } = buildClaimPrompt(s.answer);
    // EXACTLY the shape extractClaims builds — a hand-rolled variant produced a
    // 400 and sent me chasing the wrong bug.
    const input: JudgeCallInput = {
      promptVersion: CLAIM_EXTRACTION_PROMPT_VERSION,
      question,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: Number(process.env.PROBE_MAX_TOKENS ?? 0) || undefined,
    };
    const res = await client.call(input);
    const raw = res.record.answer ?? "";
    lengths.push({ chars: raw.length, tokens: res.record.outputTokens ?? 0, answerChars: s.answer.length });
    if (parseExtractionOutput(raw, s.answer).ok) { okCount++; continue; }
    failures++;
    console.log(`  truncated: answer ${s.answer.length} chars -> ${raw.length} chars out (${res.record.outputTokens ?? "?"} tokens)`);

  }
  console.log(`\n${okCount} parsed OK, ${failures} failed (maxTokens=${process.env.PROBE_MAX_TOKENS ?? "default 1024"})`);
  const toks = lengths.map((l) => l.tokens).sort((a, b) => a - b);
  const q = (p: number) => toks[Math.min(toks.length - 1, Math.floor(toks.length * p))];
  console.log(`\noutput tokens: median ${q(0.5)}  p75 ${q(0.75)}  p90 ${q(0.9)}  max ${toks[toks.length - 1]}`);
  // Ratio matters more than the absolute: a cap must scale with input, and a
  // fixed number that fits today's sample will truncate a longer answer.
  const ratios = lengths.map((l) => l.tokens / Math.max(1, l.answerChars)).sort((a, b) => a - b);
  console.log(`output tokens per input char: median ${ratios[Math.floor(ratios.length / 2)].toFixed(3)}  p90 ${ratios[Math.floor(ratios.length * 0.9)].toFixed(3)}`);
  console.log(`answer length in sample: ${Math.min(...lengths.map((l) => l.answerChars))}–${Math.max(...lengths.map((l) => l.answerChars))} chars`);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
