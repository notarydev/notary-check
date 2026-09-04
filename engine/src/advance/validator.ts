// Track 2 / Advance — the strict output validator, six guardrail layers
// (§ Track 2 / Advance build order step 3; Part 11 § Suggestion cardinality
// and the six-layer guardrail architecture).
//
// THE CORE PRINCIPLE, restated in code: the model proposes, policy
// constrains, THIS FILE rejects, code never repairs. There is no fallback
// path anywhere below — a rejected response produces zero suggestions, never
// a "closest legal" substitute, never a rewritten/summarized/cleaned-up
// version. This is written and tested against HAND-WRITTEN example outputs
// (advance.test.ts), not against real model output — the shape of the
// contract has to be proven correct before a model is ever wired in.
//
// SIX LAYERS, WITH AN EXPLICIT, HONEST SPLIT between what this file can
// GUARANTEE and what it can only HEURISTICALLY catch:
//
//   1. Input boundary — enforced by types.ts's InvocationContext shape, not
//      by this file (there is structurally no field to smuggle raw evidence
//      or claim IDs into). Nothing to validate here at the output stage.
//   2. Policy boundary — `move` checked against a CALLER-SUPPLIED allowed
//      set. DETERMINISTIC, AIRTIGHT: a move is either in the set or it
//      isn't.
//   3. Cardinality boundary — 0-2 items, unique ids, non-empty/bounded
//      short_label and prompt, no duplicate (move, normalized short_label).
//      DETERMINISTIC, AIRTIGHT — this is the STRUCTURAL half only. Whether
//      two items are semantically distinct is NOT checked here (see the
//      module comment on distinctness below).
//   4. Content safety / authority boundary — deny-list pattern matching for
//      verdicts, new facts, confidence/scoring, citations, completed-action
//      claims, autonomous-action language. HEURISTIC, NOT AIRTIGHT: a
//      rephrased violation with no matching pattern will not be caught.
//      This is an honest limit, not a design flaw — see Part 11's own
//      admission of this, and why the adversarial eval suite exists.
//   5. Track-1 boundary preservation — boundaryPreserved() below.
//      DETERMINISTIC for its narrow claim (exact substring presence), but
//      see its own doc comment: absence is NOT rejected, because omitting
//      the boundary entirely is explicitly permitted ("quote verbatim, or
//      omit — never paraphrase"), and a substring check cannot distinguish
//      "omitted" from "paraphrased." This layer can confirm a positive
//      (verbatim quote present) but cannot reliably reject a negative.
//   6. Action-language validator — does `prompt` read as a request, not a
//      conclusion? HEURISTIC, NOT AIRTIGHT, same honesty as layer 4.
//
// Layers 4 and 6 cannot be made provably complete by string matching alone.
// That is exactly why Part 11 requires an adversarial evaluation pass before
// this is considered validated — the eval suite is the real backstop for
// what these two layers structurally cannot guarantee, not supplementary
// polish on top of "real" enforcement.
//
// REJECTION IS WHOLE-RESPONSE. If any item fails any layer, the entire
// response is discarded — never salvage a clean item alongside a rejected
// one. Same precedent as ../judge/challengeGeneration.ts's whole-envelope
// rejection: a model that violated the contract once has demonstrated it
// isn't operating under it, and its other output isn't more trustworthy for
// having complied.
//
// This module performs no I/O and imports nothing from ../verification/,
// ../review/, ../judge/judgeClient.ts, or any DB/pg client.

import { z } from "zod";
import type { AdvanceMove, AdvanceSuggestion } from "./types.ts";

const ADVANCE_MOVES = ["clarify", "test", "compare", "repair"] as const;

/** § Track 2 / Advance build order step 3. A few sentences, not a paragraph. */
export const MAX_PROMPT_CHARS = 600;

/**
 * Deliberately much tighter than MAX_PROMPT_CHARS — the entire point of
 * short_label is that it's scannable at a glance ("This answer has a
 * mistake: left door stays open"), not a second copy of the full ask.
 */
// 48, down from 100. A button label that wraps is not a button, and at 100 the
// model wrote headlines rather than instructions. The prompt asks for 2-6
// imperative words; this is the enforcement.
export const MAX_SHORT_LABEL_CHARS = 48;

