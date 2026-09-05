import { useEffect, useRef, useState } from "react";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";

// Mirrors engine/src/evidence/locators.ts's Locator union as it arrives over
// the wire from server/src/engineClient.ts's CardLocator (see that file's
// comment for where this shape actually comes from — the engine's POST
// /v1/reviews/:reviewId/claims response, which reflects exactly what got
// persisted to evidence_match in the same transaction).
type CardLocator = {
  kind: "text_offsets" | "json_path" | "unresolvable";
  contentKind?: string | null;
  provenance?: "fetched" | "caller_supplied" | null;
  start?: number;
  end?: number;
  quote?: string;
  page?: number;
  path?: string;
  resolvedValue?: string;
  reason?: string;
  associatedUrl?: string | null;
};

type CardEvidenceOrigin = "answer_citation" | "user_added" | "workspace_collection";

type CardEvidenceMatch = {
  evidenceId: string;
  relation: "supports" | "contradicts";
  method: "quoted_or_computed" | "entailed";
  locator: CardLocator;
  origin: CardEvidenceOrigin;
  sourceUrl?: string;
};

type CardRejectedCandidate = {
  evidenceId: string;
  locator: string | null;
  mismatchedFields: string[];
  details: Array<{ field: string; detail: string }>;
  origin: CardEvidenceOrigin;
};

// Locked Act (Challenge, v1 — the shipped-dark, per-claim register) contract.
// See docs/build/tier-1-build-and-operating-plan.md's "Act / Challenge
// layer" section. Never a verdict/confidence/answer field.
//
// NOT the same thing as "Move" (docs/guide/proposals/system-definition-synthesis.md
// Part 11) — Move is a separate, newer system (see the Move
// type and the `notary-move` render block below, its own section,
// structurally distinct from this one). Both now consume the same
// pill-click-to-send interaction pattern; ChallengeItem stays frozen
// (its `act_challenge_enabled` org flag is off) while Move is the system that
// actually gets real, live-generated moves wired through it.
type ChallengeItem = {
  challenge_type: "ambiguity" | "missing_assumption" | "alternative_interpretation" | "evidence_request" | "adversarial_test";
  prompt: string;
  why_it_matters: string;
  action: "clarify_claim" | "add_source" | "open_evidence" | "ask_host" | "draft_test" | "leave_unchanged";
};

// Move (Act v2) — mirrors engine/src/act/types.ts's
// Move exactly (also re-declared, wire-shape only, in
// server/src/mocks/scenarios.ts's Move). This IS the "Move"
// this file's own comment above named as "not wired into reviewFlow.ts/this
// card's data at all yet" — it is now real. No verdict, confidence, score, or
// answer field, same discipline as ChallengeItem.
type Move = {
  id: string;
  short_label: string;
  move: "clarify" | "test" | "compare" | "repair";
  prompt: string;
};

type ReviewCardData = {
  status: "no_issue" | "issue_found" | "could_not_check" | "not_checked";
  /** What a detector could not check, and what would make it checkable. Facts, at most two. */
  gaps?: Array<{ missing: string; unblocks: string }>;
  bank_findings?: Array<{
    detector: string;
    type: string;
    owner: string;
    boundary_text: string;
    field_deltas: Array<{ field: string; claimed: string; observed: string; relation: string }>;
    basis_kind: string;
  }>;
  intent?: { task_mode: string; defaulted: boolean } | null;
  scope_detail?: { claims: number; checkable: number; sources: number };
  scope: string;
  claim?: string;
  findings?: Array<{
    label: string;
    text: string;
    why: string;
    evidence?: { matches: CardEvidenceMatch[]; rejectedCandidates: CardRejectedCandidate[] };
  }>;
  actions: string[];
  // Optional, defensive: the engine may not have landed this field yet. When
  // absent or empty, the "What to pressure-test" register simply doesn't
  // render — this is a coordination-by-contract dependency, not a hard one.
  challenges?: ChallengeItem[];
  // Act's 0-2 moves. Structurally SEPARATE from
  // `challenges` above — a different system, a different authority level —
  // and rendered in its own section below, never merged into one list.
  moves?: Move[];
};

type SourceRef = {
  url?: string;
  title?: string;
  quoted_excerpt?: string;
  source_role: "answer_citation" | "user_added" | "workspace_collection";
};

type ToolInput = { answer_text?: string; source_refs?: SourceRef[] };

const ORIGIN_LABEL: Record<CardEvidenceOrigin, string> = {
  answer_citation: "cited in the answer",
  user_added: "added by you",
  workspace_collection: "from your workspace",
};

