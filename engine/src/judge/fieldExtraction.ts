// The Chain-of-Verification field extractor (§ LLM judge design; § Judge
// authority boundary). One function, `extractField`, asks the judge ONE narrow
// per-field question about a resolved evidence passage and parses the answer
// into the four-outcome vocabulary. It is deliberately BLIND: it never receives
// or references the claim's asserted value for the field being extracted.
//
// The invariant this module exists to serve: the judge's output is a narrow,
// per-field, categorical OBSERVATION about the evidence — present / absent /
// ambiguous / cannot_be_determined — never a confidence score, never a
// claim-level verdict, never "does this support the claim". The comparison and
// final-state assignment are done by the PURE deterministic layer
// (assessApplicability in ../verification/applicability.ts and assignState in
// ../verification/stateMachine.ts). This module never imports or calls either
// of them; `assembleEvidenceFields` below produces the EvidenceFields object
// that IS the only thing the judge's output ever feeds.
//
// The absence of any confidence field on JudgeFieldAnswer is deliberate: the
// plan (§ No raw confidence gate) removed confidence thresholds because LLM
// self-reported confidence is not calibrated, and the four categorical outcomes
// are the signal. Adding confidence here would reintroduce the exact gate the
// plan removed. If the model sneaks a "confidence" key into its JSON anyway,
// the strict zod schema below rejects the whole output and it collapses to
// cannot_be_determined — never a number in play.

import { delimitEvidenceForModel } from "../ingestion/delimitEvidence.ts";
import { logEvent } from "../observability/log.ts";
import { estimateDeepSeekCostCents } from "../quotas/usage.ts";
import type { ApplicabilityField, EvidenceFields, ValueUnit } from "../verification/applicability.ts";
import { z } from "zod";
import {
  createJudgeClient,
  DEFAULT_JUDGE_MODEL,
  type JudgeCallInput,
  type JudgeCallRecord,
  type JudgeClient,
} from "./judgeClient.ts";
import { isJudgeDisabled } from "./killSwitch.ts";
import { buildFieldPrompt, PROMPT_VERSION } from "./promptTemplates.ts";

export type JudgeOutcome = "present" | "absent" | "ambiguous" | "cannot_be_determined";

export interface JudgeFieldAnswer {
  field: ApplicabilityField;
  outcome: JudgeOutcome;
  /** Only ever populated when outcome === "present". */
  value?: string;
  /**
   * The competing readings the judge saw, populated ONLY when outcome ===
   * "ambiguous". Never a guess at which one is right — that is precisely what
   * the judge is forbidden to decide.
   *
   * Why this exists. An ambiguous required field used to end the check: the
   * candidate became inapplicable, no relation was recorded, and the claim
   * landed on INDETERMINATE / checks_did_not_complete. Observed live on
   * "The Statue of Liberty is 500 feet tall" against a passage giving both
   * 151 feet (statue) and 305 feet (ground to torch) — two readings, neither
   * of them 500, and the ambiguity changes nothing about the verdict.
   *
   * Reporting the readings lets CODE ask whether the ambiguity is material:
   * if the claim conflicts with every candidate, the conflict is robust to
   * which reading is meant. If any candidate would match, the claim stays
   * INDETERMINATE — the safe direction.
   *
   * The authority boundary is unchanged and arguably sharpened: the model
   * still only OBSERVES (here are the values in the passage), and code still
   * DECIDES (do they all conflict). Absent candidates, behaviour is exactly
   * as before.
   */
  candidates?: string[];
  /** The span of the passage the outcome is based on, when the model gave one. */
  sourceSpan?: string;
  /**
   * Provenance (§ Judge authority boundary requirement #6 — persist the judge
   * model, prompt version, question, evidence locator, and answer). Deliberately
   * kept OFF the comparison path: assessApplicability reads only the
   * EvidenceFields assembled from field/outcome/value. But it is never dropped —
   * every answer carries the full record so a caller can persist it.
   */
  record: JudgeCallRecord;
}

export interface ExtractFieldOptions {
  /** Injected judge client. Defaults to a real client over the network. */
  client?: JudgeClient;
  promptVersion?: string;
  model?: string;
  /** The resolved evidence locator being interpreted (§ requirement #1). */
  evidenceLocator?: string;
  maxTokens?: number;
  /** Wall-clock cap for the underlying HTTP call. Defaults to the client's. */
  timeoutMs?: number;
  /**
   * Organization context for observability only (§ Monitoring): the judge call
   * log line carries it so cost/latency can be rolled up per organization. It
   * never affects extraction. Omitted when the caller has no org yet.
   */
  organizationId?: string;
}

