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
import { clerkMiddleware } from "@clerk/express";
import { mcpAuthClerk, protectedResourceHandlerClerk, authServerMetadataHandlerClerk } from "@clerk/mcp-tools/express";
import { reviewAnswer } from "./engineClient.js";
import { resolveApiKeyForUser } from "./orgResolver.js";

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
  // TRACK 2's OBJECT. Not an optional extra — without it Track 2 has no task
  // to reason about and skips entirely, which is why it used to produce
  // nothing on the ~37% of turns where Track 1 also has nothing.
  //
  // Kept optional in the SCHEMA but not in the DESCRIPTION, deliberately.
  // Making it hard-required means a validation error when Claude omits it,
  // which may prompt a corrected retry or may make Claude stop calling the
  // tool at all — and losing the invocation is worse than losing the field.
  // Measured omission rate before this change: 19% of Advance invocations.
  // Re-measure after; harden only if the description alone does not close it.
  //
  // The previous description ended with "omit it entirely if it isn't"
  // available — an explicit escape hatch for a field Claude always has, since
  // it is the message being answered. That sentence is gone.
  user_request: z
    .string()
    .optional()
    .describe(
      "REQUIRED IN PRACTICE — you always have this; it is the message you are answering. The user's own request for this turn, verbatim: never paraphrased, summarized, or invented. Notary uses it to work out what the user is trying to do, which is half of what it returns. Without it Notary cannot suggest a next move at all.",
    ),
  // Everything below is Track 2's material. None of it is required, and none
  // of it may be invented — an absent field is a correct answer, a fabricated
  // one silently corrupts the task model.
  //
  // Deliberately NOT asked for: task_mode. Classifying the task is Notary's
  // job (engine/src/advance/intent.ts), not Claude's. Asking would put an
  // unauditable label in an optional field Claude often skips; inferring it
  // makes the classification ours to explain and improve.
  explicit_constraints: z
    .array(z.string())
    .optional()
    .describe(
      "Constraints the user stated in their own words — a budget, a deadline, a technology they must use or avoid, a length limit. Verbatim, only what they actually said. Omit if they stated none; never infer one.",
    ),
  prior_attempts: z
    .array(z.string())
    .optional()
    .describe(
      "What the user says they already tried, in their words. Distinguishes 'nothing has been tried yet' from 'something was tried and needs fixing' — which are different next moves. Omit if unknown.",
    ),
  execution_results: z
    .array(z.object({ ref: z.string(), text: z.string() }))
    .optional()
    .describe(
      "Output from commands, tests, or tools you actually ran this turn — verbatim, truncated if long. Notary checks completion claims against it: if your answer says tests pass and the output shows failures, that is caught. Only include real output you received; never reconstruct or summarize it.",
    ),
  prior_context: z
    .array(
      z.object({
        kind: z.enum(["decision", "constraint", "requirement", "number", "assumption"]),
        text: z.string(),
      }),
    )
    .optional()
    .describe(
      "Statements established EARLIER in this conversation that this answer depends on, restates, or changes — quoted verbatim, never paraphrased. Used only to notice when an answer drifts from something already settled. Omit entirely rather than reconstructing from memory.",
    ),
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
        // TWO JOBS, NOT ONE. The old description described only claim-vs-source
        // checking, which is why Claude only ever sent claim-vs-source material
        // and Track 2 arrived blind. Notary now does two things and needs
        // material for both.
        "Notary independently checks your answer and suggests what to do next. It does two things: (1) finds things that are blatantly wrong — a claim the supplied source contradicts, an answer that contradicts itself, a completion claim the command output disproves; and (2) works out what the user is trying to do and suggests at most two next moves. " +
        "Bring material for both: the verbatim answer, any sources you actually used, AND the user's own request verbatim plus any constraints they stated. You always have the user's request — it is the message you are answering. Never invent a citation, a constraint, or context that was not supplied; an omitted field is correct, a fabricated one is not. " +
        // The trigger is deliberately no longer gated on having a source. A
        // source-gated trigger meant Notary was never called on the majority of
        // turns, including every turn where the second job was the useful one.
        "Call this proactively, without waiting to be asked, whenever you have written a substantive answer — you do not need a source, and you do not need a factual claim. Do this on every such answer in the conversation, not only the first. " +
        // The loop. Claude can call repeatedly BEFORE writing to the user, so
        // the ask is phrased to be acted on now rather than deferred.
        "If Notary reports that something could not be checked and names what would fix it, act on that immediately where you can — attach the source, supply the command output, then call Notary again before you finish your answer. If a later user message responds to a Notary finding (for example 'Qualify:' or 'Replace with'), treat it as an authoritative correction tied to that claim, revise, and check the revision.",
      inputSchema: reviewInputSchema,
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (
      args: {
        answer_text: string;
        source_refs?: Array<{ url?: string; title?: string; quoted_excerpt?: string; source_role: "answer_citation" | "user_added" | "workspace_collection" }>;
        user_request?: string;
        explicit_constraints?: string[];
        prior_attempts?: string[];
        execution_results?: Array<{ ref: string; text: string }>;
        prior_context?: Array<{ kind: "decision" | "constraint" | "requirement" | "number" | "assumption"; text: string }>;
      },
      extra: { authInfo?: { extra?: { userId?: string; email?: string } } },
    ) => {
      const clerkUserId = extra?.authInfo?.extra?.userId;
      const email = extra?.authInfo?.extra?.email;
      if (!clerkUserId) {
        throw new Error("Unauthenticated tool call: no Clerk user id on authInfo.");
      }
      const apiKey = await resolveApiKeyForUser(clerkUserId, email);
      const cardData = await reviewAnswer(args?.answer_text ?? "", args?.source_refs ?? [], apiKey, {
        userRequest: args?.user_request,
        explicitConstraints: args?.explicit_constraints,
        priorAttempts: args?.prior_attempts,
        executionResults: args?.execution_results,
        priorContext: args?.prior_context,
      });
      return {
        content: [
          {
            type: "text" as const,
            // The trailing reminder is deliberate, not filler: recency beats
            // distance for whether a proactive tool call happens on the NEXT
            // turn (a live test, 2026-09-03, found a user instruction from
            // several turns earlier did not reliably persist, while
            // same-turn/recent context did). Keeping a short, fresh
            // reinforcement in the model-visible text each time this tool is
            // used is cheap and puts the reminder where it's actually
            // effective, rather than relying solely on the tool description
            // (read once, at the start of the conversation) or a standing
            // user instruction (shown to fade with distance).
            text:
              // Four states. `not_checked` says plainly that nothing was
              // checked and why — the card stays silent, but the caller is
              // told, which is what keeps the silence honest rather than
              // lossy (§ Platform constraint, "render the truth plainly").
              (cardData.status === "no_issue"
                ? "No issue found."
                : cardData.status === "not_checked"
                  ? "Nothing to check — no inspectable source was supplied for the claims in this answer. This is not a failure, and no claim was verified either way."
                  : cardData.status === "could_not_check"
                    ? "Could not verify this against the supplied evidence."
                    : "1 thing to check.") +
              // The qualifier "with an available source" used to live here. It
              // was re-teaching the NARROW, Track 1-only trigger on every
              // single turn — spending the strongest lever we have (recency
              // beats distance, measured live 2026-09-03) to make Notary get
              // called less. Removed.
              " (Keep calling Notary proactively on this conversation's later answers — a source is not required, and pass the user's request each time.)",
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
// exposedHeaders is required so the browser/MCP client can read the
// WWW-Authenticate header on a 401 challenge — without it, CORS strips the
// header and the OAuth discovery flow can't proceed.
app.use(cors({ exposedHeaders: ["WWW-Authenticate"] }));
app.use(clerkMiddleware());
app.use(express.json());

const mcpHandler = async (req: express.Request, res: express.Response) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
};

// Served on both "/" and "/mcp" so the shortest possible connector URL
// (just the bare domain) works, while "/mcp" stays for anyone who already
// registered the longer form. Both are protected by Clerk OAuth.
app.post("/", mcpAuthClerk, mcpHandler);
app.post("/mcp", mcpAuthClerk, mcpHandler);

// OAuth discovery routes required by the MCP spec's auth flow.
app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceHandlerClerk({ scopes_supported: ["email", "profile"] }));
app.get("/.well-known/oauth-authorization-server", authServerMetadataHandlerClerk);

const PORT = process.env.PORT ?? 3333;
app.listen(PORT, () => {
  console.log(`Notary Check MCP server listening on http://localhost:${PORT}/mcp`);
});
