// Act, run for ONE claim — the judged half of an invocation, subordinate by
// construction to the Verify result that already committed.
//
// WHY THIS IS ITS OWN FILE. reviewFlow.ts is the deterministic pipeline: load
// evidence, compare fields, assign a state, persist. The two functions here do
// none of that. They run AFTER that pipeline has committed, they read values
// it produced and write to their own tables, and — the property that matters —
// neither of them can reach assignState(). Keeping them in the orchestrator
// made that separation something you had to trace through 1300 lines to
// confirm; as a separate module it is visible in the import list, and
// scripts/check-boundaries.ts fails the build if either file ever imports the
// state machine.
//
// BOTH FUNCTIONS ARE TOTAL. Neither throws. A failure inside Act degrades to
// zero challenges / zero moves over an intact Verify finding — a question or a
// suggestion must never be able to fail a verification. Every catch in this
// file exists to hold that line, not to hide an error: each one logs.
//
// The two layers and why they gate differently:
//   · CHALLENGE (Act v1) — 0-2 typed QUESTIONS about one resolved claim.
//     Org-flag-gated (act_challenge_enabled, off), and budgeted ACROSS the
//     claims of one review, so it holds an advisory lock while it counts.
//   · MOVE (Act v2) — 0-2 next-move recommendations about the user's broader
//     task. Its cap is entirely within one call, so there is no sibling count
//     to serialise against and no lock.

import type pg from "pg";
import type { ChallengeItem } from "../judge/challengeGeneration.ts";
import { generateChallenges } from "../judge/challengeGeneration.ts";
import { CHALLENGE_PROMPT_VERSION, MAX_CHALLENGES_PER_INVOCATION } from "../judge/challengePrompts.ts";
import type { JudgeClient } from "../judge/judgeClient.ts";
import { DEFAULT_JUDGE_MODEL } from "../judge/judgeClient.ts";
import { logEvent } from "../observability/log.ts";
import { checkQuota } from "../quotas/quotaCheck.ts";
import { insertUsageEvent, usageEventFromChallengeCall, usageEventFromMoveCall } from "../quotas/usage.ts";
import { getAllowedMoves } from "../act/policy.ts";
import { generateMoves } from "../act/liveGenerate.ts";
import { persistMoveInvocation } from "../act/persist.ts";
import type { Move, InvocationContext, ActEvidenceConstraint } from "../act/types.ts";
import type { ClaimLifecycleState } from "./lifecycle.ts";

export interface ActInput {
  organizationId: string;
  reviewId: string;
  claimId: string;
  materiality: boolean;
  claimText: string;
  decontextualizedForm?: string;
  state: string;
  stateReason: string;
  noSource: boolean;
  matchedFields: string[];
  mismatchDetails: Array<{ field: string; detail: string }>;
  excerpts: Array<{ relation: string; locatorDisplay: string; quote: string }>;
}

/**
 * The Act stage: gate, budget, quota, generate, persist.
 *
 * THE GATE ORDER IS THE COST CONTRACT, and each step is ordered by what it
 * costs to evaluate:
 *
 *   1. materiality — a non-material claim gets no challenge layer at all
 *      (§ "at most 2 challenge items per material claim"). Free: already in
 *      memory.
 *   2. the org flag — one indexed primary-key read. A disabled org stops HERE,
 *      before any budget query, any quota sum, and any judge client is
 *      constructed, so "ship dark" costs one cheap SELECT and zero DeepSeek
 *      calls rather than a call whose result is discarded.
 *   3. the invocation budget — 4 items across all claims of this review. Claims
 *      arrive one per request, so the count of sibling items already persisted
 *      IS the invocation's spend so far; a review whose budget is gone makes no
 *      call either.
 *   4. checkQuota — the same gate the field judge and claim extraction use.
 *      Act is a real DeepSeek call and must never become an unmetered path.
 *
 * NEVER THROWS. Act is subordinate by construction, so any failure in it
 * degrades to zero challenge items and an already-committed, fully valid Track
 * 1 finding. A question layer must not be able to fail a verification.
 */
