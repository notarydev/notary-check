import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { logEvent } from "./log.ts";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.DD_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.DD_API_KEY;
  else process.env.DD_API_KEY = originalApiKey;
});

test("logEvent never ships to Datadog when DD_API_KEY is unset", () => {
  delete process.env.DD_API_KEY;
  let called = false;
  globalThis.fetch = (() => {
    called = true;
    return Promise.resolve(new Response("", { status: 202 }));
  }) as typeof fetch;

  logEvent({ event: "test_event" });
  assert.equal(called, false);
});

test("logEvent ships one POST to Datadog's Logs Intake API when DD_API_KEY is set", async () => {
  process.env.DD_API_KEY = "test-key";
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  let resolveFetch: () => void = () => {};
  const fetchCalled = new Promise<void>((resolve) => {
    resolveFetch = resolve;
  });
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = typeof input === "string" ? input : input.toString();
    capturedInit = init;
    resolveFetch();
    return Promise.resolve(new Response("", { status: 202 }));
  }) as typeof fetch;

  logEvent({ event: "judge_call", latency_ms: 42, organization_id: "org-1" });
  await fetchCalled;

  assert.equal(capturedUrl, "https://http-intake.logs.datadoghq.com/api/v2/logs");
  assert.equal(capturedInit?.method, "POST");
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers["dd-api-key"], "test-key");
  const body = JSON.parse(capturedInit?.body as string);
  assert.equal(body[0].service, "notary-check-engine");
  assert.equal(body[0].event, "judge_call");
  assert.equal(body[0].latency_ms, 42);
});

test("logEvent never throws and never blocks when Datadog shipping fails", () => {
  process.env.DD_API_KEY = "test-key";
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  assert.doesNotThrow(() => logEvent({ event: "test_event" }));
});
