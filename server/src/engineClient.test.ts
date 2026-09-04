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
            // A real snake_case internal code, as engine/src/verification/stateMachine.ts
            // actually returns — not prose. Regression coverage for the bug where
            // engineClient.ts spliced this raw code into the card's display text.
            state_reason: "contradicting_applicable_relation",
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
    assert.equal(
      result.findings?.[0]?.text,
      "The supplied evidence contradicts this claim.",
      "the card must show fixed human-readable copy, never the raw internal state_reason code",
    );
    assert.doesNotMatch(
      result.findings?.[0]?.text ?? "",
      /_/,
      "finding text must never contain a raw snake_case internal code",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("review creation fails outright (engine 500, non-JSON body) -> could_not_check, never an unhandled rejection", async () => {
  const originalFetch = globalThis.fetch;
  process.env.ENGINE_URL = "http://engine.test";
  process.env.ENGINE_API_KEY = "test-key";

  globalThis.fetch = (async (...args: FetchArgs) => {
    const [input, init] = args;
    const path = pathOf(input);
    const method = init?.method ?? "GET";

    if (path === "/v1/extract-claims" && method === "POST") {
      return jsonResponse(200, {
        claims: [{ ordinal: 0, text: "Claim A is true.", materiality: true, claimFields: {} }],
      });
    }
    if (path === "/v1/reviews" && method === "POST") {
      // Simulates an upstream failure that returns something createReview()'s
      // `body.review.id` access cannot handle — e.g. a load balancer's HTML
      // error page on a 502/503, not a JSON error body. Before the fix, this
      // threw out of reviewAnswer() with no boundary to catch it.
      return new Response("<html>Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  }) as typeof fetch;

  try {
    const { reviewAnswer } = await import("./engineClient.js");
    const result = await reviewAnswer("Claim A is true.", [], "test-key");

    assert.equal(result.status, "could_not_check");
    assert.match(result.scope, /could not complete this review/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Regression coverage for the no_source / could_not_check conflation
// (2026-09-03). A claim the model stated from its own knowledge, with no
// source attached, is the ORDINARY case — not a malfunction. It used to share
// `uncheckedFindings` with genuine faults and return `could_not_check`, making
// an unsourced answer indistinguishable from "Notary broke".
//
// It must now return `not_checked`, and specifically NOT `no_issue` — the
// canonical definition § 5.7 forbids rendering `no_source` as "fine". Both
// halves of that are asserted below, because collapsing into either neighbour
// is a real, separately-tempting mistake.
test("claims with no source supplied -> not_checked, never could_not_check and never no_issue", async () => {
  const originalFetch = globalThis.fetch;
  process.env.ENGINE_URL = "http://engine.test";
  process.env.ENGINE_API_KEY = "test-key";

  globalThis.fetch = (async (...args: FetchArgs) => {
    const [input, init] = args;
    const path = pathOf(input);
    const method = init?.method ?? "GET";

    if (path === "/v1/extract-claims" && method === "POST") {
      return jsonResponse(200, {
        claims: [{ ordinal: 0, text: "Tokyo has about 14 million residents.", materiality: true, claimFields: {} }],
      });
    }
    if (path === "/v1/reviews" && method === "POST") {
      return jsonResponse(201, { review: { id: "11111111-1111-1111-1111-111111111111" } });
    }
    if (path.startsWith("/v1/reviews/") && path.endsWith("/claims") && method === "POST") {
      // The engine resolved the claim fine — there was simply nothing to
      // check it against. lifecycle_state is `completed`: nothing failed.
      return jsonResponse(201, {
        claim: {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          state: "INDETERMINATE",
          state_reason: "no_inspectable_evidence",
          no_source: true,
          lifecycle_state: "completed",
          lifecycle_detail: null,
        },
        matches: [],
        rejectedCandidates: [],
      });
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  }) as typeof fetch;

  try {
    const { reviewAnswer } = await import("./engineClient.js");
    // No sources at all — the whole point of the case.
    const result = await reviewAnswer("Tokyo has about 14 million residents.", [], "test-key");

    assert.equal(result.status, "not_checked", `expected not_checked, got ${result.status}`);
    assert.notEqual(
      result.status,
      "could_not_check",
      "an unsourced claim is not a failure — that conflation is what made a working Notary look broken",
    );
    assert.notEqual(
      result.status,
      "no_issue",
      "canonical § 5.7: no_source must never be rendered as 'fine'",
    );
    assert.equal(result.findings, undefined, "not_checked must carry no findings — there is nothing to surface");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
