import "dotenv/config";
import express from "express";
import { pool } from "./db.js";
import { evidenceRouter } from "./routes/evidence.js";

const app = express();
// Inline payloads are hashed in memory and not persisted beyond the hash in
// this step, so the body size is bounded by the same cost-control spirit that
// caps source sizes later (§ Cost-control rules).
app.use(express.json({ limit: "5mb" }));

app.use(evidenceRouter(pool));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

const PORT = Number(process.env.PORT ?? 4001);
app.listen(PORT, () => {
  console.log(`Notary Check engine listening on http://localhost:${PORT}`);
});
