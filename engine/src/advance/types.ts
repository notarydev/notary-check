// Track 2 / Advance — bounded task-state input and output contract
// (§ Track 2 / Advance — the current build target, build order step 1).
//
// This file defines ONLY types. It performs no I/O, calls no model, and
// imports nothing from ../verification/, ../review/, or ../judge/judgeClient.ts
// — the isolated unit (steps 1-4 of the locked build order) has to exist and be
// exercised against fixtures BEFORE a live model call is wired in, not after
// (docs/build/tier-1-build-and-operating-plan.md § Track 2 / Advance).
//
// THE INFORMATION BOUNDARY, in code rather than in prose (Part 11 § The
// information problem): InvocationContext is deliberately bounded to what
// Claude and the user could both legitimately see about THIS turn — the
// user's request, Claude's own answer, constraints the user stated, prior
// attempts, and artifacts the user supplied. It has no field for Claude's
// reasoning trace, no field for private tool output, and no field for a
// retrieval corpus, because Advance is not supposed to see more than Claude
// saw — giving it more would make it a second, redundant "smarter Claude"
// rather than the independently-sourced signal the design calls for. The one
// exception, `visible_context`, is deliberately a single opaque string (the
// summary Claude itself writes into the tool call — the only channel a
// connector has, per Part 11 § Case 1) rather than a structured trace.

/**
 * The closed set of task categories the policy table keys on
 * (§ Track 2 / Advance build order step 2). "general" (and undefined,
 * see policy.ts) is the default when Claude does not declare a mode —
 * it is not itself a narrower category, it is the absence of one.
 */
export type TaskMode = "coding" | "research" | "analysis" | "writing" | "strategy" | "operations" | "general";

/**
 * One invocation's bounded task-state snapshot — the ONLY input Advance's
 * model call is ever allowed to see. Every field here is either something the
 * user supplied directly or something Claude already produced and is willing
 * to restate; nothing here is inferred, fetched, or retrieved by Notary.
 */
export interface InvocationContext {
  /** Identifies this invocation for logging/persistence by later layers (step 8+). Opaque to this module — never parsed or matched against. */
  invocation_id: string;

  /**
   * The user's own request for this turn, verbatim or close to it. Required —
   * Advance has nothing to recommend a next move ABOUT without knowing what
   * was being asked; every other field is context around this one.
   */
  user_request: string;

  /**
   * Claude's own answer for this turn, when available. Optional because
   * Advance may run before Claude has finished (Track 2 starts concurrently
   * with Track 1, not after either) — a next-move recommendation can still be
   * useful from the request and prior context alone.
   */
  claude_answer?: string;

  /**
   * A single opaque summary string Claude itself writes into the tool call
   * (Part 11 § Case 1: "the tool-call response is the only channel a
   * connector has"). Deliberately NOT a structured trace or a full
   * transcript — Advance is not supposed to reconstruct the conversation,
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
   * something Advance's move must respect, not restate as the ask itself.
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
 * The one-directional, sealed signal from Track 1 (§ Delivery mechanism;
 * "Track 2 has independent authority, execution, and inputs, with exactly one
 * controlled information channel from Track 1"). Exactly three fields, and
 * `material` is always `true` by construction — this type exists to
 * represent ONLY the case where Track 1 decided something was worth sending;
 * a non-material Track 1 result never becomes one of these at all, so there
 * is no `material: false` branch for a caller to mishandle.
 */
export interface Track2EvidenceConstraint {
  /** Which invocation this sealed statement revises. Ties it back to the InvocationContext it applies to. */
  invocation_id: string;
  /** Always true — see the type-level comment above for why there is no false case. */
  material: true;
  /**
   * The sealed boundary text itself, verbatim from Track 1's deterministic
   * pipeline. Advance may quote or reference this text but — per
   * validator.ts's boundaryPreserved — must never reinterpret or expand it;
   * the model does not get to paraphrase what the evidence established.
   */
  boundary_text: string;
}

/**
 * The closed vocabulary of next moves (§ "The four moves — closed vocabulary,
 * nothing else is a valid output"). Nothing outside this union is ever a
 * valid Advance recommendation — not "answer", not "summarize", not
 * anything else a model might reach for.
 */
export type AdvanceMove = "clarify" | "test" | "compare" | "repair";

/**
 * The ENTIRE output contract the model must return, and — deliberately — the
 * entire type available to represent it. There is no answer, summary,
 * verdict, confidence, score, citation, fact, evidence_relation, or
 * recommended_state field on this type, which is what makes "Advance never
 * produces a verdict" a property TypeScript itself enforces on any code that
 * constructs a Track2ModelDraft, not a rule someone has to remember to
 * follow (same discipline as ChallengeItem in
 * ../judge/challengeGeneration.ts). validator.ts's `.strict()` zod schema
 * enforces the same shape at the boundary where untrusted model text
 * actually enters the system.
 */
export interface Track2ModelDraft {
  /** One of the four closed moves, chosen from whatever set policy.ts allowed for this invocation — never an open choice. */
  move: AdvanceMove;
  /** The single actionable ask shown to the user, editable and sendable (never auto-sent) — not a paragraph, not a transcript, not a justification. */
  prompt: string;
}
