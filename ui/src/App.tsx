import { useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";

type ReviewCardData = {
  status: "no_issue" | "issue_found" | "could_not_check";
  scope: string;
  claim?: string;
  findings?: Array<{ label: string; text: string; why: string }>;
  actions: string[];
};

type SourceRef = {
  url?: string;
  title?: string;
  quoted_excerpt?: string;
  source_role: "answer_citation" | "user_added" | "workspace_collection";
};

type ToolInput = { answer_text?: string; source_refs?: SourceRef[] };

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
  const sources = toolInput?.source_refs ?? [];

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
          {sources.length === 0 && <div>No source details available.</div>}
          {sources.map((s, i) => (
            <div className="notary-evidence-item" key={i}>
              {s.url && (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title ?? s.url}
                </a>
              )}
              {s.quoted_excerpt && <div className="notary-evidence-excerpt">"{s.quoted_excerpt}"</div>}
            </div>
          ))}
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
    </div>
  );
}
