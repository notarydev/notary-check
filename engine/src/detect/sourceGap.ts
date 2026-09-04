// The ask: "give me a source and I can check this."
//
// WHY THIS EXISTS, and why it is a detector rather than a line in the
// connector. `Gap` has declared an `addressable_source` kind since the bank was
// built, and NOTHING has ever emitted one. Only selfReport could produce a gap,
// and only for execution output — so on an answer with five unsourced claims,
// Notary produced zero gaps, said nothing about what would make them
// checkable, and the round-trip we designed never fired once.
//
// The fact was always known: `source_verify` sets `no_source` on the claim row.
// But source_verify lives in the review flow, writes `claim.state`, and has no
// path into `gaps[]` — the bank is a separate module with a different output
// shape. This closes that path without moving source_verify, which must keep
// its special status as the only detector that assigns a verification state.
//
// WHAT IT IS NOT. It does not check anything and never produces a Finding. It
// reports one fact — this material claim had nothing to check against — in the
// shape Act can turn into an ask. The distinction the whole design rests
// on: a gap is a fact, an ask is a move, and only Act makes those.

import type { Detector, DetectorInput, DetectorOutcome, Gap } from "./types.ts";

export const SOURCE_GAP_VERSION = "source-gap-v1";

/**
 * At most this many source gaps per invocation.
 *
 * Each gap can prompt a full re-invocation — Claude fetching a document, then
 * calling again — so ten unsourced claims must not become ten round trips the
 * user waits through. Two is the same interrupt budget the moves use, and
 * the connector caps again at the wire boundary.
 */
const MAX_SOURCE_GAPS = 2;

export const sourceGapDetector: Detector = {
  id: "source_verify",
  version: SOURCE_GAP_VERSION,
  // Ranks last. A claim that could not be checked is weaker than one shown to
  // be wrong, and rankActionCandidates already sorts every finding above every
  // gap — this only orders source gaps among themselves.
  rank: 90,

  run(input: DetectorInput): DetectorOutcome {
    // PER CLAIM, not per review.
    //
    // This used to test one review-wide boolean, so a single resolved source
    // anywhere in the review made the detector not-applicable for every claim
    // in it. The common shape — one cited claim beside four uncited ones —
    // therefore produced no gap at all, and the answer's four ungrounded
    // claims went unremarked. A claim whose own source resolved is the one
    // whose gap is closed; nobody else's is.
    //
    // A claim WITH resolved evidence is source_verify's own result to report
    // (SUPPORTED / CONTRADICTED / UNSUPPORTED), not a missing input we can ask
    // for. A claim without one is exactly what this detector exists to name.
    const material = input.claims.filter((c) => c.materiality);
    if (material.length === 0) {
      // No material claim, so no source would help. Asking here would be
      // asking for input that cannot change anything — exactly the case the
      // three-outcome design exists to keep separate from a real gap.
      return { status: "not_applicable" };
    }

    const ungrounded = material.filter((c) => !c.hasResolvedEvidence);
    if (ungrounded.length === 0) {
      // Every material claim had something to check against. Whatever happened
      // next is a verification result, not a gap.
      return { status: "not_applicable" };
    }

    const gaps: Gap[] = ungrounded.slice(0, MAX_SOURCE_GAPS).map((c) => ({
      detector: "source_verify",
      claimId: c.id,
      missing: "addressable_source",
      // Phrased as what BECOMES POSSIBLE, not as an instruction. The card
      // renders this after "Would let Notary …", and the tool response reports
      // it as a fact about the run. An imperative here would be an instruction
      // inside data, which Claude correctly refuses.
      unblocks: `check "${c.text.length > 90 ? `${c.text.slice(0, 90)}…` : c.text}" against it`,
    }));

    return { status: "missing_input", gaps };
  },
};
