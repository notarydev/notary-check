// Mirrors engine/src/evidence/locators.ts's Locator union as it comes back
// over the wire (JSON) from the engine's POST /v1/reviews/:reviewId/claims
// response. Not imported from engine/ (separate package, and this codebase
// must not touch engine/) — this is the wire shape, read from that module's
// source and from engine/src/routes/reviews.ts's actual response body.
export type CardLocatorKind = "text_offsets" | "json_path" | "unresolvable";
export type CardLocatorProvenance = "fetched" | "caller_supplied" | null;

export interface CardLocator {
  kind: CardLocatorKind;
  contentKind?: string | null;
  provenance?: CardLocatorProvenance;
  // text_offsets only
  start?: number;
  end?: number;
  quote?: string;
  page?: number;
  canonicalTextHash?: string;
  // json_path only
  path?: string;
  resolvedValue?: string;
  // unresolvable only
  reason?: string;
  associatedUrl?: string | null;
}

// The source_role the caller originally submitted this evidence under —
// engine's `evidence.origin` column (see engine/src/routes/evidence.ts). This
// is honest "who supplied it" labeling, distinct from the locator's own
// `provenance` (fetched vs. caller_supplied), which says whether NOTARY
// actually retrieved the text or was handed it verbatim.
export type CardEvidenceOrigin = "answer_citation" | "user_added" | "workspace_collection";

export interface CardEvidenceMatch {
  evidenceId: string;
  relation: "supports" | "contradicts";
  method: "quoted_or_computed" | "entailed";
  locator: CardLocator;
  origin: CardEvidenceOrigin;
  sourceUrl?: string;
}

export interface CardRejectedCandidate {
  evidenceId: string;
  // Source-level identifier only (never a passage locator — an inapplicable
  // row produced no passage worth pointing at). See RunReviewRejectedCandidate
  // in engine/src/review/reviewFlow.ts.
  locator: string | null;
  mismatchedFields: string[];
  details: Array<{ field: string; detail: string }>;
  origin: CardEvidenceOrigin;
}

// Locked contract from docs/build/tier-1-build-and-operating-plan.md's
// "Track 2 / Challenge layer" section — quoted, not paraphrased. Never
// carries a verdict/confidence/answer field.
export type ChallengeItem = {
  challenge_type: "ambiguity" | "missing_assumption" | "alternative_interpretation" | "evidence_request" | "adversarial_test";
  prompt: string;
  why_it_matters: string;
  action: "clarify_claim" | "add_source" | "open_evidence" | "ask_host" | "draft_test" | "leave_unchanged";
};

export type ReviewCardData = {
  status: "no_issue" | "issue_found" | "could_not_check";
  scope: string;
  claim?: string;
  findings?: Array<{
    label: string;
    text: string;
    why: string;
    // Present only for findings backed by an actual engine claim submission
    // (never invented client-side) — the resolved evidence this finding
    // rests on, straight from what the engine persisted to evidence_match.
    evidence?: {
      matches: CardEvidenceMatch[];
      rejectedCandidates: CardRejectedCandidate[];
    };
  }>;
  actions: string[];
  // Optional, defensive: absent whenever the engine hasn't landed Track 2 yet,
  // or produced zero items. Never rendered above the evidence record.
  challenges?: ChallengeItem[];
};

// Scenario A — correct answer, nothing to flag.
export const NO_ISSUE: ReviewCardData = {
  status: "no_issue",
  scope: "1 factual claim reviewed against 1 accessible source.",
  actions: [],
};

// Scenario B — single-finding card: source exists but does not support the claim.
export const SINGLE_FINDING: ReviewCardData = {
  status: "issue_found",
  claim: "Acme's revenue grew 17% in FY25.",
  scope: "No applicable source was available to check Acme's FY25 figure.",
  findings: [
    {
      label: "The cited source cannot support this claim",
      text: "It refers to overall market growth.",
      why: "entity mismatch (market ≠ Acme).",
    },
  ],
  actions: ["Open evidence", "Qualify", "Dismiss"],
};

// Scenario C — the flagship two-block contradiction card.
export const TWO_BLOCK_CONTRADICTION: ReviewCardData = {
  status: "issue_found",
  claim: "Acme's revenue grew 17% in FY25.",
  scope: "6 factual claims reviewed against 4 accessible sources.",
  findings: [
    {
      label: "The cited 17% refers to overall market growth, not Acme.",
      text: "This source cannot support the claim.",
      why: "entity mismatch.",
    },
    {
      label: "Acme's FY25 annual report says revenue increased 12% year over year.",
      text: "Applicable contradictory evidence.",
      why: "same entity, period, metric, and baseline; the value conflicts.",
    },
  ],
  actions: ["Open both sources", "Replace with 12%", "Qualify", "Dismiss", "Recheck"],
};

// Scenario D — nothing inspectable was supplied at all.
export const COULD_NOT_CHECK: ReviewCardData = {
  status: "could_not_check",
  scope: "This answer contains claims but no inspectable sources were supplied.",
  actions: [],
};

// Route a fixed list of "answer_text" inputs to one of the four scenarios above.
// This is how Phase 0 fakes the engine: match on keywords, return canned data.
export function pickMockScenario(answerText: string): ReviewCardData {
  const text = answerText.toLowerCase();
  if (text.includes("17%") && text.includes("acme") && text.includes("annual report")) {
    return TWO_BLOCK_CONTRADICTION;
  }
  if (text.includes("17%") && text.includes("acme")) {
    return SINGLE_FINDING;
  }
  if (text.trim().length === 0) {
    return COULD_NOT_CHECK;
  }
  return NO_ISSUE;
}
