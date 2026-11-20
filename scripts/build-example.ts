// Build the ТЗ example and the user's test request against fixtures/baseline.snap into examples/
// for a manual check in WING EDIT. Usage: npm run example
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { validateBaseline } from "../lib/baseline";
import { EXAMPLE_INTENT, EXAMPLE_TEXT } from "../lib/example";
import { IntentSchema, type Intent } from "../lib/intent";
import { buildReport } from "../lib/report";
import { expand } from "../lib/scene";
import { apply, compile, diff, inputLabels, summarize } from "../lib/wing";
import { USER_TEST_EXPECT, USER_TEST_TEXT } from "./eval-cases";

const raw = readFileSync("fixtures/baseline.snap", "utf8");
const base = JSON.parse(raw);
mkdirSync("examples", { recursive: true });

const variants: [string, Intent, string][] = [
  ["example", EXAMPLE_INTENT, EXAMPLE_TEXT],
  ["example_user1", { ...EXAMPLE_INTENT, pages: [{ sources: ["vocal"], buses: true, dca: true }] }, `${EXAMPLE_TEXT} Вокалы, шины и DCA на USER 1.`],
  ["user_test", IntentSchema.parse({ monitors: [], fx: [], stream: false, ...USER_TEST_EXPECT }), USER_TEST_TEXT],
];
for (const [name, intent, text] of variants) {
  const scene = expand(intent, text);
  const snap = apply(raw, compile(scene, base));
  const summary = summarize(diff(raw, snap));
  const report = buildReport({ baselineName: "Baseline.snap", baseline: validateBaseline(raw), snap: base, scene, summary, conn: inputLabels(scene, base), generatedAt: new Date() });
  writeFileSync(`examples/Baseline_generated_${name}.snap`, snap);
  writeFileSync(`examples/Baseline_generated_${name}_report.md`, report);
  writeFileSync(`examples/Baseline_generated_${name}_scene.json`, JSON.stringify(scene, null, 2));
  console.log(name, summary.byKind, summary.guards.filter((g) => g.count).map((g) => g.label), `outside: ${summary.outsideAllowlist.length}`);
}
