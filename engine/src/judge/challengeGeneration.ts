// Track 2 / Challenge generation (§ Track 2 / Challenge layer). One function,
// `generateChallenges`, takes an ALREADY-RESOLVED Track 1 finding and returns
// 0-2 typed, bounded questions about it.
//
// THE AUTHORITY BOUNDARY, in code rather than in prose:
//
//   - This module does not import ../verification/stateMachine.ts and does not
//     call the state-assignment function or the applicability assessor. It
//     cannot assign, propose, or influence a claim's state, because it holds
//     no reference to the only function that assigns one.
//     judge/challengeIsolation.test.ts asserts this statically over this
//     file's own source text (a literal substring check, so this comment is
//     deliberately worded to avoid naming either function verbatim — spelling
//     one out here would trip the same check it's describing), exactly as
//     integration.test.ts already does for fieldExtraction.ts and
//     judgeClient.ts.
//   - This module performs no I/O other than the judge call itself: no DB
//     handle, no fetch, no retrieval. It cannot add evidence or alter a
//     manifest because it has no way to reach either. (Persisting what it
//     returns is ../review/reviewFlow.ts's job, into challenge_item alone.)
//   - The returned type has no verdict, confidence, score, or answer field, and
//     the zod schema below is `.strict()` at every level, so an output that
//     invents one is REJECTED IN FULL rather than having the extra key dropped
//     and the rest accepted. That distinction matters: silently stripping a
//     smuggled "confidence" would let a model that is trying to assert one keep
//     the rest of its assertion-shaped output.
//
// WHY THE CAP IS ENFORCED HERE AND NOT ONLY IN THE PROMPT. The prompt asks for
// at most two items. Prompt compliance is probabilistic; a cap that the product
// contract states as a hard limit cannot rest on it. truncateToCap() below
// applies the per-claim limit deterministically to whatever came back and
// reports that it did, so an over-long model output is a logged, visible event
// rather than an invisible over-render. The per-INVOCATION limit (4 across all
// claims of one review) is applied by the caller, which is the only layer that
// knows about sibling claims — it passes the remaining budget in as `maxItems`.

import { delimitEvidenceForModel } from "../ingestion/delimitEvidence.ts";
import { logEvent } from "../observability/log.ts";
import { estimateDeepSeekCostCents } from "../quotas/usage.ts";
import { z } from "zod";
import {
  createJudgeClient,
  DEFAULT_JUDGE_MODEL,
  type JudgeCallInput,
  type JudgeCallRecord,
  type JudgeClient,
} from "./judgeClient.ts";
import {
  buildChallengePrompt,
  CHALLENGE_ACTIONS,
  CHALLENGE_PROMPT_VERSION,
  CHALLENGE_TYPES,
  MAX_CHALLENGES_PER_CLAIM,
  type FindingContext,
} from "./challengePrompts.ts";
import { isJudgeDisabled } from "./killSwitch.ts";

/**
 * The read-only view of a finished Track 1 finding, as a CALLER supplies it —
 * with RAW evidence quotes. Delimiting is done here, not by the caller, so it
 * is structurally impossible to reach the Track 2 prompt with undelimited
 * evidence text (locked test case 17's data-vs-instructions guard). This is the
 * same discipline extractField applies for Track 1, moved one layer in.
 */
export interface ChallengeFindingContext extends Omit<FindingContext, "excerpts"> {
  excerpts: readonly { relation: string; locatorDisplay: string; quote: string }[];
}

export type ChallengeType = (typeof CHALLENGE_TYPES)[number];
export type ChallengeAction = (typeof CHALLENGE_ACTIONS)[number];

/**
 * ONE challenge item — the exact output contract from § Track 2 output
 * contract, and deliberately nothing more. There is no field here in which a
 * verdict, a confidence figure, a score, an answer, or a transcript could be
 * expressed, which is what makes "Track 2 never produces a verdict" a property
 * of the type rather than a rule someone has to remember.
 */
export interface ChallengeItem {
  challengeType: ChallengeType;
  prompt: string;
  whyItMatters: string;
  action: ChallengeAction;
}

