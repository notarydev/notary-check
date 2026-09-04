// Self-contradiction — does the answer disagree with itself?
//
// WHY THIS ONE FIRST. Measured against 51 real transcripts (eval/
// detector-hit-rate.ts), this has material on ~39% of substantive answers —
// the broadest of any detector — and it needs NO sources, which matters
// because only ~19% of turns carry anything source-like. It is also
// ask-independent: it reads the answer, which is always present, so its
// measured rate is real rather than an artefact of nobody having asked Claude
// for anything.
//
// Canonical already grades this Tier B: "internal contradiction and claim
// drift... a reasonable extension of the existing contradiction machinery
// pointed inward. Worth building next."
//
// HOW IT WORKS. It reuses the existing comparator rather than inventing a
// second one. Two claims are compared exactly the way a claim and a piece of
// evidence are: the applicability gate first decides whether they are even
// ABOUT the same thing, and only then are their values compared.
//
// THE GATE IS THE WHOLE SAFETY PROPERTY. Without it this fires on every pair
// of claims that share a number. The specific false positive it prevents:
//
//     "Revenue grew 17%"
//     "Excluding one-time items, revenue grew 12%"
//
// Same entity, period and metric — different SCOPE. Not a contradiction, a
// qualification. So an undefined scope is deliberately NOT treated as
// compatible with a stated one: a general claim and a narrowed claim are not
// comparable, and treating them as such would make Notary wrong about the
// most ordinary kind of careful writing.
//
// O(n²) is avoided by blocking: claims are grouped by their normalized
// (entity, metric, period) key and only compared within a group. Two claims
// about different subjects never meet.

import { randomUUID } from "node:crypto";
import { assessApplicability } from "../verification/applicability.ts";
import type { ClaimFields } from "../verification/applicability.ts";
import { normalizeEntity, normalizePeriodLabel, normalizeSafeSyntax } from "../verification/normalization.ts";
import type { Detector, DetectorInput, DetectorOutcome, FieldDelta, Finding } from "./types.ts";

export const SELF_CONTRADICTION_VERSION = "self-contradiction-v1";

/**
 * Blocking key. Claims that do not share all three of entity, metric and
 * period are never compared — they are not about the same thing, so they
 * cannot contradict. This is what keeps the comparison linear in practice
 * instead of quadratic across the whole claim set.
 */
function blockKey(f: ClaimFields): string | null {
  if (f.entity === undefined || f.metric === undefined || f.period === undefined) return null;
  return [
    normalizeEntity(f.entity).normalized,
    normalizeSafeSyntax(f.metric).normalized,
    normalizePeriodLabel(f.period).normalized,
  ].join("|");
}

/**
 * Are these two claims even comparable?
 *
 * Beyond the block key, scope and comparatorBaseline must AGREE — including
 * agreeing on being absent. A claim with no stated scope is a claim about the
 * general case; a claim with a stated scope is about a subset. Those can both
 * be true, so comparing their values would manufacture a contradiction.
 */
function couldCompare(a: ClaimFields, b: ClaimFields): boolean {
  const same = (x?: string, y?: string): boolean => {
    if (x === undefined && y === undefined) return true;
    if (x === undefined || y === undefined) return false; // general vs narrowed — not comparable
    return normalizeSafeSyntax(x).normalized === normalizeSafeSyntax(y).normalized;
  };
  return same(a.scope, b.scope) && same(a.comparatorBaseline, b.comparatorBaseline) && same(a.modality, b.modality);
}

export const selfContradictionDetector: Detector = {
  id: "self_contradiction",
  version: SELF_CONTRADICTION_VERSION,
  // Ranks below a source contradiction: evidence disagreeing with the answer
  // is a stronger statement than the answer disagreeing with itself, because
  // the former is anchored to something outside the model.
  rank: 20,

  run(input: DetectorInput): DetectorOutcome {
    const withKeys = input.claims
      .map((c) => ({ claim: c, key: blockKey(c.fields) }))
      .filter((x): x is { claim: (typeof input.claims)[number]; key: string } => x.key !== null);

    if (withKeys.length < 2) {
      // Fewer than two claims that even carry an identity — nothing that could
      // contradict. Not a missing input: no ask would fix it.
      return { status: "not_applicable" };
    }

    const blocks = new Map<string, typeof withKeys>();
    for (const x of withKeys) {
      const arr = blocks.get(x.key) ?? [];
      arr.push(x);
      blocks.set(x.key, arr);
    }

    const findings: Finding[] = [];

    for (const group of blocks.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i].claim;
          const b = group[j].claim;
          if (!couldCompare(a.fields, b.fields)) continue;

          // Reuse the real comparator. Claim B stands in for "evidence" —
          // the comparison is symmetric, and this is deliberately the SAME
          // code path source-verify uses, so the two can never drift apart in
          // what they consider a conflict.
          const result = assessApplicability(a.fields, b.fields);
          if (!result.applicable || !result.valueConflicts) continue;

          const deltas: FieldDelta[] = result.fields
            .filter((f) => f.status === "value_conflict")
            .map((f) => ({
              field: String(f.field),
              claimed: String(f.claimed ?? ""),
              observed: String(f.evidence ?? ""),
              relation: "conflict" as const,
            }));
          if (deltas.length === 0) continue;

          findings.push({
            id: randomUUID(),
            detector: "self_contradiction",
            type: "internal_conflict",
            owner: "computed",
            // Both sides of this comparison are the model's own answer. The
            // conflict is real and exactly computed, and it establishes
            // nothing about the world — only that the answer disagrees with
            // itself. That is worth surfacing and must never assign a state.
            inputProvenance: "model_reported",
            claimId: a.id,
            boundaryText: `The answer states "${a.text}" and also "${b.text}".`,
            fieldDeltas: deltas,
            basis: { kind: "answer_internal", ref: `${a.id}:${b.id}` },
            rank: 20,
            detectorVersion: SELF_CONTRADICTION_VERSION,
          });
        }
      }
    }

    return { status: "ran", findings };
  },
};
