// Build the ТЗ example against fixtures/baseline.snap into examples/ for a manual check in WING EDIT.
// Usage: npm run example
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { validateBaseline } from "../lib/baseline";
import { EXAMPLE_INTENT, EXAMPLE_TEXT } from "../lib/example";
import type { Intent } from "../lib/intent";
import { buildReport } from "../lib/report";
import { expand } from "../lib/scene";
import { apply, compile, diff, summarize } from "../lib/wing";

const raw = readFileSync("fixtures/baseline.snap", "utf8");
const base = JSON.parse(raw);
const conn = Object.fromEntries(
  Object.entries(base.ae_data.ch as Record<string, { in: { conn: { grp: string; in: number } } }>).map(([n, c]) => [Number(n), `${c.in.conn.grp}${c.in.conn.in}`]),
);
mkdirSync("examples", { recursive: true });

const variants: [string, Intent, string][] = [
  ["example", EXAMPLE_INTENT, EXAMPLE_TEXT],
  ["example_user1", { ...EXAMPLE_INTENT, pages: [{ sources: ["vocal"], buses: true, dca: true }] }, `${EXAMPLE_TEXT} Вокалы, шины и DCA на USER 1.`],
];
for (const [name, intent, text] of variants) {
  const scene = expand(intent, text);
  const snap = apply(raw, compile(scene, base));
  const summary = summarize(diff(raw, snap));
  writeFileSync(`examples/Baseline_generated_${name}.snap`, snap);
  writeFileSync(`examples/Baseline_generated_${name}_report.md`, buildReport({ baselineName: "Baseline.snap", baseline: validateBaseline(raw), scene, summary, conn, generatedAt: new Date() }));
  console.log(name, summary.byKind, summary.guards.filter((g) => g.count).map((g) => g.label), `outside: ${summary.outsideAllowlist.length}`);
}
