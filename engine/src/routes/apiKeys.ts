// /v1/api-keys — dashboard API-key management: list, issue, revoke. Thin
// routing wrappers around the already-implemented, already-unit-tested
// auth/apiKey.ts functions (listApiKeys, issueApiKey, revokeApiKey) — no new
// key logic lives here.
//
// Same auth pattern as evidence.ts/reviews.ts: identity comes from
// `Authorization: Bearer <api-key>`, organization is DERIVED from the key,
// never from the request body/params.

import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { issueApiKey, listApiKeys, revokeApiKey, verifyApiKey } from "../auth/apiKey.ts";
import { logEvent } from "../observability/log.ts";

const BEARER_PREFIX = "Bearer ";

export function apiKeysRouter(database: pg.Pool): Router {
  const router = Router();

  // GET /v1/api-keys — the org's keys, never the key_hash (listApiKeys itself
  // never selects it).
  router.get("/v1/api-keys", async (req, res) => {
    const authHeader = req.header("authorization");
    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      logEvent({ event: "auth_failed", error_cause: "missing_bearer", path: "deterministic-only" });
      return res.status(401).json({ error: "missing Authorization: Bearer <api-key> header" });
    }
    const presentedKey = authHeader.slice(BEARER_PREFIX.length).trim();
    const auth = await verifyApiKey(presentedKey, database);
    if (!auth.ok) {
      logEvent({ event: "auth_failed", error_cause: `api_key_${auth.reason}`, path: "deterministic-only" });
      return res.status(401).json({ error: "invalid or revoked API key" });
    }

    const keys = await listApiKeys(auth.organizationId, database);
    return res.status(200).json({ api_keys: keys });
  });

  // POST /v1/api-keys — issues a new key for the authenticated org. No body
  // required; the org is derived from the auth header, same as everywhere
  // else — a client can never mint a key for another organization. The
  // plaintext key is returned exactly once, matching issueApiKey's
  // documented contract (auth/apiKey.ts).
  router.post("/v1/api-keys", async (req, res) => {
    const authHeader = req.header("authorization");
    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      logEvent({ event: "auth_failed", error_cause: "missing_bearer", path: "deterministic-only" });
      return res.status(401).json({ error: "missing Authorization: Bearer <api-key> header" });
    }
    const presentedKey = authHeader.slice(BEARER_PREFIX.length).trim();
    const auth = await verifyApiKey(presentedKey, database);
    if (!auth.ok) {
      logEvent({ event: "auth_failed", error_cause: `api_key_${auth.reason}`, path: "deterministic-only" });
      return res.status(401).json({ error: "invalid or revoked API key" });
    }

    const issued = await issueApiKey(auth.organizationId, database);
    logEvent({ event: "api_key_issued", organization_id: auth.organizationId, key_prefix: issued.keyPrefix });
    return res.status(201).json({
      id: issued.keyId,
      key: issued.plaintextKey,
      key_prefix: issued.keyPrefix,
    });
  });

  // DELETE /v1/api-keys/:id — revokes a key belonging to the authenticated
  // org. revokeApiKey itself has no org check (it takes a bare keyId), so the
  // ownership guard belongs here: verify the row belongs to this org BEFORE
  // calling it. 404 if the key does not exist or belongs to a different org —
  // same don't-leak-existence discipline as reviews.ts's cross-org 404.
  // Idempotent: revoking an already-revoked key still returns 200.
  router.delete("/v1/api-keys/:id", async (req, res) => {
    const authHeader = req.header("authorization");
    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      logEvent({ event: "auth_failed", error_cause: "missing_bearer", path: "deterministic-only" });
      return res.status(401).json({ error: "missing Authorization: Bearer <api-key> header" });
    }
    const presentedKey = authHeader.slice(BEARER_PREFIX.length).trim();
    const auth = await verifyApiKey(presentedKey, database);
    if (!auth.ok) {
      logEvent({ event: "auth_failed", error_cause: `api_key_${auth.reason}`, path: "deterministic-only" });
      return res.status(401).json({ error: "invalid or revoked API key" });
    }
    const orgId = auth.organizationId;

    const { id } = req.params;
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({ error: "invalid key id" });
    }

    const ownedRow = await database.query(
      "SELECT id, revoked_at FROM organization_api_key WHERE id = $1 AND organization_id = $2",
      [id, orgId],
    );
    if (!ownedRow.rowCount) {
      return res.status(404).json({ error: "api key not found for this organization" });
    }

    // Already revoked: still 200, not a 500 — a double-revoke is not an
    // error, revokeApiKey's own UPDATE ... WHERE revoked_at IS NULL simply
    // affects zero rows in that case.
    await revokeApiKey(id, database);
    logEvent({ event: "api_key_revoked", organization_id: orgId, key_id: id });
    return res.status(200).json({ id, revoked: true });
  });

  return router;
}
