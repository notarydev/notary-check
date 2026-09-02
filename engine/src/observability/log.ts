// Minimal structured logging (§ Monitoring) — build-order step 5.
//
// The platform choice (§ HANDOFF.md's "known gap") is Datadog, decided
// 2026-09-01. This stays the same single function emitting one JSON object
// per line via console.log — that behavior is unconditional and unchanged,
// since Lightsail's own container logs already ingest stdout. Shipping to
// Datadog's Logs Intake API is a SEPARATE, best-effort, fire-and-forget
// addition, active only when DD_API_KEY is set — no dependency, no SDK, one
// plain HTTPS POST per event, matching how DeepSeek/Stripe keys are already
// treated as optional-until-configured elsewhere in this codebase. If
// DD_API_KEY is unset this file behaves exactly as it always did. Every field
// the plan names as required for monitoring is first-class here:
//
//   event            — the telemetry event type (evidence_registered, judge_call, ...)
//   latency_ms       — request/operation latency
//   path             — "deterministic-only" vs "judge-involved" (§ Monitoring:
//                      latency must be trackable per path)
//   cost_cents       — per-check cost, against the spend caps
//   error_cause      — the specific failure (source-fetch, judge_timeout, ...)
//   organization_id  — per-organization rollups
//
// Callers add context fields freely; the base shape is always present. Emits to
// stdout (one JSON line per event) so nothing about process plumbing is
// invented here — a real collector attaches at the stdout/JSON boundary later.

export type LogPath = "deterministic-only" | "judge-involved";

export interface StructuredLogFields {
  /** The telemetry event type (e.g. "evidence_registered", "judge_call"). */
  event: string;
  timestamp?: string;
  latency_ms?: number;
  path?: LogPath;
  cost_cents?: number;
  error_cause?: string;
  organization_id?: string;
  /** Any additional flat context. Kept on the same line, same JSON object. */
  [key: string]: unknown;
}

const DD_SITE = process.env.DD_SITE ?? "datadoghq.com";
const SERVICE_NAME = "notary-check-engine";

/**
 * Fire-and-forget shipping of one log line to Datadog's Logs Intake API.
 * Never awaited by logEvent, never throws into the caller, never delays or
 * blocks a request — a failed/slow ship is silently dropped, same "logging
 * must not take down the request" invariant as the stdout write above. A
 * lazy read of DD_API_KEY (not a module-level const) so this respects
 * whatever loads env vars, regardless of import order (see the equivalent
 * comment in server/src/engineClient.ts for why that matters under ESM).
 */
function shipToDatadog(line: Record<string, unknown>): void {
  const apiKey = process.env.DD_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) return;
  fetch(`https://http-intake.logs.${DD_SITE}/api/v2/logs`, {
    method: "POST",
    headers: { "content-type": "application/json", "dd-api-key": apiKey },
    body: JSON.stringify([{ ddsource: "nodejs", service: SERVICE_NAME, message: JSON.stringify(line), ...line }]),
  }).catch(() => {
    // Best-effort only — Datadog being unreachable must never affect the request.
  });
}

/**
 * Emits one structured JSON log line. Never throws: logging must not take down
 * the request that produced the event. In production this is where a collector
 * would attach; in tests it is inert stdout.
 */
export function logEvent(fields: StructuredLogFields): void {
  try {
    const line: Record<string, unknown> = { ...fields };
    if (line.timestamp === undefined) {
      line.timestamp = new Date().toISOString();
    }
    console.log(JSON.stringify(line));
    shipToDatadog(line);
  } catch {
    // Logging is best-effort by design; a malformed field must not crash a route.
  }
}