/**
 * Asks the judge to extract ONE field from a resolved evidence passage.
 *
 * Blind by construction: the signature has NO parameter for the claim's
 * asserted value for `field`, so it is structurally impossible for a caller to
 * pass it in — the blind-answering step from Chain-of-Verification
 * (§ Why the judge doesn't get to read a passage and decide). The evidence
 * text is always delimited via delimitEvidenceForModel before it reaches the
 * model (locked test case 17's data-vs-instructions guard), and no raw
 * undelimited evidence ever goes into a prompt.
 *
 * Never throws on model/parse failures: anything that cannot be parsed into the
 * four-outcome schema (or any attempt to sneak in a confidence figure) maps to
 * cannot_be_determined, with the failure preserved on the returned record.
 */
export async function extractField(
  evidenceText: string,
  field: ApplicabilityField,
  options: ExtractFieldOptions = {},
): Promise<JudgeFieldAnswer> {
  const promptVersion = options.promptVersion ?? PROMPT_VERSION;

  // Delimit the evidence as DATA before it can reach any prompt (§ delimitEvidence.ts).
  const delimited = delimitEvidenceForModel(evidenceText);
  const { system, user, question } = buildFieldPrompt(field, delimited);

  const recordBase: JudgeCallRecord = {
    model: options.model ?? DEFAULT_JUDGE_MODEL,
    promptVersion,
    question,
    evidenceLocator: options.evidenceLocator,
  };

  // Kill switch (§ killSwitch.ts): when disabled, extractField returns
  // cannot_be_determined for every field WITHOUT calling the judge client at
  // all — no network call. Deterministic checks are unaffected by design.
  if (isJudgeDisabled()) {
    logEvent({
      event: "judge_call",
      path: "judge-involved",
      error_cause: "judge_kill_switch_active",
      organization_id: options.organizationId,
    });
    return { field, outcome: "cannot_be_determined", record: { ...recordBase, error: "judge_kill_switch_active" } };
  }

  let client: JudgeClient;
  try {
    client = options.client ?? createJudgeClient({ model: options.model, timeoutMs: options.timeoutMs });
  } catch (err) {
    // E.g. no DEEPSEEK_API_KEY configured — never crash, never guess.
    return { field, outcome: "cannot_be_determined", record: { ...recordBase, error: (err as Error).message } };
  }

  const input: JudgeCallInput = {
    model: options.model,
    promptVersion,
    question,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    evidenceLocator: options.evidenceLocator,
    maxTokens: options.maxTokens,
  };

  const startedAt = performance.now();
  let result;
  try {
    result = await client.call(input);
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startedAt);
    logEvent({
      event: "judge_call",
      path: "judge-involved",
      latency_ms: latencyMs,
      error_cause: "judge_client_threw",
      organization_id: options.organizationId,
    });
    return { field, outcome: "cannot_be_determined", record: { ...recordBase, error: (err as Error).message } };
  }
  const latencyMs = Math.round(performance.now() - startedAt);

  if (result.status === "error") {
    logEvent({
      event: "judge_call",
      path: "judge-involved",
      latency_ms: latencyMs,
      error_cause: result.record.error,
      organization_id: options.organizationId,
    });
    return { field, outcome: "cannot_be_determined", record: result.record };
  }

  // Observability (§ Monitoring): every judge call logs its latency and derived
  // cost so spend trends toward a cap can be seen before the cap is hit. The
  // cost comes from the token counts judgeClient already returned on the record.
  logEvent({
    event: "judge_call",
    path: "judge-involved",
    latency_ms: latencyMs,
    cost_cents: estimateDeepSeekCostCents(result.record.inputTokens ?? 0, result.record.outputTokens ?? 0),
    organization_id: options.organizationId,
  });
  return parseJudgeAnswer(result.record.answer ?? "", field, result.record);
}

// The model's structured output, validated STRICTLY. `reasoning` is required
// (the prompt forces step-by-step reasoning — part (b) of the recipe); a
// `present` outcome requires a non-empty `value`; and `.strict()` rejects any
// extra key, in particular a sneaked-in "confidence" number, collapsing it to
// cannot_be_determined below.
const MODEL_OUTPUT_SCHEMA = z
  .object({
    reasoning: z.string().min(1),
    outcome: z.enum(["present", "absent", "ambiguous", "cannot_be_determined"]),
    value: z.string().optional(),
    // Only meaningful on "ambiguous". Capped at 6: a passage offering more
    // than a handful of readings is not usefully disambiguated by listing
    // them, and an unbounded array is an unbounded prompt-echo surface.
    candidates: z.array(z.string()).max(6).optional(),
    source_span: z.string().optional(),
  })
  .strict()
  .refine((d) => d.outcome !== "present" || (typeof d.value === "string" && d.value.trim().length > 0), {
    message: "outcome 'present' requires a non-empty value",
  });

