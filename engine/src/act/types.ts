// Act / Move — bounded task-state input and output contract
// (§ Act / Move — the current build target, build order step 1).
//
// This file defines ONLY types. It performs no I/O, calls no model, and
// imports nothing from ../verification/, ../review/, or ../judge/judgeClient.ts
// — the isolated unit (steps 1-4 of the locked build order) has to exist and be
// exercised against fixtures BEFORE a live model call is wired in, not after
// (docs/build/tier-1-build-and-operating-plan.md § Act / Move).
//
// THE INFORMATION BOUNDARY, in code rather than in prose (Part 11 § The
// information problem): InvocationContext is deliberately bounded to what
// Claude and the user could both legitimately see about THIS turn — the
// user's request, Claude's own answer, constraints the user stated, prior
// attempts, and artifacts the user supplied. It has no field for Claude's
// reasoning trace, no field for private tool output, and no field for a
// retrieval corpus, because Move is not supposed to see more than Claude
// saw — giving it more would make it a second, redundant "smarter Claude"
// rather than the independently-sourced signal the design calls for. The one
// exception, `visible_context`, is deliberately a single opaque string (the
// summary Claude itself writes into the tool call — the only channel a
// connector has, per Part 11 § Case 1) rather than a structured trace.

/**
 * The closed set of task categories the policy table keys on
 * (§ Act / Move build order step 2). "general" (and undefined,
 * see policy.ts) is the default when Claude does not declare a mode —
 * it is not itself a narrower category, it is the absence of one.
 */
export type TaskMode = "coding" | "research" | "analysis" | "writing" | "strategy" | "operations" | "general";

/**
 * One invocation's bounded task-state snapshot — the ONLY input Move's
 * model call is ever allowed to see. Every field here is either something the
 * user supplied directly or something Claude already produced and is willing
 * to restate; nothing here is inferred, fetched, or retrieved by Notary.
 */
export interface InvocationContext {
  /** Identifies this invocation for logging/persistence by later layers (step 8+). Opaque to this module — never parsed or matched against. */
  invocation_id: string;

  /**
   * The user's own request for this turn, verbatim or close to it. Required —
   * Move has nothing to recommend a next move ABOUT without knowing what
   * was being asked; every other field is context around this one.
   */
  user_request: string;

  /**
   * Claude's own answer for this turn, when available. Optional because
   * Move may run before Claude has finished (Act starts concurrently
   * with Verify, not after either) — a next-move recommendation can still be
   * useful from the request and prior context alone.
   */
  claude_answer?: string;

  /**
   * A single opaque summary string Claude itself writes into the tool call
   * (Part 11 § Case 1: "the tool-call response is the only channel a
   * connector has"). Deliberately NOT a structured trace or a full
   * transcript — Move is not supposed to reconstruct the conversation,
   * only to read what Claude chose to restate of it.
   */
  visible_context?: string;

  /**
   * Artifacts the USER supplied (pasted text, uploaded file references,
   * URLs) — never something Notary fetched or resolved on its own. Kept as
   * an array of opaque strings/descriptors rather than parsed content: this
   * module does no retrieval and no parsing of artifact contents.
   */
  user_supplied_artifacts?: readonly string[];

  /**
   * What the user says they already tried, in their own words. Optional —
   * most invocations are a first attempt — but load-bearing for distinguishing
   * "test" (nothing tried yet, don't guess) from "repair" (something was
   * tried and needs fixing) in the policy layer.
   */
  prior_attempts?: readonly string[];

  /**
   * Constraints the user stated explicitly (budget, deadline, must-use-X).
   * Optional, and deliberately distinct from `user_request` — a constraint is
   * something Move's move must respect, not restate as the ask itself.
   */
  explicit_constraints?: readonly string[];

  /**
   * Declared task category, used only to select the allowed move set
   * (policy.ts). Optional — absence defaults to the full four-move set, see
   * getAllowedMoves — because an unknown task shape is not grounds to narrow
   * what the model is allowed to propose.
   */
  task_mode?: TaskMode;

  /** When this snapshot was assembled. Provenance only — never compared or aged out by this module. */
  created_at: string;
}

/**
 * The one-directional, sealed signal from Verify (§ Delivery mechanism;
 * "Act has independent authority, execution, and inputs, with exactly one
 * controlled information channel from Verify"). Exactly three fields, and
 * `material` is always `true` by construction — this type exists to
 * represent ONLY the case where Verify decided something was worth sending;
 * a non-material Verify result never becomes one of these at all, so there
 * is no `material: false` branch for a caller to mishandle.
 */