function provenanceLabel(locator: CardLocator): string {
  if (locator.provenance === "fetched") return "fetched by Notary";
  if (locator.provenance === "caller_supplied") return "supplied excerpt, not independently fetched";
  return "provenance unknown";
}

function locatorSummary(locator: CardLocator): string {
  if (locator.kind === "text_offsets") {
    const where = locator.page !== undefined ? `page ${locator.page}, ` : "";
    return `${where}chars ${locator.start ?? "?"}–${locator.end ?? "?"}`;
  }
  if (locator.kind === "json_path") {
    return `path ${locator.path ?? "?"}`;
  }
  return `unresolved${locator.reason ? ` (${locator.reason})` : ""}`;
}

// Renders the engine's actual resolved evidence for one finding — the
// retained text at the locator, never the caller's raw submitted excerpt
// presented as if it were verified. The raw submission can still appear as
// provenance context (see the "as submitted" line below), but is always
// visually and textually distinct from the resolved passage.
function EvidenceMatchView({ match }: { match: CardEvidenceMatch }) {
  const { locator } = match;
  const resolvedText = locator.kind === "text_offsets" ? locator.quote : locator.kind === "json_path" ? locator.resolvedValue : undefined;
  return (
    <div className="notary-evidence-item">
      <div className="notary-evidence-relation">
        {match.relation === "contradicts" ? "Contradicts" : "Supports"} · {match.method === "quoted_or_computed" ? "exact match" : "AI-assessed match"}
      </div>
      {resolvedText !== undefined ? (
        <div className="notary-evidence-excerpt">&ldquo;{resolvedText}&rdquo;</div>
      ) : (
        <div className="notary-evidence-unresolved">No exact passage could be resolved{locator.reason ? ` (${locator.reason})` : ""}.</div>
      )}
      <div className="notary-evidence-meta">
        {locatorSummary(locator)} · {provenanceLabel(locator)} · {ORIGIN_LABEL[match.origin]}
        {match.sourceUrl && (
          <>
            {" · "}
            <a href={match.sourceUrl} target="_blank" rel="noreferrer">
              source
            </a>
          </>
        )}
      </div>
    </div>
  );
}

function RejectedCandidateView({ candidate }: { candidate: CardRejectedCandidate }) {
  return (
    <div className="notary-evidence-item notary-evidence-rejected">
      <div className="notary-evidence-relation">Not applicable · {ORIGIN_LABEL[candidate.origin]}</div>
      <div className="notary-evidence-unresolved">
        {candidate.mismatchedFields.length > 0 ? `Mismatched: ${candidate.mismatchedFields.join(", ")}` : "Evidence did not apply to this claim."}
      </div>
      {candidate.locator && <div className="notary-evidence-meta">{candidate.locator}</div>}
    </div>
  );
}

// A pill that requires two interactions to actually send anything, on EVERY
// device, without needing to detect touch vs. mouse (§ docs/guide/proposals/
// system-definition-synthesis.md Part 11 "UI interaction model, continued" —
// hover has no touch equivalent, so the reliable universal pattern is:
// first interaction reveals the full text, second interaction commits it.
// Desktop additionally gets hover as a free shortcut to the same preview —
// never a replacement for the click-twice path, since hover doesn't exist on
// touch at all.
/**
 * The Notary mark, taken verbatim from getnotary.ai — three circles joined at
 * a centre point.
 *
 * Every stroke is `currentColor` and every fill is `none`, so it inherits the
 * surrounding text colour and needs no theme handling whatsoever. That matters
 * here specifically: this card renders inside a sandboxed iframe that never
 * receives the host's CSS variables, so anything with a hardcoded colour has to
 * be maintained as a light/dark pair by hand. This has nothing to maintain.
 */
function NotaryMark() {
  return (
    <span className="notary-flag-icon" aria-hidden="true">
      <svg viewBox="0 0 100 100" width="11" height="11">
        <path
          d="M32 32L50 50L68 32M50 50L50 68"
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="25" cy="25" r="10" fill="none" stroke="currentColor" strokeWidth="5" />
        <circle cx="75" cy="25" r="10" fill="none" stroke="currentColor" strokeWidth="5" />
        <circle cx="50" cy="80" r="10" fill="none" stroke="currentColor" strokeWidth="5" />
      </svg>
    </span>
  );
}

/**
 * What a finding type MEANS, in the reader's words.
 *
 * The card was showing the raw type — "Notary · internal_conflict" — which
 * names a code the reader has never seen and cannot act on. The first line has
 * exactly one job: answer "is something wrong, and what kind of thing is it?"
 * A snake_case identifier answers neither.
 */
