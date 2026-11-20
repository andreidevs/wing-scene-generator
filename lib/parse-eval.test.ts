import { test } from "node:test";
import assert from "node:assert/strict";
import { CASES, CASES_HOLDOUT } from "../scripts/eval-cases";
import { score } from "./signature";
import { parseRequest } from "./parse";

// Regression lock: the local parser must reproduce every evaluation scene exactly.
for (const c of [...CASES, ...CASES_HOLDOUT]) {
  test(`eval scene ${c.id}`, () => {
    const s = score(c, parseRequest(c.text).intent);
    assert.ok(s.exact, s.diffs.join("\n"));
  });
}
