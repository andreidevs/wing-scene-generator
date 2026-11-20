// Optional LLM parsing through OpenRouter, called by the server route (app/api/llm) with the owner's
// key from OPENROUTER_API_KEY. Without the key the local parser (lib/parse.ts) is the only option.
// The model only classifies the request into the same Intent the parser produces — everything after
// that (channels, presets, buses, the .snap patch) is the same deterministic code.

import { z } from "zod";
import { FX_KINDS, IntentSchema, LEVEL_TARGETS, MONITOR_MIXES, SOURCE_KINDS, type Intent } from "./intent";
import { parseRequest } from "./parse";
import { sigKey } from "./signature";

// Chosen by `npm run eval` over 51 scenes and 10 models (2026-11): xiaomi/mimo-v2.6-flash was the most
// accurate and stable (36/36 + 15/15 in most runs) at ≈$0.15 per 1000 requests. The fallback is the
// runner-up from another vendor; OpenRouter switches to it if the first model fails.
export const DEFAULT_MODEL = "xiaomi/mimo-v2.6-flash";
const FALLBACK_MODEL = "deepseek/deepseek-v4.1-flash-1017";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// Worked examples for the prompt, produced by the local parser so they always match the schema and
// the parser's conventions. None of these texts are in the evaluation set (scripts/eval-cases.ts).
const EXAMPLE_REQUESTS = [
  "Рок-квартет: кик, снейр, 2 тома, оверы, бас, гитара, 3 вокала. Барабанщику: кик и бас. Реверб на вокал, стрим.",
  "Акустика и вокал. Вокалистке ушной монитор. Вокал -8 дб.",
  "Конференция: 3 петлички, ноутбук стерео. Ничего не мьютить.",
  "Two vocals, keys in stereo, bass, drums. In-ear mixes for everyone. Delay on vocals.",
];
const examples = () =>
  EXAMPLE_REQUESTS.map((t) => `Запрос: ${t}\nJSON: ${JSON.stringify(parseRequest(t).intent)}`).join("\n\n");

export const SYSTEM_PROMPT = `Ты разбираешь запрос звукорежиссёра (русский или английский) на сцену для пульта Behringer WING и возвращаешь JSON по схеме.
Номера каналов, HPF по умолчанию, цвета, шины, уровни по умолчанию (-18 dB) и mute по умолчанию задаёт код — ты только переводишь текст в поля.

ГЛАВНОЕ ПРАВИЛО: заполняй только то, что прямо сказано в запросе. Чего нет в тексте — оставь пустым ([] или false).
Не добавляй инструменты, бэк-вокал, мониторы, in-ear, эффекты, стрим, уровни, HPF/компрессию/гейт, unmute и страницы «на всякий случай».

sources — инструменты и микрофоны, kind ∈ ${SOURCE_KINDS.join(", ")}, drum_kit.
- "барабаны/ударные/ударка" без перечисления → drum_kit (count 1). Если части перечислены (кик, снейр, хэт, томы, оверы) — только части, без drum_kit.
  "полная ударка" → kick 1, snare 1, hihat 1, tom 3, overhead 2.
- count — число перед словом или после ("хор на 6 микрофонов" → choir 6, "вокал x3" → 3). Без числа — 1; "оверы"/"тарелки" — 2.
  "стерео" у keys, playback, dj, sampler, accordion, ambience — 2 канала. Число относится только к ближайшему слову ("2 вокала и акустика" → vocal 2, ac_guitar 1).
- Исполнитель в именительном падеже = его инструмент: трубач → trumpet, саксофонист → sax, басист → bass, гитарист → e_guitar,
  клавишник/пианист → keys, скрипач → violin, барабанщик → drum_kit; "поёт/поют" → vocal (каждый поющий — 1 vocal).
- бэк-вокал/бэки/подпевка → backvocal; лид/основной вокал/солист → vocal;
  ведущий/спикер/пастор/MC/конферансье/радиомикрофон/петличка/lavalier/handheld → speech ("микрофон для MC" — это speech, не vocal);
  альт (струнный инструмент) → violin: "2 скрипки, альт" → violin 3; "струнный квартет" без перечисления → violin 3, cello 1;
  микрофоны на зал/ambience → ambience; кларнет/гобой/фагот → winds; туба/валторна → horn; укулеле/мандолина/банджо → ac_guitar;
  SPD/сэмплер/драм-машина → sampler; ноутбук/минус/фонограмма/трек → playback; губная гармошка → harmonica; аккордеон/баян → accordion.
- "Акустический сет/концерт" — формат, не инструмент. "по одному микрофону" — не отдельный вокал.
- Опечатки исправляй по смыслу ("вакал" → vocal, "барабны" → drum_kit).

monitors — только если просят мониторы. for ∈ ${MONITOR_MIXES.join(", ")}.
- Адресат в дательном падеже или "для …": вокалистам/вокалисту → vocals, барабанщику → drummer, басисту → bass, гитаристу → guitar,
  клавишнику → keys, духовым/трубачу/саксофонисту → brass, скрипачу/струнным → strings.
- contains — только явно перечисленное для этого микса ("барабанщику кик и снейр" → ["kick","snare"]), иначе [].
- iem: true только при словах "ушные", "в уши", "in-ear", "IEM", "наушники"; иначе false.
- "мониторы всем/обоим/каждому" → по миксу каждому семейству из состава (вокал → vocals, барабаны → drummer, бас → bass, гитары → guitar, клавиши → keys, духовые → brass, струнные → strings).

fx (${FX_KINDS.join(", ")}) — только если сказано: "реверб" → vocal_reverb, реверб на барабаны → drum_reverb, дилей/эхо → delay. "Без реверба" → ничего.
  Какие каналы идут в эффект, по умолчанию решает код (в реверб барабанов — снейр и томы, в вокальный — вокал, хор, акустика, духовые).
  Поэтому "реверб на вокал/барабаны/духовые/хор" — только fx, БЕЗ sendTo. sendTo пиши только для инструмента, который так не входит
  в эффект по умолчанию и назван прямо: "дилей на сакс" → sax sendTo delay, "реверб на гитару" → e_guitar sendTo vocal_reverb,
  "реверб на бочку" → kick sendTo drum_reverb.
stream: true только при словах стрим/трансляция/эфир/запись/YouTube или уровне "в стрим".

levels — только при явном уровне. target ∈ ${LEVEL_TARGETS.join(", ")}. "погромче" -12, "намного громче" -6, "потише" -24, "еле слышно" -40, "в ноль" 0, "-10 дб" → -10.
  Без указания куда — target "fader". "барабанщику кик погромче" → monitor_drummer.
  Уровень относится ко ВСЕМ инструментам из этой фразы: "клик и бас погромче" → sources ["click","bass"].
settings — только для названных инструментов: hpf (Гц), comp, gate (true/false; "без компрессии" → false), sendTo (FX конкретным: "дилей на сакс" → sax sendTo delay).
unmute — только при "не мьютить/открыть"; mute — что явно закрыть ("кроме клика"). "Ничего не мьютить" → unmute ["all"].
pages — только если просят USER 1 / USER 2. sources — только инструменты, названные в самой фразе про страницу ("вокалы … на USER 1" → ["vocal"]),
  не весь состав; "мониторы/шины" в этой фразе → buses true, "DCA" → dca true. "все каналы на USER 1" → ["all"].
Фантом, гейн, EQ, панораму, выходы и роутинг не отражай в JSON.

Примеры:

${examples()}`;