export interface GenerateChallengesResult {
  /** 0..maxItems items. Empty is a correct, expected outcome, not a failure. */
  items: ChallengeItem[];
  /** Provenance for the call, same shape every other judge call persists. */
  record: JudgeCallRecord;
  /** True when the model returned MORE items than the cap and code cut them. */
  truncated: boolean;
  /** Set when no usable output was produced; items is then empty. */
  error?: string;
}

export interface GenerateChallengesOptions {
  /** Injected judge client. Defaults to a real client over the network. */
  client?: JudgeClient;
  promptVersion?: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** Observability only (§ Monitoring) — never affects generation. */
  organizationId?: string;
  /**
   * The hard ceiling for THIS call, already reduced by the caller for any
   * budget consumed by sibling claims in the same invocation. Defaults to the
   * per-claim cap; values above it are clamped down to it, never up.
   */
  maxItems?: number;
}

/**
 * Asks the judge what is worth pressure-testing about a finished finding.
 *
 * Never throws: a transport failure, an unparseable answer, or an output that
 * smuggled a forbidden field all resolve to zero items with the reason on the
 * record. Zero items is always a safe result — Track 2 is subordinate to the
 * evidence record by construction, so its absence degrades nothing.
 */
export async function generateChallenges(
  context: ChallengeFindingContext,
  options: GenerateChallengesOptions = {},
): Promise<GenerateChallengesResult> {
  const promptVersion = options.promptVersion ?? CHALLENGE_PROMPT_VERSION;
  // Clamp DOWN only. A caller may lower the ceiling (invocation budget nearly
  // spent); no caller may raise it above the product cap.
  const cap = Math.max(0, Math.min(options.maxItems ?? MAX_CHALLENGES_PER_CLAIM, MAX_CHALLENGES_PER_CLAIM));

  // Every excerpt becomes DATA before it can reach a prompt.
  const promptContext: FindingContext = {
    ...context,
    excerpts: context.excerpts.map((e) => ({
      relation: e.relation,
      locatorDisplay: e.locatorDisplay,
      delimitedQuote: delimitEvidenceForModel(e.quote),
    })),
  };
  const { system, user, question } = buildChallengePrompt(promptContext);
  const recordBase: JudgeCallRecord = {
    model: options.model ?? DEFAULT_JUDGE_MODEL,
    promptVersion,
    question,
  };

  // A zero budget must cost zero — no client, no network call. Same
  // short-circuit shape as the kill switch below.
  if (cap === 0) {
    return { items: [], record: { ...recordBase, error: "challenge_budget_exhausted" }, truncated: false, error: "challenge_budget_exhausted" };
  }

  // The judge kill switch governs every DeepSeek call in this system, and
  // Track 2 is one. When it is active there is no network call at all.
  if (isJudgeDisabled()) {
    logEvent({
      event: "challenge_generation",
      path: "judge-involved",
      error_cause: "judge_kill_switch_active",
      organization_id: options.organizationId,
    });
    return { items: [], record: { ...recordBase, error: "judge_kill_switch_active" }, truncated: false, error: "judge_kill_switch_active" };
  }

  let client: JudgeClient;
  try {
    client = options.client ?? createJudgeClient({ model: options.model, timeoutMs: options.timeoutMs });
  } catch (err) {
    // E.g. no DEEPSEEK_API_KEY configured — never crash, never guess.
    return { items: [], record: { ...recordBase, error: (err as Error).message }, truncated: false, error: (err as Error).message };
  }

  const input: JudgeCallInput = {
    model: options.model,
    promptVersion,
    question,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: options.maxTokens,
  };

  const startedAt = performance.now();
  let result;
  try {
    result = await client.call(input);
  } catch (err) {
    logEvent({
      event: "challenge_generation",
      path: "judge-involved",
      latency_ms: Math.round(performance.now() - startedAt),
      error_cause: "challenge_client_threw",
      organization_id: options.organizationId,
    });
    return { items: [], record: { ...recordBase, error: (err as Error).message }, truncated: false, error: (err as Error).message };
  }
  const latencyMs = Math.round(performance.now() - startedAt);

  if (result.status === "error") {
    logEvent({
      event: "challenge_generation",
      path: "judge-involved",
      latency_ms: latencyMs,
      error_cause: result.record.error,
      organization_id: options.organizationId,
    });
    return { items: [], record: result.record, truncated: false, error: result.record.error };
  }

  const parsed = parseChallengeOutput(result.record.answer ?? "");
  if (!parsed.ok) {
    logEvent({
      event: "challenge_generation",
      path: "judge-involved",
      latency_ms: latencyMs,
      cost_cents: estimateDeepSeekCostCents(result.record.inputTokens ?? 0, result.record.outputTokens ?? 0),
      error_cause: parsed.error,
      organization_id: options.organizationId,
    });
    // The record is returned intact (token counts included) even on a rejected
    // parse: the call HAPPENED and its cost is real, so the caller must still
    // be able to write a usage row for it. A rejected output is free of items,
    // never free of spend.
    return { items: [], record: { ...result.record, error: parsed.error }, truncated: false, error: parsed.error };
  }

  const { items, truncated } = truncateToCap(parsed.items, cap);
  if (truncated) {
    logEvent({
      event: "challenge_cap_truncated",
      path: "judge-involved",
      organization_id: options.organizationId,
      returned_items: parsed.items.length,
      kept_items: items.length,
      cap,
    });
  }

  logEvent({
    event: "challenge_generation",
    path: "judge-involved",
    latency_ms: latencyMs,
    cost_cents: estimateDeepSeekCostCents(result.record.inputTokens ?? 0, result.record.outputTokens ?? 0),
    organization_id: options.organizationId,
    challenge_items: items.length,
  });

  return { items, record: result.record, truncated };
}

