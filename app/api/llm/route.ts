import { DEFAULT_MODEL, LlmError, voteIntent } from "@/lib/llm";

// Server-side LLM with the site owner's OpenRouter key (Vercel env OPENROUTER_API_KEY), so visitors
// can use the LLM button without a key of their own. The key never reaches the browser.
// ponytail: no per-IP rate limit; cap spend with a credit limit on the OpenRouter key instead.
// Voting can take a few model calls (each ≤45 s for long layouts, with one fallback retry).
export const maxDuration = 120;

const key = () => process.env.OPENROUTER_API_KEY ?? "";
const model = () => process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

export function GET() {
  return Response.json({ enabled: Boolean(key()), model: key() ? model() : null });
}

export async function POST(req: Request) {
  if (!key()) return Response.json({ error: "LLM на сервере не настроена (OPENROUTER_API_KEY)" }, { status: 501 });
  const body = await req.json().catch(() => null);
  const text = body?.text;
  if (typeof text !== "string" || !text.trim() || text.length > 4000) {
    return Response.json({ error: "Нужен текст запроса (до 4000 символов)" }, { status: 400 });
  }
  try {
    const { intent, calls, agreed } = await voteIntent(text, key(), { model: model() });
    return Response.json({ intent, calls, agreed });
  } catch (e) {
    if (e instanceof LlmError) return Response.json({ error: e.message }, { status: 502 });
    if (e instanceof Error && e.name === "TimeoutError") return Response.json({ error: "OpenRouter не ответил вовремя, попробуй ещё раз" }, { status: 504 });
    throw e;
  }
}
