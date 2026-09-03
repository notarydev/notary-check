// Real end-to-end tests for POST /v1/extract-claims — same pattern as
// reviews.test.ts: the actual express router against a real Postgres, driven
// over real HTTP, skipping cleanly when no test database is configured. The
// auth check is real (Bearer key → org derived from the key); the extraction
// itself uses a MOCKED judge client so the route never touches the network.
//
// Covers: a valid key extracts claims through the mocked judge, missing/garbage
// keys are rejected with 401, a non-empty answer_text is required (400), and
// the injected mocked client is what actually receives the call.

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import type pg from "pg";
import { issueApiKey } from "../auth/apiKey.ts";
import { DEFAULT_JUDGE_MODEL, type JudgeCallInput, type JudgeCallResult, type JudgeClient } from "../judge/judgeClient.ts";
import { createOrganization, freshPool, HAS_DB } from "../test/db.ts";
import { extractClaimsRouter } from "./extractClaims.ts";

const skip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

const ANSWER = "Acme's revenue grew 17% in FY25.";

/** A mocked judge client answering the extraction call with the flagship single
 * claim — proves the route handed the answer_text to extraction and returned
 * the parsed claims without any real network. */
function fakeExtractionClient(): { client: JudgeClient; calls: JudgeCallInput[] } {
  const calls: JudgeCallInput[] = [];
  const client: JudgeClient = {
    async call(input: JudgeCallInput): Promise<JudgeCallResult> {
      calls.push(input);
      return {
        status: "ok",
        record: {
          model: input.model ?? DEFAULT_JUDGE_MODEL,
          promptVersion: input.promptVersion,
          question: input.question,
          answer: JSON.stringify({
            claims: [
              {
                reasoning: "1. One factual clause. 2. Acme, 17%, FY25.",
                text: "Acme's revenue grew 17% in FY25.",
                materiality: true,
                claim_fields: {
                  entity: "Acme",
                  period: "FY25",
                  metric: "revenue",
                  operator: "increase",
                  value_unit: { value: "17", unit: "%" },
                },
              },
            ],
          }),
        },
      };
    },
  };
  return { client, calls };
}

interface TestServer {
  baseUrl: string;
  pool: pg.Pool;
  close: () => Promise<void>;
}

async function startServer(injected?: JudgeClient): Promise<TestServer> {
  const pool: pg.Pool = await freshPool();
  const client = injected ?? fakeExtractionClient().client;
  const app = express();
  app.use(express.json());
  app.use(extractClaimsRouter(pool, { client }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    pool,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await pool.end();
    },
  };
}

async function postExtractClaims(
  server: TestServer,
  opts: { bearer?: string; body?: Record<string, unknown> },
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.bearer !== undefined) headers.authorization = `Bearer ${opts.bearer}`;
  return fetch(`${server.baseUrl}/v1/extract-claims`, {
    method: "POST",
    headers,
    body: JSON.stringify({ answer_text: ANSWER, ...opts.body }),
  });
}

test(
  "POST /v1/extract-claims: a valid API key extracts claims via the mocked judge",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      const res = await postExtractClaims(server, { bearer: plaintextKey });
      assert.equal(res.status, 200);
      const json = (await res.json()) as {
        claims: Array<{
          ordinal: number;
          text: string;
          materiality: boolean;
          claimFields: { entity: string; period: string; valueUnit: { value: string; unit: string } };
        }>;
      };
      assert.equal(json.claims.length, 1);
      assert.equal(json.claims[0].ordinal, 1);
      assert.equal(json.claims[0].text, "Acme's revenue grew 17% in FY25.");
      assert.equal(json.claims[0].materiality, true);
      // camelCase keys survive to the response — this new endpoint is not bound
      // by evidence.ts's snake_case convention.
      assert.equal(json.claims[0].claimFields.entity, "Acme");
      assert.equal(json.claims[0].claimFields.period, "FY25");
      assert.deepEqual(json.claims[0].claimFields.valueUnit, { value: "17", unit: "%" });
      // REGRESSION (audit bug 2): a successful response says so explicitly, and
      // says how far the claims got. A claim that has only been EXTRACTED has
      // not been verified against anything, and no caller may read it as checked.
      const meta = json as unknown as { extraction_status: string; lifecycle_state: string; dropped_claim_count: number };
      assert.equal(meta.extraction_status, "ok");
      assert.equal(meta.lifecycle_state, "extracted");
      assert.equal(meta.dropped_claim_count, 0);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/extract-claims: missing and garbage keys are rejected with 401",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const missing = await postExtractClaims(server, {});
      assert.equal(missing.status, 401);

      const garbage = await postExtractClaims(server, { bearer: "not-a-real-key" });
      assert.equal(garbage.status, 401);

      const forged = await postExtractClaims(server, { bearer: "Bearer sk-evil" });
      assert.equal(forged.status, 401);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/extract-claims: a missing or empty answer_text is rejected with 400",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);
      const bearer = { bearer: plaintextKey };

      const missing = await postExtractClaims(server, { ...bearer, body: { answer_text: undefined } });
      assert.equal(missing.status, 400);

      const empty = await postExtractClaims(server, { ...bearer, body: { answer_text: "" } });
      assert.equal(empty.status, 400);
    } finally {
      await server.close();
    }
  },
);

