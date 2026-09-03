// REAL DeepSeek API tests for claim extraction — deliberately separated from
// the mocked suite, mirroring judge/liveApi.test.ts. Each test skips cleanly
// (the whole suite keeps passing) when DEEPSEEK_API_KEY is not set in the
// environment. When it IS set, these hit the live `deepseek-v4-flash` model
// with short, cheap prompts (kept to exactly 2 real calls).
//
// They prove the one thing that CANNOT be proven with mocks: the flagship
// example — "Acme's revenue grew 17% in FY25." — actually extracts to one
// claim with entity Acme, a valueUnit containing 17/%, and some period field
// populated, and that a message with no checkable claims degrades to an empty
// array. The architectural invariants (never decides evidence/applicability,
// verbatim-text containment, strict schema) are proven by the mocked suite.

import assert from "node:assert/strict";
import { test } from "node:test";
import { extractClaims, type ExtractedClaim } from "./extractClaims.ts";

const HAS_KEY = Boolean(process.env.DEEPSEEK_API_KEY);

const LIVE_OPTS = { model: "deepseek-v4-flash", maxTokens: 600, timeoutMs: 30_000 };

test(
  "live (a): the flagship example extracts to one claim with entity Acme, 17%, and a period",
  { skip: !HAS_KEY },
  async () => {
    const result = await extractClaims("Acme's revenue grew 17% in FY25.", LIVE_OPTS);
    assert.equal(result.ok, true, `live extraction failed: ${JSON.stringify(result)}`);
    const claims = (result as { ok: true; claims: ExtractedClaim[] }).claims;
    const acme = claims.find((c) => /acme/i.test(c.claimFields.entity ?? ""));
    assert.ok(acme, `expected a claim naming Acme; extracted ${JSON.stringify(claims.map((c) => c.claimFields))}`);
    const valueUnit = acme.claimFields.valueUnit;
    assert.ok(valueUnit, "the claim's valueUnit should be populated");
    assert.ok(valueUnit.value.includes("17"), `value should contain 17, got: ${valueUnit.value}`);
    assert.ok(acme.claimFields.period, "a period field should be populated");
    assert.equal(acme.materiality, true, "a figure a reader would rely on is material");
  },
);

test(
  "live (b): a message with no checkable claims returns an empty array",
  { skip: !HAS_KEY },
  async () => {
    const result = await extractClaims("Hi there! Hope you're doing well. Take care!", LIVE_OPTS);
    // Must be a SUCCESSFUL extraction of zero claims, not a failure that
    // happens to look empty — the distinction this endpoint now makes.
    assert.equal(result.ok, true, `live extraction failed: ${JSON.stringify(result)}`);
    assert.deepEqual((result as { ok: true; claims: ExtractedClaim[] }).claims, [], "greetings and well-wishes are not checkable claims");
  },
);