/**
 * What a finding SAYS, as a consequence the reader can judge in a second.
 *
 * Never the detector name. "internal_conflict" is a classification, and a
 * classification asks the reader to learn our taxonomy before they can decide
 * whether they care. The consequence asks nothing.
 *
 * A LADDER, best form first, because the sharpest phrasing is not always
 * derivable:
 *
 *   two short conflicting values   ->  "$6.9M vs $8M"
 *   a modality conflict            ->  'says "may", answer says "will"'
 *   anything else                  ->  prose for that finding type
 *
 * The first form is the strongest — the reader knows instantly whether it
 * matters — but it only works when both operands are short and the conflict is
 * about a value. An operator conflict rendered this way would read
 * "increase vs decrease", which is worse than the prose. So the ladder falls
 * back rather than forcing the shape.
 */
const FINDING_PROSE: Record<string, string> = {
  internal_conflict: "Answer contradicts itself",
  self_report_mismatch: "Output doesn't match the claim",
  source_contradiction: "Source doesn't support this",
  arithmetic_conflict: "Numbers don't add up",
  requirement_unmet: "Part of the request is missing",
  overreach: "Stated more strongly than the source",
  conflict_candidate: "Conflicts with something earlier",
};

/** Short enough to read inside a pill without wrapping. */
function isPillSized(v: string): boolean {
  return v.length > 0 && v.length <= 14;
}

function findingLabel(f: {
  type: string;
  field_deltas: Array<{ field: string; claimed: string; observed: string; relation: string }>;
}): string {
  const conflict = f.field_deltas.find((d) => d.relation === "conflict");
  if (conflict !== undefined) {
    if (conflict.field === "modality") {
      return `says "${conflict.observed}", answer says "${conflict.claimed}"`;
    }
    // Values only. "increase vs decrease" is a worse label than the prose.
    const numeric = /\d/.test(conflict.claimed) && /\d/.test(conflict.observed);
    if (numeric && isPillSized(conflict.claimed) && isPillSized(conflict.observed)) {
      return `${conflict.claimed} vs ${conflict.observed}`;
    }
  }
  return FINDING_PROSE[f.type] ?? "Worth checking";
}

/**
 * L2 and L3 — what Notary looked at, and how it knows.
 *
 * THE LAYERING, and why it is three levels rather than two:
 *   L1  one line. What we did. Costs no attention.
 *   L2  what was found and what could not be checked, in prose. Enough to
 *       decide whether to care, without reading a table.
 *   L3  the record: which field disagreed, what each side said, which detector
 *       and on what basis. This is the part no prompt can replicate, and the
 *       part almost nobody wants on any given turn — so it is its own
 *       disclosure, not the bottom of L2.
 *
 * INTENT LIVES HERE, at L3, and only as an explanation of WHY THESE MOVES.
 * It is deliberately not a panel of its own: the classifier defaults to
 * "general" often, and a card announcing "Intent: general" tells the reader
 * nothing while looking like a malfunction. A defaulted intent is therefore
 * not rendered at all — an honest absence beats a meaningless label.
 */
