// Kill switch for the semantic-evaluator path (§ Security, privacy, and
// reliability requirements: "Maintain a kill switch that can disable the
// semantic-evaluator path specifically while deterministic checks keep
// running"; § Monitoring: "an operator should be able to act on [a judge
// error/timeout alert] by flipping the semantic-evaluator path off").
//
// When enabled, ANY code path that would call the judge must instead return
// cannot_be_determined for every field WITHOUT calling the judge client at all
// — no network call. Deterministic checks (verification steps 1–6 and 8) are
// completely unaffected. A failing or degraded third-party judge degrades
// Notary to "deterministic-only, semantic checks paused" rather than taking
// the whole product down.
//
// Enforcement point: the switch is read in fieldExtraction.ts's extractField()
// — the ONE real chokepoint through which every judge call flows today. It is
// deliberately NOT scattered across callers; judgeClient.ts itself is not the
// enforcement point because the intent is to short-circuit before a client is
// even constructed (a client configured here still costs nothing, but the
// design keeps the decision in exactly one place). If a future caller routes
// judge traffic around extractField, this is the module that must be consulted
// there too.
//
// Controlled by NOTARY_JUDGE_KILL_SWITCH (documented in engine/.env.example).
// Default is false — the judge is ENABLED unless an operator flips it.

/** Returns true when the judge path is disabled by the kill switch. */
export function isJudgeDisabled(): boolean {
  const raw = process.env.NOTARY_JUDGE_KILL_SWITCH;
  return raw === "true" || raw === "1";
}