/** Part 11 § Suggestion cardinality: 0-2 suggestions per round, never more. */
export const MAX_SUGGESTIONS = 2;

const ADVANCE_ITEM_SCHEMA = z
  .object({
    id: z.string().min(1),
    short_label: z.string().min(1).max(MAX_SHORT_LABEL_CHARS),
    move: z.enum(ADVANCE_MOVES),
    prompt: z.string().min(1).max(MAX_PROMPT_CHARS),
  })
  .strict();

const ADVANCE_RESPONSE_SCHEMA = z
  .object({
    suggestions: z.array(ADVANCE_ITEM_SCHEMA).max(MAX_SUGGESTIONS),
  })
  .strict();

export type AdvanceValidationResult =
  | { ok: true; suggestions: readonly AdvanceSuggestion[] }
  | { ok: false; error: string };

/**
 * Defensively extracts the JSON object the model was asked to emit,
 * tolerating stray prose or a ```json fence around it. Mirrors
 * ../judge/challengeGeneration.ts's extractChallengeJson exactly — same
 * tolerance, no more.
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
 * LAYER 4 — content safety / authority. Deny-list patterns, deliberately
 * documented as non-exhaustive (see module comment). Matched against BOTH
 * short_label and prompt, case-insensitively. Each pattern targets one
 * category from Part 11's list; kept as separate named groups so a failure
 * message can say WHICH category tripped, not just "rejected."
 */
