// Track 2 / Advance — the strict output validator
// (§ Track 2 / Advance build order step 3).
//
// This is the code that runs BEFORE anything a model produces reaches a
// user. It is written and tested against HAND-WRITTEN example outputs
// (advance.test.ts), not against real model output — the shape of the
// contract has to be proven correct before a model is ever wired in (step
// 5+, explicitly out of scope for this module).
//
// THE AUTHORITY BOUNDARY, same discipline as
// ../judge/challengeGeneration.ts's parseChallengeOutput:
//   - The output schema is `.strict()`, so a smuggled extra key (verdict,
//     confidence, score, anything) rejects the WHOLE output, never just the
//     offending field. A model that tried to assert a verdict has
//     demonstrated it is not operating under this contract, and the rest of
//     its output is not more trustworthy for having complied.
//   - `move` is checked against a CALLER-SUPPLIED allowed set, not decided
//     here. This module enforces policy, it does not choose it — policy.ts
//     alone owns that decision. A structurally valid AdvanceMove that isn't
//     in the allowed set for this call is still rejected.
//   - validateAdvanceOutput never throws. Every path returns a discriminated
//     result, exactly like parseChallengeOutput.
//
// This module performs no I/O and imports nothing from ../verification/,
// ../review/, ../judge/judgeClient.ts, or any DB/pg client.

import { z } from "zod";
import type { AdvanceMove, Track2ModelDraft } from "./types.ts";

const ADVANCE_MOVES = ["clarify", "test", "compare", "repair"] as const;

/**
 * The alpha character limit on `prompt`. Chosen as an order of magnitude
 * that fits "one actionable ask" (Part 11: "pick exactly one of four moves
 * and phrase it as one actionable ask") — a few sentences, not a paragraph
 * or a transcript. Exported so callers/tests reference the same constant
 * rather than a magic number.
 */
export const MAX_PROMPT_CHARS = 600;

/**
 * The exact output contract: `{ move, prompt }` and nothing else.
 * `.strict()` is what turns an extra key into a full rejection rather than a
 * silent strip — see the module-level comment above.
 */
const ADVANCE_OUTPUT_SCHEMA = z
  .object({
    move: z.enum(ADVANCE_MOVES),
    prompt: z.string().min(1).max(MAX_PROMPT_CHARS),
  })
  .strict();

export type AdvanceValidationResult =
  | { ok: true; draft: Track2ModelDraft }
  | { ok: false; error: string };

/**
 * Defensively extracts the JSON object the model was asked to emit,
 * tolerating stray prose or a ```json fence around it. Mirrors
 * ../judge/challengeGeneration.ts's extractChallengeJson exactly — same
 * tolerance, no more — so both Track 2 surfaces parse model output with one
 * shared level of leniency rather than two subtly different ones.
 */
export function extractAdvanceJson(text: string): unknown {
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

/**
 * Validates raw model output against the exact Advance contract AND the
 * caller-supplied allowed-move set for this invocation. Never throws:
 * malformed JSON, a schema violation, or an out-of-policy move all resolve
 * to `{ ok: false, error }` — no fallback guess is ever produced.
 */
export function validateAdvanceOutput(
  raw: unknown,
  opts: { allowedMoves: readonly AdvanceMove[] },
): AdvanceValidationResult {
  // Accept either an already-parsed object or raw model text, mirroring how
  // callers may hold either depending on whether extraction already ran.
  const json = typeof raw === "string" ? extractAdvanceJson(raw) : raw;
  if (json === undefined || json === null) {
    return { ok: false, error: "advance output is not a valid JSON object" };
  }

  const result = ADVANCE_OUTPUT_SCHEMA.safeParse(json);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.join(".") ?? "";
    return {
      ok: false,
      error: `advance output failed schema validation${path ? ` at ${path}` : ""}: ${first?.message ?? "unknown"}`,
    };
  }

  if (!opts.allowedMoves.includes(result.data.move)) {
    return {
      ok: false,
      error: `move "${result.data.move}" is not in the allowed set for this invocation (${opts.allowedMoves.join(", ")})`,
    };
  }

  return { ok: true, draft: { move: result.data.move, prompt: result.data.prompt } };
}

/**
 * A simple, honestly-scoped check that a Track-1-derived boundary was not
 * reinterpreted or expanded in a proposed prompt: the boundary's exact text
 * must appear verbatim as a substring of `prompt`.
 *
 * WHAT THIS DOES NOT PROVE: a substring match cannot detect paraphrase,
 * partial quoting that changes meaning, or a boundary quoted correctly but
 * used to support a different conclusion than the one Track 1 actually
 * established. It only proves the exact characters are present somewhere in
 * the text — a caller wanting semantic fidelity needs a stronger check than
 * this. This function is deliberately kept to that narrow, honest claim
 * rather than oversold as a meaning-preservation guarantee.
 */
export function boundaryPreserved(prompt: string, boundaryText: string): boolean {
  if (boundaryText.length === 0) return false;
  return prompt.includes(boundaryText);
}
