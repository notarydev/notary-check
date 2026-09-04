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

// Regression coverage for the parallelised claim loop (E2, 2026-09-03).
//
// Two properties, and the second is the one a naive Promise.all breaks.
//
//   1. Claims are submitted CONCURRENTLY — a five-claim review must not take
//      five sequential round trips while the MCP tool call blocks Claude's
//      turn.
//   2. Results are accumulated IN CLAIM ORDER regardless of which network
//      call returns first. The challenge/Move caps are first-come, so if
//      accumulation followed completion order, identical input would produce
//      different cards run to run and a reproduction would stop reproducing.
//
// The mock below makes the LAST claim the fastest and the FIRST the slowest,
// so completion order is the exact reverse of claim order. Anything that
// accumulates by completion would visibly mis-attribute.
test("claims are submitted concurrently but findings stay in claim order", async () => {
  const originalFetch = globalThis.fetch;
  process.env.ENGINE_URL = "http://engine.test";
  process.env.ENGINE_API_KEY = "test-key";

  const DELAYS = [120, 90, 60, 30, 10]; // claim 1 slowest, claim 5 fastest
  let inFlight = 0;
  let maxInFlight = 0;

  globalThis.fetch = (async (...args: FetchArgs) => {
    const [input, init] = args;
    const path = pathOf(input);
    const method = init?.method ?? "GET";

    if (path === "/v1/extract-claims" && method === "POST") {
      return jsonResponse(200, {
        claims: DELAYS.map((_, i) => ({
          ordinal: i,
          text: `Claim ${i + 1} is true.`,
          materiality: true,
          claimFields: {},
        })),
      });
    }
    if (path === "/v1/reviews" && method === "POST") {
      return jsonResponse(201, { review: { id: "11111111-1111-1111-1111-111111111111" } });
    }
    if (path.startsWith("/v1/reviews/") && path.endsWith("/claims") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { text: string };
      const n = Number(/Claim (\d+)/.exec(body.text)?.[1] ?? 0);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, DELAYS[n - 1]));
      inFlight -= 1;
      // Every claim comes back CONTRADICTED so each produces a finding whose
      // label is its own claim text — that label is what proves attribution.
      return jsonResponse(201, {
        claim: {
          id: `aaaaaaaa-aaaa-aaaa-aaaa-00000000000${n}`,
          state: "CONTRADICTED",
          state_reason: "contradicting_applicable_relation",
          no_source: false,
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
    const started = Date.now();
    const result = await reviewAnswer(
      DELAYS.map((_, i) => `Claim ${i + 1} is true.`).join(" "),
      [],
      "test-key",
    );
    const elapsed = Date.now() - started;

    assert.equal(result.status, "issue_found");
    assert.equal(result.findings?.length, 5, "every claim must produce a finding");

    // ORDER: findings must follow claim order, not completion order. Under a
    // completion-ordered implementation this array would read 5,4,3,2,1.
    assert.deepEqual(
      result.findings?.map((f) => f.label),
      ["Claim 1 is true.", "Claim 2 is true.", "Claim 3 is true.", "Claim 4 is true.", "Claim 5 is true."],
      "findings must be in claim order regardless of which request finished first",
    );

    // CONCURRENCY: serial would be 120+90+60+30+10 = 310ms. Generous ceiling
    // so this does not turn into a flaky timing test on a loaded machine — it
    // only needs to distinguish "concurrent" from "one at a time".
    assert.ok(maxInFlight > 1, `expected overlapping requests, saw max ${maxInFlight} in flight`);
    assert.ok(elapsed < 280, `expected concurrency to beat the 310ms serial sum, took ${elapsed}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Regression coverage for the detector bank being wired in (2026-09-04).
//
// The property that was broken: a review with NO material claims returned
// immediately, so the detector bank never ran and Move never ran. Measured
// over 51 real transcripts, ~37% of substantive answers have material for no
// detector at all — those are exactly the turns where Verify has nothing and
// Act is the entire product, and it was silent on all of them.
test("zero material claims still runs detection and can return moves", async () => {
  const originalFetch = globalThis.fetch;
  process.env.ENGINE_URL = "http://engine.test";
  process.env.ENGINE_API_KEY = "test-key";

  let detectCalled = false;
  globalThis.fetch = (async (...args: FetchArgs) => {
    const [input, init] = args;
    const path = pathOf(input);
    const method = init?.method ?? "GET";

    if (path === "/v1/extract-claims" && method === "POST") {
      // A real extraction that found nothing material — not a failure.
      return jsonResponse(200, { claims: [] });
    }
    if (path === "/v1/reviews" && method === "POST") {
      return jsonResponse(201, { review: { id: "11111111-1111-1111-1111-111111111111" } });
    }
    if (path.endsWith("/detect") && method === "POST") {
      detectCalled = true;
      const body = JSON.parse(String(init?.body ?? "{}")) as { user_request?: string };
      assert.equal(body.user_request, "Should I use Postgres or DynamoDB?", "the task must reach detection");
      return jsonResponse(200, {
        findings: [],
        gaps: [],
        moves: [
          { id: "s1", short_label: "Compare write throughput", move: "compare", prompt: "Compare write throughput." },
        ],
      });
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  }) as typeof fetch;

  try {
    const { reviewAnswer } = await import("./engineClient.js");
    const result = await reviewAnswer("Both databases would work here.", [], "test-key", {
      userRequest: "Should I use Postgres or DynamoDB?",
    });
    assert.ok(detectCalled, "detection must run even with zero material claims");
    assert.equal(result.status, "no_issue");
    assert.equal(result.moves?.length, 1, "Act must produce value with no claims and no sources");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a bank finding surfaces even when the claim itself is SUPPORTED", async () => {
  // The case that breaks the old model: source-verify says fine, the bank says
  // the answer contradicts itself. Both are right, and "is there a problem?"
  // is no longer readable off claim.state alone.
  const originalFetch = globalThis.fetch;
  process.env.ENGINE_URL = "http://engine.test";
  process.env.ENGINE_API_KEY = "test-key";

  globalThis.fetch = (async (...args: FetchArgs) => {
    const [input, init] = args;
    const path = pathOf(input);
    const method = init?.method ?? "GET";

    if (path === "/v1/extract-claims" && method === "POST") {
      return jsonResponse(200, { claims: [{ ordinal: 0, text: "Claim A.", materiality: true, claimFields: {} }] });
    }
    if (path === "/v1/reviews" && method === "POST") {
      return jsonResponse(201, { review: { id: "11111111-1111-1111-1111-111111111111" } });
    }
    if (path.startsWith("/v1/reviews/") && path.endsWith("/claims") && method === "POST") {
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
    if (path.endsWith("/detect") && method === "POST") {
      return jsonResponse(200, {
        // Shaped exactly like real engine output. An earlier version of this
        // fixture omitted `detector` and `fieldDeltas`, which parseBankFindings
        // correctly rejects — the parser was right and the fixture was thin,
        // which is the same class of miss that hid three bugs today.
        findings: [
          {
            detector: "self_contradiction",
            type: "internal_conflict",
            owner: "computed",
            boundaryText: "The answer states X and also not-X.",
            fieldDeltas: [{ field: "valueUnit", claimed: "17%", observed: "12%", relation: "conflict" }],
            basis: { kind: "answer_internal" },
            rank: 20,
            detectorVersion: "self-contradiction-v1",
          },
        ],
        gaps: [],
        moves: [],
      });
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  }) as typeof fetch;

  try {
    const { reviewAnswer } = await import("./engineClient.js");
    const result = await reviewAnswer("Claim A.", [], "test-key", { userRequest: "check this" });
    assert.equal(result.status, "issue_found", "a bank finding must surface even when the claim is SUPPORTED");
    // It reaches the card through bank_findings, NOT through `findings`.
    // `findings` is Verify's evidence-backed list, and a bank finding has no
    // evidence by nature — self-contradiction compares the answer against
    // itself. Merging them printed "No resolved evidence is on record" in
    // warning styling on a finding that was working exactly as designed.
    assert.ok(
      result.bank_findings?.some((f) => f.boundary_text.includes("states X and also not-X")),
      "the bank's finding must reach the card through its own field",
    );
    assert.ok(
      !(result.findings ?? []).some((f) => f.text.includes("states X and also not-X")),
      "and must NOT be mixed into Verify's evidence-backed findings",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// The back-and-forth: what could not be checked reaches the caller as a FACT.
test("a gap from the engine reaches the card, capped at two", async () => {
  const originalFetch = globalThis.fetch;
  process.env.ENGINE_URL = "http://engine.test";
  process.env.ENGINE_API_KEY = "test-key";

  globalThis.fetch = (async (...args: FetchArgs) => {
    const [input, init] = args;
    const path = pathOf(input);
    const method = init?.method ?? "GET";
    if (path === "/v1/extract-claims" && method === "POST") return jsonResponse(200, { claims: [] });
    if (path === "/v1/reviews" && method === "POST") {
      return jsonResponse(201, { review: { id: "11111111-1111-1111-1111-111111111111" } });
    }
    if (path.endsWith("/detect") && method === "POST") {
      return jsonResponse(200, {
        findings: [],
        // Three gaps offered; the cap must keep two. Each gap can trigger a
        // full re-invocation, so ten would be ten round trips of latency.
        gaps: [
          { detector: "self_report", missing: "execution_result", unblocks: "check whether the output supports the claim that this worked" },
          { detector: "source_verify", missing: "addressable_source", unblocks: "check the FY25 revenue figure" },
          { detector: "source_verify", missing: "addressable_source", unblocks: "check the headcount figure" },
        ],
        moves: [],
      });
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  }) as typeof fetch;

  try {
    const { reviewAnswer } = await import("./engineClient.js");
    const result = await reviewAnswer("I fixed it and all tests pass.", [], "test-key", {
      userRequest: "fix the failing test",
    });
    assert.equal(result.gaps?.length, 2, "at most two gaps reach the card");
    assert.ok(result.gaps?.[0].unblocks.includes("supports the claim"), "the gap text is what would become checkable");
    // A gap is a statement of fact, not a request. Nothing here may read as an
    // instruction to the model — that was the injected-instruction bug.
    for (const g of result.gaps ?? []) {
      assert.ok(!/^(please|send|attach|supply|call|provide)\b/i.test(g.unblocks), "a gap must not be phrased as a command");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("malformed gaps are dropped rather than trusted", async () => {
  const originalFetch = globalThis.fetch;
  process.env.ENGINE_URL = "http://engine.test";
  process.env.ENGINE_API_KEY = "test-key";

  globalThis.fetch = (async (...args: FetchArgs) => {
    const [input, init] = args;
    const path = pathOf(input);
    const method = init?.method ?? "GET";
    if (path === "/v1/extract-claims" && method === "POST") return jsonResponse(200, { claims: [] });
    if (path === "/v1/reviews" && method === "POST") {
      return jsonResponse(201, { review: { id: "11111111-1111-1111-1111-111111111111" } });
    }
    if (path.endsWith("/detect") && method === "POST") {
      return jsonResponse(200, {
        gaps: [{ missing: "" }, { unblocks: "no missing field" }, "a string", null, { missing: "x", unblocks: "y" }],
        moves: [],
      });
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  }) as typeof fetch;

  try {
    const { reviewAnswer } = await import("./engineClient.js");
    const result = await reviewAnswer("Something.", [], "test-key", { userRequest: "check" });
    assert.equal(result.gaps?.length, 1, "only the well-formed gap survives");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
