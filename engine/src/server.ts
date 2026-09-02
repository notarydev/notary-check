import "dotenv/config";
import express from "express";
import { pool } from "./db.js";
import { createStripeClient } from "./billing/stripeClient.js";
import { evidenceRouter } from "./routes/evidence.js";
import { billingRouter } from "./routes/billing.js";
import { webhookRouter } from "./routes/webhook.js";
import { reviewsRouter } from "./routes/reviews.js";
import { extractClaimsRouter } from "./routes/extractClaims.js";
import { internalRouter } from "./routes/internal.js";
import { usageRouter } from "./routes/usage.js";
import { organizationRouter } from "./routes/organization.js";
import { apiKeysRouter } from "./routes/apiKeys.js";
import { waitlistRouter } from "./routes/waitlist.js";

const app = express();

// Webhook signature verification needs the RAW request bytes: Stripe signs the
// exact byte payload, so constructEvent must see the unmodified body. Mount
// express.raw() for the webhook path BEFORE the JSON parser — body-parser marks
// the body as already parsed, so the global express.json() below skips it.
app.use("/v1/billing/webhook", express.raw({ type: "application/json" }));

// Inline payloads are hashed in memory and not persisted beyond the hash in
// this step, so the body size is bounded by the same cost-control spirit that
// caps source sizes later (§ Cost-control rules).
app.use(express.json({ limit: "5mb" }));

app.use(evidenceRouter(pool));
app.use(reviewsRouter(pool));
app.use(extractClaimsRouter(pool));
app.use(internalRouter(pool));
app.use(usageRouter(pool));
app.use(organizationRouter(pool));
app.use(apiKeysRouter(pool));
app.use(waitlistRouter(pool));

const stripe = createStripeClient();
app.use(billingRouter(pool, stripe));
app.use(webhookRouter(pool, stripe));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

const PORT = Number(process.env.PORT ?? 4001);
app.listen(PORT, () => {
  console.log(`Notary Check engine listening on http://localhost:${PORT}`);
});