export async function runActChallenge(
  input: ActInput,
  db: pg.Pool,
  client?: JudgeClient,
): Promise<ChallengeItem[]> {
  try {
    if (!input.materiality) return [];

    const flag = await db.query("SELECT act_challenge_enabled FROM organization WHERE id = $1", [input.organizationId]);
    if (flag.rows[0]?.act_challenge_enabled !== true) return [];

    // The per-invocation cap, counted across every claim already written for
    // this review — including by earlier requests, since one review's claims
    // are submitted one per call.
    //
    // RACE CLOSED HERE: this used to be a plain db.query() count, followed
    // much later by a separate insert transaction, with a network model call
    // in between. Two concurrent claim submissions for the same review could
    // both read "4 remaining", both call the model, and both insert — the
    // per-review cap was only best-effort under concurrency. Fixed by holding
    // one connection for the whole count -> generate -> insert span and taking
    // a Postgres advisory transaction lock keyed on the review id: a second
    // concurrent call for the SAME review blocks at the lock acquisition
    // (released automatically at COMMIT/ROLLBACK) until the first either
    // commits its inserts or rolls back, so the count it then reads is always
    // current. Different reviews use different lock keys and never block each
    // other. hashtext() collisions are theoretically possible but only ever
    // cause two unrelated reviews to serialize against each other — never an
    // incorrect count — so this stays correct even in that case.
    const conn = await db.connect();
    try {
      await conn.query("BEGIN");
      await conn.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.reviewId]);

      const spent = await conn.query(
        `SELECT count(*)::int AS n
           FROM challenge_item ci
           JOIN claim c ON c.id = ci.claim_id
          WHERE c.review_id = $1`,
        [input.reviewId],
      );
      const remaining = MAX_CHALLENGES_PER_INVOCATION - Number(spent.rows[0]?.n ?? 0);
      if (remaining <= 0) {
        await conn.query("COMMIT");
        logEvent({
          event: "challenge_skipped",
          error_cause: "invocation_cap_reached",
          organization_id: input.organizationId,
          review_id: input.reviewId,
        });
        return [];
      }

      const quota = await checkQuota(input.organizationId, db);
      if (!quota.allowed) {
        await conn.query("COMMIT");
        logEvent({
          event: "challenge_skipped",
          error_cause: `quota_${quota.reason}`,
          organization_id: input.organizationId,
          review_id: input.reviewId,
          path: "judge-involved",
        });
        return [];
      }

      const generated = await generateChallenges(
        {
          claimText: input.claimText,
          decontextualizedForm: input.decontextualizedForm,
          state: input.state,
          stateReason: input.stateReason,
          noSource: input.noSource,
          matchedFields: input.matchedFields,
          mismatchDetails: input.mismatchDetails,
          excerpts: input.excerpts,
        },
        { client, organizationId: input.organizationId, maxItems: remaining },
      );

      // A call that reached the network has a token count on its record, and
      // its cost is real whether or not its output survived parsing. Metering
      // it is therefore keyed on the token count, exactly as the field-judge
      // path is — never on whether items came back.
      if (generated.record.inputTokens !== undefined) {
        await insertUsageEvent(
          db,
          usageEventFromChallengeCall(generated.record, {
            organizationId: input.organizationId,
            reviewId: input.reviewId,
          }),
        );
      }

      if (generated.items.length === 0) {
        await conn.query("COMMIT");
        return [];
      }

      // Persisted on the SAME locked connection/transaction, into
      // challenge_item and nothing else. Note what is absent: the claim row
      // is never touched, nor is evidence_match. A Act write cannot reach
      // either table from here.
      for (const [ordinal, item] of generated.items.entries()) {
        await conn.query(
          `INSERT INTO challenge_item
             (claim_id, ordinal, challenge_type, action, prompt, why_it_matters,
              model, prompt_version, verify_state, verify_state_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            input.claimId,
            ordinal,
            item.challengeType,
            item.action,
            item.prompt,
            item.whyItMatters,
            generated.record.model,
            generated.record.promptVersion ?? CHALLENGE_PROMPT_VERSION,
            input.state,
            input.stateReason,
          ],
        );
      }
      await conn.query("COMMIT");
      return generated.items;
    } catch (err) {
      await conn.query("ROLLBACK");
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    // Subordinate by construction: a Act failure is logged and swallowed,
    // never propagated into a committed Verify result.
    logEvent({
      event: "challenge_failed",
      error_cause: (err as Error)?.message ?? "unknown",
      organization_id: input.organizationId,
      review_id: input.reviewId,
    });
    return [];
  }
}

/** Everything Move is allowed to see about this claim, by value. */
export interface MoveInput {
  organizationId: string;
  reviewId: string;
  claimId: string;
  claimText: string;
  materiality: boolean;
  lifecycle: ClaimLifecycleState;
  state: string;
  stateReason: string;
  /** The user's own verbatim request for this turn, when the caller has it. */
  userRequest?: string;
}

/**
 * The MOVE stage: build the bounded InvocationContext, compute the allowed
 * move set, generate (quota/kill-switch gated inside liveGenerate.ts),
 * persist, return. NEVER THROWS — same subordination discipline as
 * runActChallenge: Move is a move layer, and any failure inside it
 * degrades to zero moves over an intact, already-committed Verify
 * finding, never a failed verification.
 *
 * GATE ORDER, cheapest-first, same shape as Act/Challenge's own gate:
 *   1. userRequest — absent/empty means Move has nothing to recommend a
 *      next move ABOUT (types.ts's InvocationContext doc comment); skip
 *      before building anything. Free: already in memory.
 *   2. allowedMoves — policy.ts's getAllowedMoves is pure and always
 *      non-empty for this codebase's TaskMode set, but liveGenerate.ts
 *      short-circuits on an empty set defensively regardless, so this is not
 *      a gate this function needs to duplicate.
 *   3. liveGenerate.ts's own kill-switch and quota gates, consulted inside
 *      generateMoves() itself (organizationId + db passed
 *      through) — the same DeepSeek call site every other judge-involved path
 *      in this codebase gates the same way.
 *
 * Not held under the same advisory lock / per-invocation budget Act/
 * Challenge uses: Move's own cardinality cap (0-2 moves) is entirely
 * WITHIN one call (validator.ts's MAX_SUGGESTIONS), never a cross-claim
 * invocation budget — there is no sibling-row count to serialize against.
 */
export async function runMovesForClaim(
  input: MoveInput,
  db: pg.Pool,
  client?: JudgeClient,
): Promise<Move[]> {
  try {
    // Org feature flag (migration 0014), checked FIRST — before the
    // user_request short-circuit, before any budget query, and before any
    // client is constructed. Same ordering discipline as Act/Challenge's
    // own flag read: a disabled org must cost exactly zero extra DeepSeek
    // calls, not one whose result is then discarded.
    //
    // Deliberately writes no act_invocation row. A 'skipped' row means
    // "Move was eligible to run and short-circuited on its own policy" —
    // an org that has the feature turned off was never eligible at all, and
    // recording one row per claim per disabled org would bury the real
    // policy short-circuits in noise.
    const flag = await db.query("SELECT act_moves_enabled FROM organization WHERE id = $1", [input.organizationId]);
    if (flag.rows[0]?.act_moves_enabled !== true) return [];

    const userRequest = input.userRequest?.trim() ?? "";
    if (userRequest.length === 0) {
      // Recorded as a 'skipped' row (not silence) so "Move never ran for
      // this claim because there was no user_request" is distinguishable
      // later from "Move ran and found nothing" or "Move's call
      // failed" — see persist.ts's status derivation and
      // migration 0013's act_invocation.status doc comment.
      await persistMoveInvocation(db, {
        organizationId: input.organizationId,
        reviewId: input.reviewId,
        claimId: input.claimId,
        invocationContextId: input.claimId,
        hasEvidenceConstraint: false,
        allowedMoves: [],
        // Neither `moves` nor `record` set — persist.ts's own status
        // derivation reads this as 'skipped' (no call was attempted at all),
        // distinct from the 'ok' zero-moves case liveGenerate.ts's
        // in-call short-circuits produce (which DO set `moves: []`).
        result: { error: "no_user_request" },
      });
      return [];
    }

    // Case 2 (§ Part 11): a sealed Verify boundary exists whenever this
    // claim is material, its lifecycle actually completed (never surface an
    // incomplete check as a "finding" Move can react to), and the
    // resolved state is not SUPPORTED — i.e. exactly the cases in which
    // server/src/engineClient.ts's own findingFor() would render a finding
    // to the user. boundary_text is built from the same two fields the card
    // already treats as the stable, displayable record of what Verify
    // established (state + state_reason) — never a paraphrase of anything
    // Verify did not itself assert.
    const hasEvidenceConstraint = input.materiality && input.lifecycle === "completed" && input.state !== "SUPPORTED";
    const constraint: ActEvidenceConstraint | undefined = hasEvidenceConstraint
      ? {
          invocation_id: input.claimId,
          material: true,
          boundary_text: `Notary's Verify check resolved the claim "${input.claimText}" to ${input.state} (${input.stateReason}).`,
        }
      : undefined;

    // task_mode is undefined: the current MCP tool input has no field for it
    // (§ this build's known interpretation gap, flagged in the handoff report
    // — the server/src/server.ts schema only grew user_request, not
    // task_mode). getAllowedMoves(undefined, ...) is documented to resolve to
    // the full four-move set, which is the honest default for an unknown
    // task shape rather than a narrowing guess.
    const allowedMoves = getAllowedMoves(undefined, hasEvidenceConstraint);

    const context: InvocationContext = {
      invocation_id: input.claimId,
      user_request: userRequest,
      created_at: new Date().toISOString(),
    };

    const generated = await generateMoves(context, allowedMoves, constraint, {
      client,
      organizationId: input.organizationId,
      db,
    });

    // Same metering discipline as every other judge-involved call site: a
    // call that reached the network has a token count on its record, and its
    // cost is real whether or not its output survived validation.
    if (generated.record?.inputTokens !== undefined) {
      await insertUsageEvent(
        db,
        usageEventFromMoveCall(generated.record, { organizationId: input.organizationId, reviewId: input.reviewId }),
      );
    }

    const persisted = await persistMoveInvocation(db, {
      organizationId: input.organizationId,
      reviewId: input.reviewId,
      claimId: input.claimId,
      invocationContextId: input.claimId,
      hasEvidenceConstraint,
      allowedMoves,
      result: generated,
    });

    return [...persisted.moves];
  } catch (err) {
    // Subordinate by construction, same as Act/Challenge: a Move
    // failure is logged and swallowed, never propagated into a committed
    // Verify result.
    logEvent({
      event: "move_failed",
      error_cause: (err as Error)?.message ?? "unknown",
      organization_id: input.organizationId,
      review_id: input.reviewId,
    });
    return [];
  }
}
