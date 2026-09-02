import { Input } from "@/components/ui/input";
import { CopyUrlButton } from "./copy-url-button";

const STEPS = [
  "Open Claude, then go to Settings → Connectors → Add custom connector.",
  "Paste the connector URL below into the \"URL\" field.",
  "Sign in when prompted — this links the connector to your Notary organization.",
  "Ask Claude to check a claim. Notary will show up as a tool it can call.",
] as const;

export default function ConnectPage() {
  // No hardcoded production URL here — configure NOTARY_MCP_CONNECTOR_URL per
  // environment. Falls back to a clearly-fake placeholder if unset, rather
  // than silently pointing at nothing.
  const connectorUrl = process.env.NOTARY_MCP_CONNECTOR_URL ?? "https://mcp.example.com";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect Claude</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add Notary as a connector so Claude can check claims against evidence directly in your conversation.
        </p>
      </div>

      <section className="rounded-xl border p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Connector URL</h2>
        <div className="mt-3 flex gap-2">
          <Input readOnly value={connectorUrl} className="font-mono text-xs" />
          <CopyUrlButton url={connectorUrl} />
        </div>
      </section>

      <section className="rounded-xl border p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Setup</h2>
        <ol className="mt-3 flex flex-col gap-3">
          {STEPS.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
