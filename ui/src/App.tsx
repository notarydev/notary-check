import { useState } from "react";
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

// Locked Track 2 (Challenge, v1 — the shipped-dark, per-claim register) contract.
// See docs/build/tier-1-build-and-operating-plan.md's "Track 2 / Challenge
// layer" section. Never a verdict/confidence/answer field.
//
// NOT the same thing as "Advance" (docs/guide/proposals/system-definition-synthesis.md
// Part 11) — Advance is a separate, newer system (see the AdvanceSuggestion
// type and the `notary-advance` render block below, its own section,
// structurally distinct from this one). Both now consume the same
// pill-click-to-send interaction pattern; ChallengeItem stays frozen
// (its `track2_enabled` org flag is off) while Advance is the system that
// actually gets real, live-generated suggestions wired through it.
type ChallengeItem = {
  challenge_type: "ambiguity" | "missing_assumption" | "alternative_interpretation" | "evidence_request" | "adversarial_test";
  prompt: string;
  why_it_matters: string;
  action: "clarify_claim" | "add_source" | "open_evidence" | "ask_host" | "draft_test" | "leave_unchanged";
};

// Advance (Track 2 v2) — mirrors engine/src/advance/types.ts's
// AdvanceSuggestion exactly (also re-declared, wire-shape only, in
// server/src/mocks/scenarios.ts's AdvanceSuggestion). This IS the "Advance"
// this file's own comment above named as "not wired into reviewFlow.ts/this
// card's data at all yet" — it is now real. No verdict, confidence, score, or
// answer field, same discipline as ChallengeItem.
type AdvanceSuggestion = {
  id: string;
  short_label: string;
  move: "clarify" | "test" | "compare" | "repair";
  prompt: string;
};

type ReviewCardData = {
  status: "no_issue" | "issue_found" | "could_not_check" | "not_checked";
  /** What a detector could not check, and what would make it checkable. Facts, at most two. */
  gaps?: Array<{ missing: string; unblocks: string }>;
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
  // Advance's 0-2 next-move suggestions. Structurally SEPARATE from
  // `challenges` above — a different system, a different authority level —
  // and rendered in its own section below, never merged into one list.
  advance_suggestions?: AdvanceSuggestion[];
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

function ActionPill({
  label,
  fullText,
  busy,
  onCommit,
}: {
  label: string;
  fullText: string;
  busy: boolean;
  onCommit: () => void;
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
          <div className="notary-pill-preview-hint">Click again to send to Claude</div>
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
  const [busy, setBusy] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  // Real host wiring. Verified against @modelcontextprotocol/ext-apps@1.7.5:
  // useApp() connects this sandboxed view to the host (Claude) over
  // postMessage; app.ontoolresult fires with the tool's CallToolResult once
  // review_source_backed_answer completes, and `structuredContent` there is
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

  if (!data || dismissed) return null;

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

  // Track 2/Challenge action routing, per the plan doc: clarify_claim ->
  // qualify_claim (closest existing match), add_source -> add_source,
  // open_evidence -> open_evidence (folded into the same finding-expand
  // toggle as Track 1's own evidence, not a separate reveal), recheck_claim
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
  // `not_checked` had already returned — so Track 2's suggestions were
  // discarded on exactly the states where Track 2 is the ONLY thing that ran.
  // An unsourced answer is the case where a next move is the sole useful
  // output, and the card was throwing it away.
  const quietAdvance = (data.advance_suggestions ?? []).slice(0, 2);
  const quietGaps = (data.gaps ?? []).slice(0, 2);
  const hasQuietContent = quietAdvance.length > 0 || quietGaps.length > 0;

  /** The one-line resting state, plus anything Track 2 produced. */
  const quietCard = (line: string) => (
    <div className="notary-card notary-quiet">
      <div className="notary-header">
        <NotaryMark />
        <span className="notary-summary">{line}</span>
      </div>
      {quietGaps.length > 0 && (
        <ul className="notary-gaps">
          {quietGaps.map((g) => (
            <li key={g.missing + g.unblocks}>Not checked: {g.unblocks}</li>
          ))}
        </ul>
      )}
      {quietAdvance.length > 0 && (
        <div className="notary-advance">
          <div className="notary-advance-pills">
            {quietAdvance.map((s) => (
              <ActionPill
                key={s.id}
                label={s.short_label}
                fullText={s.prompt}
                busy={busy === `advance:${s.id}`}
                onCommit={() => sendToHost(`advance:${s.id}`, s.prompt)}
              />
            ))}
          </div>
        </div>
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
  // But silence is now conditional. When Track 2 produced a next move, or a
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
  // Advance — at most 2 per Part 11's cardinality contract, already enforced
  // server-side (server/src/engineClient.ts's MAX_ADVANCE_SUGGESTIONS),
  // sliced again here defensively, same discipline as `challenges` above.
  const advanceSuggestions = (data.advance_suggestions ?? []).slice(0, 2);

  // The finding icon's hover/title text: the single finding's own reason
  // when there's one, or a plain count when there are several — never a
  // severity word, never a color.
  const findingSummary =
    findings.length === 1 ? findings[0].label : `${findings.length} things to check`;

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
        <button type="button" className="notary-link" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
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
            {allMatches.length === 0 && allRejected.length === 0 && (
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
          <div className="notary-scope">{data.scope}</div>
          {isTwoBlock && (
            <div className="notary-note">
              Two-block card — only render this shape when a rejected candidate AND
              separate applicable contradicting evidence both exist. See § Product
              contract in this document before reusing this layout elsewhere.
            </div>
          )}
          {/* "What to pressure-test" — Track 2/Challenge, visually subordinate,
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
          {/* Advance (Track 2 v2) — structurally SEPARATE from the "What to
              pressure-test" register above: a different system, a different
              authority level (a next-move suggestion about the user's broader
              task, not a question about this claim's finding). Reuses the exact
              same pill/sendToHost mechanism already built and tested against the
              real host above — not a new interaction pattern, just real data
              flowing through it for the first time. `short_label` is the text
              at rest (Advance, unlike Track 1, has to say what it's proposing
              before the user engages with it — see the module comment on
              ChallengeItem above); `prompt` is the full, already-validated ask,
              revealed on first interaction (or hover) and sent verbatim on the
              second. Renders nothing when the engine produced zero suggestions —
              a correct, expected result, never a broken state. */}
          {advanceSuggestions.length > 0 && (
            <div className="notary-advance">
              <div className="notary-advance-pills">
                {advanceSuggestions.map((s) => {
                  const busyKey = `advance:${s.id}`;
                  return (
                    <ActionPill
                      key={s.id}
                      label={s.short_label}
                      fullText={s.prompt}
                      busy={busy === busyKey}
                      onCommit={() => sendToHost(busyKey, s.prompt)}
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
