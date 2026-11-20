// Explore a WING snapshot before trusting any assumption about its format.
// Usage: npm run inspect -- [file] [--grep regex] [--all]
// Prints: encoding, root keys, then every leaf path with array/numeric keys
// collapsed to `#`, its value types, occurrence count and up to 5 sample values.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const showAll = args.includes("--all");
const grep = new RegExp(
  flag("--grep") ??
    "name|col|filter|hpf|lc|dyn|comp|gate|send|dca|ver|firm|model|type|on$|lvl|mute|in/|src|conn",
  "i",
);
const file = args.find((a) => !a.startsWith("--")) ?? "fixtures/baseline.snap";

const buf = readFileSync(file);
const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
console.log(`file: ${file}\nsize: ${buf.length} bytes\nUTF-8 BOM: ${bom}`);

let snap: unknown;
try {
  snap = JSON.parse(buf.toString("utf8").replace(/^﻿/, ""));
} catch (e) {
  console.log(`NOT plain JSON: ${(e as Error).message}`);
  console.log("first 256 bytes (hex):", buf.subarray(0, 256).toString("hex"));
  process.exit(1);
}

console.log("root keys:", Object.keys(snap as object));
for (const [k, v] of Object.entries(snap as object)) {
  if (typeof v !== "object" || v === null) console.log(`  ${k} = ${JSON.stringify(v)}`);
}

type Shape = { types: Set<string>; samples: Set<string>; count: number };
const shapes = new Map<string, Shape>();

function walk(v: unknown, path: string[]) {
  if (v !== null && typeof v === "object") {
    for (const [k, c] of Object.entries(v)) walk(c, [...path, /^\d+$/.test(k) ? "#" : k]);
    return;
  }
  const key = "/" + path.join("/");
  const s = shapes.get(key) ?? { types: new Set(), samples: new Set(), count: 0 };
  s.types.add(v === null ? "null" : typeof v);
  if (s.samples.size < 5) s.samples.add(JSON.stringify(v));
  s.count++;
  shapes.set(key, s);
}
walk(snap, []);

const rows = [...shapes].filter(([k]) => showAll || grep.test(k)).sort(([a], [b]) => a.localeCompare(b));
console.log(`\nleaf paths: ${shapes.size} total, ${rows.length} shown${showAll ? "" : ` (filter ${grep})`}\n`);
for (const [k, s] of rows) {
  console.log(`${k}  [${[...s.types].join("|")}] x${s.count}  e.g. ${[...s.samples].join(", ")}`);
}
