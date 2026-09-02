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

async function startServer(): Promise<TestServer> {
  const pool: pg.Pool = await freshPool();
  const { client } = fakeExtractionClient();
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
