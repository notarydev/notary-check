// Regression coverage for the mixed-review silent-drop bug: a review where
// one material claim resolves cleanly (SUPPORTED) and a second claim's
// submission to the engine fails must never collapse to `no_issue` — the
// failed claim must produce an explicit finding that participates in the
// completeness logic (§ engineClient.ts's reviewAnswer).
//
// Run with: node --import tsx --test src/engineClient.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

// engineFetch reads process.env.ENGINE_URL/ENGINE_API_KEY lazily and calls
// the global `fetch`, so the whole engine is faked here by stubbing
// `globalThis.fetch` per-test rather than standing up a server.
type FetchArgs = [input: string | URL | Request, init?: RequestInit];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function pathOf(input: FetchArgs[0]): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(url).pathname;
}

test("extraction failure (quota denied) -> could_not_check, never no_issue", async () => {
  const originalFetch = globalThis.fetch;
  process.env.ENGINE_URL = "http://engine.test";
  process.env.ENGINE_API_KEY = "test-key";

  globalThis.fetch = (async (...args: FetchArgs) => {
    const [input, init] = args;
    const path = pathOf(input);
    const method = init?.method ?? "GET";

    if (path === "/v1/extract-claims" && method === "POST") {
      // No `claims` key at all — matches engine/src/routes/extractClaims.ts's
      // actual failure response shape. A client that fell back to `?? []`
      // here would collapse this back into "no material claims", which is
      // exactly the bug this test guards against.
      return jsonResponse(429, {
        error: "claim extraction did not complete",
        extraction_status: "failed",
        lifecycle_state: "not_extracted",
        reason: "quota_denied",
      });
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  }) as typeof fetch;

  try {
    const { reviewAnswer } = await import("./engineClient.js");
    const result = await reviewAnswer("Acme's revenue grew 17% in FY25.", [], "test-key");

    assert.equal(
      result.status,
      "could_not_check",
      "an extraction failure must render could_not_check, never no_issue",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mixed review: one claim SUPPORTED, one claim's submission fails -> could_not_check, never no_issue", async () => {
  const originalFetch = globalThis.fetch;
  process.env.ENGINE_URL = "http://engine.test";
  process.env.ENGINE_API_KEY = "test-key";

  let claimCallCount = 0;
  globalThis.fetch = (async (...args: FetchArgs) => {
    const [input, init] = args;
    const path = pathOf(input);
    const method = init?.method ?? "GET";

    if (path === "/v1/extract-claims" && method === "POST") {
      return jsonResponse(200, {
        claims: [
          { ordinal: 0, text: "Claim A is true.", materiality: true, claimFields: {} },
          { ordinal: 1, text: "Claim B is true.", materiality: true, claimFields: {} },
        ],
      });
    }
    if (path === "/v1/reviews" && method === "POST") {
      return jsonResponse(201, { review: { id: "11111111-1111-1111-1111-111111111111" } });
    }
    if (path === "/v1/evidence" && method === "POST") {
      return jsonResponse(201, { evidence: { id: "22222222-2222-2222-2222-222222222222" } });
    }
    if (path.startsWith("/v1/reviews/") && path.endsWith("/claims") && method === "POST") {
      claimCallCount += 1;
      if (claimCallCount === 1) {
        // Claim A: resolves cleanly.
        return jsonResponse(201, {
          claim: {
            id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            state: "SUPPORTED",
            state_reason: null,
            no_source: false,
            lifecycle_state: "completed",
            lifecycle_detail: null,
          },
          matches: [],
          rejectedCandidates: [],
        });
      }
      // Claim B: submission fails outright (engine 500).
      return jsonResponse(500, { error: "internal error" });
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  }) as typeof fetch;

  try {
    const { reviewAnswer } = await import("./engineClient.js");
    const result = await reviewAnswer(
      "Claim A is true. Claim B is true.",
      [{ url: "https://example.com/a", source_role: "answer_citation" }],
      "test-key",
    );

    assert.notEqual(result.status, "no_issue", "a failed claim submission must never silently collapse to no_issue");
    assert.ok(
      result.status === "could_not_check" || result.status === "issue_found",
      `expected could_not_check or issue_found, got ${result.status}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mixed review: one claim CONTRADICTED, one claim's submission fails -> issue_found, never no_issue", async () => {
  const originalFetch = globalThis.fetch;
  process.env.ENGINE_URL = "http://engine.test";
  process.env.ENGINE_API_KEY = "test-key";

  let claimCallCount = 0;
  globalThis.fetch = (async (...args: FetchArgs) => {
    const [input, init] = args;
    const path = pathOf(input);
    const method = init?.method ?? "GET";

    if (path === "/v1/extract-claims" && method === "POST") {
      return jsonResponse(200, {
        claims: [
          { ordinal: 0, text: "Claim A is true.", materiality: true, claimFields: {} },
          { ordinal: 1, text: "Claim B is true.", materiality: true, claimFields: {} },
        ],
      });
    }
    if (path === "/v1/reviews" && method === "POST") {
      return jsonResponse(201, { review: { id: "11111111-1111-1111-1111-111111111111" } });
    }
    if (path === "/v1/evidence" && method === "POST") {
      return jsonResponse(201, { evidence: { id: "22222222-2222-2222-2222-222222222222" } });
    }
    if (path.startsWith("/v1/reviews/") && path.endsWith("/claims") && method === "POST") {
      claimCallCount += 1;
      if (claimCallCount === 1) {
        return jsonResponse(201, {
          claim: {
            id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            state: "CONTRADICTED",
            state_reason: "The supplied evidence contradicts this claim.",
            no_source: false,
            lifecycle_state: "completed",
            lifecycle_detail: null,
          },
          matches: [],
          rejectedCandidates: [],
        });
      }
      // Network-level failure this time (fetch throws), not just a non-2xx.
      throw new Error("network error");
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  }) as typeof fetch;

  try {
    const { reviewAnswer } = await import("./engineClient.js");
    const result = await reviewAnswer(
      "Claim A is true. Claim B is true.",
      [{ url: "https://example.com/a", source_role: "answer_citation" }],
      "test-key",
    );

    assert.equal(result.status, "issue_found");
    assert.equal(result.findings?.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
