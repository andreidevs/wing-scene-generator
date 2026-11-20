// Evaluate text → intent on scripts/eval-cases.ts, for the local parser and/or OpenRouter models.
// Scores the resulting scene field by field, so equivalent intents count as equal.
//
//   npm run eval -- --parser                          # local parser only (free, offline)
//   npm run eval -- --models mistralai/mistral-nemo,openai/gpt-oss-20b [--verbose] [--cases tz,typos]
//   npm run eval -- --models xiaomi/mimo-v2.6-flash --vote [--holdout]   # parser + model voting, as in production
//
// The OpenRouter key is read from .env.local (OPENROUTER_API_KEY) and never printed.

import type { Intent } from "../lib/intent";
import { llmIntent, voteIntent } from "../lib/llm";
import { parseRequest } from "../lib/parse";
import { CASES, CASES_HOLDOUT } from "./eval-cases";
import { FIELDS, score } from "../lib/signature";

try {
  process.loadEnvFile(".env.local");
} catch {}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const verbose = process.argv.includes("--verbose");
const onlyCases = arg("cases")?.split(",");
const cases = (process.argv.includes("--holdout") ? CASES_HOLDOUT : CASES).filter((c) => !onlyCases || onlyCases.includes(c.id));

// ---------------------------------------------------------------- runners
type Run = { id: string; intent: Intent | null; error?: string; ms: number; cost: number; tokens: number };

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

async function runModel(model: string): Promise<Run[]> {
  const key = process.env.OPENROUTER_API_KEY ?? "";
  return pool(cases, Number(arg("concurrency") ?? 6), async (c): Promise<Run> => {
    let cost = 0;
    let tokens = 0;
    // Wrap fetch to read OpenRouter's usage block (tokens, cost) without touching lib/llm.ts.
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      body.usage = { include: true };
      const res = await fetch(url, { ...init, body: JSON.stringify(body) });
      // Read the body once and hand llmIntent a fresh Response (clone() can fail on aborted/odd streams).
      const text = await res.text();
      let json: { usage?: { cost?: number; total_tokens?: number } } | null = null;
      try {
        json = JSON.parse(text);
      } catch {}
      cost += json?.usage?.cost ?? 0;
      tokens += json?.usage?.total_tokens ?? 0;
      return new Response(text, { status: res.status, headers: res.headers });
    }) as typeof fetch;
    const t0 = Date.now();
    try {
      const intent = process.argv.includes("--vote")
        ? (await voteIntent(c.text, key, { model, fetchImpl })).intent
        : await llmIntent(c.text, key, { model, fetchImpl });
      return { id: c.id, intent, ms: Date.now() - t0, cost, tokens };
    } catch (e) {
      return { id: c.id, intent: null, error: (e as Error).message, ms: Date.now() - t0, cost, tokens };
    }
  });
}

function runParser(): Run[] {
  return cases.map((c) => {
    const t0 = Date.now();
    try {
      return { id: c.id, intent: parseRequest(c.text).intent, ms: Date.now() - t0, cost: 0, tokens: 0 };
    } catch (e) {
      return { id: c.id, intent: null, error: (e as Error).message, ms: 0, cost: 0, tokens: 0 };
    }
  });
}

function report(name: string, runs: Run[]) {
  let exact = 0;
  let fields = 0;
  const lines: string[] = [];
  runs.forEach((r, i) => {
    const sc = score(cases[i], r.intent);
    if (sc.exact) exact++;
    fields += sc.ok;
    if (!sc.exact) lines.push(`  ✗ ${r.id}${r.error ? ` — ${r.error}` : ""}${verbose ? "\n      " + sc.diffs.join("\n      ") : ` (${sc.diffs.map((d) => d.split(":")[0]).join(", ")})`}`);
  });
  const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
  const cost = runs.reduce((a, r) => a + r.cost, 0);
  console.log(
    `\n${name}\n  точные сцены: ${exact}/${runs.length}  поля: ${((100 * fields) / (runs.length * FIELDS.length)).toFixed(1)}%` +
      `  медиана ${ms[Math.floor(ms.length / 2)]} мс  стоимость $${cost.toFixed(5)} (${(cost / runs.length * 1000).toFixed(3)} $/1000 запросов)`,
  );
  lines.forEach((l) => console.log(l));
  return { name, exact, fieldPct: (100 * fields) / (runs.length * FIELDS.length), cost };
}

async function main() {
  const summary: ReturnType<typeof report>[] = [];
  if (process.argv.includes("--parser")) summary.push(report("локальный парсер", runParser()));
  const models = arg("models")?.split(",") ?? [];
  if (models.length && !process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY в .env.local");
  const runs = await Promise.all(models.map(async (m) => [m, await runModel(m)] as const));
  for (const [m, r] of runs) summary.push(report(m, r));
  if (summary.length > 1) {
    console.log("\nИтог:");
    for (const s of summary.sort((a, b) => b.exact - a.exact || b.fieldPct - a.fieldPct)) {
      console.log(`  ${String(s.exact).padStart(2)}/${cases.length}  ${s.fieldPct.toFixed(1).padStart(5)}%  $${s.cost.toFixed(5)}  ${s.name}`);
    }
  }
}
main();
