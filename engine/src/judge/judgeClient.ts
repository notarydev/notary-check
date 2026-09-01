// The constrained judge's DeepSeek chat-completions client (§ LLM judge design;
// § Judge authority boundary).
//
// What this module is: a THIN HTTP client. It serializes a chat-completions
// request to DeepSeek and returns the raw assistant answer plus the provenance
// needed to satisfy § Judge authority boundary requirement #6 ("persist the
// judge model, prompt version, question, evidence locator, and answer"). It has
// no opinion about what the answer means — parsing into the four-outcome
// vocabulary is fieldExtraction.ts's job.
//
// Architectural enforcement of the closed-authority contract, in code, not just
// prompt text:
//
//   - NO TOOLS / FUNCTION-CALLING: the request body is constructed here with no
//     `tools` key and no `tool_choice` key, and the input type has no place to
//     express a tool. A call can therefore never ask the model to retrieve,
//     browse, or run a function — the "closed authority, no retrieval, no
//     tools" boundary (§ Judge authority boundary) is structural, not a prompt
//     instruction.
//   - NO RETRIEVAL: there is no search/retrieval hook or parameter anywhere in
//     this module. The only text that reaches the model is the delimited
//     evidence passage the caller supplies.
//   - INJECTABLE TRANSPORT: the underlying HTTP call is a constructor option
//     (`httpCall`, defaulting to `globalThis.fetch`), mirroring the injectable
//     `resolve` / `createConnection` seams in safeFetch.ts, so unit tests never
//     need real network access by default.
//
// Model choice: DeepSeek's current Flash model, `deepseek-v4-flash`, confirmed
// against the DeepSeek API docs (Models & Pricing, retrieved 2026-09-01) and
// consistent with plan.md § Operating cost's "DeepSeek Flash" assumption ($0.22
// per million input / $0.66 per million output tokens, off-peak cache-miss). It
// is deliberately a different model family from the generator (Claude),
// per § Model choice: the invariant is that the judge never gets the final
// word, and a different family additionally reduces correlated judge/generator
// failure modes.

export const DEFAULT_JUDGE_MODEL = "deepseek-v4-flash";
export const DEFAULT_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_MAX_TOKENS = 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;

export type JudgeRole = "system" | "user" | "assistant";
export interface JudgeMessage {
  role: JudgeRole;
  content: string;
}

/** Everything a single judge call needs, plus what to persist. */
export interface JudgeCallInput {
  /** Overrides the client's model for this call. Defaults to the client model. */
  model?: string;
  /** Prompt version string, persisted with the call (§ requirement #6). */
  promptVersion: string;
  /** The narrow extraction question, persisted with the call. */
  question: string;
  /** The conversation to send. Built by promptTemplates/fieldExtraction. */
  messages: JudgeMessage[];
  /** The resolved evidence locator being interpreted, if provided (§ requirement #1). */
  evidenceLocator?: string;
  maxTokens?: number;
}

/**
 * The persisted record for one judge call (§ Judge authority boundary
 * requirement #6). Deliberately carries everything a DB row would need later:
 * model, prompt version, question, evidence locator, and answer (or the error
 * that prevented an answer). No DB is wired up in this build step — the record
 * IS the persistence contract, and callers (fieldExtraction.ts) never drop it.
 */
export interface JudgeCallRecord {
  model: string;
  promptVersion: string;
  question: string;
  evidenceLocator?: string;
  /** The raw assistant answer when the call resolved; absent on error. */
  answer?: string;
  /** Machine-readable failure reason when the call did not resolve. */
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type JudgeCallResult =
  | { status: "ok"; record: JudgeCallRecord }
  | { status: "error"; record: JudgeCallRecord };

/** The injectable transport seam, mirroring safeFetch.ts's injectable seams. */
export type JudgeHttpCall = (url: string, init: RequestInit) => Promise<Response>;

export interface JudgeClientOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  httpCall?: JudgeHttpCall;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface JudgeClient {
  call(input: JudgeCallInput): Promise<JudgeCallResult>;
}

/** Thrown when the client cannot be configured (missing API key). */
export class JudgeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JudgeConfigError";
  }
}

/**
 * Creates a judge client. Never throws after construction except for a missing
 * API key (a loud configuration error); transport failures during a call are
 * returned as `{ status: "error", record }` so the caller can map them to
 * cannot_be_determined without crashing.
 */
export function createJudgeClient(options: JudgeClientOptions = {}): JudgeClient {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new JudgeConfigError("DEEPSEEK_API_KEY is not set; the judge cannot be called");
  }
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const clientModel = options.model ?? DEFAULT_JUDGE_MODEL;
  const clientMaxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const httpCall = options.httpCall ?? defaultHttpCall;

  return {
    async call(input: JudgeCallInput): Promise<JudgeCallResult> {
      const model = input.model ?? clientModel;
      const record: JudgeCallRecord = {
        model,
        promptVersion: input.promptVersion,
        question: input.question,
        evidenceLocator: input.evidenceLocator,
      };
      const url = `${baseUrl}/chat/completions`;

      // NOTE the deliberate absences, per the module header: no `tools`, no
      // `tool_choice`, no retrieval parameter. This is the architectural
      // enforcement, not a prompt instruction.
      const body = {
        model,
        messages: input.messages,
        // Implementation choice for extraction determinism (not a plan-mandated
        // decision): temperature 0 and non-thinking mode keep the structured
        // output stable and the calls cheap.
        temperature: 0,
        max_tokens: input.maxTokens ?? clientMaxTokens,
        stream: false,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
      };

      let response: Response;
      try {
        response = await httpCall(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        return {
          status: "error",
          record: {
            ...record,
            error: isTimeout ? "judge_timeout" : `judge_http_call_failed: ${(err as Error)?.message ?? "unknown"}`,
          },
        };
      }

      if (!response.ok) {
        let detail = "";
        try {
          detail = (await response.text()).slice(0, 500);
        } catch {
          // ignore body read failure; the status code is the signal.
        }
        return { status: "error", record: { ...record, error: `judge_http_${response.status}: ${detail}` } };
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return { status: "error", record: { ...record, error: "judge_response_not_json" } };
      }

      const parsed = parseChatCompletion(json);
      if (!parsed.ok) {
        return { status: "error", record: { ...record, error: parsed.error } };
      }
      record.answer = parsed.data.answer;
      record.inputTokens = parsed.data.inputTokens;
      record.outputTokens = parsed.data.outputTokens;
      return { status: "ok", record };
    },
  };
}

async function defaultHttpCall(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

interface ChatCompletionData {
  answer: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Parses a non-streaming OpenAI-compatible chat completion response. Exported
 * for unit testing the response-shape handling in isolation.
 */
export function parseChatCompletion(
  json: unknown,
): { ok: true; data: ChatCompletionData } | { ok: false; error: string } {
  if (typeof json !== "object" || json === null) {
    return { ok: false, error: "judge_response_not_object" };
  }
  const obj = json as Record<string, unknown>;
  if (!Array.isArray(obj.choices) || obj.choices.length === 0) {
    return { ok: false, error: "judge_response_empty_choices" };
  }
  const first = obj.choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    return { ok: false, error: "judge_response_empty_content" };
  }
  const usage = obj.usage as Record<string, unknown> | undefined;
  const inputTokens = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  const outputTokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined;
  return { ok: true, data: { answer: content, inputTokens, outputTokens } };
}
