// REAL DeepSeek API tests for the constrained judge — deliberately separated
// from the mocked suite. Each test skips cleanly (the whole suite keeps
// passing) when DEEPSEEK_API_KEY is not set in the environment. When it IS set,
// these hit the live `deepseek-v4-flash` model with short, cheap prompts.
//
// They prove exactly the two things that CANNOT be proven with mocks:
//   (a) a field that IS present in a real short passage is extracted with the
//       right value, and
//   (b) a field genuinely absent from a passage returns "absent", not a
//       hallucinated value.
// They cannot prove the architectural invariants (blind answering, no
// tools/retrieval, judge-never-decides) — those are enforced by code structure
// and are proven by the mocked integration test, not by what a model does.
// Run separately from the mocked suite: `node --test --experimental-strip-types src/judge/liveApi.test.ts`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { extractField } from "./fieldExtraction.ts";

const HAS_KEY = Boolean(process.env.DEEPSEEK_API_KEY);

const LIVE_OPTS = { model: "deepseek-v4-flash", maxTokens: 300, timeoutMs: 30_000 };

test(
  "live (a): a field that IS present in a real short passage is extracted with the right value",
  { skip: !HAS_KEY },
  async () => {
    const passage = "Acme Corporation's revenue grew 17% in fiscal 2025.";
    const answer = await extractField(passage, "entity", LIVE_OPTS);
    assert.equal(answer.outcome, "present", `expected present, got ${answer.outcome} (${answer.record.error ?? ""})`);
    assert.ok(answer.value && /acme/i.test(answer.value), `value should name Acme, got: ${answer.value}`);
  },
);

test(
  "live (b): a field genuinely absent from a passage returns absent, not a hallucinated value",
  { skip: !HAS_KEY },
  async () => {
    // No comparator/baseline language anywhere — the judge must say absent.
    const passage = "Acme Corporation reported 1.2 million units sold in fiscal 2025.";
    const answer = await extractField(passage, "comparatorBaseline", LIVE_OPTS);
    assert.equal(answer.outcome, "absent", `expected absent, got ${answer.outcome} (${answer.record.error ?? ""})`);
    assert.equal(answer.value, undefined, "absent must not carry a value");
  },
);
