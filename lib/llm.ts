// Optional LLM parsing through OpenRouter, called by the server route (app/api/llm) with the owner's
// key from OPENROUTER_API_KEY. Without the key the local parser (lib/parse.ts) is the only option.
// The model only classifies the request into the same Intent the parser produces — everything after
// that (channels, presets, buses, the .snap patch) is the same deterministic code.

import { z } from "zod";
import { FX_KINDS, IntentSchema, LEVEL_TARGETS, MONITOR_MIXES, SOURCE_KINDS, type Intent } from "./intent";
import { TEMPLATES } from "./vocab";

// Cheapest OpenRouter model with structured outputs at the time of writing (≈$0.03 / 1M tokens).
// The fallback is tried by OpenRouter if the first one fails.
export const DEFAULT_MODEL = "mistralai/mistral-nemo";
const FALLBACK_MODEL = "openai/gpt-oss-20b";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM = `Ты разбираешь запрос звукорежиссёра (русский или английский) на сцену для пульта Behringer WING.
Верни только JSON по схеме. Ты лишь классифицируешь запрос — номера каналов, HPF по умолчанию, цвета, шины и routing задаёт код.

Источники (sources.kind): ${SOURCE_KINDS.join(", ")}, а также drum_kit (= "барабаны" без подробностей: кик, снейр, 2 овера).
- бэк-вокал/бэки → backvocal; ведущий/спикер/радиомикрофон/петличка → speech; микрофоны на зал/ambience → ambience;
  кларнет/гобой/фагот → winds; туба/валторна → horn; укулеле/мандолина/банджо → ac_guitar; SPD/сэмплер/драм-машина → sampler.
- count — количество; "стерео" у клавиш/плейбэка/DJ = 2 канала.
- Если названа только формация ("рок-группа", "конференция"…), разложи её на типовой состав. Известные шаблоны: ${TEMPLATES.map((t) => t.name).join(", ")}.

Мониторы (monitors): for ∈ ${MONITOR_MIXES.join(", ")}. contains — что звучит в миксе (пусто = по умолчанию).
iem: true — ушной мониторинг (in-ear, IEM, "ушные", "в уши"), false — напольные. "Мониторы всем" = микс каждому музыканту.

Эффекты (fx): ${FX_KINDS.join(", ")}. "реверб" без уточнения → vocal_reverb; реверб на барабаны → drum_reverb; дилей/эхо → delay.
stream: true, если нужен стрим/трансляция/запись.

levels — только если уровни явно названы. target ∈ ${LEVEL_TARGETS.join(", ")}. db от -60 до 10.
"погромче" = -12, "намного громче" = -6, "потише" = -24, "еле слышно" = -40, "в ноль" = 0. По умолчанию всё -18, это делает код.
sources в levels/unmute/mute/settings — список kind или "all".

unmute/mute: все каналы по умолчанию замьючены; unmute — что открыть ("вокалы не мьютить"), mute — что закрыть явно ("кроме клика").
settings: hpf (Гц, 20–2000), comp, gate (true/false), sendTo (fx-посылы конкретным источникам: "дилей на сакс").
pages: максимум 2 (USER 1, USER 2), только если просят свою страницу пульта.

Фантом, гейн, EQ, панораму, выходы и роутинг не трогай и не отражай в JSON.`;

export class LlmError extends Error {}

const schema = z.toJSONSchema(IntentSchema, { io: "input" });

// Some models wrap JSON in ``` fences even with response_format.
const unfence = (s: string) => s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

export async function llmIntent(text: string, key: string, model = DEFAULT_MODEL, fetchImpl: typeof fetch = fetch): Promise<Intent> {
  if (!key.trim()) throw new LlmError("Нужен ключ OpenRouter");
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const user = problem ? `${text}\n\nПредыдущий ответ не прошёл проверку схемы: ${problem}\nИсправь и верни валидный JSON.` : text;
    const res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json", "X-Title": "WING Scene Generator" },
      body: JSON.stringify({
        model,
        models: [...new Set([model, FALLBACK_MODEL])],
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name: "intent", strict: false, schema } },
        provider: { require_parameters: true }, // only route to providers that honor response_format
        temperature: 0,
        max_tokens: 3000,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (res.status === 401) throw new LlmError("OpenRouter отклонил ключ (401)");
    if (!res.ok) throw new LlmError(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    if (data.error) throw new LlmError(`OpenRouter: ${data.error.message ?? "ошибка"}`);
    const content = data.choices?.[0]?.message?.content ?? "";
    let json: unknown;
    try {
      json = JSON.parse(unfence(content));
    } catch {
      problem = "ответ не является JSON";
      continue;
    }
    const parsed = IntentSchema.safeParse(json);
    if (parsed.success) return parsed.data;
    problem = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  throw new LlmError(`Модель не вернула валидную сцену: ${problem}`);
}
