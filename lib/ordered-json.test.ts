import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getNode, parseOrdered, replaceNode, serialize, fromValue } from "./ordered-json";

for (const f of ["fixtures/baseline.snap", "fixtures/show-working.snap"]) {
  test(`${f}: parse → serialize is byte-identical`, () => {
    const raw = readFileSync(f, "utf8");
    assert.equal(serialize(parseOrdered(raw)), raw);
    assert.notEqual(JSON.stringify(JSON.parse(raw)), raw, "JSON.parse reorders keys — the reason this module exists");
  });
}

test("replaceNode keeps key position and refuses unknown paths", () => {
  const root = parseOrdered('{"b":1,"1":{"x":2.50},"a":true}');
  replaceNode(root, ["1", "x"], fromValue(3));
  assert.equal(serialize(root), '{"b":1,"1":{"x":3},"a":true}');
  assert.throws(() => replaceNode(root, ["1", "nope"], fromValue(1)), /not in baseline/);
  assert.equal(getNode(root, ["a"])?.k, "raw");
});

test("rejects malformed input", () => {
  assert.throws(() => parseOrdered('{"a":1,}'));
  assert.throws(() => parseOrdered('{"a":1} x'));
});
