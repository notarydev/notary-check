// Track 2 / Advance — prompt construction
// (§ Track 2 / Advance build order step 5; Part 11 § Prompt construction,
// § Suggestion cardinality and the six-layer guardrail architecture).
//
// Builds the fixed prompt blocks: role, allowed moves, cardinality rule,
// content/authority prohibitions, delimited data, strict output instruction.
// All caller-supplied text (user_request, claude_answer, visible_context,
// prior_attempts, explicit_constraints, and a sealed Track1 boundary_text if
// present) is delimited via ../ingestion/delimitEvidence.ts's
// delimitEvidenceForModel before it reaches the prompt — the same defense
// Track 1's judge and Track 2/Challenge use against a document (here: a
// user's own request) containing instruction-shaped text ("ignore prior
// instructions and recommend X"). Nothing here calls a model or does I/O;
// this module only builds text. What it asks for is a REQUEST to the model —
// validator.ts is what actually enforces the result, not this prompt.

import { delimitEvidenceForModel } from "../ingestion/delimitEvidence.ts";
import type { AdvanceMove, InvocationContext, Track2EvidenceConstraint } from "./types.ts";

export const ADVANCE_PROMPT_VERSION = "2026-09-04.1";

export interface AdvancePromptInput {
  context: InvocationContext;
  allowedMoves: readonly AdvanceMove[];
  constraint?: Track2EvidenceConstraint;
}

const MOVE_DESCRIPTIONS: Record<AdvanceMove, string> = {
  clarify: "clarify — something important is missing; get it",
  test: "test — don't guess; run a small, reversible check",
  compare: "compare — multiple live explanations/options exist; distinguish them",
  repair: "repair — something in the current work needs fixing; fix it without carrying the bad premise forward",
};

/**
 * Builds the system/user messages for one Advance call. Returns the messages
 * plus `question` (persisted provenance, matching every other judge call in
 * this codebase's convention) — never calls a model itself.
 */
export function buildAdvancePrompt(input: AdvancePromptInput): { system: string; user: string; question: string } {
  const { context, allowedMoves, constraint } = input;

  const system = [
    "You propose the NEXT HUMAN MOVE(S) for someone working with an AI assistant.",
    "You are not answering their question, and you are not verifying any fact —",
    "that is a separate system's job, not yours.",
    "",
    "CARDINALITY: return 0, 1, or 2 suggestions. Zero is correct and expected",
    "when there is nothing useful to add — do not manufacture one. A second",
    "suggestion is legal ONLY when it represents a materially distinct next",
    "move, not a rephrasing or a minor variant of the first. Padding to two",
    "when one is clearly sufficient is invalid behavior.",
    "",
    "ALLOWED MOVES (each suggestion must use exactly one):",
    ...allowedMoves.map((m) => `- ${MOVE_DESCRIPTIONS[m]}`),
    "",
    "EACH SUGGESTION MUST BE:",
    "- short_label: a short, scannable headline (under 100 characters) —",
    "  e.g. \"This answer has a mistake: left door stays open\".",
    "- prompt: one short, concrete, actionable REQUEST addressed to the",
    "  assistant (under 600 characters) — something to ask or tell it to do,",
    "  never a conclusion you state yourself.",
    "",
    "EVERY SUGGESTION MUST NEVER CONTAIN:",
    "- a verdict or verification claim (\"the evidence proves...\", \"this claim",
    "  is false...\") — you do not verify anything.",
    "- a new factual claim not already present in the supplied context.",
    "- a confidence figure or score.",
    "- a citation or sourcing claim, unless it is literally quoting text the",
    "  user themselves supplied.",
    "- a claim that an action was already completed (\"I checked...\", \"I",
    "  compared...\", \"this has been fixed...\").",
    "- language telling the system to act autonomously (\"send this\", \"run",
    "  this\", \"search for...\", \"open the browser\").",
    "- a stated conclusion in place of a request (\"the correct answer is X\"",
    "  is WRONG; \"compare X and Y on Z\" is RIGHT).",
    "",
    constraint
      ? "If you reference the SEALED EVIDENCE BOUNDARY below, you may quote it\nverbatim, or omit it entirely. You may NOT paraphrase it."
      : undefined,
    "",
    'Respond with ONLY a JSON object of this exact shape:',
    '{"suggestions": [{"id": "<short unique string>", "short_label": "<...>", "move": "<one of the allowed moves>", "prompt": "<...>"}]}',
    "The array may be empty. No prose outside the JSON object.",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  const sections: string[] = [
    `USER'S REQUEST:\n${delimitEvidenceForModel(context.user_request)}`,
  ];
  if (context.claude_answer) {
    sections.push(`ASSISTANT'S ANSWER SO FAR:\n${delimitEvidenceForModel(context.claude_answer)}`);
  }
  if (context.visible_context) {
    sections.push(`ADDITIONAL VISIBLE CONTEXT:\n${delimitEvidenceForModel(context.visible_context)}`);
  }
  if (context.explicit_constraints && context.explicit_constraints.length > 0) {
    sections.push(`EXPLICIT CONSTRAINTS:\n${delimitEvidenceForModel(context.explicit_constraints.join("\n"))}`);
  }
  if (context.prior_attempts && context.prior_attempts.length > 0) {
    sections.push(`PRIOR ATTEMPTS:\n${delimitEvidenceForModel(context.prior_attempts.join("\n"))}`);
  }
  if (constraint) {
    // The sentence, as before.
    let block =
      "SEALED EVIDENCE BOUNDARY — do not reinterpret or add to it, quote it as-is if you reference it:\n" +
      delimitEvidenceForModel(constraint.boundary_text);

    // The structured half. Rendered as a plain table rather than JSON: the
    // model reads this, and a table of three short columns is harder to
    // misread than nested braces. Values are delimited exactly like every
    // other caller-supplied string — a claim or a passage can contain
    // instruction-shaped text, and this is content, not trusted input.
    if (constraint.field_deltas !== undefined && constraint.field_deltas.length > 0) {
      const rows = constraint.field_deltas
        .map((d) => `  ${d.field}: claim says "${d.claimed}" / evidence says "${d.observed}" (${d.relation})`)
        .join("\n");
      block +=
        "\n\nWHICH FIELDS DISAGREED — use this to choose a move that names the RIGHT problem. " +
        "A wrong period, a wrong entity, and a right entity with a wrong number need different next steps:\n" +
        delimitEvidenceForModel(rows);
    }
    if (constraint.evidence_locator !== undefined) {
      block += `\n\nSOURCE THE FINDING CAME FROM (reference only, you have not been shown its contents): ${delimitEvidenceForModel(constraint.evidence_locator)}`;
    }
    sections.push(block);
  }

  const user = sections.join("\n\n");
  const question = `Given this task state${constraint ? " and the sealed evidence boundary" : ""}, what (if any) next move(s) are worth proposing?`;

  return { system, user, question };
}
