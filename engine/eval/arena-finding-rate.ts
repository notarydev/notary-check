// Do the detectors actually FIND anything on real conversations?
//
// Everything measured so far has been PRECONDITIONS — could a detector have
// run. This is the first measurement of the number that matters: how often one
// actually fires on real answers.
//
// THE DATA. LMSYS Chatbot Arena: 33,000 head-to-head pairs of real chat
// conversations with a human vote on which answer was better. Two properties
// make it worth the model spend:
//
//   1. It is GENERAL CHAT, not coding. The earlier hit-rate measurement used
//      51 Claude Code transcripts, which is the domain where Verify is
//      weakest and is not what the connector is used for.
//   2. The human vote gives a free, if weak, validation signal. If a detector
//      fires MORE on the answer humans rejected than on the one they picked,
//      it is catching something a person independently disliked. That is not
//      ground truth, but it is evidence, and it costs nothing extra.
//
// WHAT IT IS NOT. There are no labels for our task — "which answer is better"
// is not "does this answer contradict itself". This CANNOT serve as B1, the
// held-out labelled set the release gate needs; that still requires
// adjudicated claim-level labels and annotators.
//
// COST. One claim-extraction call per answer. Sampled, not exhaustive, and the
// real spend is printed at the end so the next run can be sized honestly.
//
// Run: cd engine && npx tsx eval/arena-finding-rate.ts [pairs] [bothbadPairs]

import { execFileSync } from "node:child_process";
import { extractClaims } from "../src/extraction/extractClaims.ts";
import { runDetectors } from "../src/detect/registry.ts";
import type { Finding } from "../src/detect/types.ts";

const PARQUET = `${process.env.HOME}/Downloads/train-00000-of-00001-cced8514c7ed782a.parquet`;

interface Sample {
  bucket: "winner" | "loser" | "bothbad";
  answer: string;
  userRequest: string;
}

/**
 * Pulls a stratified sample out of the parquet via a short Python shim —
 * pyarrow is already present and reading columnar data from Node would mean a
 * new dependency for one script.
 *
 * Only the FIRST assistant turn of each conversation is taken. Later turns are
 * responses to follow-ups the other model never saw, so they are not
 * comparable between the two sides of a pair.
 */
function loadSamples(pairs: number, bothbadPairs: number): Sample[] {
  const py = `
import pyarrow.parquet as pq, json, random
random.seed(7)  # fixed, so re-runs are comparable
t = pq.read_table(${JSON.stringify(PARQUET)},
    columns=["winner","language","conversation_a","conversation_b"])
rows = t.to_pylist()
rows = [r for r in rows if r["language"] == "English"]

def first_pair(conv):
    u = next((m["content"] for m in conv if m["role"] == "user"), None)
    a = next((m["content"] for m in conv if m["role"] == "assistant"), None)
    return u, a

out = []
decisive = [r for r in rows if r["winner"] in ("model_a", "model_b")]
bothbad  = [r for r in rows if r["winner"] == "tie (bothbad)"]
random.shuffle(decisive); random.shuffle(bothbad)

for r in decisive:
    if len([o for o in out if o["bucket"] != "bothbad"]) >= ${pairs} * 2: break
    win_conv  = r["conversation_a"] if r["winner"] == "model_a" else r["conversation_b"]
    lose_conv = r["conversation_b"] if r["winner"] == "model_a" else r["conversation_a"]
    uw, aw = first_pair(win_conv); ul, al = first_pair(lose_conv)
    # Both sides must be substantive, or the comparison is between an answer
    # and an apology.
    if not (uw and aw and ul and al and len(aw) > 200 and len(al) > 200): continue
    out.append({"bucket": "winner", "answer": aw, "userRequest": uw})
    out.append({"bucket": "loser",  "answer": al, "userRequest": ul})

n = 0
for r in bothbad:
    if n >= ${bothbadPairs} * 2: break
    for conv in (r["conversation_a"], r["conversation_b"]):
        u, a = first_pair(conv)
        if u and a and len(a) > 200:
            out.append({"bucket": "bothbad", "answer": a, "userRequest": u}); n += 1
print(json.dumps(out))
`;
  const raw = execFileSync("python3", ["-c", py], { maxBuffer: 512 * 1024 * 1024 }).toString();
  return JSON.parse(raw) as Sample[];
}

