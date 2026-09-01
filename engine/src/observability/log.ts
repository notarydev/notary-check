// Minimal structured logging (§ Monitoring) — build-order step 5.
//
// This is NOT a metrics/alerting platform (Datadog/Grafana/etc. — a vendor
// choice, explicitly out of scope) and NOT an external logging-library
// dependency. It is a single function that emits one JSON object per line via
// console.log, with a consistent shape a real platform could later ingest
// (CloudWatch, Datadog agent, etc.). Every field the plan names as required for
// monitoring is first-class here:
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
  } catch {
    // Logging is best-effort by design; a malformed field must not crash a route.
  }
}
