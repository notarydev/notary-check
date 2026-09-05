// Bridge from the MCP tool call to the real engine API (replaces
// mocks/scenarios.ts's pickMockScenario). Does the real work: extract claims
// from the answer text, register whatever sources were actually supplied,
// run each material claim through the engine's deterministic+judge pipeline,
// and map the results onto the card's locked 3-state shape.
//
// Engine-state -> finding-type -> card-state mapping is exactly the table in
// docs/build/tier-1-build-and-operating-plan.md's "Engine state -> finding type -> card state" section — this
// module does not invent its own compression rule, it implements that one.

import { randomUUID } from "node:crypto";
import type {
  ReviewCardData,
  CardLocator,
  CardEvidenceMatch,
  CardRejectedCandidate,
  CardEvidenceOrigin,
  ChallengeItem,
  Move,
} from "./mocks/scenarios.js";

// Read lazily, not as module-level constants: ES module imports are hoisted
// and evaluated before any other top-level code in the importing module runs
// (including server.ts's process.loadEnvFile() call), so capturing
// process.env at import time would permanently bake in the pre-.env-load
// (undefined) values.
function engineUrl(): string {
  return process.env.ENGINE_URL ?? "http://localhost:4001";
}
// Fallback default so local/manual testing without Clerk still works. The
// real Clerk-authenticated path always passes the per-user resolved key
// explicitly (see server.ts / orgResolver.ts) — this is only the fallback.
function defaultEngineApiKey(): string {
  return process.env.ENGINE_API_KEY ?? "";
}

interface SourceRef {
  url?: string;
  title?: string;
  quoted_excerpt?: string;
  source_role: "answer_citation" | "user_added" | "workspace_collection";
}

interface ClaimFields {
  entity?: string;
  period?: string;
  metric?: string;
  operator?: "increase" | "decrease" | "no_change";
  valueUnit?: { value: string; unit?: string };
  comparatorBaseline?: string;
  modality?: string;
  scope?: string;
}

interface ExtractedClaim {
  ordinal: number;
  text: string;
  materiality: boolean;
  claimFields: ClaimFields;
}

// Per-claim LIFECYCLE state, mirrored from engine/src/review/lifecycle.ts:
// where the claim got to in the pipeline, kept strictly separate from its
// verification `state` (what the evidence showed). Only "completed" licenses
// reading `state` as a finding about the world.
type ClaimLifecycleState = "not_extracted" | "extracted" | "submitted" | "completed" | "not_checkable" | "failed";

// Wire shape of POST /v1/reviews/:reviewId/claims's response body, as
// actually returned by engine/src/routes/reviews.ts today:
//   { claim: { id, review_id, state, state_reason, no_source, lifecycle_state,
//              lifecycle_detail, checks_completed },
//     matches, rejectedCandidates, evidence_statuses }
// `matches` mirrors exactly what was just inserted into evidence_match in the
// same transaction (engine/src/review/reviewFlow.ts) — this is the persisted
// data, not a separate computation.
interface EngineMatch {
  evidenceId: string;
  relation: "supports" | "contradicts";
  method: "quoted_or_computed" | "entailed";
  locator: CardLocator;
}
interface EngineRejectedCandidate {
  evidenceId: string;
  locator: string | null;
  mismatchedFields: string[];
  details: Array<{ field: string; detail: string }>;
}
interface ClaimResult {
  claim: {
    id: string;
    state: string;
    state_reason: string | null;
    no_source: boolean;
    lifecycle_state: ClaimLifecycleState;
    lifecycle_detail: string | null;
  };
  matches: EngineMatch[];
  rejectedCandidates: EngineRejectedCandidate[];
  // Act / Challenge layer (docs/build/tier-1-build-and-operating-plan.md's
  // "Act / Challenge layer" section). PRESENT in the engine's response —
  // engine/src/routes/reviews.ts maps its internal ChallengeItem[] to this
  // wire shape. Still typed `unknown` and parsed strictly (parseChallengeItems
  // below), same discipline as the Verify judge output: a caller must never
  // trust the wire shape just because a field exists, and an org with the
  // act_challenge_enabled flag off (or a review with no material claims) legitimately
  // sends no challenges at all, which must render as "none" rather than error.
  challenges?: unknown;
  // Move (Act v2) — PRESENT in the engine's response
  // (engine/src/routes/reviews.ts maps its internal Move[] to
  // this wire shape). Structurally separate from `challenges` above: a
  // different system, a different authority level. Typed `unknown` and
  // parsed strictly (parseMoves below), same discipline as
  // every other model-sourced wire field this client trusts nothing about
  // just because it's present — absent user_request, an exhausted quota, an
  // active kill switch, or a validation rejection all legitimately produce
  // no moves at all, which must render as "none", never an error.
  moves?: unknown;
}

// Locked output contract, quoted from the plan doc — see ChallengeItem in
// scenarios.ts. Strict-parsing discipline mirrors
// engine/src/judge/fieldExtraction.ts's rule for the Verify judge: a sneaked-in
// field (verdict/confidence/answer/anything else) rejects the whole item
// rather than being silently accepted.
const CHALLENGE_TYPES = new Set([
  "ambiguity",
  "missing_assumption",
  "alternative_interpretation",
  "evidence_request",
  "adversarial_test",
]);
const CHALLENGE_ACTIONS = new Set(["clarify_claim", "add_source", "open_evidence", "ask_host", "draft_test", "leave_unchanged"]);
const CHALLENGE_KEYS = ["challenge_type", "prompt", "why_it_matters", "action"];