export interface ActEvidenceConstraint {
  /** Which invocation this sealed statement revises. Ties it back to the InvocationContext it applies to. */
  invocation_id: string;
  /** Always true — see the type-level comment above for why there is no false case. */
  material: true;
  /**
   * The sealed boundary text itself, verbatim from Verify's deterministic
   * pipeline. Move may quote or reference this text but — per
   * validator.ts's boundaryPreserved — must never reinterpret or expand it;
   * the model does not get to paraphrase what the evidence established.
   */
  boundary_text: string;
  /**
   * WHICH FIELDS DISAGREED, and how — the structured half of the handoff.
   *
   * boundary_text alone is a sentence, and a sentence cannot distinguish
   * "wrong period" from "wrong entity" from "right entity, wrong number."
   * Those are three different repairs, and until this existed Act read one
   * sentence and guessed which it was looking at.
   *
   * DELIBERATELY NOT INCLUDED, and this is the boundary: no evidence corpus,
   * no resolved passages beyond a short excerpt, and no rejected-candidate
   * pool. Act gets enough to choose and phrase a move, and never enough to
   * re-litigate the finding. Handing it the raw material would make it a
   * second verifier, and then two things in the system would be entitled to an
   * opinion about the same evidence.
   *
   * Empty when Verify produced no field-level detail (a detector that
   * compares whole statements rather than fields), in which case behaviour is
   * exactly as it was before this field existed.
   */
  field_deltas?: ReadonlyArray<{
    /** The applicability field, e.g. "period", "entity", "valueUnit". */
    field: string;
    /** What the claim asserted for it. */
    claimed: string;
    /** What the evidence (or the other claim) had instead. */
    observed: string;
    relation: "conflict" | "missing" | "weaker" | "stronger";
  }>;
  /** Where the finding came from, so a move can name it. Never the passage itself. */
  evidence_locator?: string;
}

/**
 * The closed vocabulary of next moves (§ "The four moves — closed vocabulary,
 * nothing else is a valid output"). Nothing outside this union is ever a
 * valid Move recommendation — not "answer", not "summarize", not
 * anything else a model might reach for.
 */
export type MoveKind = "clarify" | "test" | "compare" | "repair";

/**
 * ONE move — the entire output shape the model may fill in per item,
 * and — deliberately — the entire type available to represent it. There is
 * no answer, summary, verdict, confidence, score, citation, fact,
 * evidence_relation, or recommended_state field, which is what makes
 * "Move never produces a verdict" a property TypeScript itself enforces
 * on any code that constructs an Move, not a rule someone has
 * to remember to follow (same discipline as ChallengeItem in
 * ../judge/challengeGeneration.ts). validator.ts's `.strict()` zod schema
 * enforces the same shape at the boundary where untrusted model text
 * actually enters the system, plus the content/authority checks types alone
 * cannot express (§ Act / Move build order step 3, layers 4/6).
 */
export interface Move {
  /** Unique within one response — lets the UI and later persistence address one item without ambiguity. */
  id: string;
  /**
   * A short, scannable headline shown by default (e.g. "This answer has a
   * mistake: left door stays open") — NOT the full prompt. Its own, tighter
   * character limit (validator.ts's MAX_SHORT_LABEL_CHARS) — the point of
   * having it at all is that it's short enough to read at a glance.
   */
  short_label: string;
  /** One of the four closed moves, chosen from whatever set policy.ts allowed for this invocation — never an open choice. */
  move: MoveKind;
  /** The full actionable ask, generated eagerly alongside short_label but only revealed in the UI on click — editable and sendable (never auto-sent) — not a paragraph, not a transcript, not a justification, not a stated conclusion. */
  prompt: string;
}

/**
 * The ENTIRE output contract the model must return for one round: zero, one,
 * or two moves (Part 11 § Move cardinality, locked 2026-09-03 —
 * supersedes an earlier "always exactly one" version of this type). Zero is
 * a legitimate, expected result ("no useful intervention"), never treated as
 * a failure. A second item is only ever legal because the MODEL judged it a
 * materially distinct next move — code enforces the count and structural
 * shape (validator.ts), never the semantic judgment of whether two items
 * actually differ.
 */
export interface MoveModelResponse {
  moves: readonly Move[];
}
