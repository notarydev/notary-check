// Track 2 / Advance — the deterministic move-policy layer
// (§ Track 2 / Advance build order step 2; Part 11 § "AI's role here").
//
// Part 2's rule — AI parses, code judges — doesn't map cleanly onto
// move-selection, because picking one of four labeled actions is closer to a
// judgment than a parse. The compromise the design locks in: CODE supplies
// the allowed move set (by task_mode and by whether a sealed Track 1 finding
// exists), and the model only ever chooses and phrases WITHIN that closed
// set — it never invents the action space. This file is that policy layer.
// It is pure, versioned DATA plus one pure function; it does not call a
// model, does not do I/O, and does not import anything from ../judge/ or
// ../verification/.
//
// WHY THIS IS DATA, NOT PROMPT WORDING: a prompt change is invisible —
// nothing forces a reviewer to notice that "coding + no update" quietly
// started allowing `repair`. A change to POLICY_TABLE below is a diff in a
// versioned, reviewed file, and POLICY_VERSION exists so any downstream
// record (once persistence exists, in step 8+) can pin exactly which policy
// generation a stored suggestion was drafted under.

import type { AdvanceMove, TaskMode } from "./types.ts";

/** Bumped whenever POLICY_TABLE's mappings change. Not read by this module — exists so callers persisting a suggestion can record which policy generation produced it. */
export const POLICY_VERSION = "2026-09-03.1";

/**
 * task_mode (or "general" for undefined) x whether a sealed Track 1 finding
 * is attached -> the allowed move set for that combination.
 *
 * The starting rows below are the exact example mappings from Part 11 / the
 * build spec:
 *   - coding + no update      -> {clarify, test, compare}   (repair excluded:
 *     nothing has been independently found broken yet, so "fix it" would be
 *     the model inventing a defect rather than responding to one)
 *   - research + update       -> {clarify, compare, repair} (an applicability
 *     boundary from Track 1 makes "repair the premise" and "compare against
 *     the boundary" live; "test" drops out because there is no code/artifact
 *     to run — this is a case-2 example whose task_mode is research)
 *   - writing + update        -> {repair, clarify}          (a contradicted
 *     claim needs fixing or clarifying, not testing or comparing options)
 *
 * Every other cell is filled in below on the same reasoning: what does a
 * sealed Track 1 boundary make newly relevant or newly irrelevant for this
 * kind of task. "general"/undefined always gets the full four-move set
 * (see getAllowedMoves) — an unrecognized task shape is not grounds to
 * narrow what the model may propose, so it is intentionally NOT a row here.
 */
const POLICY_TABLE: Readonly<Record<Exclude<TaskMode, "general">, { noConstraint: readonly AdvanceMove[]; withConstraint: readonly AdvanceMove[] }>> = {
  coding: {
    // No independent finding yet: don't assume something is broken (no
    // repair) or that competing options exist (compare is still allowed,
    // since code tasks often do have live alternatives) — clarify missing
    // requirements, or test the untested rather than guess.
    noConstraint: ["clarify", "test", "compare"],
    // A sealed boundary on a coding task most often means "the thing you
    // built/assumed doesn't hold" — repair becomes live; test stays useful
    // (verify the fix); compare drops (the boundary already picked a
    // winner, so "compare options" is less relevant than acting on it).
    withConstraint: ["clarify", "test", "repair"],
  },
  research: {
    // Nothing sealed yet: the open questions are what's missing (clarify),
    // what to run/check to reduce uncertainty (test), or which of several
    // live explanations holds (compare). Repair excluded — there's no
    // established defect yet to fix.
    noConstraint: ["clarify", "test", "compare"],
    // An applicability boundary from Track 1: distinguishing explanations
    // against the sealed fact (compare), fixing a premise the boundary
    // broke (repair), or asking what's still missing given the new fact
    // (clarify) are all live. Test drops — there's no artifact to run,
    // the finding already came from Track 1's own verification.
    withConstraint: ["clarify", "compare", "repair"],
  },
  writing: {
    // Nothing sealed yet: is something missing (clarify), or are there
    // competing framings/claims to distinguish (compare)? Test and repair
    // don't fit an as-yet-unverified piece of writing.
    noConstraint: ["clarify", "compare"],
    // A sealed finding contradicts something in the draft: fix it (repair)
    // or, if the fix isn't obvious without more from the user, ask
    // (clarify). Compare and test both drop — the boundary already
    // resolved which claim is right, so there's nothing left to compare or
    // test.
    withConstraint: ["repair", "clarify"],
  },
  strategy: {
    // Nothing sealed yet: strategy work is rarely a single test-and-verify
    // loop, and rarely reveals a defect without independent evidence — the
    // live moves are clarifying the goal/constraints or comparing live
    // options. Test and repair excluded for the same reasons as writing.
    noConstraint: ["clarify", "compare"],
    // A sealed boundary undercuts an assumption behind the strategy:
    // repair the plan, ask what's still needed (clarify), or compare
    // against the newly-established fact. Test stays excluded — strategy
    // has no artifact to run.
    withConstraint: ["clarify", "compare", "repair"],
  },
  analysis: {
    // Closer to research than to coding: nothing sealed yet means the live
    // moves are what's missing (clarify), what check would reduce
    // uncertainty (test — e.g. re-run a calculation, pull a missing number),
    // or which of several readings of the data holds (compare). No
    // established defect yet, so repair is excluded.
    noConstraint: ["clarify", "test", "compare"],
    // A sealed boundary from Track 1 plays the same role it does for
    // research: it already adjudicated between explanations, so what's left
    // is fixing a premise the boundary broke (repair), distinguishing
    // remaining live readings against it (compare), or asking what's still
    // missing (clarify). Test drops — the boundary IS the verification, not
    // a prompt to run another one.
    withConstraint: ["clarify", "compare", "repair"],
  },
  operations: {
    // Like coding, operations tasks usually have a real, runnable artifact
    // (a config, a deploy, a runbook step) — so before anything is
    // independently found broken, the live moves are clarifying missing
    // detail, testing the untested change, or comparing live approaches.
    // Repair is excluded for the same reason as coding: nothing has been
    // established as wrong yet.
    noConstraint: ["clarify", "test", "compare"],
    // A sealed boundary most often means an assumed-safe operational premise
    // doesn't hold — repair becomes live, testing the fix stays useful, and
    // compare drops because the boundary already picked the answer rather
    // than leaving live alternatives to weigh.
    withConstraint: ["clarify", "test", "repair"],
  },
};

/** The full four-move set — the default for "general" and for an undefined task_mode. */
const FULL_MOVE_SET: readonly AdvanceMove[] = ["clarify", "test", "compare", "repair"];

/**
 * Returns the allowed move set for a given task_mode and whether a sealed
 * Track 2 evidence constraint (Track 1 finding) is attached to this
 * invocation. Pure and total: every TaskMode value, "general", and undefined
 * all resolve to a defined result — there is no combination this function
 * can be called with that falls through without a documented answer.
 */
export function getAllowedMoves(taskMode: TaskMode | undefined, hasEvidenceConstraint: boolean): readonly AdvanceMove[] {
  if (taskMode === undefined || taskMode === "general") {
    return FULL_MOVE_SET;
  }
  const row = POLICY_TABLE[taskMode];
  return hasEvidenceConstraint ? row.withConstraint : row.noConstraint;
}
