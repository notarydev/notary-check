// Self-report detector. As with self-contradiction, the negative cases carry
// the weight — this reads tool output, which is full of text that looks like
// failure and isn't ("0 failed", error-handling code, log lines).

import assert from "node:assert/strict";
import { test } from "node:test";
import { selfReportDetector } from "./selfReport.ts";
import type { DetectorInput } from "./types.ts";

function input(answerText: string, results?: Array<{ ref: string; text: string }>): DetectorInput {
  return { answerText, claims: [], hasResolvedEvidence: false, executionResults: results };
}

test("catches a success claim contradicted by failing tests", () => {
  const out = selfReportDetector.run(
    input("I've fixed the retry logic and all tests pass now.", [
      { ref: "t1", text: "# tests 12\n# pass 10\n# fail 2\n" },
    ]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].type, "self_report_mismatch");
  assert.equal(out.findings[0].basis.kind, "execution");
});

test("catches a success claim contradicted by a nonzero exit code", () => {
  const out = selfReportDetector.run(
    input("This now works — the build is clean.", [{ ref: "t1", text: "npm ERR! code 1\nexit code: 1" }]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 1);
});

test("catches a success claim contradicted by a traceback", () => {
  const out = selfReportDetector.run(
    input("I've resolved the parsing issue.", [
      { ref: "t1", text: 'Traceback (most recent call last):\n  File "x.py", line 3\nValueError' },
    ]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 1);
});

// --- must NOT fire -------------------------------------------------------

test("'0 failed' is a pass, not a failure", () => {
  const out = selfReportDetector.run(
    input("I've fixed it and all tests pass.", [{ ref: "t1", text: "# tests 12\n# pass 12\n# fail 0\n" }]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 0, "a zero failure count must never read as a failure");
});

test("exit code 0 is a pass", () => {
  const out = selfReportDetector.run(
    input("The build is now green.", [{ ref: "t1", text: "Build succeeded.\nexit code: 0" }]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 0);
});

test("a hedged claim is a prediction, not a report", () => {
  // "should fix" is not a success claim. Treating it as one would make Notary
  // contradict Claude for being appropriately uncertain.
  const out = selfReportDetector.run(
    input("This should fix the retry logic and the tests should pass now.", [
      { ref: "t1", text: "# fail 2" },
    ]),
  );
  assert.equal(out.status, "not_applicable", "a hedge disqualifies the success claim");
});

test("the bare word 'error' in output does not fire", () => {
  // Healthy output is full of the word. A detector that fired on it would be
  // wrong far more often than right, which disqualifies it from a bank whose
  // bar is 'blatant'.
  const out = selfReportDetector.run(
    input("I've added the error handler and it works.", [
      { ref: "t1", text: "Added error handling for ECONNRESET.\nAll checks completed.\nexit code: 0" },
    ]),
  );
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.findings.length, 0);
});

test("an answer with no success claim is not_applicable", () => {
  const out = selfReportDetector.run(
    input("Here are three approaches you could take to the retry problem.", [{ ref: "t1", text: "# fail 2" }]),
  );
  assert.equal(out.status, "not_applicable");
});

// --- the gap -------------------------------------------------------------

test("a success claim with NO output produces a gap, not a finding", () => {
  // This is the one detector where missing_input is genuinely actionable —
  // an ask for the command output would let the check run.
  const out = selfReportDetector.run(input("I've fixed it and all tests pass."));
  assert.equal(out.status, "missing_input");
  if (out.status !== "missing_input") return;
  assert.equal(out.gaps.length, 1);
  assert.equal(out.gaps[0].missing, "execution_result");
});

test("no success claim and no output is not_applicable, never a gap", () => {
  // Asking for test output when the answer never claimed anything worked
  // would be asking for input that cannot help.
  const out = selfReportDetector.run(input("Here is how the retry logic currently behaves."));
  assert.equal(out.status, "not_applicable");
});
