// Optional LLM parsing through OpenRouter, called by the server route (app/api/llm) with the owner's
// key from OPENROUTER_API_KEY. Without the key the local parser (lib/parse.ts) is the only option.
// The model only classifies the request into the same Intent the parser produces — everything after
// that (channels, presets, buses, the .snap patch) is the same deterministic code.

import { z } from "zod";
import { FX_KINDS, IntentSchema, LEVEL_TARGETS, MONITOR_MIXES, SOURCE_KINDS, type Intent } from "./intent";
import { parseRequest, recordIn } from "./parse";
import { expand, resolveRef } from "./scene";
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
// A detailed-layout example, written by hand (the rule parser does not do layouts). Not in the eval sets.
const LAYOUT_EXAMPLE = {
  text: "Каналы: Vox1 - 3 и Host, потом бас, клавиши (стерео), место под 1 канал, толкбэк. Main1 — Зал, Main2 — Сабы. Ушные миксы InEarBass, InEarKeys и 2 вокальных InEarVox1 - 2: все каналы, у каждого свой в 0. Группа вокала — все вокалы. Матрица стрим, реверб на вокал.",
  intent: {
    sources: [],
    channels: [
      { kind: "vocal", label: "Vox{n}", count: 3, stereo: false },
      { kind: "speech", label: "Host", count: 1, stereo: false },
      { kind: "bass", count: 1, stereo: false },
      { kind: "keys", count: 1, stereo: true },
      { kind: "reserve", count: 1, stereo: false },
      { kind: "talkback", count: 1, stereo: false },
    ],
    mixes: [
      { name: "InEarBass", iem: true, contains: ["all"], own: ["bass"] },
      { name: "InEarKeys", iem: true, contains: ["all"], own: ["keys"] },
      { name: "InEarVox1", iem: true, contains: ["all"], own: ["Vox1"] },
      { name: "InEarVox2", iem: true, contains: ["all"], own: ["Vox2"] },
    ],
    groups: [{ name: "Vocal Group", members: ["vocal"], except: [] }],
    mains: [{ main: 1, name: "Hall" }, { main: 2, name: "Subs" }],
    monitors: [], fx: ["vocal_reverb"], stream: true, streamVia: "matrix",
    levels: [], unmute: [], mute: [], settings: [], pages: [],
  },
};

const examples = () =>
  [
    ...EXAMPLE_REQUESTS.map((t) => `Запрос: ${t}\nJSON: ${JSON.stringify(parseRequest(t).intent)}`),
    `Запрос: ${LAYOUT_EXAMPLE.text}\nJSON: ${JSON.stringify(LAYOUT_EXAMPLE.intent)}`,
  ].join("\n\n");

