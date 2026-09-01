import express from "express";
import cors from "cors";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// Verified against @modelcontextprotocol/ext-apps@1.7.5's installed package.json
// exports map: registerAppTool/registerAppResource/RESOURCE_MIME_TYPE live under
// the "./server" subpath, not the package root (the root export is the client-side
// App class used by ui/src/App.tsx). Import RESOURCE_MIME_TYPE rather than
// hardcoding "text/html" — the package's actual default is
// "text/html;profile=mcp-app".
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { reviewAnswer } from "./engineClient.js";

try {
  process.loadEnvFile();
} catch {
  // no .env file present — fine in environments where ENGINE_URL/ENGINE_API_KEY
  // are set another way (e.g. the container's own env).
}

// The MCP SDK's registerTool contract takes a Zod raw shape (a plain object of
// Zod schemas), not a JSON Schema object — this is the actual, buildable shape,
// not a placeholder. Only answer_text is used in Phase 0; source_refs is accepted
// and ignored until Phase 1 wires the real evidence manifest (§ Verification pipeline).
const reviewInputSchema = {
  answer_text: z.string().describe("The verbatim draft or sent answer text to review."),
  source_refs: z
    .array(
      z.object({
        url: z.string().url().optional(),
        title: z.string().optional(),
        quoted_excerpt: z.string().optional(),
        source_role: z.enum(["answer_citation", "user_added", "workspace_collection"]),
      }),
    )
    .optional()
    .describe("Sources Claude can identify as actually available — never invented."),
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST_DIR = path.join(__dirname, "../../ui/dist");
const RESOURCE_URI = "ui://notary/review-card";

function buildServer() {
  const server = new McpServer({ name: "notary", version: "0.1.0" });

  registerAppTool(
    server,
    "review_source_backed_answer",
    {
      title: "Check with Notary",
      description:
        "Reviews the material factual claims in a source-backed AI answer against the sources actually supplied, and returns a card showing only material issues. Pass the verbatim answer text and only sources you can identify as actually available — never invent citations or imply private context was delivered.",
      inputSchema: reviewInputSchema,
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args: { answer_text: string; source_refs?: Array<{ url?: string; title?: string; quoted_excerpt?: string; source_role: "answer_citation" | "user_added" | "workspace_collection" }> }) => {
      const cardData = await reviewAnswer(args?.answer_text ?? "", args?.source_refs ?? []);
      return {
        content: [
          {
            type: "text" as const,
            text:
              cardData.status === "no_issue"
                ? "No issue found."
                : cardData.status === "could_not_check"
                  ? "Could not verify this against the supplied evidence."
                  : "1 thing to check.",
          },
        ],
        structuredContent: cardData,
      };
    },
  );

  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await readFile(path.join(UI_DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}

const app = express();
app.use(cors());
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = process.env.PORT ?? 3333;
app.listen(PORT, () => {
  console.log(`Notary Check MCP server listening on http://localhost:${PORT}/mcp`);
});
