import { test } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLE_INTENT } from "./example";
import { DEFAULT_MODEL, LlmError, llmIntent } from "./llm";

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
  process.env.OPENROUTER_API_KEY = "test-key";
  delete process.env.OPENROUTER_MODEL;
  const { impl, calls } = fakeFetch([JSON.stringify(EXAMPLE_INTENT)]);
  const intent = await llmIntent("4 вокала…", impl);
  assert.deepEqual(intent.sources, EXAMPLE_INTENT.sources);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].body.model, DEFAULT_MODEL);
  assert.equal((calls[0].body.response_format as { type: string }).type, "json_schema");
  assert.equal(calls[0].body.temperature, 0);
});

test("llm: one repair retry with the validation error, then gives up", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  const ok = fakeFetch(['```json\n{"sources":[]}\n```', JSON.stringify(EXAMPLE_INTENT)]);
  await llmIntent("x", ok.impl);
  assert.equal(ok.calls.length, 2);
  assert.match(String((ok.calls[1].body.messages as { content: string }[])[1].content), /не прошёл проверку/);
  const bad = fakeFetch(["not json", '{"sources":[{"kind":"banjo","count":1}]}']);
  await assert.rejects(llmIntent("x", bad.impl), LlmError);
});

test("llm: refuses without a key", async () => {
  delete process.env.OPENROUTER_API_KEY;
  await assert.rejects(llmIntent("x"), /OPENROUTER_API_KEY/);
});
