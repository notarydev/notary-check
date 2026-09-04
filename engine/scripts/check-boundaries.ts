// Module boundaries, enforced instead of documented.
//
// WHY THIS EXISTS.
//
// Two rules hold this engine together, and until now both lived only in prose:
//
//   1. "A model may propose. A record earns a state only through an
//      evidence-bound procedure." (CLAUDE.md) — which in code means
//      verification/ is the deterministic bottom layer and assignState() has
//      exactly one caller.
//   2. The directory layering, which is what lets someone open one directory
//      and understand it without reading the other thirteen.
//
// Prose rules decay silently. Both had already been broken by the time this
// script was written — verification/immaterialAmbiguity.ts imported a helper
// from judge/, and quotas/ and judge/ imported each other — and nothing
// failed, because nothing was checking. Neither break was harmful on its own;
// that is exactly the problem. Layer violations are never harmful on their
// own. They are harmful in aggregate, at which point they are expensive to
// undo.
//
// This runs in `npm test`. A violation fails the build with the offending file
// and line, so the rule is enforced at the moment it is broken rather than
// discovered months later by whoever has to unpick it.
//
// SCOPE. Production source only — *.test.ts is exempt. A test legitimately
// reaches across layers to build a fixture (quotaCheck.test.ts constructing a
// JudgeCallRecord is fine and should stay fine); a production module doing the
// same is the thing being prevented.
//
// Run: cd engine && npx tsx scripts/check-boundaries.ts

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

/**
 * The layering, bottom to top. A module may import from a STRICTLY LOWER layer
 * and nothing else — not sideways, not upward.
 *
 * Sideways is barred as well as upward because two modules at the same layer
 * that import each other cannot be read independently, which is the property
 * the layering is for. When two same-layer modules genuinely need to share
 * something, the shared thing belongs in a lower layer (see
 * verification/valueUnit.ts and quotas/usage.ts's ModelCallRecord — both are
 * that fix, applied).
 */
const LAYERS: readonly (readonly string[])[] = [
  // 0 — leaves. No engine dependencies at all. verification/ is here because
  // it is the deterministic core: it must be auditable without reading a line
  // of model-calling code, and that is only true if it imports none of it.
  ["observability", "middleware", "test", "verification", "evidence", "auth", "billing", "quotas"],
  // 1 — thin wrappers over a leaf.
  ["ingestion", "detect"],
  // 2 — the model transport and the prompts that use it.
  ["judge"],
  // 3 — the two model-driven producers. Neither may import the other: they run
  // independently by design, and a dependency between them would make that
  // claim untestable.
  ["extraction", "act"],
  // 4 — orchestration. Sequences everything below and owns the ONE call to
  // assignState().
  ["review"],
  // 5 — HTTP. Nothing may import this; it is the outermost edge.
  ["routes"],
];

const layerOf = new Map<string, number>();
LAYERS.forEach((mods, i) => mods.forEach((m) => layerOf.set(m, i)));

interface Violation {
  file: string;
  line: number;
  message: string;
}

/**
 * assignState() is the only function in this codebase that can write a
 * Claim.state. Restricting who may import it is the mechanical half of the
 * authority rule — the half that does not depend on anyone reading CLAUDE.md.
 */
const STATE_ASSIGNMENT = "verification/stateMachine.ts";
const STATE_ASSIGNMENT_CALLERS = new Set(["review"]);

async function tsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tsFiles(full)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

async function main(): Promise<void> {
  const violations: Violation[] = [];
  const unlayered = new Set<string>();

  for (const file of await tsFiles(SRC)) {
    const rel = path.relative(SRC, file);
    const owner = rel.includes(path.sep) ? rel.split(path.sep)[0] : null;
    // Files directly in src/ (server.ts, migrate.ts) are entry points and are
    // allowed to reach anywhere — they are the composition root.
    if (owner === null) continue;

    const ownLayer = layerOf.get(owner);
    if (ownLayer === undefined) {
      unlayered.add(owner);
      continue;
    }

    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((text, i) => {
      const match = /^\s*import\s[^"']*["'](\.\.\/[^"']+)["']/.exec(text);
      if (match === null) return;
      const spec = match[1];
      const target = spec.replace(/^\.\.\//, "");
      const targetDir = target.split("/")[0];
      const targetLayer = layerOf.get(targetDir);
      if (targetLayer === undefined) return;

      if (targetLayer >= ownLayer) {
        const how = targetLayer === ownLayer ? "sideways within" : "upward from";
        violations.push({
          file: rel,
          line: i + 1,
          message: `${owner}/ (layer ${ownLayer}) imports ${targetDir}/ (layer ${targetLayer}) — ${how} its own layer. Move the shared code down, or state why the layering changed.`,
        });
      }

      if (target === STATE_ASSIGNMENT && !STATE_ASSIGNMENT_CALLERS.has(owner)) {
        violations.push({
          file: rel,
          line: i + 1,
          message: `${owner}/ imports ${STATE_ASSIGNMENT}. Only ${[...STATE_ASSIGNMENT_CALLERS].join(", ")}/ may assign a claim state — see CLAUDE.md, "A model may propose."`,
        });
      }
    });
  }

  if (unlayered.size > 0) {
    console.error(`New directories not present in LAYERS: ${[...unlayered].sort().join(", ")}`);
    console.error("Add them to this file's LAYERS table — a directory with no declared layer is unchecked.\n");
  }

  if (violations.length === 0 && unlayered.size === 0) {
    console.log(`boundaries ok — ${LAYERS.flat().length} modules, no upward or sideways imports, one assignState caller`);
    return;
  }

  for (const v of violations) console.error(`${v.file}:${v.line}  ${v.message}`);
  console.error(`\n${violations.length} boundary violation(s).`);
  process.exit(1);
}

main().catch((e: unknown) => {
  console.error("check-boundaries failed to run:", e instanceof Error ? e.message : String(e));
  process.exit(2);
});
