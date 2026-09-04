// Intent inference — Track 2's first job.
//
// WHY THIS IS OURS AND NOT CLAUDE'S. The obvious design is to add `task_mode`
// to the MCP schema and let Claude label the task. That is asking Claude to do
// Track 2's job, in an optional field it will often skip — and we already
// measured that it skips optional fields 19% of the time on the one that
// actually matters. Worse, it makes the classification unauditable: if Claude
// says "research" we have no idea why, and no way to improve it.
//
// Inferring it ourselves makes the classification ours to own, version, and
// get better at. It is also a well-understood problem — intent classification
// from a first user turn against a closed set of classes is standard work, not
// something we would be inventing.
//
// WHY IT MATTERS SO MUCH. Measured over 51 real transcripts, ~37% of
// substantive answers have material for NO detector at all. On those turns
// Track 1 has nothing and Track 2 is the entire product. Track 2's object is
// the task — so with no task signal it has nothing, and would drift into
// commenting on the answer, which is Track 1's object and not its own.
//
// DETERMINISTIC FIRST, ON PURPOSE. This runs a lexical classifier before any
// model call, and only escalates when the lexical pass is not confident. Most
// requests are obvious ("fix this function", "summarise this paper"), the
// classifier is free and instant, and a `task_mode` we can explain beats one
// we cannot. The model call is the fallback, not the default.

import type { TaskMode } from "./types.ts";

export const INTENT_VERSION = "intent-lexical-v1";

export interface IntentResult {
  taskMode: TaskMode;
  /** How the classification was reached — recorded so a bad call is diagnosable. */
  basis: "lexical" | "default";
  /** The signal that decided it, for the same reason. */
  matched?: string;
  /**
   * True when nothing matched and we fell back to "general". The caller uses
   * this to decide whether the intent is worth ASKING about — a defaulted
   * intent is exactly a gap Track 2 may want to close.
   */
  defaulted: boolean;
}

/**
 * Signals per mode, ordered most-specific-first within each mode.
 *
 * Deliberately narrow. A word only earns a place here if its presence is
 * strong evidence on its own — "test" appears in every kind of work and is
 * absent, while "unit test" is not. A loose classifier is worse than a
 * defaulted one, because a wrong task mode narrows the allowed move set
 * (policy.ts) and silently removes options that should have been available.
 */
const SIGNALS: Array<{ mode: TaskMode; patterns: RegExp[] }> = [
  {
    mode: "coding",
    patterns: [
      /\b(refactor|debug|stack ?trace|compile|compiler|runtime error|unit test|regression test|pull request|merge conflict)\b/i,
      /\b(function|method|class|module|dependency|import|package|repo|repository|codebase)\b.{0,40}\b(fix|broken|failing|error|bug|implement|write|add)\b/i,
      /\b(fix|debug|implement|refactor)\b.{0,30}\b(function|method|class|bug|test|endpoint|query|script)\b/i,
    ],
  },
  {
    mode: "research",
    patterns: [
      /\b(literature|papers?|study|studies|citation|cite|peer[- ]reviewed|meta[- ]analysis|systematic review)\b/i,
      /\b(what does the (research|evidence|literature) say|find sources?|according to the (paper|study))\b/i,
    ],
  },
  {
    mode: "analysis",
    patterns: [
      /\b(revenue|margin|earnings|forecast|valuation|financials?|quarterly|fiscal year|balance sheet|cash flow)\b/i,
      /\b(analy[sz]e|breakdown|reconcile)\b.{0,30}\b(numbers?|figures?|data|results?|report)\b/i,
    ],
  },
  {
    mode: "writing",
    patterns: [
      /\b(draft|rewrite|edit|proofread|tone|copy|headline|paragraph|essay|blog post|newsletter)\b/i,
      /\b(write|write me)\b.{0,25}\b(email|memo|post|letter|summary|intro|announcement)\b/i,
    ],
  },
  {
    mode: "strategy",
    patterns: [
      /\b(go[- ]to[- ]market|positioning|roadmap|competitive|business model|pricing strategy|market entry)\b/i,
      /\b(should we|which should I)\b.{0,40}\b(build|buy|pursue|prioriti[sz]e|invest)\b/i,
    ],
  },
  {
    mode: "operations",
    patterns: [
      /\b(deploy|deployment|rollback|runbook|incident|on[- ]call|migration|infrastructure|terraform|kubernetes|cluster)\b/i,
      /\b(production|staging)\b.{0,30}\b(down|failing|outage|broken|degraded)\b/i,
    ],
  },
];

/**
 * Classifies the user's request into one of the closed task modes.
 *
 * Returns `general` when nothing matches — which is the honest answer, not a
 * failure. `general` resolves to the FULL four-move set in policy.ts, so a
 * defaulted intent never silently narrows what Track 2 may propose. Guessing a
 * specific mode would.
 */
export function inferIntent(userRequest: string | undefined): IntentResult {
  const text = (userRequest ?? "").trim();
  if (text.length === 0) {
    return { taskMode: "general", basis: "default", defaulted: true };
  }

  // Score rather than first-match: a request mentioning both a function and a
  // paper should not be decided by the order of this table.
  const scores = new Map<TaskMode, { n: number; matched: string }>();
  for (const { mode, patterns } of SIGNALS) {
    for (const re of patterns) {
      const m = re.exec(text);
      if (m === null) continue;
      const prev = scores.get(mode);
      scores.set(mode, { n: (prev?.n ?? 0) + 1, matched: prev?.matched ?? m[0] });
    }
  }
  if (scores.size === 0) {
    return { taskMode: "general", basis: "default", defaulted: true };
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].n - a[1].n);
  // A tie is genuine ambiguity between two task shapes. Narrowing on a
  // coin-flip would remove moves that should have stayed available, so an
  // unbroken tie defaults to the full move set instead.
  if (ranked.length > 1 && ranked[0][1].n === ranked[1][1].n) {
    return { taskMode: "general", basis: "default", defaulted: true };
  }

  return { taskMode: ranked[0][0], basis: "lexical", matched: ranked[0][1].matched, defaulted: false };
}
