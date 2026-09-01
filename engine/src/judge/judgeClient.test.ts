// Unit tests for the DeepSeek judge client (engine/src/judge/judgeClient.ts).
// All HTTP is injected via a mocked httpCall — no real network access anywhere
// in this file. Focus: request shaping (correct endpoint/headers/body, and the
// structural absence of tools/retrieval), response parsing, error mapping, and
// the persistence record (§ Judge authority boundary requirement #6).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  createJudgeClient,
  DEFAULT_JUDGE_MODEL,
  parseChatCompletion,
  type JudgeCallInput,
  type JudgeHttpCall,
} from "./judgeClient.ts";

interface CapturedRequest {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function okCompletion(answer: string, usage?: { prompt_tokens?: number; completion_tokens?: number }): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "deepseek-v4-flash",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: answer } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, ...usage },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Builds a mocked httpCall that records the request and returns `respond`. */
function recordingHttpCall(respond: () => Response): { httpCall: JudgeHttpCall; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const httpCall: JudgeHttpCall = async (url, init) => {
    captured.push({ url, init, body: JSON.parse(String(init.body)) });
    return respond();
  };
  return { httpCall, captured };
}

const INPUT: JudgeCallInput = {
  model: "deepseek-v4-flash",
  promptVersion: "judge-field-extraction-v1",
  question: "What entity do the figures refer to?",
  messages: [
    { role: "system", content: "you extract one field per call" },
    { role: "user", content: "evidence <<<EVIDENCE:0000000000000000:START>>>\nAcme\n<<<EVIDENCE:0000000000000000:END>>>" },
  ],
  evidenceLocator: "evidence://sha256:abc123",
};

const originalKey = process.env.DEEPSEEK_API_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
});

test("sends an OpenAI-compatible chat completion to the DeepSeek endpoint and records full provenance", async () => {
  const { httpCall, captured } = recordingHttpCall(() => okCompletion('{"outcome":"present","value":"Acme","reasoning":"x"}'));
  const client = createJudgeClient({ apiKey: "sk-test", httpCall });

  const result = await client.call(INPUT);
  assert.equal(result.status, "ok");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(captured[0].init.method, "POST");
  const headers = captured[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer sk-test");
  assert.equal(headers["Content-Type"], "application/json");
  const body = captured[0].body;
  assert.equal(body.model, "deepseek-v4-flash");
  assert.deepEqual(body.messages, INPUT.messages);
  assert.equal(body.stream, false);

  // § requirement #6: the returned record carries model, prompt version,
  // question, evidence locator, and answer.
  assert.ok(result.status === "ok");
  assert.equal(result.record.model, "deepseek-v4-flash");
  assert.equal(result.record.promptVersion, "judge-field-extraction-v1");
  assert.equal(result.record.question, INPUT.question);
  assert.equal(result.record.evidenceLocator, INPUT.evidenceLocator);
  assert.equal(result.record.answer, '{"outcome":"present","value":"Acme","reasoning":"x"}');
  assert.equal(result.record.inputTokens, 100);
  assert.equal(result.record.outputTokens, 20);
});

test("architectural enforcement: the request body carries no tools, no tool_choice, and no retrieval", async () => {
  const { httpCall, captured } = recordingHttpCall(() => okCompletion("{}"));
  const client = createJudgeClient({ apiKey: "sk-test", httpCall });
  await client.call(INPUT);

  const body = captured[0].body;
  assert.ok(!("tools" in body), "request must never declare tools/function-calling");
  assert.ok(!("tool_choice" in body), "request must never select a tool");
  const messageText = body.messages as Array<{ content: string }>;
  const allText = messageText.map((m) => m.content).join("\n");
  assert.ok(!allText.includes("http"), "no retrieval/search instruction may reach the model");
});

test("reads the API key from process.env.DEEPSEEK_API_KEY when not passed", async () => {
  process.env.DEEPSEEK_API_KEY = "sk-from-env";
  const { httpCall, captured } = recordingHttpCall(() => okCompletion("{}"));
  const client = createJudgeClient({ httpCall });
  await client.call(INPUT);
  const headers = captured[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer sk-from-env");
});

test("throws JudgeConfigError when no API key is configured anywhere", () => {
  delete process.env.DEEPSEEK_API_KEY;
  assert.throws(() => createJudgeClient(), /DEEPSEEK_API_KEY/);
});

test("a non-2xx response returns an error record that still carries the provenance", async () => {
  const { httpCall } = recordingHttpCall(() => new Response("insufficient balance", { status: 402 }));
  const client = createJudgeClient({ apiKey: "sk-test", httpCall });
  const result = await client.call(INPUT);

  assert.equal(result.status, "error");
  assert.match(result.record.error ?? "", /judge_http_402/);
  // Persistence must not be dropped on failure either.
  assert.equal(result.record.model, "deepseek-v4-flash");
  assert.equal(result.record.promptVersion, INPUT.promptVersion);
  assert.equal(result.record.question, INPUT.question);
  assert.equal(result.record.evidenceLocator, INPUT.evidenceLocator);
});

test("an empty assistant content returns an error record, never a crash", async () => {
  const emptyContent = new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content: "" } }] }),
    { status: 200 },
  );
  const { httpCall } = recordingHttpCall(() => emptyContent);
  const client = createJudgeClient({ apiKey: "sk-test", httpCall });
  const result = await client.call(INPUT);
  assert.equal(result.status, "error");
  assert.match(result.record.error ?? "", /empty_content/);
});

test("a transport abort maps to a judge_timeout error record", async () => {
  const httpCall: JudgeHttpCall = async () => {
    const err = new Error("aborted") as Error & { name: string };
    err.name = "AbortError";
    throw err;
  };
  const client = createJudgeClient({ apiKey: "sk-test", httpCall });
  const result = await client.call(INPUT);
  assert.equal(result.status, "error");
  assert.equal(result.record.error, "judge_timeout");
});

test("parseChatCompletion: valid shape, empty choices, and empty content are handled distinctly", () => {
  const ok = parseChatCompletion({
    choices: [{ message: { content: "hi" } }],
    usage: { prompt_tokens: 5, completion_tokens: 7 },
  });
  assert.deepEqual(ok, { ok: true, data: { answer: "hi", inputTokens: 5, outputTokens: 7 } });

  assert.deepEqual(parseChatCompletion({ choices: [] }), { ok: false, error: "judge_response_empty_choices" });
  assert.deepEqual(parseChatCompletion({ choices: [{ message: { content: "" } }] }), {
    ok: false,
    error: "judge_response_empty_content",
  });
  assert.deepEqual(parseChatCompletion(null), { ok: false, error: "judge_response_not_object" });
});
