import { LlmError, llmEnabled, llmIntent, llmModel } from "@/lib/llm";

// Whether the optional LLM button should be shown (the key itself never leaves the server).
export function GET() {
  return Response.json({ enabled: llmEnabled(), model: llmEnabled() ? llmModel() : null });
}

export async function POST(req: Request) {
  if (!llmEnabled()) return Response.json({ error: "LLM не настроена: задай OPENROUTER_API_KEY в .env.local" }, { status: 501 });
  const body = await req.json().catch(() => null);
  const text = body?.text;
  if (typeof text !== "string" || !text.trim() || text.length > 4000) {
    return Response.json({ error: "Нужен текст запроса (до 4000 символов)" }, { status: 400 });
  }
  try {
    return Response.json({ intent: await llmIntent(text), model: llmModel() });
  } catch (e) {
    if (e instanceof LlmError) return Response.json({ error: e.message }, { status: 502 });
    if (e instanceof Error && e.name === "TimeoutError") return Response.json({ error: "OpenRouter не ответил за 45 с" }, { status: 504 });
    throw e;
  }
}