function DetailBlock({
  data,
  recordOpen,
  setRecordOpen,
}: {
  data: ReviewCardData;
  recordOpen: boolean;
  setRecordOpen: (v: boolean) => void;
}) {
  const [allOpen, setAllOpen] = useState(false);
  const bank = data.bank_findings ?? [];
  const gaps = data.gaps ?? [];
  const scope = data.scope_detail;

  // AN ATTENTION POLICY, even though findings are uncapped in the engine.
  // "Facts do not compete for attention the way moves do" is true of the
  // engine and false of the screen: four pills beside an answer is
  // overwhelming whatever they contain. The rest stay one quiet click away.
  const VISIBLE = 2;
  const shown = bank.slice(0, VISIBLE);
  const hidden = bank.length - shown.length;

  return (
    <div className="notary-detail">
      {/* THE FINDING. Consequence first, then the sentence that earns it.
          One question answered per line: what is it, then why. */}
      {shown.map((f, i) => (
        <div key={`${f.detector}-${i}`} className="notary-finding">
          <div className="notary-finding-label">{findingLabel(f)}</div>
          <div className="notary-finding-why">{f.boundary_text}</div>
        </div>
      ))}
      {hidden > 0 && !allOpen && (
        <button type="button" className="notary-link notary-more" onClick={() => setAllOpen(true)}>
          +{hidden} more
        </button>
      )}
      {allOpen &&
        bank.slice(VISIBLE).map((f, i) => (
          <div key={`more-${i}`} className="notary-finding">
            <div className="notary-finding-label">{findingLabel(f)}</div>
            <div className="notary-finding-why">{f.boundary_text}</div>
          </div>
        ))}

      {/* Provenance as a horizontal strip, not stacked sentences. Says where
          the claims CAME FROM rather than what Notary was denied — an answer
          from what a model knows is a normal mode, not a deficit, and three
          earlier attempts at this line all framed it as one. */}
      {scope !== undefined && (
        <div className="notary-meta">
          <span>
            {scope.claims} claim{scope.claims === 1 ? "" : "s"}
          </span>
          <span>
            {scope.checkable === 0
              ? "answered directly by Claude"
              : scope.checkable === scope.claims
                ? `checked against ${scope.sources} source${scope.sources === 1 ? "" : "s"}`
                : `${scope.checkable} checked against a source`}
          </span>
          {gaps.length > 0 && <span>a source would let Notary check {gaps.length === 1 ? "one" : "more"}</span>}
        </div>
      )}

      {/* BASIS, not a record dump. It answers exactly one question — "how do
          you know?" — and is reached only by a reader who is already doubting
          the finding.
          Deliberately dropped from here: which detector fired, the epistemic
          owner, and which moves the policy allowed. Those answer "how does
          Notary work", which nobody asked, and mixing them in is what made
          this read as a book report. */}
      {bank.length > 0 && (
        <>
          <button
            type="button"
            className="notary-link notary-record-toggle"
            aria-expanded={recordOpen}
            onClick={() => setRecordOpen(!recordOpen)}
          >
            {recordOpen ? "Hide basis" : "See basis"}
          </button>
          {recordOpen && (
            <div className="notary-record">
              {bank.map((f, i) =>
                f.field_deltas.length > 0 ? (
                  <table className="notary-record-table" key={`b-${i}`}>
                    <tbody>
                      {f.field_deltas.map((d) => (
                        <tr key={d.field}>
                          <td className="notary-record-field">{d.field}</td>
                          <td>{d.claimed}</td>
                          <td className="notary-record-rel">vs</td>
                          <td>{d.observed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="notary-record-note" key={`b-${i}`}>
                    compared as whole statements — {f.basis_kind.replace(/_/g, " ")}
                  </div>
                ),
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActionPill({
  label,
  fullText,
  busy,
  onCommit,
  onReveal,
}: {
  label: string;
  fullText: string;
  busy: boolean;
  onCommit: () => void;
  /**
   * Fired on the deliberate click-to-reveal ONLY, never on hover. Hover fires
   * on every pointer pass across the card and would drown the signal we
   * actually want — "someone chose to look at this" — in mouse noise.
   */
  onReveal?: () => void;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div
      className={`notary-pill${revealed ? " notary-pill-revealed" : ""}`}
      onMouseEnter={() => setRevealed(true)}
      onMouseLeave={() => setRevealed(false)}
    >
      <button
        type="button"
        className="notary-pill-button"
        disabled={busy}
        onClick={() => {
          if (!revealed) {
            setRevealed(true);
            onReveal?.();
            return;
          }
          onCommit();
        }}
      >
        {busy ? "…" : label}
      </button>
      {revealed && (
        <div className="notary-pill-preview">
          {fullText}
          {/* THE COMMIT AFFORDANCE, not an instruction to read.
              This was italic grey text saying "Click again to send to Claude" —
              six words of instruction where the interface should simply look
              clickable. Act's whole job is that acting costs one click, and
              the closing beat of that flow was the weakest thing on the card.
              Still the same two-step interaction: the first click reveals what
              would be sent, the second sends it. Nothing is sent by accident. */}
          <div className="notary-pill-send" aria-hidden="true">
            Send to Claude <span className="notary-pill-send-arrow">→</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<ReviewCardData | null>(null);
  const [toolInput, setToolInput] = useState<ToolInput | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [findingOpen, setFindingOpen] = useState(false);
  // L3 — the record. A SEPARATE disclosure from L2 on purpose: L2 answers
  // "what did you find", L3 answers "how do you know". Most readers never want
  // the second, and putting the field-by-field table inside the first
  // disclosure would make every expansion cost a wall of table.
  const [recordOpen, setRecordOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  /**
   * Move ids already reported as `shown`.
   *
   * A ref rather than state on purpose: recording a display must not itself
   * cause a render, or the effect below re-runs on its own output. The set is
   * per-card-instance, which is the right scope — the same move rendered in a
   * new invocation is genuinely a new display.
   */
  const shownMoves = useRef<Set<string>>(new Set());

  // Real host wiring. Verified against @modelcontextprotocol/ext-apps@1.7.5:
  // useApp() connects this sandboxed view to the host (Claude) over
  // postMessage; app.ontoolresult fires with the tool's CallToolResult once
  // check_answer completes, and `structuredContent` there is
  // exactly what server.ts returned. ontoolinput fires with the same call's
  // original arguments — kept only for the "as submitted" provenance display
  // below (the explicit "Recheck" action was dropped — see the note above
  // the actions row for why).
  const { app } = useApp({
    appInfo: { name: "notary-check", version: "0.1.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolinput = (params) => {
        setToolInput((params.arguments as ToolInput) ?? null);
      };
      app.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as ReviewCardData);
          setDismissed(false);
          setFindingOpen(false);
          setActionNote(null);
        }
      };
    },
  });

  // Real host theming, not a guess: applies the host's actual CSS variables
  // (--color-background-primary, --color-text-secondary, etc.) and light/dark
  // theme to the document root, reactively, whenever the host context changes.
  // Reported bug this fixes: a hardcoded white card background read as a
  // jarring, unstyled rectangle on Claude's dark theme. index.css now reads
  // these variables (with light-mode-safe fallbacks) instead of hardcoding
  // colors that only worked against a light host.
  useHostStyles(app, app?.getHostContext());

  /**
   * Records that a move was DISPLAYED.
   *
   * The denominator for every other event. Without it "3 moves were committed"
   * is uninterpretable — out of three shown, or three hundred? act_move_event
   * has existed since migration 0013 and had never held a row, so production
   * had shown moves to real users and could not answer either question.
   *
   * Guarded by a ref so a re-render never re-reports the same display, and
   * capped at the same 2 the card actually renders.
   */
  useEffect(() => {
    if (!app || !data) return;
    for (const m of (data.moves ?? []).slice(0, 2)) {
      if (shownMoves.current.has(m.id)) continue;
      shownMoves.current.add(m.id);
      void app
        .callServerTool({ name: "record_move_event", arguments: { move_id: m.id, event_type: "shown" } })
        .catch(() => {
          /* telemetry is never worth surfacing to a user */
        });
    }
  }, [app, data]);

  if (typeof window !== "undefined") {
    // Local dev only: read a `?mock=` query param so the card can be tested
    // standalone without a live Claude session (§ 0.9's isolated browser test).
    // URLSearchParams.get() already URL-decodes the value — do not
    // decodeURIComponent() it again. Confirmed by testing: a payload
    // containing a literal "%" (e.g. "17%" in the card copy) throws
    // "URI malformed" on the second, redundant decode.
    const params = new URLSearchParams(window.location.search);
    const mock = params.get("mock");
    if (mock && data === null) {
      try {
        setData(JSON.parse(mock));
      } catch {
        // malformed ?mock= payload — ignore, render nothing
      }
    }
  }

  if (dismissed) return null;

  // WORKING STATE — shown between the tool call starting and its result
  // arriving.
  //
  // WHY IT MIGHT NOT APPEAR, stated honestly: the collapsed row a user sees
  // first ("Notary check_answer") is the HOST's chrome, not ours, and we cannot
  // touch it. This only renders if the host mounts the app iframe when the call
  // BEGINS rather than when it resolves. If it mounts late this is dead
  // pixels — harmless, never wrong, and it costs one element.
  //
  // Deliberately not a spinner. A spinner says "busy" and this card's whole
  // posture is quiet; a slow pulse on the mark we already use says the same
  // thing without demanding attention. It also names what is happening —
  // "checking" — because a user who does not know what Notary is should learn
  // it from the wait, not from the result.
  //
  // The real fix for a two-minute wait was making it not take two minutes.
  // This is for the seconds that remain.
  if (!data) {
    // Only when actually connected to a host. In `?mock=` and in a bare browser
    // there is no call in flight and this must stay invisible.
    if (!app) return null;
    return (
      <div className="notary-card notary-quiet notary-working">
        <div className="notary-header">
          <NotaryMark />
          <span className="notary-summary">Notary · checking</span>
        </div>
      </div>
    );
  }

  /**
   * Records one interaction with a move.
   *
   * FIRE AND FORGET, ALWAYS. Telemetry must never be able to break the card or
   * delay an action the user asked for — every call site below deliberately
   * does not await this, and every failure path is swallowed. A lost data
   * point is strictly better than a user watching a spinner because we wanted
   * to write a row about their click.
   *
   * `callServerTool` rather than `sendMessage`: sendMessage stages text in the
   * user's input box and tells us nothing about what happened. This talks to
   * our own MCP server directly, without involving Claude.
   */
  function recordMove(moveId: string, eventType: "shown" | "revealed" | "committed" | "dismissed") {
    if (!app) return;
    void app
      .callServerTool({ name: "record_move_event", arguments: { move_id: moveId, event_type: eventType } })
      .catch(() => {
        /* telemetry is never worth surfacing to a user */
      });
  }

  async function sendToHost(label: string, text: string) {
    if (!app) return;
    setBusy(label);
    setActionNote(null);
    try {
      const result = await app.sendMessage({
        role: "user",
        content: [{ type: "text", text }],
      });
      // sendMessage's real behavior (confirmed live, Claude Desktop,
      // 2026-09-03 — see Part 11): it places the text in the user's own
      // input box, editable, unsent — it does NOT post automatically. So
      // "isError" is the only failure signal available to us; a successful
      // call does not mean the user has sent anything yet, only that the
      // host accepted staging it. Never claim more than that here.
      if (result.isError) setActionNote("The host didn't accept that action.");
    } catch {
      setActionNote("Something went wrong — try again.");
    } finally {
      setBusy(null);
    }
  }

  // Act/Challenge action routing, per the plan doc: clarify_claim ->
  // qualify_claim (closest existing match), add_source -> add_source,
  // open_evidence -> open_evidence (folded into the same finding-expand
  // toggle as Verify's own evidence, not a separate reveal), recheck_claim
  // after any of those. ask_host and draft_test don't map to an existing
  // app-only tool yet (plan doc: "not built speculatively ahead of need") —
  // those fall back to the same sendMessage-to-host pattern.
  function challengeActionLabel(item: ChallengeItem): string {
    switch (item.action) {
      case "clarify_claim":
        return "Clarify claim";
      case "add_source":
        return "Add source";
      case "ask_host":
        return "Ask host";
      case "draft_test":
        return "Draft test";
      default:
        return "Notary";
    }
  }

  // Computed BEFORE the quiet-state returns below, and that ordering is the
  // whole fix. These used to be read further down, after `no_issue` and
  // `not_checked` had already returned — so Act's moves were
  // discarded on exactly the states where Act is the ONLY thing that ran.
  // An unsourced answer is the case where a next move is the sole useful
  // output, and the card was throwing it away.
  const quietMove = (data.moves ?? []).slice(0, 2);
  const quietGaps = (data.gaps ?? []).slice(0, 2);
  const hasQuietContent = quietMove.length > 0 || quietGaps.length > 0;

  // Anything worth expanding into? Scope, a bank finding, or a gap.
  const hasDetail =
    (data.bank_findings?.length ?? 0) > 0 ||
    quietGaps.length > 0 ||
    data.scope_detail !== undefined;

  /**
   * L1 — one line, plus whatever Act produced, plus a Details affordance
   * when there is anything underneath.
   *
   * The gaps are NOT rendered at L1 any more; they moved into L2. At rest the
   * card should cost one line of attention, and a bulleted list of what could
   * not be checked is the opposite of that — it puts an apology above the two
   * useful questions.
   */
  const quietCard = (line: string) => (
    <div className="notary-card notary-quiet">
      <div className="notary-header">
        <NotaryMark />
        <span className="notary-summary">{line}</span>
        {hasDetail && (
          <>
            <button
              type="button"
              className="notary-link"
              aria-expanded={findingOpen}
              onClick={() => setFindingOpen((v) => !v)}
            >
              {findingOpen ? "Hide details" : "Details"}
            </button>
            <span className="notary-sep">·</span>
          </>
        )}
        <button type="button" className="notary-link" onClick={() => {
          // Dismissal is a real signal, not an absence of one: "shown and
          // rejected" is different from "shown and ignored", and only the
          // first tells us the move was wrong rather than unnoticed.
          for (const m of (data.moves ?? []).slice(0, 2)) recordMove(m.id, "dismissed");
          setDismissed(true);
        }}>
          Dismiss
        </button>
      </div>
      {quietMove.length > 0 && (
        <div className="notary-move">
          <div className="notary-move-pills">
            {quietMove.map((s) => (
              <ActionPill
                key={s.id}
                label={s.short_label}
                fullText={s.prompt}
                busy={busy === `move:${s.id}`}
                onReveal={() => recordMove(s.id, "revealed")}
                onCommit={() => {
                  recordMove(s.id, "committed");
                  void sendToHost(`move:${s.id}`, s.prompt);
                }}
              />
            ))}
          </div>
        </div>
      )}
      {findingOpen && hasDetail && (
        <DetailBlock data={data} recordOpen={recordOpen} setRecordOpen={setRecordOpen} />
      )}
    </div>
  );

  // "nothing flagged" rather than "no issue found" or a claim count. The count
  // would be a lie whenever some claims had no source, and a verdict word
  // drifts toward the green badge canonical § 15 forbids. "Flagged" is OUR
  // action: we looked and raised nothing. The absence of a flag says the rest.
  if (data.status === "no_issue") {
    return quietCard("Notary · nothing flagged");
  }

  // `not_checked` stays SILENT when there is genuinely nothing to say — the
  // procedure never ran, and announcing "no source!" beside every unsourced
  // sentence is the noise this card exists to avoid.
  //
  // But silence is now conditional. When Act produced a next move, or a
  // detector named something it could not check, there IS something worth
  // showing, and rendering null would discard it. The state is still carried
  // in the payload and the model-visible text either way.
  if (data.status === "not_checked") {
    // "nothing flagged", the same line `no_issue` uses — NOT "nothing to check
    // against", which was the first wording and read as a complaint.
    //
    // The problem was one of emphasis, not accuracy. Leading with what Notary
    // could NOT do frames a turn where it just produced two useful questions
    // as a failure, and the useful content sits underneath the apology.
    //
    // "Flagged" stays honest without that: it is OUR action, and we raised
    // nothing — true whether or not a source existed to check. It never claims
    // anything was verified. What was not checked, and what would fix it, is
    // carried by the gap lines below when there is something worth saying, and
    // by the model-visible text either way. The distinction is not lost; it is
    // just no longer the headline.
    return hasQuietContent ? quietCard("Notary · nothing flagged") : null;
  }

  if (data.status === "could_not_check") {
    return quietCard("Notary · could not verify this against the supplied evidence");
  }

  const findings = data.findings ?? [];
  const isTwoBlock = findings.length > 1;
  const submittedSources = toolInput?.source_refs ?? [];
  const allMatches = findings.flatMap((f) => f.evidence?.matches ?? []);
  const allRejected = findings.flatMap((f) => f.evidence?.rejectedCandidates ?? []);
  // At most 4 total, per the plan doc's cap — already enforced server-side
  // (server/src/engineClient.ts), sliced again here defensively.
  const challenges = (data.challenges ?? []).slice(0, 4);
  // Move — at most 2 per Part 11's cardinality contract, already enforced
  // server-side (server/src/engineClient.ts's MAX_MOVES),
  // sliced again here defensively, same discipline as `challenges` above.
  const moves = (data.moves ?? []).slice(0, 2);

  // The resting line, in prose. Never a severity word, never a colour, and —
  // since 2026-09-04 — never a raw type code either.
  //
  // Findings come from two places now and both must read the same way to a
  // reader who does not know the difference: Verify's evidence-backed list,
  // and the detector bank. One item names what it is; several get a count,
  // because naming two different problems in one line reads as neither.
  const bankHere = data.bank_findings ?? [];
  const totalFindings = findings.length + bankHere.length;
  const findingSummary =
    totalFindings === 1
      ? bankHere.length === 1
        ? findingLabel(bankHere[0])
        : findings[0].label
      : `${totalFindings} things to check`;

  return (
    <div className="notary-card">
      {/* At rest: one quiet line — icon, a short summary, and two links —
          no box, no border, no background. Modeled directly on Claude's
          own "Claude is AI and can make mistakes" footer treatment rather
          than reading as a separate widget bolted under the answer. The
          icon + summary together do what the old separate claim-row/flag/
          Dismiss-button trio did, just inline. */}
      <div className="notary-header">
        <NotaryMark />
        <span className="notary-summary">Notary · {findingSummary}</span>
        <button
          type="button"
          className="notary-link"
          aria-expanded={findingOpen}
          onClick={() => setFindingOpen((v) => !v)}
        >
          {findingOpen ? "Hide details" : "Details"}
        </button>
        <span className="notary-sep">·</span>
        <button type="button" className="notary-link" onClick={() => {
          // Dismissal is a real signal, not an absence of one: "shown and
          // rejected" is different from "shown and ignored", and only the
          // first tells us the move was wrong rather than unnoticed.
          for (const m of (data.moves ?? []).slice(0, 2)) recordMove(m.id, "dismissed");
          setDismissed(true);
        }}>
          Dismiss
        </button>
      </div>
      {findingOpen && (
        <DetailBlock data={data} recordOpen={recordOpen} setRecordOpen={setRecordOpen} />
      )}
      {findingOpen && (
        <div className="notary-detail">
          {data.claim && <div className="notary-finding-text">{data.claim}</div>}
          {findings.map((f, i) => (
            <div className="notary-finding" key={i}>
              <div className="notary-finding-label">{f.label}</div>
              <div className="notary-finding-text">{f.text}</div>
              <div className="notary-finding-why">Why: {f.why}</div>
            </div>
          ))}
          <div className="notary-evidence">
            {/* The engine's actual resolved evidence — the retained text at
                the locator, applicability outcome, and honest origin. This
                is what was actually checked, not the raw submission. */}
            {allMatches.map((m, i) => (
              <EvidenceMatchView match={m} key={`match-${i}`} />
            ))}
            {allRejected.map((c, i) => (
              <RejectedCandidateView candidate={c} key={`rejected-${i}`} />
            ))}
            {/* Only meaningful for a VERIFY finding, which is supposed to
                rest on resolved evidence. A card carrying only bank findings
                has no evidence by design — self-contradiction compares the
                answer against itself — and printing this there said something
                had gone wrong when nothing had. Separating the two finding
                lists was necessary but not sufficient: with `findings` empty,
                both arrays below are empty too and this fired anyway. */}
            {findings.length > 0 && allMatches.length === 0 && allRejected.length === 0 && (
              <div className="notary-evidence-unresolved">No resolved evidence is on record for this finding.</div>
            )}
            {/* Original submitted source references — provenance context
                only, never presented as the verified passage above. */}
            {submittedSources.length > 0 && (
              <div className="notary-evidence-submitted">
                <div className="notary-evidence-submitted-label">As submitted</div>
                {submittedSources.map((s, i) => (
                  <div className="notary-evidence-item" key={i}>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.title ?? s.url}
                      </a>
                    )}
                    {s.quoted_excerpt && <div className="notary-evidence-excerpt">&ldquo;{s.quoted_excerpt}&rdquo;</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {actionNote && <div className="notary-action-note">{actionNote}</div>}
          {/* Suppressed when scope_detail exists, because DetailBlock already
              rendered the same fact in fewer words. Both showed at once:
              "10 claims · answered from Claude's own knowledge, not from a
              supplied source" followed by "10 material claims reviewed against
              0 accessible sources." */}
          {data.scope_detail === undefined && <div className="notary-scope">{data.scope}</div>}
          {isTwoBlock && (
            <div className="notary-note">
              Two-block card — only render this shape when a rejected candidate AND
              separate applicable contradicting evidence both exist. See § Product
              contract in this document before reusing this layout elsewhere.
            </div>
          )}
          {/* "What to pressure-test" — Act/Challenge, visually subordinate,
              always below the evidence record above, never a verdict/score/
              competing claim. Renders nothing when the engine hasn't produced
              any. Pills, not buttons: click once reveals the full text (or
              hover, on desktop), click again actually sends it. */}
          {challenges.length > 0 && (
            <div className="notary-challenges">
              <div className="notary-challenges-header">What to pressure-test</div>
              <div className="notary-challenges-pills">
                {challenges.map((c, i) => {
                  if (c.action === "open_evidence") {
                    return (
                      <button
                        key={i}
                        type="button"
                        className="notary-pill-button notary-pill-standalone"
                        onClick={() => setFindingOpen(true)}
                      >
                        {c.prompt}
                      </button>
                    );
                  }
                  if (c.action === "leave_unchanged") {
                    return (
                      <span key={i} className="notary-challenge-static">
                        {c.prompt}
                      </span>
                    );
                  }
                  const label = challengeActionLabel(c);
                  const busyKey = `challenge:${i}`;
                  return (
                    <ActionPill
                      key={i}
                      label={label}
                      fullText={`${label}: ${c.prompt}`}
                      busy={busy === busyKey}
                      onCommit={() => sendToHost(busyKey, `${label}: ${c.prompt}`)}
                    />
                  );
                })}
              </div>
            </div>
          )}
          {/* Move (Act v2) — structurally SEPARATE from the "What to
              pressure-test" register above: a different system, a different
              authority level (a next-move move about the user's broader
              task, not a question about this claim's finding). Reuses the exact
              same pill/sendToHost mechanism already built and tested against the
              real host above — not a new interaction pattern, just real data
              flowing through it for the first time. `short_label` is the text
              at rest (Move, unlike Verify, has to say what it's proposing
              before the user engages with it — see the module comment on
              ChallengeItem above); `prompt` is the full, already-validated ask,
              revealed on first interaction (or hover) and sent verbatim on the
              second. Renders nothing when the engine produced zero moves —
              a correct, expected result, never a broken state. */}
          {moves.length > 0 && (
            <div className="notary-move">
              <div className="notary-move-pills">
                {moves.map((s) => {
                  const busyKey = `move:${s.id}`;
                  return (
                    <ActionPill
                      key={s.id}
                      label={s.short_label}
                      fullText={s.prompt}
                      busy={busy === busyKey}
                      onReveal={() => recordMove(s.id, "revealed")}
                      onCommit={() => {
                        recordMove(s.id, "committed");
                        void sendToHost(busyKey, s.prompt);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
