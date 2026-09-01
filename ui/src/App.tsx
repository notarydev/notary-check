import { useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";

type ReviewCardData = {
  status: "no_issue" | "issue_found" | "could_not_check";
  scope: string;
  claim?: string;
  findings?: Array<{ label: string; text: string; why: string }>;
  actions: string[];
};

export default function App() {
  const [data, setData] = useState<ReviewCardData | null>(null);

  // Real host wiring. Verified against @modelcontextprotocol/ext-apps@1.7.5:
  // useApp() connects this sandboxed view to the host (Claude) over
  // postMessage; app.ontoolresult fires with the tool's CallToolResult once
  // review_source_backed_answer completes, and `structuredContent` there is
  // exactly what server.ts returned — this was the § 0.8 VERIFY, now resolved.
  useApp({
    appInfo: { name: "notary-check", version: "0.1.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as ReviewCardData);
        }
      };
    },
  });

  useEffect(() => {
    // Local dev only: read a `?mock=` query param so the card can be tested
    // standalone without a live Claude session (§ 0.9's isolated browser test).
    // URLSearchParams.get() already URL-decodes the value — do not
    // decodeURIComponent() it again. Confirmed by testing: a payload
    // containing a literal "%" (e.g. "17%" in the card copy) throws
    // "URI malformed" on the second, redundant decode.
    const params = new URLSearchParams(window.location.search);
    const mock = params.get("mock");
    if (mock) setData(JSON.parse(mock));
  }, []);

  if (!data) return null;

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
      <div className="notary-actions">
        {data.actions.map((a) => (
          <button key={a}>{a}</button>
        ))}
      </div>
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
