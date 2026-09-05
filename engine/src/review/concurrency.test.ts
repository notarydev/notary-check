// Pure tests for mapWithLimit — bounded concurrency with order preservation
// (E13). No DB, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mapWithLimit } from "./concurrency.ts";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("mapWithLimit never has more than `limit` tasks in flight", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const fn = async (v: number) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await delay(5);
    inFlight -= 1;
    return v * 2;
  };
  const result = await mapWithLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, fn);
  assert.deepEqual(result, [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.ok(maxInFlight <= 3, `expected at most 3 in flight, saw ${maxInFlight}`);
});

test("mapWithLimit returns results in input order even when completion order is reversed", async () => {
  const items = [10, 20, 30, 40];
  const result = await mapWithLimit(items, 2, async (v) => {
    await delay(v === 10 ? 20 : v === 40 ? 1 : 10); // slowest first
    return v + 1;
  });
  assert.deepEqual(result, [11, 21, 31, 41], "results must stay in input order");
});

test("mapWithLimit handles an empty input and a limit above the item count", async () => {
  assert.deepEqual(await mapWithLimit([], 4, async () => 1), []);
  const out = await mapWithLimit(["a", "b"], 10, async (v) => v.toUpperCase());
  assert.deepEqual(out, ["A", "B"]);
});

test("mapWithLimit propagates a rejection like Promise.all", async () => {
  await assert.rejects(
    mapWithLimit([1, 2, 3], 2, async (v) => {
      if (v === 2) throw new Error("boom");
      return v;
    }),
    /boom/,
  );
});
