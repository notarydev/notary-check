// Track 2, run once per INVOCATION rather than per claim.
//
// WHY THIS EXISTS. `reviewFlow.ts`'s `runAdvanceForClaim` fires inside the
// per-claim path, and the connector returns early when a review has no
// material claims. So today: no claims -> Advance never runs at all.
//
// Measured over 51 real transcripts, ~37% of substantive answers have material
// for NO detector — and those are exactly the turns where Track 1 has nothing
// and Track 2 is the entire product. Being a passenger on Track 1 meant Track 2
// was silent precisely when it was most needed. That is the bug this closes.
//
// THE INDEPENDENCE PROPERTY, precisely: Track 2 is not gated on Track 1's
// DECISIONS, only on its OUTPUTS. `findings = []` and `claims = []` are valid
// inputs and it still runs. It is not "started early" — assembling its context
// takes microseconds, so that would be a phantom stage — it simply does not
// require Track 1 to have concluded anything.
//
// WHAT IT SEES, and the line that holds:
//   - the payload (request, answer, task)  -> its own object: the task
//   - findings and gaps                    -> facts, as grounding
// It never sees the evidence corpus or the rejected-candidate pool. Handing
// Track 2 enough raw material to disagree with Track 1 would make it a second
// verifier, and then two things in the system would be entitled to an opinion
// about the same evidence. One is the whole design.

import { getAllowedMoves } from "./policy.ts";
import { inferIntent } from "./intent.ts";
import type { IntentResult } from "./intent.ts";
import { generateAdvanceSuggestions } from "./liveGenerate.ts";
import type { AdvanceMove, AdvanceSuggestion, InvocationContext, Track2EvidenceConstraint } from "./types.ts";
import type { Finding, Gap } from "../detect/types.ts";
import type { JudgeClient } from "../judge/judgeClient.ts";
import type { GenerateAdvanceMoveResult } from "./liveGenerate.ts";

export interface AdvanceInvocationInput {
  organizationId: string;
  reviewId: string;
  invocationId: string;
  /** The user's own verbatim request. Track 2's primary object. */
  userRequest?: string;
  /** Everything the bank computed. Facts only. */
  findings: readonly Finding[];
  /** What could not be checked, and why. Also facts. */
  gaps: readonly Gap[];
}

export interface AdvanceInvocationResult {
  suggestions: readonly AdvanceSuggestion[];
  intent: IntentResult;
  allowedMoves: readonly AdvanceMove[];
  /** Present when a call was attempted; absent when policy short-circuited. */
  raw?: GenerateAdvanceMoveResult;
  /** Why nothing was produced, when nothing was. */
  skipped?: "no_user_request" | "no_legal_move";
}

/**
 * Deterministic pre-ranking of what Track 2 may act on.
 *
 * Selection is code; wording is judgment. Without this, network-order or model
 * whim decides which finding becomes the visible action, and the same input
 * produces different cards on different runs.
 *
 * Findings sort before gaps: something established as wrong outranks something
 * we merely could not check. Within each, the fixed per-detector rank decides.
 */
export function rankActionCandidates(
  findings: readonly Finding[],
  gaps: readonly Gap[],
): Array<{ kind: "finding"; item: Finding } | { kind: "gap"; item: Gap }> {
  const f = [...findings].sort((a, b) => a.rank - b.rank).map((item) => ({ kind: "finding" as const, item }));
  const g = gaps.map((item) => ({ kind: "gap" as const, item }));
  return [...f, ...g];
}

/**
 * Renders findings and gaps into the single opaque context string Track 2's
 * prompt accepts, in ranked order.
 *
 * `boundaryText` and `unblocks` only — never the underlying evidence. That is
 * the same discipline `Track2EvidenceConstraint` already enforces for a single
 * Track 1 result, applied to the whole bank.
 */
function renderCandidates(ranked: ReturnType<typeof rankActionCandidates>): string | undefined {
  if (ranked.length === 0) return undefined;
  const lines = ranked.map((c) =>
    c.kind === "finding"
      ? `- Notary established: ${c.item.boundaryText}`
      : `- Notary could not check: ${c.item.unblocks} (missing: ${c.item.missing})`,
  );
  return lines.join("\n");
}

/**
 * Runs Track 2 once for an invocation.
 *
 * Never throws — a Track 2 fault must never affect the verification result,
 * which is already committed by the time this runs.
 */
export async function runAdvanceForInvocation(
  input: AdvanceInvocationInput,
  options: { client?: JudgeClient; organizationId?: string } = {},
): Promise<AdvanceInvocationResult> {
  // Intent first. This is Track 2's own object, and it is computed before any
  // model call — a task_mode we can explain beats one we cannot.
  const intent = inferIntent(input.userRequest);

  // A finding exists => Track 1 established something material, which is
  // exactly the condition the move policy calls "has evidence constraint".
  const hasConstraint = input.findings.length > 0;
  const allowedMoves = getAllowedMoves(intent.taskMode, hasConstraint);

  const userRequest = input.userRequest?.trim() ?? "";
  if (userRequest.length === 0) {
    // Without the user's request Track 2 has no task, and inventing one is the
    // one thing it must never do. Note this is NOT the same as "no findings" —
    // Track 2 runs happily with zero findings, which is the common case.
    return { suggestions: [], intent, allowedMoves, skipped: "no_user_request" };
  }
  if (allowedMoves.length === 0) {
    return { suggestions: [], intent, allowedMoves, skipped: "no_legal_move" };
  }

  const ranked = rankActionCandidates(input.findings, input.gaps);
  const context: InvocationContext = {
    invocation_id: input.invocationId,
    user_request: userRequest,
    task_mode: intent.taskMode,
    visible_context: renderCandidates(ranked),
    created_at: new Date().toISOString(),
  };

  // The single highest-ranked finding becomes the sealed boundary, preserving
  // the existing one-directional channel rather than opening a second one.
  const top = ranked.find((c) => c.kind === "finding");
  const constraint: Track2EvidenceConstraint | undefined =
    top !== undefined && top.kind === "finding"
      ? { invocation_id: input.invocationId, material: true, boundary_text: top.item.boundaryText }
      : undefined;

  const raw = await generateAdvanceSuggestions(context, allowedMoves, constraint, {
    client: options.client,
    organizationId: options.organizationId ?? input.organizationId,
  });

  return { suggestions: raw.suggestions ?? [], intent, allowedMoves, raw };
}