// ---------------------------------------------------------------------------
// REGRESSION (audit bug 2) — the response CONTRACT is the fix.
//
// This route used to answer 200 { claims: [] } for a broken extractor and
// 200 { claims: [] } for an answer with nothing checkable in it — byte-identical
// responses for two situations that must never be shown to a user the same way.
// server/src/engineClient.ts reads an empty claim list as the `no_issue` card,
// so a provider outage or a blown spend cap rendered as "no issue found".
// ---------------------------------------------------------------------------

test(
  "POST /v1/extract-claims: an answer with no checkable claims is a 200 SUCCESS with an empty list",
  { ...skip },
  async () => {
    // The case that must keep working: this is a real, reportable finding.
    const emptyClient: JudgeClient = {
      async call(input: JudgeCallInput): Promise<JudgeCallResult> {
        return {
          status: "ok",
          record: { model: input.model ?? DEFAULT_JUDGE_MODEL, promptVersion: input.promptVersion, question: input.question, answer: JSON.stringify({ claims: [] }) },
        };
      },
    };
    const server = await startServer(emptyClient);
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);
      const res = await postExtractClaims(server, { bearer: plaintextKey });
      assert.equal(res.status, 200);
      const json = (await res.json()) as { extraction_status: string; claims: unknown[] };
      assert.equal(json.extraction_status, "ok");
      assert.deepEqual(json.claims, []);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/extract-claims: a provider failure is 502 and carries NO claims key at all",
  { ...skip },
  async () => {
    const brokenClient: JudgeClient = {
      async call(): Promise<JudgeCallResult> {
        throw new Error("provider down");
      },
    };
    const server = await startServer(brokenClient);
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);
      const res = await postExtractClaims(server, { bearer: plaintextKey });

      assert.equal(res.status, 502, "a broken extractor is not a successful review");
      const json = (await res.json()) as Record<string, unknown>;
      assert.equal(json.extraction_status, "failed");
      assert.equal(json.reason, "judge_client_threw");
      assert.equal(json.lifecycle_state, "not_extracted");
      // The belt-and-braces half: a client that ignores status codes and reads
      // body.claims gets undefined, not an empty array it could mistake for
      // "nothing to report".
      assert.equal("claims" in json, false, "a failure response must not carry a claims key");
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/extract-claims: a denied quota is 429, makes no model call, and carries no claims key",
  { ...skip },
  async () => {
    // REGRESSION (audit bug 5) at the HTTP boundary. Extraction was previously
    // ungated entirely: any valid API key could drive unlimited DeepSeek calls
    // past both the per-org monthly limit and the global spend cap.
    let called = false;
    const countingClient: JudgeClient = {
      async call(input: JudgeCallInput): Promise<JudgeCallResult> {
        called = true;
        return {
          status: "ok",
          record: { model: input.model ?? DEFAULT_JUDGE_MODEL, promptVersion: input.promptVersion, question: input.question, answer: JSON.stringify({ claims: [] }) },
        };
      },
    };
    const originalLimit = process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
    process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = "0";
    const server = await startServer(countingClient);
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);
      const res = await postExtractClaims(server, { bearer: plaintextKey });

      assert.equal(res.status, 429);
      const json = (await res.json()) as Record<string, unknown>;
      assert.equal(json.reason, "quota_denied");
      assert.equal("claims" in json, false);
      assert.equal(called, false, "a denied quota must cost zero network traffic");
    } finally {
      if (originalLimit === undefined) delete process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS;
      else process.env.NOTARY_ORG_MONTHLY_LIMIT_CENTS = originalLimit;
      await server.close();
    }
  },
);
