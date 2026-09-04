// The detector bank.
//
// Runs every registered detector against one invocation and collects the two
// outputs: FINDINGS (things blatantly wrong) and GAPS (things a detector could
// have checked if an input had arrived). Both are facts. Neither is an action —
// turning a gap into an ask is Track 2's job, and nothing in this module
// expresses a suggestion.
//
// THREE OUTCOMES, NOT TWO. A detector reports `ran`, `not_applicable`, or
// `missing_input`, and the third is the one that is easy to omit and expensive
// to get wrong. Without it we cannot distinguish "this task has no code, so
// there is no test output to want" from "this task has code and the output is
// missing" — and we would ask a literature-review user to paste a test run.
//
// ISOLATION. A detector that throws produces nothing and cannot affect any
// other detector or Track 1's verification result. The bank is additive: the
// worst a broken detector can do is contribute no findings. This is the same
// rule Advance already follows toward Track 1, generalised — with several
// detectors there are several new ways to break the one thing that already
// works, and none of them may.
//
// ORDER. Findings are returned sorted by the detector's fixed `rank`, then by
// insertion. That is purely so two findings have a deterministic order for
// rendering and for the action pre-ranking; it is NOT a severity scale, and
// canonical bans exposing severity levels or colour-coded triage to the user.

import { logEvent } from "../observability/log.ts";
import { selfContradictionDetector } from "./selfContradiction.ts";
import { sourceGapDetector } from "./sourceGap.ts";
import { selfReportDetector } from "./selfReport.ts";
import type { Detector, DetectorInput, Finding, Gap } from "./types.ts";

/**
 * Every detector in the bank, in no particular order — `rank` decides output
 * ordering, not position here.
 *
 * Deliberately absent, with reasons, so nobody re-adds them without the
 * argument (rates measured over 51 real transcripts,
 * eval/detector-hit-rate.ts):
 *
 *   arithmetic    6.7% of turns have material, and it is ask-independent so
 *                 that number will not improve. Cheap to add later; not worth
 *                 a slot now.
 *   requirement   2.3%, ask-independent. People rarely state countable
 *                 requirements. It was ranked a week-one build and the data
 *                 says otherwise.
 *   drift         3.3%, but that number is meaningless — it depends entirely
 *                 on prior_context, which nothing has ever asked Claude for.
 *                 Unmeasurable until the widened ask ships.
 *   overreach     needs an ordered modality vocabulary that does not exist,
 *                 and is gated on sources anyway.
 *
 * source_verify's CHECKING half is still not here — it is the only detector
 * that writes `claim.state`, it runs inside the verification pipeline, and it
 * produces a state rather than a Finding. What IS registered is sourceGap: the
 * half that reports "this claim had nothing to check against", which is a fact
 * the bank can carry and the checking half had no way to express. Without it
 * `Gap`'s `addressable_source` kind was declared and never emitted, so Notary
 * never once asked for a source.
 */
const DETECTORS: readonly Detector[] = [selfReportDetector, selfContradictionDetector, sourceGapDetector];

export interface DetectionResult {
  findings: Finding[];
  gaps: Gap[];
  /** Per-detector outcome, for telemetry — how often each was applicable at all. */
  outcomes: Array<{ detector: string; status: string; count: number }>;
}

export function runDetectors(input: DetectorInput): DetectionResult {
  const findings: Finding[] = [];
  const gaps: Gap[] = [];
  const outcomes: DetectionResult["outcomes"] = [];

  for (const d of DETECTORS) {
    try {
      const out = d.run(input);
      if (out.status === "ran") {
        findings.push(...out.findings);
        outcomes.push({ detector: d.id, status: "ran", count: out.findings.length });
      } else if (out.status === "missing_input") {
        gaps.push(...out.gaps);
        outcomes.push({ detector: d.id, status: "missing_input", count: out.gaps.length });
      } else {
        outcomes.push({ detector: d.id, status: "not_applicable", count: 0 });
      }
    } catch (err) {
      // Never rethrow. A detector fault must degrade to "this detector found
      // nothing", never to a failed review — the verification result is not
      // this module's to break.
      logEvent({
        event: "detector_failed",
        error_cause: `${d.id}:${err instanceof Error ? err.message : String(err)}`,
      });
      outcomes.push({ detector: d.id, status: "error", count: 0 });
    }
  }

  findings.sort((a, b) => a.rank - b.rank);
  return { findings, gaps, outcomes };
}

/** Exposed for tests and for the hit-rate harness. */
export const REGISTERED_DETECTORS = DETECTORS;