/** Bounded concurrency — the extraction endpoint is shared with production. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

interface Row {
  answers: number;
  withClaims: number;
  claims: number;
  findings: number;
  answersWithFinding: number;
  byDetector: Map<string, number>;
}

function blank(): Row {
  return { answers: 0, withClaims: 0, claims: 0, findings: 0, answersWithFinding: 0, byDetector: new Map() };
}

async function main() {
  const pairs = Number(process.argv[2] ?? 150);
  const bothbadPairs = Number(process.argv[3] ?? 50);

  console.log("Loading Arena sample…");
  const samples = loadSamples(pairs, bothbadPairs);
  console.log(`${samples.length} answers (${pairs} decisive pairs + ${bothbadPairs} both-bad pairs)\n`);
  console.log("Extracting claims — one model call per answer. This is the cost.\n");

  const buckets = new Map<string, Row>([
    ["winner", blank()],
    ["loser", blank()],
    ["bothbad", blank()],
  ]);
  let extractionFailures = 0;
  const failureReasons = new Map<string, number>();
  let done = 0;

  const results = await mapLimit(samples, 6, async (s) => {
    const ex = await extractClaims(s.answer, { organizationId: "eval-arena" });
    done++;
    if (done % 50 === 0) process.stderr.write(`  ${done}/${samples.length}\n`);
    if (!ex.ok) return { s, claims: [], failed: true, reason: ex.reason };
    return { s, claims: ex.claims, failed: false, reason: "" };
  });

  for (const r of results) {
    const row = buckets.get(r.s.bucket);
    if (row === undefined) continue;
    row.answers++;
    if (r.failed) {
      extractionFailures++;
      failureReasons.set(r.reason, (failureReasons.get(r.reason) ?? 0) + 1);
      continue;
    }
    const material = r.claims.filter((c) => c.materiality);
    row.claims += material.length;
    if (material.length > 0) row.withClaims++;

    const det = runDetectors({
      answerText: r.s.answer,
      userRequest: r.s.userRequest,
      claims: material.map((c, i) => ({
        id: `c${i}`,
        text: c.text,
        fields: c.claimFields,
        materiality: true,
      })),
      hasResolvedEvidence: false,
    });
    if (det.findings.length > 0) {
      row.answersWithFinding++;
      row.findings += det.findings.length;
      for (const f of det.findings as Finding[]) {
        row.byDetector.set(f.detector, (row.byDetector.get(f.detector) ?? 0) + 1);
      }
    }
  }

  const pct = (n: number, d: number) => (d === 0 ? "  n/a" : `${((n / d) * 100).toFixed(1)}%`);
  console.log("\n=== FINDING RATE — how often a detector actually fires ===\n");
  console.log("bucket     answers  with claims  ANSWERS WITH A FINDING");
  for (const name of ["winner", "loser", "bothbad"]) {
    const r = buckets.get(name);
    if (r === undefined || r.answers === 0) continue;
    console.log(
      `${name.padEnd(10)} ${String(r.answers).padStart(7)}  ${pct(r.withClaims, r.answers).padStart(11)}  ${pct(r.answersWithFinding, r.answers).padStart(10)}   (${r.answersWithFinding} of ${r.answers})`,
    );
  }

  const w = buckets.get("winner");
  const l = buckets.get("loser");
  if (w !== undefined && l !== undefined && w.answers > 0 && l.answers > 0) {
    const wr = w.answersWithFinding / w.answers;
    const lr = l.answersWithFinding / l.answers;
    console.log("\n=== THE PREFERENCE SIGNAL ===");
    console.log(`  fires on the answer humans PICKED:   ${(wr * 100).toFixed(1)}%`);
    console.log(`  fires on the answer humans REJECTED: ${(lr * 100).toFixed(1)}%`);
    if (w.answersWithFinding + l.answersWithFinding < 20) {
      console.log("  -> too few findings to read anything into the split. Sample more.");
    } else if (lr > wr * 1.2) {
      console.log("  -> fires more on rejected answers. Weak evidence the detector catches");
      console.log("     something humans independently disliked. Not ground truth.");
    } else if (wr > lr * 1.2) {
      console.log("  -> fires MORE on preferred answers. That is a bad sign and worth");
      console.log("     understanding before trusting the detector.");
    } else {
      console.log("  -> no meaningful difference. The detector is not tracking human");
      console.log("     preference either way, which is neither good nor bad on its own.");
    }
  }

  const all = [...buckets.values()];
  const totalAnswers = all.reduce((a, r) => a + r.answers, 0);
  const totalClaims = all.reduce((a, r) => a + r.claims, 0);
  console.log("\n=== DETECTOR BREAKDOWN (all buckets) ===");
  const merged = new Map<string, number>();
  for (const r of all) for (const [k, v] of r.byDetector) merged.set(k, (merged.get(k) ?? 0) + v);
  if (merged.size === 0) console.log("  no detector fired on any answer in this sample");
  for (const [k, v] of [...merged.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${v} finding(s)`);
  }
  console.log(`\nclaims extracted: ${totalClaims} across ${totalAnswers} answers`);
  if (extractionFailures > 0) {
    console.log(`extraction failures: ${extractionFailures}`);
    for (const [reason, n] of [...failureReasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason}: ${n}`);
    }
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