/**
 * The model's structured output, validated STRICTLY at BOTH levels. `.strict()`
 * on the item object is the one that matters most: it is what turns a smuggled
 * "verdict" / "confidence" / "score" / "answer" key into a rejection of the
 * entire output rather than a silent strip-and-accept. Rejecting the whole
 * envelope (not just the offending item) is deliberate — a model that tried to
 * assert a verdict in one item has demonstrated it is not operating under this
 * contract, and its other items are not more trustworthy for having complied.
 */
const CHALLENGE_ITEM_SCHEMA = z
  .object({
    challenge_type: z.enum(CHALLENGE_TYPES),
    prompt: z.string().min(1),
    why_it_matters: z.string().min(1),
    action: z.enum(CHALLENGE_ACTIONS),
  })
  .strict();

const CHALLENGE_OUTPUT_SCHEMA = z
  .object({
    reasoning: z.string().min(1),
    challenges: z.array(CHALLENGE_ITEM_SCHEMA),
  })
  .strict();

export type ChallengeParseResult =
  | { ok: true; items: ChallengeItem[] }
  | { ok: false; error: string };

/** Defensively extracts the JSON object the model was asked to emit, tolerating
 * stray prose or a ```json fence around it. Same tolerance fieldExtraction.ts
 * applies, and no more. */
export function extractChallengeJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** Validates raw model output against the exact Track 2 contract. */
export function parseChallengeOutput(rawAnswer: string): ChallengeParseResult {
  const json = extractChallengeJson(rawAnswer);
  if (json === undefined) {
    return { ok: false, error: "challenge output is not a valid JSON object" };
  }
  const result = CHALLENGE_OUTPUT_SCHEMA.safeParse(json);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.join(".") ?? "";
    return {
      ok: false,
      error: `challenge output failed schema validation${path ? ` at ${path}` : ""}: ${first?.message ?? "unknown"}`,
    };
  }
  return {
    ok: true,
    items: result.data.challenges.map((c) => ({
      challengeType: c.challenge_type,
      prompt: c.prompt,
      whyItMatters: c.why_it_matters,
      action: c.action,
    })),
  };
}

/**
 * The cap, applied in code. Deterministic and order-preserving: the model's own
 * ordering is kept and the tail is dropped, so the same output always yields
 * the same kept items (no sampling, no "pick the best two" — that would be a
 * judgment this layer is not entitled to make).
 */
export function truncateToCap(
  items: readonly ChallengeItem[],
  cap: number = MAX_CHALLENGES_PER_CLAIM,
): { items: ChallengeItem[]; truncated: boolean } {
  const limit = Math.max(0, Math.min(cap, MAX_CHALLENGES_PER_CLAIM));
  if (items.length <= limit) return { items: [...items], truncated: false };
  return { items: items.slice(0, limit), truncated: true };
}

/** Re-exported so callers get the contract's own vocabulary from one place. */
export { MAX_CHALLENGES_PER_CLAIM };
