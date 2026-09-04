// Act, run once per INVOCATION rather than per claim.
//
// WHY THIS EXISTS. `reviewFlow.ts`'s `runMovesForClaim` fires inside the
// per-claim path, and the connector returns early when a review has no
// material claims. So today: no claims -> Move never runs at all.
//
// Measured over 51 real transcripts, ~37% of substantive answers have material
// for NO detector — and those are exactly the turns where Verify has nothing
// and Act is the entire product. Being a passenger on Verify meant Act
// was silent precisely when it was most needed. That is the bug this closes.
//
// THE INDEPENDENCE PROPERTY, precisely: Act is not gated on Verify's
// DECISIONS, only on its OUTPUTS. `findings = []` and `claims = []` are valid
// inputs and it still runs. It is not "started early" — assembling its context
// takes microseconds, so that would be a phantom stage — it simply does not
// require Verify to have concluded anything.
//
// WHAT IT SEES, and the line that holds:
//   - the payload (request, answer, task)  -> its own object: the task
//   - findings and gaps                    -> facts, as grounding
// It never sees the evidence corpus or the rejected-candidate pool. Handing
// Act enough raw material to disagree with Verify would make it a second
// verifier, and then two things in the system would be entitled to an opinion
// about the same evidence. One is the whole design.

import { getAllowedMoves } from "./policy.ts";
import { inferIntent } from "./intent.ts";
import type { IntentResult } from "./intent.ts";
import { generateMoves } from "./liveGenerate.ts";
import type { MoveKind, Move, InvocationContext, ActEvidenceConstraint } from "./types.ts";
import type { Finding, Gap } from "../detect/types.ts";
import type { JudgeClient } from "../judge/judgeClient.ts";
import type { GenerateMoveResult } from "./liveGenerate.ts";

export interface MoveInvocationInput {
  organizationId: string;
  reviewId: string;
  invocationId: string;
  /** The user's own verbatim request. Act's primary object. */
  userRequest?: string;
  /** Everything the bank computed. Facts only. */
  findings: readonly Finding[];
  /** What could not be checked, and why. Also facts. */
  gaps: readonly Gap[];
}

export interface MoveInvocationResult {
  moves: readonly Move[];
  intent: IntentResult;
  allowedMoves: readonly MoveKind[];
  /** Present when a call was attempted; absent when policy short-circuited. */
  raw?: GenerateMoveResult;
  /** Why nothing was produced, when nothing was. */
  skipped?: "no_user_request" | "no_legal_move";
}

/**
 * Deterministic pre-ranking of what Act may act on.
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
 * Renders findings and gaps into the single opaque context string Act's
 * prompt accepts, in ranked order.
 *
 * `boundaryText` and `unblocks` only — never the underlying evidence. That is
 * the same discipline `ActEvidenceConstraint` already enforces for a single
 * Verify result, applied to the whole bank.
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
 * Runs Act once for an invocation.
 *
 * Never throws — a Act fault must never affect the verification result,
 * which is already committed by the time this runs.
 */
export async function runMovesForInvocation(
  input: MoveInvocationInput,
  options: { client?: JudgeClient; organizationId?: string } = {},
): Promise<MoveInvocationResult> {
  // Intent first. This is Act's own object, and it is computed before any
  // model call — a task_mode we can explain beats one we cannot.
  const intent = inferIntent(input.userRequest);

  // A finding exists => Verify established something material, which is
  // exactly the condition the move policy calls "has evidence constraint".
  const hasConstraint = input.findings.length > 0;
  const allowedMoves = getAllowedMoves(intent.taskMode, hasConstraint);

  const userRequest = input.userRequest?.trim() ?? "";
  if (userRequest.length === 0) {
    // Without the user's request Act has no task, and inventing one is the
    // one thing it must never do. Note this is NOT the same as "no findings" —
    // Act runs happily with zero findings, which is the common case.
    return { moves: [], intent, allowedMoves, skipped: "no_user_request" };
  }
  if (allowedMoves.length === 0) {
    return { moves: [], intent, allowedMoves, skipped: "no_legal_move" };
  }

  const ranked = rankActionCandidates(input.findings, input.gaps);
  const context: InvocationContext = {
    invocation_id: input.invocationId,
    user_request: userRequest,
    task_mode: intent.taskMode,
    visible_context: renderCandidates(ranked),
    created_at: new Date().toISOString(),
  };

  // The highest-ranked finding becomes the sealed boundary, now carrying its
  // field-level detail. Those deltas were already computed by the detector and
  // were being discarded at this boundary — the reason Act's moves
  // read as generic was that it received a sentence and had to guess whether
  // it was looking at a wrong period, a wrong entity, or a wrong number.
  const top = ranked.find((c) => c.kind === "finding");
  const constraint: ActEvidenceConstraint | undefined =
    top !== undefined && top.kind === "finding"
      ? {
          invocation_id: input.invocationId,
          material: true,
          boundary_text: top.item.boundaryText,
          field_deltas: top.item.fieldDeltas.map((d) => ({
            field: d.field,
            claimed: d.claimed,
            observed: d.observed,
            relation: d.relation,
          })),
          // A reference only. The passage itself is never handed over — see
          // ActEvidenceConstraint's own comment on why.
          evidence_locator: top.item.basis.ref,
        }
      : undefined;

  const raw = await generateMoves(context, allowedMoves, constraint, {
    client: options.client,
    organizationId: options.organizationId ?? input.organizationId,
  });

  return { moves: raw.moves ?? [], intent, allowedMoves, raw };
}
