export type ReviewCardData = {
  status: "no_issue" | "issue_found" | "could_not_check";
  scope: string;
  claim?: string;
  findings?: Array<{
    label: string;
    text: string;
    why: string;
  }>;
  actions: string[];
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