// At most 2 challenge items per material claim (plan doc's stated cap).
function parseChallengeItems(raw: unknown): ChallengeItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ChallengeItem[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const keys = Object.keys(item);
    if (keys.length !== CHALLENGE_KEYS.length || !CHALLENGE_KEYS.every((k) => keys.includes(k))) continue;
    const { challenge_type, prompt, why_it_matters, action } = item as Record<string, unknown>;
    if (typeof challenge_type !== "string" || !CHALLENGE_TYPES.has(challenge_type)) continue;
    if (typeof prompt !== "string" || prompt.length === 0) continue;
    if (typeof why_it_matters !== "string" || why_it_matters.length === 0) continue;
    if (typeof action !== "string" || !CHALLENGE_ACTIONS.has(action)) continue;
    out.push({
      challenge_type: challenge_type as ChallengeItem["challenge_type"],
      prompt,
      why_it_matters,
      action: action as ChallengeItem["action"],
    });
    if (out.length === 2) break;
  }
  return out;
}

// Move's closed four-move vocabulary (engine/src/act/types.ts's
// MoveKind) and exact key set (engine/src/act/types.ts's
// Move: id, short_label, move, prompt — nothing else). Same
// strict-parsing discipline as parseChallengeItems above: a sneaked-in field
// (confidence/verdict/anything else) rejects that item outright rather than
// being silently accepted, mirroring what engine/src/act/validator.ts
// already enforces server-side — this is the SECOND, independent guard at the
// wire boundary, not a substitute for it.
const MOVE_KINDS = new Set(["clarify", "test", "compare", "repair"]);
const MOVE_KEYS = ["id", "short_label", "move", "prompt"];

// At most MAX_MOVES per review (Part 11: "0, 1, or 2
// moves" is per-invocation — the engine's own call is per-claim today,
// see review/reviewFlow.ts's runMovesForClaim, so this cap is what keeps a
// multi-claim answer from surfacing more than the per-invocation cardinality
// the design actually specifies).
const MAX_MOVES = 2;

function parseMoves(raw: unknown): Move[] {
  if (!Array.isArray(raw)) return [];
  const out: Move[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const keys = Object.keys(item);
    if (keys.length !== MOVE_KEYS.length || !MOVE_KEYS.every((k) => keys.includes(k))) continue;
    const { id, short_label, move, prompt } = item as Record<string, unknown>;
    if (typeof id !== "string" || id.length === 0) continue;
    if (typeof short_label !== "string" || short_label.length === 0) continue;
    if (typeof move !== "string" || !MOVE_KINDS.has(move)) continue;
    if (typeof prompt !== "string" || prompt.length === 0) continue;
    out.push({ id, short_label, move: move as Move["move"], prompt });
    if (out.length === MAX_MOVES) break;
  }
  return out;
}

// submitClaim's outcome: either the engine actually responded (ClaimResult),
// or the submission itself never completed — network error, non-2xx, thrown
// exception. The latter must never be swallowed as "nothing happened": bug 1
// was exactly that a `undefined` result here vanished with no finding.
type SubmitOutcome = { ok: true; result: ClaimResult } | { ok: false };

