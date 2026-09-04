// Self-report — the answer claims something about work it did, and the tool
// output is right there to check it against.
//
// WHY THIS EXISTS. Measured against 51 real transcripts (eval/
// detector-hit-rate.ts), this has material on ~27% of substantive answers —
// second-broadest in the bank — and adding it pulled "Notary has nothing to
// say" from 50% down to 37%.
//
// It is the one place an agentic conversation carries its own ground truth.
// Claude ran the command; the output is in the same turn. No external source,
// no fetch, no adapter — the evidence arrived with the payload. We had
// deferred this as "needs a repository integration"; the transcripts say it
// does not.
//
// Directly supported by the research already cited in the plan: across 20,574
// real coding sessions, 91.49% of visible resolutions required explicit user
// correction, and inaccurate self-reporting grew as a share of failures over
// time. This detector is aimed squarely at that.
//
// WHAT IT DOES NOT DO. It does not judge whether the work was good, whether
// the fix was correct, or whether the approach was right. It compares a
// SUCCESS CLAIM against a FAILURE SIGNAL in the material the claim is about.
// That is the only thing here blatant enough to be a Verify finding —
// everything else about agent quality is judgment, and judgment is Act's.

import { randomUUID } from "node:crypto";
import type { Detector, DetectorInput, DetectorOutcome, Finding } from "./types.ts";

export const SELF_REPORT_VERSION = "self-report-v1";

/**
 * A claim that work succeeded. Deliberately narrow: only unhedged, completed,
 * first-person-or-impersonal success. "This should fix it" and "try running
 * the tests" are not success claims and must not be treated as ones.
 */
const SUCCESS_CLAIM =
  /\b(?:I(?:'ve| have)?\s+(?:fixed|resolved|corrected)|all\s+(?:the\s+)?(?:tests?|checks?|suites?)\s+(?:now\s+)?pass(?:ing|es)?|tests?\s+(?:now\s+)?pass(?:ing|es)?|(?:it|this|that)\s+(?:now\s+)?works?\b|build\s+(?:is\s+)?(?:now\s+)?(?:passing|green|clean)|no\s+(?:more\s+)?errors?\b|typecheck\s+(?:is\s+)?clean|verified\s+working)/i;

/** Hedges that disqualify a success claim — it is a prediction, not a report. */
const HEDGE = /\b(should|might|may|probably|likely|hopefully|try|attempt|expect|I think|presumably)\b/i;

/**
 * A failure signal in tool output. Kept to signals that are unambiguous in
 * ordinary tooling — a nonzero exit, an explicit failure count, a traceback.
 *
 * NOT included, on purpose: the bare word "error" or "warning". Both appear
 * constantly in healthy output (log lines, error-handling code being printed,
 * "0 errors"), and a detector that fires on them would be wrong far more
 * often than right — which disqualifies it from a bank whose bar is "blatant".
 */
const FAILURE_SIGNALS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(\d+)\s+(?:tests?\s+)?fail(?:ed|ing|ures?)\b/i, label: "reported test failures" },
  { re: /^\s*#\s*fail\s+([1-9]\d*)\s*$/im, label: "reported test failures" },
  { re: /\bnot ok\s+\d+/i, label: "a failing test case" },
  { re: /\bexit(?:\s+code|ed with)?\s*[:=]?\s*([1-9]\d*)\b/i, label: "a nonzero exit code" },
  { re: /\bTraceback \(most recent call last\)/i, label: "an unhandled exception" },
  { re: /\bAssertionError\b/i, label: "a failed assertion" },
  { re: /\bFAILED\b\s+\S+::/i, label: "a failing test case" },
  { re: /\berror TS\d+:/i, label: "a TypeScript compile error" },
];

/** Explicit all-clear signals, so "0 failed" is never read as a failure. */
const CLEAN_SIGNALS = [/\b0\s+fail(?:ed|ures?)\b/i, /\b#\s*fail\s+0\b/i, /\bexit(?:\s+code)?\s*[:=]?\s*0\b/i];

export const selfReportDetector: Detector = {
  id: "self_report",
  version: SELF_REPORT_VERSION,
  // Ranks above self-contradiction: a false success claim about work already
  // done is acted on immediately, and is the failure mode the agent research
  // identifies as most costly.
  rank: 15,

  run(input: DetectorInput): DetectorOutcome {
    const claimsSuccess = SUCCESS_CLAIM.test(input.answerText) && !HEDGE.test(input.answerText);
    if (!claimsSuccess) {
      // The answer makes no completion claim. Nothing to verify, and no ask
      // would change that.
      return { status: "not_applicable" };
    }

    const results = input.executionResults ?? [];
    if (results.length === 0) {
      // A success claim WITH no output to check it against is exactly the case
      // an ask can fix — this is the one detector where "missing_input" is
      // genuinely actionable.
      return {
        status: "missing_input",
        gaps: [
          {
            detector: "self_report",
            missing: "execution_result",
            unblocks: "check whether the command output actually supports the claim that this worked",
          },
        ],
      };
    }

    const findings: Finding[] = [];
    for (const r of results) {
      // An explicit all-clear anywhere in the output beats a pattern match —
      // "0 failed" contains a digit and the word "fail".
      if (CLEAN_SIGNALS.some((re) => re.test(r.text))) continue;

      for (const sig of FAILURE_SIGNALS) {
        const m = sig.re.exec(r.text);
        if (m === null) continue;
        // A zero capture is a pass, not a failure: "0 failed", "exit code 0".
        if (m[1] !== undefined && Number(m[1]) === 0) continue;

        findings.push({
          id: randomUUID(),
          detector: "self_report",
          type: "self_report_mismatch",
          owner: "computed",
          boundaryText: `The answer reports success, but the output shows ${sig.label}.`,
          fieldDeltas: [
            { field: "outcome", claimed: "succeeded", observed: m[0].trim(), relation: "conflict" },
          ],
          basis: { kind: "execution", ref: r.ref, excerpt: m[0].trim() },
          rank: 15,
          detectorVersion: SELF_REPORT_VERSION,
        });
        break; // one finding per result — the first signal is enough
      }
    }

    return { status: "ran", findings };
  },
};