export class LlmError extends Error {}

const schema = z.toJSONSchema(IntentSchema, { io: "input" });

// Some models wrap JSON in ``` fences even with response_format.
const unfence = (s: string) => s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

export type LlmOptions = { model?: string; system?: string; fetchImpl?: typeof fetch };

export async function llmIntent(text: string, key: string, opts: LlmOptions = {}): Promise<Intent> {
  const { model = DEFAULT_MODEL, system = SYSTEM_PROMPT, fetchImpl = fetch } = opts;
  if (!key.trim()) throw new LlmError("Нужен ключ OpenRouter");
  let problem = "";
  // A hung provider (timeout) or dropped connection is retried once on the fallback model directly.
  const post = async (user: string) => {
    try {
      return await request(user, model);
    } catch (e) {
      if (e instanceof LlmError || model === FALLBACK_MODEL) throw e;
      return request(user, FALLBACK_MODEL);
    }
  };
  const request = (user: string, m: string) =>
    fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json", "X-Title": "WING Scene Generator" },
      body: JSON.stringify({
        model: m,
        models: [...new Set([m, FALLBACK_MODEL])],
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name: "intent", strict: false, schema } },
        provider: { require_parameters: true }, // only route to providers that honor response_format
        temperature: 0,
        max_tokens: 3000,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  for (let attempt = 0; attempt < 2; attempt++) {
    const user = problem ? `${text}\n\nПредыдущий ответ не прошёл проверку схемы: ${problem}\nИсправь и верни валидный JSON.` : text;
    const res = await post(user);
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

// ---------------------------------------------------------------- voting
// One model call is right ~97% of the time; its misses are random (a different scene each run).
// So: compare it with the local parser. Same scene → done (1 call). Different → 2 more calls in
// parallel and the scene with the most votes among {parser, call 1, call 2, call 3} wins.
export type VoteResult = { intent: Intent; calls: number; agreed: boolean; parserOnly?: true };

export async function voteIntent(text: string, key: string, opts: LlmOptions = {}): Promise<VoteResult> {
  let parsed: Intent | null = null;
  try {
    parsed = parseRequest(text).intent;
  } catch {} // parser found no sources — only the model votes
  let first: Intent;
  try {
    first = await llmIntent(text, key, opts);
  } catch (e) {
    // OpenRouter down or both models failed: the local parser's scene is still a valid answer.
    if (parsed && !(e instanceof LlmError && /ключ/.test(e.message))) return { intent: parsed, calls: 0, agreed: false, parserOnly: true };
    throw e;
  }
  if (parsed && sigKey(parsed) === sigKey(first)) return { intent: first, calls: 1, agreed: true };

  const more = await Promise.allSettled([llmIntent(text, key, opts), llmIntent(text, key, opts)]);
  const models = [first, ...more.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))];
  const tally = new Map<string, { intent: Intent; votes: number; model: number }>();
  for (const [i, intent] of [...models, ...(parsed ? [parsed] : [])].entries()) {
    const k = sigKey(intent);
    const t = tally.get(k) ?? { intent, votes: 0, model: 0 };
    t.votes++;
    if (i < models.length) t.model++;
    tally.set(k, t);
  }
  // Most votes wins; on a tie the scene more model calls agree on, then the first call.
  const best = [...tally.values()].sort((a, b) => b.votes - a.votes || b.model - a.model)[0];
  return { intent: best.intent, calls: models.length, agreed: false };
}