export type ModelOutputParseResult =
  | { ok: true; data: { reasoning: string; outcome: JudgeOutcome; value?: string; candidates?: string[]; source_span?: string } }
  | { ok: false; error: string };

/** Defensively extracts the JSON object the model was asked to emit, tolerating
 * stray prose or a ```json fence around it. Returns undefined if there is no
 * well-formed JSON object. */
export function extractJsonObject(text: string): unknown {
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

/** Validates the model's raw JSON against the exact four-outcome schema. */
export function safeParseModelOutput(rawAnswer: string): ModelOutputParseResult {
  const json = extractJsonObject(rawAnswer);
  if (json === undefined) {
    return { ok: false, error: "model output is not a valid JSON object" };
  }
  const result = MODEL_OUTPUT_SCHEMA.safeParse(json);
  if (!result.success) {
    const first = result.error.issues[0];
    return { ok: false, error: `model output failed schema validation: ${first?.message ?? "unknown"}` };
  }
  return { ok: true, data: result.data };
}

/**
 * Maps a validated model answer to a JudgeFieldAnswer. Only `present` carries a
 * value forward (per § No raw confidence gate); any value the model attached to
 * a non-present outcome is a hallucination and is dropped. Any invalid output
 * maps to cannot_be_determined — never a crash, never a guess.
 */
export function parseJudgeAnswer(rawAnswer: string, field: ApplicabilityField, record: JudgeCallRecord): JudgeFieldAnswer {
  const parsed = safeParseModelOutput(rawAnswer);
  if (!parsed.ok) {
    return { field, outcome: "cannot_be_determined", record: { ...record, error: parsed.error } };
  }
  // Deterministic correction, not a judgment call: every stated figure has a
  // modality, even an unmarked one — a plain assertion IS the "actual"
  // modality (matches ../extraction/extractClaims.ts's own claim-side
  // convention). The prompt already instructs the model to answer "present,
  // actual" for a plain assertion, but model compliance with that nuance is
  // unreliable in practice; applying the same structural default here in code
  // makes it exact rather than probabilistic. "absent" for modality can only
  // mean "no marker was stated" (per the field's own definition — every other
  // field genuinely has an "unstated" state, modality does not), so an
  // "absent" outcome is always safe to upgrade to "present, actual".
  if (field === "modality" && parsed.data.outcome === "absent") {
    return { field, outcome: "present", value: "actual", sourceSpan: parsed.data.source_span, record };
  }
  return {
    field,
    outcome: parsed.data.outcome,
    value: parsed.data.outcome === "present" ? parsed.data.value : undefined,
    // Mirrors the `value` discipline exactly: candidates are kept ONLY on the
    // outcome they are defined for. A model that returns them alongside
    // "present" or "absent" has them dropped rather than half-honoured.
    candidates: parsed.data.outcome === "ambiguous" ? parsed.data.candidates : undefined,
    sourceSpan: parsed.data.source_span,
    record,
  };
}

/**
 * Deterministic split of the judge's extracted value string into a ValueUnit.
 * This is NOT claim-side extraction and NOT a unit conversion; it only separates
 * a leading signed number from its unit so assessApplicability's unit-vs-value
 * distinction (applicability.ts) can do its exact comparison. Matches the
 * convention used in applicability.test.ts ('17%' → value '17', unit '%').
 */
export function parseValueUnit(extracted: string): ValueUnit {
  const raw = extracted.trim();
  const stripped = raw.replace(/^[$£€¥]/, "").trim();
  const match = /^([+-]?(?:\d[\d,]*)(?:\.\d+)?)\s*(.*)$/.exec(stripped);
  if (!match) {
    return { value: raw };
  }
  const value = match[1].replace(/,/g, "");
  const unit = match[2].trim().replace(/\s+/g, " ").replace(/[.,;:]$/, "").trim();
  return unit.length > 0 ? { value, unit } : { value };
}

/**
 * Assembles the judge's per-field answers into the EvidenceFields object that
 * assessApplicability consumes. Exactly the plan's rule: present → value,
 * everything else → undefined. A field the judge could not establish stays
 * undefined, which assessApplicability already treats as "unestablished"
 * (a mismatch when the claim asserts that field — see applicability.ts lines
 * 133-143 and 165-172). This is the ONLY thing the judge's output ever feeds;
 * nothing else downstream consumes it.
 */
export function assembleEvidenceFields(answers: readonly JudgeFieldAnswer[]): EvidenceFields {
  const evidence: EvidenceFields = {};
  for (const answer of answers) {
    if (answer.outcome !== "present" || answer.value === undefined) continue;
    if (answer.field === "valueUnit") {
      evidence.valueUnit = parseValueUnit(answer.value);
    } else {
      evidence[answer.field] = answer.value;
    }
  }
  return evidence;
}
