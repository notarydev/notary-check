// Unit tests for verification/valueUnit.ts.
//
// These moved here from judge/fieldExtraction.test.ts along with the function
// itself. parseValueUnit is pure and deterministic — it belongs to the
// verification layer, not to the module that happens to call a model, and
// scripts/check-boundaries.ts now enforces that direction.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseValueUnit } from "./valueUnit.ts";

test("parseValueUnit splits a leading signed number from its unit deterministically", () => {
  assert.deepEqual(parseValueUnit("17%"), { value: "17", unit: "%" });
  assert.deepEqual(parseValueUnit(" 17 % "), { value: "17", unit: "%" });
  assert.deepEqual(parseValueUnit("12"), { value: "12" });
  assert.deepEqual(parseValueUnit("$1.2 billion"), { value: "1.2", unit: "billion" });
  assert.deepEqual(parseValueUnit("3.5x"), { value: "3.5", unit: "x" });
  assert.deepEqual(parseValueUnit("17%."), { value: "17", unit: "%" });
  assert.deepEqual(parseValueUnit("1,200.50"), { value: "1200.50" });
});