export const SYSTEM_PROMPT = `Ты разбираешь запрос звукорежиссёра (русский или английский) на сцену для пульта Behringer WING и возвращаешь JSON по схеме.
Номера каналов, HPF по умолчанию, цвета, шины, уровни по умолчанию (-18 dB) и mute по умолчанию задаёт код — ты только переводишь текст в поля.

ГЛАВНОЕ ПРАВИЛО: заполняй только то, что прямо сказано в запросе. Чего нет в тексте — оставь пустым ([] или false).
Не добавляй инструменты, бэк-вокал, мониторы, in-ear, эффекты, стрим, уровни, HPF/компрессию/гейт, unmute и страницы «на всякий случай».

sources — инструменты и микрофоны, kind ∈ ${SOURCE_KINDS.join(", ")}, drum_kit.
- "барабаны/ударные/ударка" без перечисления → drum_kit (count 1). Если части перечислены (кик, снейр, хэт, томы, оверы) — только части, без drum_kit.
  "полная ударка" → kick 1, snare 1, hihat 1, tom 3, overhead 2.
- count — число перед словом или после ("хор на 6 микрофонов" → choir 6, "вокал x3" → 3). Без числа — 1; "оверы"/"тарелки" — 2.
  "стерео" у keys, playback, dj, sampler, accordion, e_guitar — ОДИН канал {count:1, stereo:true} (на WING стерео — один канал на паре входов). Без слова "стерео" stereo:false. Число относится только к ближайшему слову ("2 вокала и акустика" → vocal 2, ac_guitar 1).
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
  streamVia: "matrix", если стрим назван матрицей ("матрица стрим", "стрим через матрицу", "Stream matrix"); иначе "bus".

levels — только при явном уровне. target ∈ ${LEVEL_TARGETS.join(", ")}. "погромче" -12, "намного громче" -6, "потише" -24, "еле слышно" -40, "в ноль" 0, "-10 дб" → -10.
  Без указания куда — target "fader". "барабанщику кик погромче" → monitor_drummer.
  Уровень относится ко ВСЕМ инструментам из этой фразы: "клик и бас погромче" → sources ["click","bass"].
settings — только для названных инструментов: hpf (Гц), comp, gate (true/false; "без компрессии" → false), sendTo (FX конкретным: "дилей на сакс" → sax sendTo delay).
unmute — только при "не мьютить/открыть"; mute — что явно закрыть ("кроме клика"). "Ничего не мьютить" → unmute ["all"].
pages — только если просят USER 1 / USER 2. sources — только инструменты, названные в самой фразе про страницу ("вокалы … на USER 1" → ["vocal"]),
  не весь состав; "мониторы/шины" в этой фразе → buses true, "DCA" → dca true. "все каналы на USER 1" → ["all"].
Фантом, гейн, EQ, панораму, выходы и роутинг не отражай в JSON. Исключение — запись:
record.usb true — "выходы всех каналов на USB для записи" / мультитрек в DAW; record.card true — запись каналов на флешку/SD,
встроенный рекордер, WING-LIVE. "Запись стрима/эфира" без USB/флешки — это stream, не record.

ДЕТАЛЬНАЯ РАСКЛАДКА — только если запрос задаёт порядок/имена каналов, именованные миксы, группы, мейны или матрицу:
- channels — каналы в порядке пульта (тогда sources = []). kind; label — только явное имя канала из запроса:
  "Mic1 - 7" → {kind:"vocal", label:"Mic{n}", count:7}; "Speaker" → {kind:"speech", label:"Speaker"}. Для "Бас", "Клавиши" и т.п. label не задавай.
  stereo: true для "(стерео)" — это один стерео-канал, не L/R; электронные барабаны → sampler; "оставим место N каналов" → {kind:"reserve", count:N}.
- mixes — именованные мониторные миксы (тогда monitors = []): name как в запросе; iem true для in-ear; contains ["all"], если "все каналы";
  own — свой инструмент музыканта: kind ("sampler", "keys"…) или имя канала ("Mic1"). Для барабанщика с электронными барабанами own ["sampler"].
  Нумерованные вокальные миксы — у каждого свой микрофон по номеру: InEarVocal1 → own ["Mic1"], InEarVocal2 → ["Mic2"] (имена каналов из channels), а не все вокалы.
  Если миксов больше, чем перечислено имён ("10 миксов" и 8 имён) — добавь недостающие по образцу имён: InEar9, InEar10.
- groups — подгруппы: name латиницей, members — kinds участников, except — исключения ("кроме speaker" → ["Speaker"]).
- dcas — только если запрос перечисляет DCA: name латиницей ≤ 8 символов ("Вокал" → "Vocal", "Инструменты" → "Instr", "FX" → "FX"),
  members — kinds / имена каналов; "fx" — все шины эффектов; except — исключения ("Speaker в DCA не идёт" → не включай его).
- muteGroups — mute-группы пульта (это НЕ groups): group — номер из запроса, members/except как у groups,
  "все инструменты" → перечисли kinds инструментов из channels. name — только если задано в запросе.
- mains — имена мейнов: [{main:1,name:"Tops"},{main:2,name:"Subs"}].
- "матрица стрим" → stream true, streamVia "matrix"; обычный стрим → streamVia "bus".
- Имена шин, групп и мейнов — латиницей, коротко (≤16): "Группа вокала" → "Vocal Group", "Группа инструментов" → "Instr Group",
  "Топы" → "Tops", "Сабы" → "Subs". Имена, уже написанные латиницей (InEarDrums), оставляй как есть.

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
        max_tokens: 6000, // detailed layouts are long JSON
      }),
      signal: AbortSignal.timeout(45_000),
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
    if (parsed.success) return repair(text, parsed.data);
    problem = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  throw new LlmError(`Модель не вернула валидную сцену: ${problem}`);
}

// ---------------------------------------------------------------- deterministic repairs
// Things the text states unambiguously but models keep getting wrong; fixed in code after the model.
const STREAM_MATRIX = /(?:матриц\p{L}*\s+(?:для\s+)?стрим\p{L}*|стрим\p{L}*\s+(?:через\s+|в\s+)?матриц\p{L}*|stream\s+matrix|matrix\s+(?:for\s+)?stream)/iu;

const MIX_COUNT = /(\d{1,2})\s+(?:in-?ear|инир\p{L}*|ушн\p{L}*|мониторн\p{L}*|iem)?\s*микс/iu;
const commonPrefix = (names: string[]) =>
  names.reduce((p, n) => {
    let i = 0;
    while (i < p.length && i < n.length && p[i] === n[i]) i++;
    return p.slice(0, i);
  });

export function repair(text: string, intent: Intent): Intent {
  const out: Intent = { ...intent, mixes: intent.mixes.map((m) => ({ ...m })) };
  // "Матрица стрим" → the stream is a matrix fed from Main 1, not a bus.
  if (STREAM_MATRIX.test(text)) {
    out.stream = true;
    out.streamVia = "matrix";
  }
  // Recording outputs: the model often drops them; the parser's sentence rules catch the usual phrasing.
  for (const sentence of text.split(/[.;!?\n]+/)) {
    const rec = recordIn(sentence);
    if (rec) out.record = { usb: out.record.usb || rec.usb, card: out.record.card || rec.card };
  }
  // Channel names only when the request spells them (Latin, verbatim: "Mic1 - 7" → Mic{n}, "Speaker");
  // invented ones ("Аккустика 2", "Acoustic2") fall back to the preset names ("Ac 1", "Ac 2").
  const lowered = text.toLowerCase();
  out.channels = out.channels.map((c) => {
    if (!c.label) return c;
    const stem = c.label.replace("{n}", "").trim().toLowerCase();
    const spelled = /^[\x20-\x7e]+$/.test(c.label) && stem.length > 0 && lowered.includes(stem);
    return spelled ? c : { ...c, label: undefined };
  });
  // A mix with no channels is never what was asked: an empty `contains` means "all channels".
  for (const m of out.mixes) if (!m.contains.length) m.contains = ["all"];
  // "10 InEar миксов" with fewer returned → add the missing ones named like the others (InEar9, InEar10).
  const wanted = Number(MIX_COUNT.exec(text)?.[1] ?? 0);
  if (wanted > out.mixes.length && out.mixes.length && wanted <= 16) {
    const prefix = commonPrefix(out.mixes.map((m) => m.name)) || "Mix";
    const iem = out.mixes.some((m) => m.iem);
    for (let k = out.mixes.length + 1; k <= wanted; k++) {
      const name = `${prefix}${k}`.slice(0, 16);
      if (!out.mixes.some((m) => m.name === name)) out.mixes.push({ name, iem, contains: ["all"], own: [] });
    }
  }
  // Numbered vocal mixes ("InEarVocal2") that got "all vocals" as their own channel → the N-th vocal channel.
  if (out.channels.length) {
    const channels = expand(out).channels;
    // An `own` that names no channel ("Acoustic", "Аккустика") → the source kind the parser's vocabulary reads in it.
    for (const m of out.mixes) {
      m.own = m.own.flatMap((ref) => {
        if (ref === "all" || resolveRef(ref, channels).length) return [ref];
        try {
          return parseRequest(ref).intent.sources.map((s) => s.kind).filter((k) => channels.some((c) => c.kind === k));
        } catch {
          return [ref];
        }
      });
    }
    const vocals = channels.filter((c) => c.kind === "vocal");
    for (const m of out.mixes) {
      const n = /(?:vocal|vox|вокал)\D*(\d+)$/i.exec(m.name)?.[1];
      if (n && vocals[Number(n) - 1] && m.own.length === 1 && m.own[0] === "vocal") m.own = [vocals[Number(n) - 1].label];
    }
  }
  return out;
}

// ---------------------------------------------------------------- voting
// One model call is right ~97% of the time; its misses are random (a different scene each run).
// So: compare it with the local parser. Same scene → done (1 call). Different → 2 more calls in
// parallel and the scene with the most votes among {parser, call 1, call 2, call 3} wins (tie → parser).
// The parser votes only when it understood the whole request; detailed layouts it can't read get
// three parallel model calls and a majority among them.
export type VoteResult = { intent: Intent; calls: number; agreed: boolean; parserOnly?: true };

export async function voteIntent(text: string, key: string, opts: LlmOptions = {}): Promise<VoteResult> {
  let parsed: Intent | null = null;
  try {
    const r = parseRequest(text);
    if (!r.unknown.length) parsed = r.intent; // a parser that didn't understand everything gets no vote
  } catch {} // parser found no sources — only the model votes
  if (!parsed) {
    // Detailed requests the parser can't read: three model calls at once, majority wins.
    const runs = await Promise.allSettled([llmIntent(text, key, opts), llmIntent(text, key, opts), llmIntent(text, key, opts)]);
    const models = runs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!models.length) throw (runs[0] as PromiseRejectedResult).reason;
    return { intent: majority(models, []), calls: models.length, agreed: false };
  }
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
  return { intent: majority(models, [parsed]), calls: models.length, agreed: false };
}

// The scene with the most votes. On a tie the parser's scene wins (it only votes when it understood the
// whole request, and it is exact on every evaluation scene), then the first model call.
function majority(models: Intent[], parser: Intent[]): Intent {
  const tally = new Map<string, { intent: Intent; votes: number; parser: boolean; first: number }>();
  [...models, ...parser].forEach((intent, i) => {
    const k = sigKey(intent);
    const t = tally.get(k) ?? { intent, votes: 0, parser: false, first: i };
    t.votes++;
    if (i >= models.length) t.parser = true;
    tally.set(k, t);
  });
  return [...tally.values()].sort((a, b) => b.votes - a.votes || Number(b.parser) - Number(a.parser) || a.first - b.first)[0].intent;
}