const AUTHORITY_VIOLATION_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  { category: "verification_claim", pattern: /\b(the evidence (proves|shows|confirms)|this claim is (false|true)|the source (confirms|proves))\b/i },
  { category: "confidence_or_score", pattern: /\b(i'?m\s+\d{1,3}%\s*(confident|sure)|confidence(\s*(level|score))?[:=]|\bscore[:=]\s*\d)\b/i },
  { category: "citation_claim", pattern: /\baccording to (source|the source|reference)\b/i },
  { category: "completed_action", pattern: /\b(i(’ve| have|'ve)? (already )?(checked|compared|verified|confirmed|fixed)|has (already )?been (fixed|resolved|completed))\b/i },
  { category: "autonomous_action", pattern: /\b(send this( now)?\.|run this( now)?\.|search (for|the web)|open (the )?browser|i will (send|run|search|open))\b/i },
];

/** LAYER 4, exported for direct testing. */
export function findAuthorityViolation(text: string): string | undefined {
  for (const { category, pattern } of AUTHORITY_VIOLATION_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return undefined;
}

/**
 * LAYER 6 — action-language. Heuristic, same honesty as layer 4: this can
 * only catch an UNAMBIGUOUSLY declarative sentence with no request marker
 * anywhere in it, not every rephrased conclusion.
 *
 * CORRECTED 2026-09-03 after the first live evaluation pass: the original
 * version anchored the request-verb check to the very START of the string
 * (`^(please\s+)?(ask|check|...)`). Against 43 real fixture responses, this
 * rejected the majority of otherwise-valid two-item outputs, because a real
 * well-formed request very often opens with a clause before the verb —
 * "Also, check whether...", "Given the ambiguity, ask which...", "For the
 * comparison, evaluate..." — none of which are declarative conclusions, all
 * of which the anchored version wrongly rejected (and because rejection is
 * whole-response, this was destroying a SECOND, otherwise-clean item too).
 * Confirmed directly, without spending any model call: 5 of 7 realistic
 * well-formed request sentences failed the old check purely because the
 * verb wasn't the literal first word.
 *
 * The fixed version looks for a request marker ANYWHERE in the text — a
 * question mark, a request phrase ("please", "could/can/would you"), or a
 * request verb as a whole word anywhere — rather than requiring it to open
 * the sentence. This is deliberately more permissive; it will still fail
 * to catch a declarative conclusion that happens to contain one of these
 * words incidentally (e.g. "I already checked this is correct" — though
 * that phrasing gets caught by layer 4's completed_action pattern instead).
 * The two locked test cases this must still get right: "The correct
 * architecture is X" (no marker anywhere -> false, correctly rejected) and
 * "Compare X and Y on Z" (has a request verb -> true, correctly accepted).
 */
const REQUEST_PHRASE = /\b(please|could you|can you|would you|should you)\b/i;
const REQUEST_VERB = /\b(ask|check|clarify|compare|confirm|distinguish|double[- ]?check|evaluate|find|identify|run|test|try|verify|explain|walk (me )?through)\b/i;

/** LAYER 6, exported for direct testing. */
export function looksLikeRequest(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.includes("?")) return true;
  if (REQUEST_PHRASE.test(trimmed)) return true;
  if (REQUEST_VERB.test(trimmed)) return true;
  return false;
}

/**
 * LAYER 5 — Track-1 boundary preservation. A simple, honestly-scoped check
 * that a Track-1-derived boundary was not reinterpreted or expanded: the
 * boundary's exact text must appear verbatim as a substring of `text`.
 *
 * WHAT THIS DOES NOT PROVE, and why it is NEVER used as a rejection gate on
 * its own: a substring match cannot detect paraphrase, and — critically —
 * it cannot distinguish "the boundary was omitted entirely" (explicitly
 * PERMITTED — "quote verbatim, or omit — never paraphrase") from "the
 * boundary was paraphrased" (NOT permitted). Both produce `false`. So this
 * function can only ever CONFIRM a positive (verbatim quote present); a
 * `false` result is not, by itself, evidence of a violation. Treat it as an
 * observability signal, not an automatic reject.
 */
export function boundaryPreserved(prompt: string, boundaryText: string): boolean {
  if (boundaryText.length === 0) return false;
  return prompt.includes(boundaryText);
}

/**
 * Validates one raw model response against the FULL contract: schema shape,
 * per-item policy membership, cardinality/dedup, and the two heuristic
 * content layers. Never throws. Rejection is whole-response — see module
 * comment.
 */
export function validateAdvanceOutput(
  raw: unknown,
  opts: { allowedMoves: readonly AdvanceMove[] },
): AdvanceValidationResult {
  const json = typeof raw === "string" ? extractAdvanceJson(raw) : raw;
  if (json === undefined || json === null) {
    return { ok: false, error: "advance output is not a valid JSON object" };
  }

  const parsed = ADVANCE_RESPONSE_SCHEMA.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.join(".") ?? "";
    return {
      ok: false,
      error: `advance output failed schema validation${path ? ` at ${path}` : ""}: ${first?.message ?? "unknown"}`,
    };
  }

  const items = parsed.data.suggestions;

  // Layer 2 (policy): every item's move must be in the CALLER-supplied
  // allowed set — a structurally valid AdvanceMove outside that set is
  // still rejected. Whole-response.
  for (const item of items) {
    if (!opts.allowedMoves.includes(item.move)) {
      return {
        ok: false,
        error: `move "${item.move}" (id ${item.id}) is not in the allowed set for this invocation (${opts.allowedMoves.join(", ")})`,
      };
    }
  }

  // Layer 3 (cardinality, structural): unique ids, no duplicate
  // (move, normalized short_label) pairs. Code does not and cannot judge
  // whether two items are semantically distinct — see module comment.
  const seenIds = new Set<string>();
  const seenMoveLabel = new Set<string>();
  for (const item of items) {
    if (seenIds.has(item.id)) {
      return { ok: false, error: `duplicate suggestion id "${item.id}"` };
    }
    seenIds.add(item.id);
    const key = `${item.move}::${item.short_label.trim().toLowerCase()}`;
    if (seenMoveLabel.has(key)) {
      return { ok: false, error: `duplicate (move, short_label) pair for move "${item.move}"` };
    }
    seenMoveLabel.add(key);
  }

  // Layers 4 and 6 (heuristic, whole-response on any single violation).
  for (const item of items) {
    const authorityHit = findAuthorityViolation(item.short_label) ?? findAuthorityViolation(item.prompt);
    if (authorityHit) {
      return { ok: false, error: `suggestion ${item.id} failed authority check: ${authorityHit}` };
    }
    if (!looksLikeRequest(item.prompt)) {
      return { ok: false, error: `suggestion ${item.id}'s prompt does not read as a request (layer 6)` };
    }
  }

  return { ok: true, suggestions: items };
}
