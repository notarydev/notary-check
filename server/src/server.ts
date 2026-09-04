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
      "The user's own request for this turn, verbatim — never paraphrased, summarized, or invented. You always have this: it is the message you are answering, and Notary cannot see it any other way. It is what Notary uses to work out what the user is trying to do, which is half of what it returns; without it, Notary can check your answer but cannot suggest anything.",
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
        // WHO WE ARE, FIRST. Claude has no way to know what Notary is or what
        // it can see, and the single most useful thing to tell it is the
        // constraint: this call is the ONLY channel. Every field the schema
        // asks for is self-justifying once that is said, so it is said first.
        //
        // This belongs in the DESCRIPTION — trusted configuration the host
        // registers — and nowhere else. An earlier build put behaviour
        // guidance in the tool RESULT and Claude correctly refused it as an
        // injected instruction (see the response-text block below).
        "Notary is an independent checker that runs outside this conversation. It cannot see the conversation, your reasoning, or anything you have not passed in this call — everything it asks for is because there is no other way for it to know. " +
        // Two jobs, concretely. The old description covered only claim-vs-source
        // checking, which is why Notary was only ever called on the small
        // fraction of turns that had a citable claim.
        "It does two things: (1) finds things that are blatantly wrong — a claim your source contradicts, an answer that contradicts itself, a \"tests pass\" the command output disproves; and (2) works out what the user is trying to do and suggests at most two next moves. " +
        // Sets the expectation that silence is success. Without this a model
        // may reasonably infer that calling a checker invites criticism.
        "It checks mechanically against material you supply. It does not grade your reasoning or second-guess your judgment, and most calls find nothing — that is the normal result, not a failure. " +
        "Pass the verbatim answer, any sources you actually used, and the user's own request in their words. Never invent a citation, a constraint, or context that was not supplied: an omitted field is correct, a fabricated one is not. " +
        "Call this proactively, without waiting to be asked, on any substantive answer you write — you do not need a source, and you do not need a factual claim. Do this on every such answer, not only the first. " +
        "If Notary reports something it could not check and names what would fix it, act on that now where you can — attach the source, supply the command output, then call Notary again before you finish your answer. If a later user message responds to a Notary finding (for example \"Qualify:\" or \"Replace with\"), treat it as an authoritative correction tied to that claim, revise, and check the revision.",
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
            // NO IMPERATIVES IN TOOL OUTPUT — this block reports state and
            // nothing else.
            //
            // It previously appended "(Keep calling Notary proactively... pass
            // the user's request each time.)" to every response, on the
            // reasoning that a recent reminder beats a tool description read
            // once at conversation start. That reasoning was right about
            // recency and wrong about the channel.
            //
            // Observed live 2026-09-04, three consecutive calls: Claude
            // identified the sentence as an injected instruction, said so to
            // the user, and disregarded it — correctly. A tool result is DATA.
            // Instruction-shaped text arriving inside one is exactly the shape
            // of a prompt-injection attack, and a well-trained model is
            // supposed to refuse it. So the reminder did not merely fail to
            // work: it spent the model's trust in everything else we return,
            // and got escalated to the user as a security concern.
            //
            // Where behaviour guidance legitimately belongs is the TOOL
            // DESCRIPTION — trusted configuration the host registers, not
            // untrusted content arriving mid-conversation. It already says to
            // call proactively without a source.
            //
            // What stays here is a factual account of what happened. A capable
            // model will often act on "one claim could not be checked because
            // no source was supplied" — but that is it choosing to act on a
            // reported fact, not us issuing a command inside data. Same
            // principle the rest of this system runs on: the observation is
            // the product; the instruction was never ours to give.
            text:
              (cardData.status === "no_issue"
                ? "No issue found."
                : cardData.status === "not_checked"
                  ? "Nothing was checked: no inspectable source was supplied for the claims in this answer. No claim was verified either way."
                  : cardData.status === "could_not_check"
                    ? "Could not verify this against the supplied evidence."
                    : "1 thing to check.") +
              // WHAT COULD NOT BE CHECKED, AND WHY — stated as facts about this
              // run, never as a request.
              //
              // The distinction is the whole lesson of the reminder that used
              // to sit here. "Send me the command output" is an instruction
              // inside data, and Claude is right to refuse it. "No command
              // output was supplied, so the claim that this worked was not
              // checked" is a report of what happened, and a capable model
              // acting on it is choosing to act on a fact.
              //
              // Every ask must be worth reading even if nothing acts on it:
              // the user learns the same thing from the card either way. That
              // is what stops this being hostage to model behaviour.
              (cardData.gaps === undefined || cardData.gaps.length === 0
                ? ""
                : "\n\nNot checked in this run:\n" +
                  cardData.gaps.map((g) => `- ${g.unblocks} (nothing supplied for: ${g.missing})`).join("\n")),
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