async function engineFetch(path: string, init: RequestInit, apiKey: string = defaultEngineApiKey()): Promise<Response> {
  return fetch(`${engineUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
  });
}

type ExtractionResult = { ok: true; claims: ExtractedClaim[] } | { ok: false; reason: string };

// Bug fix: this used to `return []` on any non-2xx response, making an
// extraction FAILURE (quota denial, provider/parse fault — 429/502 per
// engine/src/routes/extractClaims.ts) indistinguishable from a genuinely
// claim-free answer. Both used to collapse to the same empty array one line
// up the call chain, which is exactly what let reviewAnswer() render
// "no issue found" when the truth was "Notary never actually looked." The
// engine now always returns a distinct `extraction_status`/`reason` on
// failure and omits `claims` entirely (never an empty array) — this function
// preserves that distinction instead of erasing it.
async function extractClaims(answerText: string, apiKey: string): Promise<ExtractionResult> {
  const res = await engineFetch(
    "/v1/extract-claims",
    {
      method: "POST",
      body: JSON.stringify({ answer_text: answerText }),
    },
    apiKey,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { reason?: string };
    return { ok: false, reason: body.reason ?? "unknown" };
  }
  const body = (await res.json()) as { claims: ExtractedClaim[] };
  return { ok: true, claims: body.claims };
}

async function createReview(apiKey: string): Promise<string> {
  const res = await engineFetch(
    "/v1/reviews",
    {
      method: "POST",
      body: JSON.stringify({ idempotency_key: randomUUID() }),
    },
    apiKey,
  );
  const body = (await res.json()) as { review: { id: string } };
  return body.review.id;
}

async function registerEvidence(reviewId: string, source: SourceRef, apiKey: string): Promise<string | undefined> {
  const body: Record<string, unknown> = { review_id: reviewId, origin: source.source_role };
  // When both are present, send both: the excerpt is the actually-checkable
  // text (often already resolved by whoever supplied it, and not guaranteed
  // to be re-fetchable — a paywalled page, a screenshot transcript), while
  // the URL is provenance/traceability. Registering the URL alone and
  // dropping the excerpt would silently discard the one thing the caller
  // could actually check against — this was a real bug: it made the URL
  // resolve lazily (and often fail to reproduce the pasted text at all)
  // instead of using the text that was right there.
  if (source.quoted_excerpt !== undefined) body.payload = source.quoted_excerpt;
  if (source.url !== undefined) body.submitted_url = source.url;
  if (body.payload === undefined && body.submitted_url === undefined) return undefined; // nothing addressable to register

  const res = await engineFetch("/v1/evidence", { method: "POST", body: JSON.stringify(body) }, apiKey);
  if (!res.ok) return undefined;
  const parsed = (await res.json()) as { evidence: { id: string } };
  return parsed.evidence.id;
}

async function submitClaim(
  reviewId: string,
  claim: ExtractedClaim,
  evidenceIds: string[],
  apiKey: string,
  userRequest?: string,
): Promise<SubmitOutcome> {
  try {
    const res = await engineFetch(
      `/v1/reviews/${reviewId}/claims`,
      {
        method: "POST",
        body: JSON.stringify({
          text: claim.text,
          ordinal: claim.ordinal,
          materiality: claim.materiality,
          claim_fields: claim.claimFields,
          evidence_ids: evidenceIds,
          // Move needs the user's own original ask — passed straight
          // through, verbatim, never invented here. Omitted from the body
          // entirely when absent (undefined is dropped by JSON.stringify),
          // which the engine's own schema already treats as "optional, skip
          // Move for this claim" rather than a validation error.
          user_request: userRequest,
          // This connector ALWAYS calls /detect after the claim loop, which
          // runs Move once per invocation. Without this flag both paths run:
          // observed live on a five-claim answer, six per-claim Move calls
          // fired and were then discarded in favour of the invocation-level
          // result. Six model calls paid for, output thrown away, and the
          // "0-2 per invocation" cardinality contract bypassed — ten
          // near-duplicate moves generated before the connector trimmed
          // to two.
          skip_claim_moves: true,
        }),
      },
      apiKey,
    );
    if (!res.ok) return { ok: false };
    const result = (await res.json()) as ClaimResult;
    return { ok: true, result };
  } catch {
    // Network error, timeout, malformed JSON — the submission never
    // completed. Same "not checkable" fate as a non-2xx response, never a
    // silent drop.
    return { ok: false };
  }
}

interface Finding {
  label: string;
  text: string;
  why: string;
  evidence?: { matches: CardEvidenceMatch[]; rejectedCandidates: CardRejectedCandidate[] };
}

function toCardMatches(matches: EngineMatch[], originByEvidenceId: Map<string, CardEvidenceOrigin>): CardEvidenceMatch[] {
  return matches.map((m) => ({
    evidenceId: m.evidenceId,
    relation: m.relation,
    method: m.method,
    locator: m.locator,
    origin: originByEvidenceId.get(m.evidenceId) ?? "user_added",
    sourceUrl: m.locator.associatedUrl ?? undefined,
  }));
}

function toCardRejectedCandidates(
  rejected: EngineRejectedCandidate[],
  originByEvidenceId: Map<string, CardEvidenceOrigin>,
): CardRejectedCandidate[] {
  return rejected.map((r) => ({
    evidenceId: r.evidenceId,
    locator: r.locator,
    mismatchedFields: r.mismatchedFields,
    details: r.details,
    origin: originByEvidenceId.get(r.evidenceId) ?? "user_added",
  }));
}

// docs/build/tier-1-build-and-operating-plan.md's engine-state -> finding-type -> card-state table, made code.
// Bug fix: this now gates on `lifecycle_state`, not just `state`. A claim
// whose lifecycle isn't "completed" must never have its `state` read as a
// finding about the world (engine/src/review/lifecycle.ts's
// stateIsMeaningful) — even though the engine already sets `state` to
// INDETERMINATE in that case, this makes the client's own trust boundary
// explicit rather than depending on the engine never regressing that
// invariant.
// result.state_reason is an internal snake_case code from
// engine/src/verification/stateMachine.ts (e.g. "contradicting_applicable_relation"),
// never prose — it is not a display-text fallback source. It used to be spliced
// into `text` via `?? "..."`, but stateMachine.ts's assignState() always returns
// a non-null reason for a completed claim, so that fallback never actually
// triggered: the card was rendering the raw internal code as the finding text.
// `text` below is now always the fixed, human-readable copy; the code itself is
// preserved in `why` (already a stable, separate field for exactly this) for
// logs/telemetry, never for display.
/**
 * How many claims may be in flight at once. Claims are capped at 10 per
 * review (§ Cost-control rules), so this bounds a worst-case review to three
 * waves rather than ten simultaneous judge conversations — enough parallelism
 * to collapse the latency, not enough to stampede the provider or trip a rate
 * limit. Deliberately a small constant, not tuned: the win is going from
 * sequential to concurrent at all, and a larger number mostly buys risk.
 */
const CLAIM_CONCURRENCY = 4;

/**
 * How long Notary may spend checking claims before it stops and reports what
 * it has.
 *
 * WHY A DEADLINE AT ALL. Notary's work is proportional to claims x sources,
 * and BOTH are chosen by the caller. Without a bound, latency is a property of
 * whatever Claude happened to send rather than a property of Notary — which is
 * how one answer took two minutes, and how a much larger one would take far
 * longer. No amount of parallelism fixes an unbounded input; only a bound does.
 *
 * RUNNING OUT OF TIME IS NOT A FAILURE, IT IS A GAP. "I could not check that"
 * is already a first-class output of this system. So the deadline degrades to
 * the honest thing: check what fits, then say plainly how many claims were not
 * reached. "12 of 40 checked" is a legitimate answer; a spinner at two minutes
 * is not.
 *
 * This is deliberately NOT claim-capping. Nothing is silently skipped — the
 * unchecked count is stated on the card, and because Claude re-invokes on the
 * next turn, the remainder gets picked up rather than lost.
 *
 * Set generously on purpose: this is a backstop for pathological inputs, not
 * the common path. If it starts firing on ordinary answers, that is a signal
 * to make the engine faster, not to raise the number.
 */
const CLAIM_BUDGET_MS = Number(process.env.NOTARY_CLAIM_BUDGET_MS ?? 25_000);

/**
 * Runs `fn` over `items` with at most `limit` in flight, returning results in
 * INPUT ORDER regardless of completion order.
 *
 * Order preservation is the whole reason this exists rather than a plain
 * `Promise.all` over a sliced array: callers here fill first-come caps from
 * the results, so a result array shuffled by network timing would make the
 * output non-deterministic for identical input.
 *
 * Rejections propagate, matching `Promise.all`. Every caller in this module
 * passes a function that already degrades its own failures into a value
 * (`submitClaim` returns `{ok:false}` rather than throwing), so this path is
 * not load-bearing for error handling — but it must not silently swallow a
 * genuine bug either.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function findingFor(
  result: ClaimResult["claim"],
  claimText: string,
  evidence: { matches: CardEvidenceMatch[]; rejectedCandidates: CardRejectedCandidate[] },
): { finding?: Finding; needsCheck: boolean; noSource?: boolean } {
  if (result.lifecycle_state !== "completed") {
    return {
      finding: {
        label: claimText,
        text: "This claim could not be checked against the supplied evidence.",
        why: result.no_source ? "no_inspectable_evidence" : "unresolved_applicability",
        evidence,
      },
      needsCheck: true,
    };
  }
  // "No source was supplied" is NOT a failure — it is the expected, correct
  // outcome for a claim the model stated from its own knowledge. It used to
  // share `uncheckedFindings` with genuine faults (extraction errors, failed
  // submissions), which meant an unsourced answer returned `could_not_check`
  // — indistinguishable from "Notary broke". That conflation is why the card
  // could not be broadened past source-backed answers without shouting a
  // failure at every ordinary sentence.
  //
  // The third bucket keeps the finding (so the count is still available for a
  // future ambient "n claims checked" marker) while keeping it OFF the card,
  // and leaves `could_not_check` meaning only what it says: something we
  // attempted actually failed. Do not merge these buckets back together.
  //
  // It surfaces as the `not_checked` card state, NOT `no_issue` — the
  // canonical definition § 5.7 forbids rendering `no_source` as "fine".
  if (result.no_source) {
    return {
      finding: { label: claimText, text: "No inspectable evidence was supplied for this claim.", why: "no_inspectable_evidence", evidence },
      needsCheck: true,
      noSource: true,
    };
  }
  switch (result.state) {
    case "SUPPORTED":
      return { needsCheck: false };
    case "CONTRADICTED":
      return {
        finding: {
          label: claimText,
          text: "The supplied evidence contradicts this claim.",
          why: "direct_contradiction",
          evidence,
        },
        needsCheck: false,
      };
    case "UNSUPPORTED":
      return {
        finding: {
          label: claimText,
          text: "No supplied evidence supports this claim.",
          why: "unsupported_claim",
          evidence,
        },
        needsCheck: false,
      };
    default: // INDETERMINATE, any reason
      return {
        finding: {
          label: claimText,
          text: "This claim could not be checked against the supplied evidence.",
          why: "unresolved_applicability",
          evidence,
        },
        needsCheck: true,
      };
  }
}

// apiKey defaults to the shared ENGINE_API_KEY env var for local/manual
// testing without Clerk. The real Clerk-authenticated path (server.ts) always
// passes the caller's own per-user resolved key explicitly.
/**
 * Everything Claude sends beyond the answer and its sources — Act's
 * material plus the execution output Verify's self-report detector checks
 * against.
 *
 * Every field is optional and none may be invented by us. An absent field is
 * a correct, expected state; fabricating one would silently corrupt the task
 * model Act reasons from.
 */
export interface InvocationExtras {
  userRequest?: string;
  explicitConstraints?: string[];
  priorAttempts?: string[];
  executionResults?: Array<{ ref: string; text: string }>;
  priorContext?: Array<{ kind: string; text: string }>;
}

/** Wire shape of POST /v1/reviews/:id/detect. Parsed loosely on purpose —
 *  findings are pass-through data for the card, and an unexpected shape must
 *  degrade to "no findings" rather than failing the review. */
export interface CardGap {
  /** What is missing, in the engine's closed vocabulary. */
  missing: string;
  /** What becomes checkable if it arrives. A statement of fact, never a request. */
  unblocks: string;
}

interface DetectResponse {
  findings?: unknown[];
  gaps?: unknown[];
  moves?: unknown;
  intent?: { task_mode?: string; defaulted?: boolean } | null;
}

/**
 * Parses the engine's gaps into the shape the card and the response text use.
 *
 * Capped at 2. Each gap potentially triggers a full re-invocation — Claude
 * fetching a source, then calling again — and ten of those is ten round trips
 * the user waits through. Two is the same interrupt budget the moves use.
 */
function parseGaps(raw: unknown): CardGap[] {
  if (!Array.isArray(raw)) return [];
  const out: CardGap[] = [];
  for (const g of raw) {
    if (typeof g !== "object" || g === null) continue;
    const { missing, unblocks } = g as Record<string, unknown>;
    if (typeof missing !== "string" || typeof unblocks !== "string") continue;
    if (missing.length === 0 || unblocks.length === 0) continue;
    out.push({ missing, unblocks });
    if (out.length === MAX_GAPS) break;
  }
  return out;
}

/** See parseGaps — the same interrupt budget the moves use. */
const MAX_GAPS = 2;

/**
 * The detector bank's findings, with the field-level detail the record view
 * renders. Parsed strictly and defensively, same discipline as every other
 * model-adjacent wire field: an unexpected shape degrades to "no findings"
 * rather than failing the review.
 *
 * Findings are NOT capped. They are computed facts, and facts do not compete
 * for attention the way moves do — the cap belongs on actions, which are
 * an interrupt budget. The card decides how many to show at rest.
 */
function parseBankFindings(raw: unknown): NonNullable<ReviewCardData["bank_findings"]> {
  if (!Array.isArray(raw)) return [];
  const out: NonNullable<ReviewCardData["bank_findings"]> = [];
  for (const f of raw) {
    if (typeof f !== "object" || f === null) continue;
    const o = f as Record<string, unknown>;
    if (typeof o.detector !== "string" || typeof o.boundaryText !== "string") continue;
    const deltas = Array.isArray(o.fieldDeltas)
      ? o.fieldDeltas.flatMap((d) => {
          if (typeof d !== "object" || d === null) return [];
          const x = d as Record<string, unknown>;
          if (typeof x.field !== "string" || typeof x.relation !== "string") return [];
          return [{
            field: x.field,
            claimed: String(x.claimed ?? ""),
            observed: String(x.observed ?? ""),
            relation: x.relation,
          }];
        })
      : [];
    const basis = typeof o.basis === "object" && o.basis !== null ? (o.basis as Record<string, unknown>) : {};
    out.push({
      detector: o.detector,
      type: typeof o.type === "string" ? o.type : "finding",
      owner: typeof o.owner === "string" ? o.owner : "computed",
      boundary_text: o.boundaryText,
      field_deltas: deltas,
      basis_kind: typeof basis.kind === "string" ? basis.kind : "unknown",
    });
  }
  return out;
}

/**
 * Runs the detector bank and invocation-level Act.
 *
 * Called on EVERY review, including one with zero material claims — that is
 * the ~37% of turns where Verify has nothing and Act is the whole
 * product, and where Move used to be silent because it rode on the claim
 * loop.
 *
 * Never throws: detection is additive, so a failure here loses findings and
 * moves but must never turn a completed verification into an error.
 */
async function runDetection(
  reviewId: string,
  answerText: string,
  claims: ExtractedClaim[],
  claimIds: Map<number, string>,
  /**
   * Per-claim grounding, keyed by ordinal — NOT a review-wide flag.
   *
   * This argument used to be one boolean (`evidenceIds.length > 0`) for the
   * whole review, and the engine's source-gap detector short-circuited on it.
   * One cited claim beside four uncited ones therefore produced no gap for any
   * of them. The per-claim truth was already sitting in each submission's
   * `claim.no_source`; it was being thrown away here.
   */
  grounded: Map<number, boolean>,
  apiKey: string,
  extras: InvocationExtras,
): Promise<DetectResponse> {
  try {
    const res = await engineFetch(
      `/v1/reviews/${reviewId}/detect`,
      {
        method: "POST",
        body: JSON.stringify({
        answer_text: answerText,
        user_request: extras.userRequest,
        explicit_constraints: extras.explicitConstraints,
        prior_attempts: extras.priorAttempts,
        execution_results: extras.executionResults,
        prior_context: extras.priorContext,
        claims: claims.map((c) => ({
          // Use the engine's own claim id when the claim was submitted, so a
          // finding can be tied back to a real row; fall back to the ordinal
          // for the unsubmitted (zero-claim) path.
          id: claimIds.get(c.ordinal) ?? `ordinal-${c.ordinal}`,
          text: c.text,
          materiality: c.materiality,
            claim_fields: c.claimFields,
            // Absent from the map means the submission failed or never ran, so
            // nothing was checked against anything — ungrounded is the correct
            // and safe reading.
            has_resolved_evidence: grounded.get(c.ordinal) ?? false,
          })),
        }),
      },
      apiKey,
    );
    if (!res.ok) return {};
    return (await res.json()) as DetectResponse;
  } catch {
    return {};
  }
}

/**
 * Records one interaction with a move.
 *
 * Fire-and-forget by design: telemetry must never be able to break the card.
 * A failure here loses one data point, which is strictly better than a user
 * seeing an error because we could not write a row about their click.
 */
/**
 * Marks a review finished, so a polling card knows to stop.
 *
 * Fire-and-forget: a lost completion costs a card that keeps polling a finished
 * review, which is wasteful and harmless. Failing the user's review because a
 * status flag did not stick would not be.
 */
async function markReviewComplete(reviewId: string, apiKey: string): Promise<void> {
  try {
    await engineFetch(`/v1/reviews/${reviewId}/complete`, { method: "POST", body: "{}" }, apiKey);
  } catch {
    // See above.
  }
}

/**
 * Reads a review's current state for a polling card.
 *
 * Returns null rather than throwing on any failure. A poll that errors would
 * turn a slow-but-working review into a broken card, and the card's correct
 * response to "I could not read the state" is to keep showing what it has.
 */
export async function fetchReviewState(reviewId: string, apiKey: string): Promise<unknown | null> {
  try {
    const res = await engineFetch(`/v1/reviews/${reviewId}/state`, { method: "GET" }, apiKey);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function recordMoveEvent(
  moveId: string,
  eventType: "shown" | "revealed" | "committed" | "dismissed",
  apiKey: string,
): Promise<boolean> {
  try {
    const res = await engineFetch(
      "/v1/move-events",
      { method: "POST", body: JSON.stringify({ move_id: moveId, event_type: eventType }) },
      apiKey,
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function reviewAnswer(
  answerText: string,
  sourceRefs: SourceRef[],
  apiKey: string = defaultEngineApiKey(),
  extras: InvocationExtras = {},
): Promise<ReviewCardData> {
  const userRequest = extras.userRequest;
  const extraction = await extractClaims(answerText, apiKey);
  if (!extraction.ok) {
    // Extraction itself failed (quota denial, provider/parse fault) — this is
    // NOT "no material claims", it's "Notary could not check this answer at
    // all". See extractClaims()'s own comment for the bug this closes.
    return {
      status: "could_not_check",
      scope: "Notary could not extract claims from this answer right now.",
      actions: [],
    };
  }
  const materialClaims = extraction.claims.filter((c) => c.materiality);

  if (materialClaims.length === 0) {
    // THE 37% CASE. No material claims means Verify has nothing — but the
    // answer can still contradict itself, still claim work succeeded that the
    // output disproves, and the user still has a task Act can act on.
    // This path used to return here blind, which is why Move produced
    // nothing on the majority of real turns.
    //
    // A review is created purely to carry the invocation; no claims are
    // submitted, so no verification work or judge cost is incurred.
    try {
      const reviewId = await createReview(apiKey);
      const det = await runDetection(reviewId, answerText, extraction.claims, new Map(), new Map(), apiKey, extras);
      const moves = parseMoves(det.moves).slice(0, MAX_MOVES);
      const zeroClaimGaps = parseGaps(det.gaps);
      const zeroBank = parseBankFindings(det.findings);
      const zeroIntent = det.intent != null && typeof det.intent.task_mode === "string"
        ? { task_mode: det.intent.task_mode, defaulted: det.intent.defaulted === true }
        : null;
      const findingCount = Array.isArray(det.findings) ? det.findings.length : 0;
      if (findingCount > 0) {
        return {
          status: "issue_found",
          scope: `${findingCount} finding${findingCount === 1 ? "" : "s"} in the answer itself.`,
          findings: (det.findings as Array<{ boundaryText?: string; type?: string }>).map((f) => ({
            label: String(f.type ?? "finding"),
            text: String(f.boundaryText ?? ""),
            why: "internal_conflict",
          })),
          actions: ["Dismiss"],
          moves: moves.length > 0 ? moves : undefined,
          gaps: zeroClaimGaps.length > 0 ? zeroClaimGaps : undefined,
          bank_findings: zeroBank.length > 0 ? zeroBank : undefined,
          intent: zeroIntent,
          scope_detail: { claims: extraction.claims.length, checkable: 0, sources: 0 },
        };
      }
      return {
        status: "no_issue",
        scope: "No material factual claims found to review.",
        actions: [],
        moves: moves.length > 0 ? moves : undefined,
        gaps: zeroClaimGaps.length > 0 ? zeroClaimGaps : undefined,
        bank_findings: zeroBank.length > 0 ? zeroBank : undefined,
        intent: zeroIntent,
        scope_detail: { claims: extraction.claims.length, checkable: 0, sources: 0 },
      };
    } catch {
      return { status: "no_issue", scope: "No material factual claims found to review.", actions: [] };
    }
  }

  // Everything from here on talks to the engine over the network. extractClaims
  // above and submitClaim inside the loop below already degrade their own
  // failures into explicit findings/could_not_check — but createReview() and
  // registerEvidence() had NO top-level boundary: a non-JSON or unexpected-shape
  // response (e.g. body.review.id on a 5xx HTML error page) throws, and nothing
  // upstream of reviewAnswer() catches it — the MCP tool call would reject
  // outright instead of returning an honest card. A whole-review failure at
  // this stage is exactly as "could not check" as an extraction failure is; it
  // must degrade the same way, never surface as an unhandled rejection.
  try {
    const reviewId = await createReview(apiKey);
    // Registered in parallel with the source it came from, kept side by side
    // (not just filtered down to bare ids) so the card can later label each
    // resolved match with the honest origin it was actually submitted under —
    // `origin` on the engine's evidence row is exactly `source.source_role`
    // (see registerEvidence above and engine/src/routes/evidence.ts).
    const registered = await Promise.all(
      sourceRefs.map(async (s) => ({ source: s, evidenceId: await registerEvidence(reviewId, s, apiKey) })),
    );
    const evidenceIds = registered.filter((r): r is { source: SourceRef; evidenceId: string } => r.evidenceId !== undefined).map((r) => r.evidenceId);
    const originByEvidenceId = new Map<string, CardEvidenceOrigin>(
      registered
        .filter((r): r is { source: SourceRef; evidenceId: string } => r.evidenceId !== undefined)
        .map((r) => [r.evidenceId, r.source.source_role]),
    );

    const issueFindings: Finding[] = [];
    const uncheckedFindings: Finding[] = [];
    // Collected, never rendered — see findingFor()'s no_source branch.
    const noSourceFindings: Finding[] = [];
    const challenges: ChallengeItem[] = [];
    const moves: Move[] = [];

    // Claims are submitted CONCURRENTLY but accumulated IN ORDER, and the
    // split matters.
    //
    // Concurrency: each submitClaim is a network round trip that internally
    // runs a judge call — and, when this comment was written, a Move call too.
    // Per-claim Move is now OFF (skip_claim_moves below); Act runs once per
    // invocation via /detect. Claims are fully independent
    // — nothing about claim 2 depends on claim 1. Serially, a five-claim
    // answer was five sequential round trips while the MCP tool call blocked
    // Claude's turn, so the user watched a spinner for the sum rather than
    // the max. Bounded rather than unbounded so a 10-claim review (the § Cost
    // control rules cap) cannot open ten simultaneous judge conversations.
    //
    // Order: the caps below (4 challenges, 2 moves per
    // invocation) are FIRST-COME. Accumulating them as promises resolve would
    // let network timing decide which claim's moves survive — the same
    // answer would produce different cards on different runs, and a
    // reproduction would stop being a reproduction. So the fan-out only
    // gathers results; the loop that fills the caps runs afterwards, strictly
    // in claim order, exactly as it did when this was serial.
    // The deadline is checked BEFORE each submission rather than enforced with
    // a timeout on the request. A submission already in flight is allowed to
    // finish: it has been paid for, and abandoning it would waste the spend and
    // lose a result we already have.
    const claimDeadline = Date.now() + CLAIM_BUDGET_MS;
    let skippedForBudget = 0;
    const outcomes = await mapWithConcurrency(materialClaims, CLAIM_CONCURRENCY, (claim) => {
      if (Date.now() > claimDeadline) {
        skippedForBudget++;
        return Promise.resolve(undefined);
      }
      return submitClaim(reviewId, claim, evidenceIds, apiKey, userRequest);
    });
    if (skippedForBudget > 0) {
      console.warn(
        JSON.stringify({
          event: "claim_budget_exhausted",
          review_id: reviewId,
          checked: materialClaims.length - skippedForBudget,
          skipped: skippedForBudget,
          budget_ms: CLAIM_BUDGET_MS,
        }),
      );
    }

    for (let i = 0; i < materialClaims.length; i++) {
      const claim = materialClaims[i];
      const outcome = outcomes[i];
      // Bug fix: a failed/undefined submission used to `continue` here with no
      // finding recorded at all — silently dropping the claim from both
      // issueFindings and uncheckedFindings, so a mixed review (one claim
      // resolves, another's submission fails) could still fall through to
      // `no_issue` below. It must always produce an explicit "not checkable"
      // finding that participates in the completeness logic.
      // Undefined means the deadline passed before this claim was submitted —
      // NOT that submission failed. The two are different facts and only one is
      // a defect. A budget skip is already counted and stated in the scope line
      // ("12 of 40 checked"), so recording it here as unsubmittable would both
      // misdescribe it and flip the whole card to could_not_check, hiding the
      // twelve claims that WERE checked.
      if (outcome === undefined) continue;

      if (!outcome.ok) {
        uncheckedFindings.push({
          label: claim.text,
          text: "This claim could not be submitted to the engine for verification.",
          why: "submission_failed",
        });
        continue;
      }
      const evidence = {
        matches: toCardMatches(outcome.result.matches, originByEvidenceId),
        rejectedCandidates: toCardRejectedCandidates(outcome.result.rejectedCandidates, originByEvidenceId),
      };
      const { finding, needsCheck, noSource } = findingFor(outcome.result.claim, claim.text, evidence);
      if (finding === undefined) continue;
      if (noSource) noSourceFindings.push(finding);
      else if (needsCheck) uncheckedFindings.push(finding);
      else issueFindings.push(finding);
      // Parsed strictly regardless of whether the engine sent any (see the
      // comment on ClaimResult.challenges) — an org with the flag off, or a
      // review the engine judged non-material, legitimately sends none, and
      // that must render as "no challenges", never an error. Overall cap of 4
      // per invocation, per the plan doc.
      if (challenges.length < 4) {
        challenges.push(...parseChallengeItems(outcome.result.challenges).slice(0, 4 - challenges.length));
      }
      // Move — capped at MAX_MOVES (2) for the whole review,
      // same first-come discipline as challenges' own cap above: the engine
      // calls Move per claim submission today (review/reviewFlow.ts's
      // runMovesForClaim), but Part 11's cardinality contract is per
      // INVOCATION (0-2 total), so this is the client-side enforcement of
      // that invariant until/unless the engine grows a single per-review
      // Move call.
      if (moves.length < MAX_MOVES) {
        moves.push(
          ...parseMoves(outcome.result.moves).slice(0, MAX_MOVES - moves.length),
        );
      }
    }

    // Detection runs AFTER the claim loop so findings can reference real claim
    // ids, and its own Act call supersedes the per-claim one — the
    // cardinality contract is per INVOCATION, and the per-claim path could
    // only ever approximate that with a first-come cap.
    const claimIds = new Map<number, string>();
    // Per-claim grounding. `no_source` is the engine's own per-claim record of
    // "nothing addressable to check this against", which is exactly the
    // question the source-gap detector asks — so it is read straight through
    // rather than re-derived from the review's evidence count.
    const grounded = new Map<number, boolean>();
    for (let i = 0; i < materialClaims.length; i++) {
      const o = outcomes[i];
      if (o?.ok) {
        claimIds.set(materialClaims[i].ordinal, o.result.claim.id);
        grounded.set(materialClaims[i].ordinal, !o.result.claim.no_source);
      }
    }
    const detection = await runDetection(reviewId, answerText, materialClaims, claimIds, grounded, apiKey, extras);

    // Everything that will ever be written for this review has been written.
    // Marked HERE rather than at each return below, because there are several
    // and a status that depends on which branch was taken would be wrong on the
    // one somebody forgets.
    await markReviewComplete(reviewId, apiKey);

    // Bank findings are deliberately NOT pushed into issueFindings.
    //
    // They used to be, and it produced a genuinely misleading card: a bank
    // finding has no evidence BY NATURE — self-contradiction compares the
    // answer against itself — so rendering it through Verify's evidence-backed
    // UI printed "No resolved evidence is on record for this finding" in
    // warning styling, as though something had gone wrong. Nothing had. It also
    // duplicated the finding text (once in Verify's list, once in the record)
    // and surfaced the raw `internal_conflict` code as the user-facing label.
    //
    // They are a different kind of thing and get their own rendering. What
    // still holds is the reason they were merged: a claim can be SUPPORTED by
    // its source AND the answer still contradict itself, so the card's status
    // is computed from EITHER source below.
    // Invocation-level Move replaces whatever the per-claim calls produced.
    const invocationGaps = parseGaps(detection.gaps);
    const bankFindingsDetail = parseBankFindings(detection.findings);
    const invocationIntent = detection.intent != null && typeof detection.intent.task_mode === "string"
      ? { task_mode: detection.intent.task_mode, defaulted: detection.intent.defaulted === true }
      : null;
    // Honest scope: how many claims there were, and how many had ANY source to
    // check against. The resting line never carries a count for this reason —
    // "5 claims checked" is a lie when four of them had nothing to check.
    const checkableCount = outcomes.filter((o) => o?.ok && !o.result.claim.no_source).length;
    const scopeDetail = {
      claims: materialClaims.length,
      checkable: checkableCount,
      sources: evidenceIds.length,
    };
    const invocationMoves = parseMoves(detection.moves).slice(0, MAX_MOVES);
    if (invocationMoves.length > 0) {
      moves.length = 0;
      moves.push(...invocationMoves);
    }

    // When the budget ran out, the scope line SAYS SO. The whole point of a
    // deadline is that the shortfall is reported rather than hidden — a card
    // claiming "40 claims reviewed" when 12 were checked would be worse than
    // being slow.
    const checkedCount = materialClaims.length - skippedForBudget;
    const scope =
      skippedForBudget > 0
        ? `${checkedCount} of ${materialClaims.length} material claims checked against ${evidenceIds.length} source${evidenceIds.length === 1 ? "" : "s"} — ${skippedForBudget} not reached in time.`
        : `${materialClaims.length} material claim${materialClaims.length === 1 ? "" : "s"} reviewed against ${evidenceIds.length} accessible source${evidenceIds.length === 1 ? "" : "s"}.`;
    const challengesField = challenges.length > 0 ? challenges : undefined;
    const movesField = moves.length > 0 ? moves : undefined;

    // "Is there a problem?" is no longer readable off claim.state alone: a
    // claim can be SUPPORTED by its source while the answer contradicts
    // itself. Either source raises the status; only Verify's own findings go
    // in `findings`, which is the evidence-backed list.
    if (issueFindings.length > 0 || bankFindingsDetail.length > 0) {
      return {
        status: "issue_found",
        review_id: reviewId,
        complete: true,
        scope,
        findings: issueFindings.length > 0 ? issueFindings : undefined,
        actions: ["Open evidence", "Qualify", "Dismiss", "Recheck"],
        challenges: challengesField,
        moves: movesField,
        gaps: invocationGaps.length > 0 ? invocationGaps : undefined,
        bank_findings: bankFindingsDetail.length > 0 ? bankFindingsDetail : undefined,
        intent: invocationIntent,
        scope_detail: scopeDetail,
      };
    }
    // Bug fix: this used to require `uncheckedFindings.length === materialClaims.length`
    // — i.e. only report could_not_check when EVERY material claim was
    // unchecked. That's exactly the mixed-review bug: one claim SUPPORTED, one
    // claim's submission fails -> issueFindings=[], uncheckedFindings has 1 of 2
    // -> fell through to `no_issue`, silently discarding the fact that a
    // material claim was never actually checked. Any unchecked material claim
    // (with no issue found elsewhere) must produce could_not_check, never
    // no_issue.
    if (uncheckedFindings.length > 0) {
      return {
        status: "could_not_check",
        review_id: reviewId,
        complete: true,
        scope: uncheckedFindings[0].text,
        actions: [],
        // Moves ride along here too, and this is the case where they matter
        // MOST. A live run proved it: 16 claims, 8 fetched sources, every claim
        // forced to INDETERMINATE by a locator bug — Act ran fine and produced
        // two moves, and the user saw only "Could not verify this against the
        // supplied evidence" because this branch dropped them. Verify failing is
        // exactly when the next move is the only useful thing on the card.
        //
        // The same bug shape was fixed once already for `no_source`. It was not
        // fixed here, because nothing tied the two branches together.
        moves: movesField,
        gaps: invocationGaps.length > 0 ? invocationGaps : undefined,
        bank_findings: bankFindingsDetail.length > 0 ? bankFindingsDetail : undefined,
        intent: invocationIntent,
        scope_detail: scopeDetail,
      };
    }
    // Nothing failed and nothing was contradicted. If every material claim
    // simply had no source to check against, say that plainly rather than
    // reusing the "reviewed against N sources" scope, which reads as though a
    // comparison happened. Move still rides along either way — that is the
    // whole point of splitting no_source out: an unsourced answer is exactly
    // the case where the next-move move is the only useful output.
    if (noSourceFindings.length > 0 && noSourceFindings.length === materialClaims.length) {
      return {
        status: "not_checked",
        review_id: reviewId,
        complete: true,
        scope: `No inspectable source was supplied for ${materialClaims.length === 1 ? "this claim" : `these ${materialClaims.length} claims`}.`,
        actions: [],
        moves: movesField,
        gaps: invocationGaps.length > 0 ? invocationGaps : undefined,
        bank_findings: bankFindingsDetail.length > 0 ? bankFindingsDetail : undefined,
        intent: invocationIntent,
        scope_detail: scopeDetail,
      };
    }
    return {
      status: "no_issue",
        review_id: reviewId,
        complete: true,
      scope,
      actions: [],
      moves: movesField,
      gaps: invocationGaps.length > 0 ? invocationGaps : undefined,
        bank_findings: bankFindingsDetail.length > 0 ? bankFindingsDetail : undefined,
        intent: invocationIntent,
        scope_detail: scopeDetail,
    };
  } catch (err) {
    const correlationId = randomUUID();
    console.error(`[reviewAnswer] review failed, correlation_id=${correlationId}:`, err);
    return {
      status: "could_not_check",
      scope: `Notary could not complete this review right now (ref ${correlationId}).`,
      actions: [],
    };
  }
}
