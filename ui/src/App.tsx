import { useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";

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

// Locked Track 2 contract — see docs/build/tier-1-build-and-operating-plan.md's
// "Track 2 / Challenge layer" section. Never a verdict/confidence/answer
// field.
type ChallengeItem = {
  challenge_type: "ambiguity" | "missing_assumption" | "alternative_interpretation" | "evidence_request" | "adversarial_test";
  prompt: string;
  why_it_matters: string;
  action: "clarify_claim" | "add_source" | "open_evidence" | "ask_host" | "draft_test" | "leave_unchanged";
};

type ReviewCardData = {
  status: "no_issue" | "issue_found" | "could_not_check";
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

export default function App() {
  const [data, setData] = useState<ReviewCardData | null>(null);
  const [toolInput, setToolInput] = useState<ToolInput | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  // Real host wiring. Verified against @modelcontextprotocol/ext-apps@1.7.5:
  // useApp() connects this sandboxed view to the host (Claude) over
  // postMessage; app.ontoolresult fires with the tool's CallToolResult once
  // review_source_backed_answer completes, and `structuredContent` there is
  // exactly what server.ts returned. ontoolinput fires with the same call's
  // original arguments — captured here so "Recheck" can re-invoke the tool
  // with the same answer_text/source_refs (the card is never given those in
  // its own result payload, only in the separate tool-input notification).
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
          setEvidenceOpen(false);
          setActionNote(null);
        }
      };
    },
  });

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

  async function handleAction(action: string) {
    if (!data) return;
    // "Dismiss" and "Open evidence" are pure local UI state and never need
    // the host connection — resolve them before the `app` check below, so
    // they still work even in the ?mock= standalone test harness (no real
    // host to connect to there) and aren't blocked by host latency.
    if (action === "Dismiss") {
      setDismissed(true);
      return;
    }
    if (action === "Open evidence" || action === "Open both sources") {
      setEvidenceOpen((v) => !v);
      return;
    }
    if (!app) return;
    setBusy(action);
    setActionNote(null);
    try {
      if (action === "Recheck") {
        const result = await app.callServerTool({
          name: "review_source_backed_answer",
          arguments: {
            answer_text: toolInput?.answer_text ?? "",
            source_refs: toolInput?.source_refs ?? [],
          },
        });
        if (!result.isError && result.structuredContent) {
          setData(result.structuredContent as unknown as ReviewCardData);
          setEvidenceOpen(false);
        } else {
          setActionNote("Recheck failed — try again.");
        }
        return;
      }
      // "Qualify", "Replace with 12%", and any other free-text action: hand
      // the request to the model as a real message rather than guessing at a
      // structured action this card has no authority to perform itself —
      // the card records and surfaces; the user (via Claude) decides.
      const claimText = data.claim ?? data.findings?.[0]?.label ?? "this claim";
      const result = await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: `${action}: "${claimText}"` }],
      });
      if (result.isError) setActionNote("The host didn't accept that action.");
    } catch {
      setActionNote("Something went wrong — try again.");
    } finally {
      setBusy(null);
    }
  }

  // Track 2 action routing, per the plan doc: clarify_claim -> qualify_claim
  // (closest existing match), add_source -> add_source, open_evidence ->
  // open_evidence, recheck_claim after any of those. ask_host and draft_test
  // don't map to an existing app-only tool yet (plan doc: "not built
  // speculatively ahead of need") — those fall back to the same
  // sendMessage-to-host pattern the rest of this card already uses for
  // actions with no dedicated tool.
  async function handleChallengeAction(item: ChallengeItem) {
    if (item.action === "open_evidence") {
      setEvidenceOpen((v) => !v);
      return;
    }
    if (item.action === "leave_unchanged") return;
    if (!app) return;
    const busyKey = `challenge:${item.prompt}`;
    setBusy(busyKey);
    setActionNote(null);
    try {
      const label =
        item.action === "clarify_claim"
          ? "Qualify"
          : item.action === "add_source"
            ? "Add source"
            : item.action === "ask_host"
              ? "Ask host"
              : "Draft test";
      const result = await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: `${label}: ${item.prompt}` }],
      });
      if (result.isError) setActionNote("The host didn't accept that action.");
    } catch {
      setActionNote("Something went wrong — try again.");
    } finally {
      setBusy(null);
    }
  }

  if (data.status === "no_issue") {
    return <div className="notary-card notary-quiet">No issue found.</div>;
  }

  if (data.status === "could_not_check") {
    return (
      <div className="notary-card notary-quiet">
        Could not verify this against the supplied evidence.
      </div>
    );
  }

  const isTwoBlock = (data.findings?.length ?? 0) > 1;
  const submittedSources = toolInput?.source_refs ?? [];
  // At most 4 total, per the plan doc's cap — already enforced server-side
  // (server/src/engineClient.ts), sliced again here defensively.
  const challenges = (data.challenges ?? []).slice(0, 4);

  return (
    <div className="notary-card">
      <div className="notary-header">1 thing to check</div>
      {data.claim && <div className="notary-claim">{data.claim}</div>}
      {data.findings?.map((f, i) => (
        <div className="notary-finding" key={i}>
          <div className="notary-finding-label">{f.label}</div>
          <div className="notary-finding-text">{f.text}</div>
          <div className="notary-finding-why">Why: {f.why}</div>
        </div>
      ))}
      {evidenceOpen && (
        <div className="notary-evidence">
          {/* The engine's actual resolved evidence — the retained text at the
              locator, applicability outcome, and honest origin. This is what
              was actually checked, not the raw submission. */}
          {data.findings?.flatMap((f) => f.evidence?.matches ?? []).map((m, i) => (
            <EvidenceMatchView match={m} key={`match-${i}`} />
          ))}
          {data.findings?.flatMap((f) => f.evidence?.rejectedCandidates ?? []).map((c, i) => (
            <RejectedCandidateView candidate={c} key={`rejected-${i}`} />
          ))}
          {data.findings?.every((f) => (f.evidence?.matches.length ?? 0) === 0 && (f.evidence?.rejectedCandidates.length ?? 0) === 0) && (
            <div className="notary-evidence-unresolved">No resolved evidence is on record for this finding.</div>
          )}
          {/* Original submitted source references — provenance context only,
              never presented as the verified passage above. */}
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
      )}
      <div className="notary-actions">
        {data.actions.map((a) => (
          <button key={a} onClick={() => handleAction(a)} disabled={busy !== null}>
            {busy === a ? "…" : a}
          </button>
        ))}
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
      {/* "What to pressure-test" — Track 2, visually subordinate, always below
          the evidence record above, never a verdict/score/competing claim.
          Renders nothing when the engine hasn't produced any (or hasn't
          landed the field at all yet). */}
      {challenges.length > 0 && (
        <div className="notary-challenges">
          <div className="notary-challenges-header">What to pressure-test</div>
          {challenges.map((c, i) => (
            <div className="notary-challenge-item" key={i}>
              <div className="notary-challenge-prompt">{c.prompt}</div>
              <div className="notary-challenge-why">{c.why_it_matters}</div>
              {c.action !== "leave_unchanged" && (
                <button
                  className="notary-challenge-action"
                  onClick={() => handleChallengeAction(c)}
                  disabled={busy !== null}
                >
                  {busy === `challenge:${c.prompt}`
                    ? "…"
                    : c.action === "clarify_claim"
                      ? "Clarify claim"
                      : c.action === "add_source"
                        ? "Add source"
                        : c.action === "open_evidence"
                          ? "Open evidence"
                          : c.action === "ask_host"
                            ? "Ask host"
                            : "Draft test"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
