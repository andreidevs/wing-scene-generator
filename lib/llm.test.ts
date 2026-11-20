import { test } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLE_INTENT, EXAMPLE_TEXT } from "./example";
import { DEFAULT_MODEL, LlmError, llmIntent, voteIntent } from "./llm";
import { parseRequest } from "./parse";

// No network: a fake fetch returns canned OpenRouter responses.
function fakeFetch(replies: string[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const content = replies.shift() ?? "{}";
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("llm: sends the cheap model + JSON schema, returns a validated intent", async () => {
  const { impl, calls } = fakeFetch([JSON.stringify(EXAMPLE_INTENT)]);
  const intent = await llmIntent("4 вокала…", "test-key", { fetchImpl: impl });
  assert.deepEqual(intent.sources, EXAMPLE_INTENT.sources);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].body.model, DEFAULT_MODEL);
  assert.equal((calls[0].body.response_format as { type: string }).type, "json_schema");
  assert.equal(calls[0].body.temperature, 0);
  assert.deepEqual(calls[0].body.models, [DEFAULT_MODEL, "deepseek/deepseek-v4.1-flash-1017"]);
});

test("llm: one repair retry with the validation error, then gives up", async () => {
  const ok = fakeFetch(['```json\n{"sources":[]}\n```', JSON.stringify(EXAMPLE_INTENT)]);
  await llmIntent("x", "test-key", { fetchImpl: ok.impl });
  assert.equal(ok.calls.length, 2);
  assert.match(String((ok.calls[1].body.messages as { content: string }[])[1].content), /не прошёл проверку/);
  const bad = fakeFetch(["not json", '{"sources":[{"kind":"banjo","count":1}]}']);
  await assert.rejects(llmIntent("x", "test-key", { fetchImpl: bad.impl }), LlmError);
});

test("llm: refuses without a key", async () => {
  await assert.rejects(llmIntent("x", "  "), /ключ/);
});

const PARSED = JSON.stringify(parseRequest(EXAMPLE_TEXT).intent);

test("vote: model agrees with the parser → one call", async () => {
  const { impl, calls } = fakeFetch([PARSED]);
  const r = await voteIntent(EXAMPLE_TEXT, "test-key", { fetchImpl: impl });
  assert.equal(r.calls, 1);
  assert.equal(r.agreed, true);
  assert.equal(calls.length, 1);
});

test("vote: a random model slip is outvoted by two more calls and the parser", async () => {
  const slip = JSON.stringify({ ...EXAMPLE_INTENT, sources: [{ kind: "vocal", count: 1 }] });
  const { impl, calls } = fakeFetch([slip, PARSED, PARSED]);
  const r = await voteIntent(EXAMPLE_TEXT, "test-key", { fetchImpl: impl });
  assert.equal(calls.length, 3);
  assert.equal(r.agreed, false);
  assert.deepEqual(r.intent.sources, EXAMPLE_INTENT.sources, "majority scene wins");
});

test("llm: a timeout is retried once on the fallback model", async () => {
  const calls: string[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body.model);
    if (calls.length === 1) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(EXAMPLE_INTENT) } }] }));
  }) as unknown as typeof fetch;
  await llmIntent("x", "test-key", { fetchImpl: impl });
  assert.deepEqual(calls, [DEFAULT_MODEL, "deepseek/deepseek-v4.1-flash-1017"]);
});

test("vote: OpenRouter down → the parser's scene is returned instead of an error", async () => {
  const impl = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const r = await voteIntent(EXAMPLE_TEXT, "test-key", { fetchImpl: impl });
  assert.equal(r.parserOnly, true);
  assert.equal(r.intent.sources.length, parseRequest(EXAMPLE_TEXT).intent.sources.length);
});
