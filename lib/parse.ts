// Local rule-based parser: Russian/English stage request → Intent. No LLM, no network, deterministic.
// Vocabulary lives in lib/vocab.ts; this file only applies it clause by clause:
//   page → mute/unmute → manual-only → level → processing → reverb/delay/stream → monitors → template → sources.
// Anything not understood goes to `unknown`, things deliberately left to the engineer go to `manual`.
// Full reference: docs/parser.md.

import { IntentSchema, MONITOR_MIXES, type Intent } from "./intent";
import { CHANNEL_PRESETS, DRUM_KINDS, FULL_DRUM_KIT, FX_ROLE, STEREO_KINDS } from "./presets";
import type { SourceKind } from "./intent";
import {
  ACTION_WORDS, AUTO_WORDS, EVERYONE_WORDS, FAMILY_MIX, FULL_KIT_WORDS, FUZZY_STEMS, FX_WORDS, IEM_WORDS, MIC_WORDS, NUM_WORDS,
  PAIR_KINDS, PAIR_PHRASE_WORDS, PER_PERFORMER_WORDS, RECIPIENT_WORDS, SOURCE_WORDS, STEREO_WORDS, TEMPLATES, UNSUPPORTED_WORDS, WEDGE_WORDS, type Template,
} from "./vocab";

type Src = Intent["sources"][number]["kind"];
type Mix = (typeof MONITOR_MIXES)[number];
type Level = Intent["levels"][number];
type Setting = Intent["settings"][number];

// Unicode word boundaries (\b does not work for Cyrillic).
const W = (body: string) => new RegExp(`(?<![\\p{L}\\d])(?:${body})(?![\\p{L}])`, "giu");

const SOURCES = SOURCE_WORDS.map(([k, p]) => [k, W(p)] as const);
const MIC = W(MIC_WORDS);
const PER_PERFORMER = W(PER_PERFORMER_WORDS);
const PAIR_PHRASE = new RegExp(`^\\s*(?:${PAIR_PHRASE_WORDS})(?![\\p{L}])`, "iu");
const FULL_KIT = W(FULL_KIT_WORDS);
const STEREO = W(STEREO_WORDS);
const RECIPIENT = MONITOR_MIXES.map((m) => [m, W(RECIPIENT_WORDS[m])] as const);
const EVERYONE = W(EVERYONE_WORDS);
const IEM = W(IEM_WORDS);
const WEDGE = W(WEDGE_WORDS);
const RE = Object.fromEntries(Object.entries(ACTION_WORDS).map(([k, p]) => [k, W(p)])) as Record<keyof typeof ACTION_WORDS, RegExp>;
const REVERB = W(FX_WORDS.reverb);
const DELAY = W(FX_WORDS.delay);
const AUTO = W(AUTO_WORDS);
const UNSUPPORTED = UNSUPPORTED_WORDS.map(([p, msg]) => [W(p), msg] as const);
const TEMPLATE_RE = TEMPLATES.map((t) => [W(t.words), t] as const);
const COUNT = new RegExp(`(?<![\\p{L}\\d-])(\\d{1,2}|${Object.keys(NUM_WORDS).join("|")})(?![\\p{L}\\d])`, "giu");
// "-10", "−6 дб", "10 db"; a minus inside a range ("выходы 1-2") is not a level.
const DB = /(?<![\d\p{L}])([-−–]\s?\d+(?:[.,]\d+)?)\s*(?:db|дб)?|(\d+(?:[.,]\d+)?)\s*(?:db|дб)/iu;
const HZ = /(\d{2,4})\s*(?:гц|hz|герц)?/iu;

const has = (re: RegExp, s: string) => {
  re.lastIndex = 0;
  return re.test(s);
};

type Hit = { kind: Src; at: number; end: number; text: string };

// Every source mention in a clause. Specific patterns run first and their matches are blanked out,
// so generic words don't re-match ("бас-гитара" is not also a "гитара").
function hitsIn(clause: string): Hit[] {
  const hits: Hit[] = [];
  let rest = clause;
  for (const [kind, re] of SOURCES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let found = false;
    while ((m = re.exec(rest))) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      hits.push({ kind, at: m.index, end: m.index + m[0].length, text: m[0] });
      found = true;
    }
    if (found) rest = rest.replace(re, (s) => " ".repeat(s.length));
  }
  if (!hits.length && !has(PER_PERFORMER, clause)) {
    MIC.lastIndex = 0;
    const m = MIC.exec(clause);
    if (m) hits.push({ kind: "vocal", at: m.index, end: m.index + m[0].length, text: m[0] });
  }
  if (!hits.length) hits.push(...fuzzyHits(clause));
  return hits.sort((a, b) => a.at - b.at);
}

// Source kinds in a clause with counts. A count is a number written in the gap right before a mention
// (≤3 words, not reaching back past the previous mention: "2 вокала и акустика" → 1 acoustic) or right
// after it ("хор на 6 микрофонов", "вокал x4"). Several counted mentions of one kind add up
// ("one lavalier and two handhelds" → 3); uncounted repeats don't ("ведущий с радиомикрофоном" → 1).
type Found = { kind: Src; count: number; at: number; explicit: boolean; micOnly: boolean };

function sourcesIn(clause: string): Found[] {
  const hits = hitsIn(clause);
  MIC.lastIndex = 0;
  const micOnly = hits.length === 1 && hits[0].kind === "vocal" && MIC.test(hits[0].text);
  const stereo = has(STEREO, clause);
  const per = new Map<Src, { explicit: number; pair: boolean; at: number }>();
  hits.forEach((h, i) => {
    const gap = clause.slice(i ? hits[i - 1].end : 0, h.at);
    const n = countIn(gap) ?? countAfter(clause.slice(h.end, hits[i + 1]?.at ?? clause.length));
    const p = per.get(h.kind) ?? { explicit: 0, pair: false, at: h.at };
    p.explicit += n ?? 0;
    p.pair ||= PAIR_KINDS.includes(h.kind) && /(?:ы|и|s)$/u.test(h.text);
    per.set(h.kind, p);
  });
  return [...per].map(([kind, p]) => {
    let count = p.explicit || (p.pair ? 2 : 1);
    if (!p.explicit && stereo && STEREO_KINDS.includes(kind as never)) count = 2; // "клавиши стерео" → L/R
    return { kind, count: Math.min(count, 16), at: p.at, explicit: p.explicit > 0, micOnly };
  });
}

function countIn(gap: string): number | null {
  const words = gap.split(/\s+/).filter(Boolean).slice(-3).join(" ");
  let n: number | null = null;
  COUNT.lastIndex = 0;
  for (let m; (m = COUNT.exec(words)); ) n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1]];
  return n && n >= 1 && n <= 16 ? n : null;
}

function countAfter(tail: string): number | null {
  if (PAIR_PHRASE.test(tail)) return 2; // "бочка внутрь и снаружи", "snare top and bottom", "OH pair"
  // "x4", ": 4", "на 6 микрофонов", "— 2", or a bare number closing the clause ("вокал 2").
  const m = /^\s*(?:[x×:]\s?|на\s+|—\s*)(\d{1,2})(?!\d)|^\s+(\d{1,2})\s*$/iu.exec(tail);
  if (m && !m[1]) m[1] = m[2];
  const n = m ? Number(m[1]) : null;
  return n && n >= 1 && n <= 16 ? n : null;
}

// Typo tolerance for clauses that match nothing: "вакал" → vocal, "гетара" → guitar, "барабны" → drums.
function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function fuzzyHits(clause: string): Hit[] {
  const hits: Hit[] = [];
  for (const m of clause.matchAll(/\p{L}{3,}/gu)) {
    const w = m[0];
    let best: { kind: Src; score: number } | null = null;
    for (const [kind, stem] of FUZZY_STEMS) {
      if (w.length > stem.length + 4) continue;
      // Short stems must match exactly ("басс" → бас), longer ones allow 1–2 typos ("барабны" → барабан).
      const max = stem.length <= 3 ? 0 : stem.length <= 5 ? 1 : 2;
      for (let k = stem.length - 1; k <= stem.length + 1; k++) {
        const d = lev(w.slice(0, k), stem);
        const score = d / stem.length; // relative distance: a long stem with 2 typos beats a short one with 1
        if (d <= max && (!best || score < best.score)) best = { kind, score };
      }
    }
    if (best) hits.push({ kind: best.kind, at: m.index!, end: m.index! + w.length, text: w });
  }
  return hits;
}

function levelOf(clause: string): number | null {
  if (has(RE.unity, clause)) return 0;
  if (has(RE.muchLouder, clause)) return -6;
  if (has(RE.barely, clause)) return -40;
  const m = DB.exec(clause);
  if (m) {
    const v = Number((m[1] ?? m[2]).replace(/[−–]/, "-").replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(v)) return Math.max(-60, Math.min(10, v));
  }
  if (has(RE.louder, clause)) return -12;
  if (has(RE.quieter, clause)) return -24;
  return null;
}

const AUX_KINDS: Src[] = ["ambience", "click", "talkback"];
const KIT_PIECES: Src[] = ["kick", "snare", "overhead"]; // what "барабаны" (drum_kit) expands to
const ALIASES: [Src, Src][] = [["accordion", "harmonica"]]; // "гармошка": accordion unless a harmonica is listed
const isDrum = (k: Src) => k === "drum_kit" || DRUM_KINDS.includes(k as never);

export type ParseResult = { intent: Intent; unknown: string[]; manual: string[]; template: string | null };

export function parseRequest(text: string): ParseResult {
  const sources = new Map<Src, number>();
  const monitors = new Map<Mix, { set: Set<Src>; iem: boolean | null }>();
  const fx = new Set<Intent["fx"][number]>();
  const levels: Level[] = [];
  const settings: Setting[] = [];
  const unmute = new Set<Src | "all">();
  const mute = new Set<Src | "all">();
  const pages: Intent["pages"] = [];
  const unknown: string[] = [];
  const manual = new Set<string>();
  let stream: boolean | null = null;
  let lastMix: Mix | null = null;
  let lastSource: { kind: Src; explicit: boolean } | null = null;
  const fxMentioned = new Set<Src>();
  let template: Template | null = null;
  let everyone: { iem: boolean | null } | null = null;
  let iemAll = false;
  const mix = (m: Mix) => monitors.get(m) ?? monitors.set(m, { set: new Set(), iem: null }).get(m)!;

  // Sentences first; page/mute sentences stay whole ("вокалы, мониторы и dca на user 1"),
  // others split on ":" and ",". `afterColon` marks a list introduced by ":".
  const clauses: { clause: string; afterColon: boolean }[] = [];
  for (const sentence of text.toLowerCase().replace(/ё/g, "е").split(/[.;!?\n]+/)) {
    if (has(RE.page, sentence) || has(RE.unmute, sentence) || has(RE.except, sentence)) {
      if (sentence.trim()) clauses.push({ clause: sentence.trim(), afterColon: false });
      continue;
    }
    let afterColon = false;
    for (const part of sentence.split(/([:,])/)) {
      if (part === ":") afterColon = true;
      else if (part !== ",") {
        if (part.trim()) clauses.push({ clause: part.trim(), afterColon });
        afterColon = false;
      }
    }
  }

  for (const { clause, afterColon } of clauses) {
    const recipients = RECIPIENT.filter(([, re]) => has(re, clause)).map(([m]) => m);
    let plain = RECIPIENT.reduce((s, [, re]) => s.replace(re, " "), clause); // clause without "кому"
    const fullKit = has(FULL_KIT, plain);
    if (fullKit) plain = plain.replace(FULL_KIT, " ");
    const srcs = sourcesIn(plain);
    const kinds = srcs.map((s) => s.kind);
    const who = (): (Src | "all")[] => (has(RE.all, plain) || !kinds.length ? ["all"] : kinds);
    const unsupported = UNSUPPORTED.filter(([re]) => has(re, clause)).map(([, msg]) => msg);
    const iemWord = has(IEM, clause);
    const wedgeWord = has(WEDGE, clause);

    // 1. USER pages.
    if (has(RE.page, clause)) {
      const n = /(?:user|юзер)\s?([12])/iu.exec(clause);
      const idx = n ? Number(n[1]) - 1 : pages.length;
      if (idx <= 1) pages[idx] = { sources: has(RE.all, clause) ? ["all"] : kinds, buses: has(RE.buses, clause), dca: has(RE.dca, clause) };
      continue;
    }

    // 2. Mute / unmute ("вокалы не мьютить", "ничего не мьютить, кроме клика", "замьють клик").
    if (has(RE.unmute, clause) || (has(RE.mute, clause) && !has(RE.monitor, clause))) {
      RE.except.lastIndex = 0;
      const exceptAt = RE.except.exec(plain)?.index ?? -1;
      const headText = exceptAt >= 0 ? plain.slice(0, exceptAt) : plain;
      const head = sourcesIn(headText).map((s) => s.kind);
      const tail = exceptAt >= 0 ? sourcesIn(plain.slice(exceptAt)).map((s) => s.kind) : [];
      const target = has(RE.unmute, clause) ? unmute : mute;
      const other = target === unmute ? mute : unmute;
      (has(RE.all, headText) || !head.length ? ["all" as const] : head).forEach((k) => target.add(k));
      tail.forEach((k) => other.add(k));
      continue;
    }

    // 3. Deliberately manual things (phantom, gain, EQ, pan, outputs…) — before levels, so "гейн +6"
    // or "выходы 1-2" are not read as fader levels.
    if (unsupported.length) {
      unsupported.forEach((m) => manual.add(m));
      continue;
    }

    // 4. Levels ("вокал -10 дб", "барабанщику кик погромче", "дилей на вокал -20", "бас в ноль").
    const db = levelOf(clause);
    if (db !== null && !has(RE.hpf, clause)) {
      const target: Level["target"] = recipients.length
        ? `monitor_${recipients[0]}`
        : has(DELAY, clause)
          ? "delay"
          : has(REVERB, clause)
            ? kinds.length && kinds.every(isDrum) ? "drum_reverb" : "vocal_reverb"
            : has(RE.stream, clause)
              ? "stream"
              : "fader";
      levels.push({ sources: who(), target, db });
      for (const r of recipients) {
        kinds.forEach((k) => mix(r).set.add(k)); // a level in a mix implies the source is in it
        if (iemWord) mix(r).iem = true; // "барабанщику в уши клик погромче"
      }
      if (target === "stream") stream = true; // "всё в стрим -6" also asks for the stream
      if (target === "delay" || target === "vocal_reverb" || target === "drum_reverb") fx.add(target); // a level in an FX implies the FX
      continue;
    }

    // 5. Processing: "hpf на вокале 150", "без компрессии на басе", "гейт на томы".
    const hz = has(RE.hpf, clause) ? HZ.exec(plain) : null;
    if (kinds.length && (has(RE.comp, clause) || has(RE.gate, clause) || hz)) {
      const off = has(RE.off, clause);
      const st: Setting = { sources: who() };
      if (hz && Number(hz[1]) >= 20 && Number(hz[1]) <= 2000) st.hpf = Number(hz[1]);
      if (has(RE.comp, clause)) st.comp = !off;
      if (has(RE.gate, clause)) st.gate = !off;
      settings.push(st);
      continue;
    }

    // 6. Effects and stream ("посылы на реверб", "дилей на сакс", "стриму стерео-микс", "без стрима").
    let understood = false;
    if (has(RE.streamOff, clause) || has(RE.stream, clause)) {
      stream = !has(RE.streamOff, clause);
      understood = true;
    }
    const reverb = has(REVERB, clause);
    const delay = has(DELAY, clause);
    if ((reverb || delay) && has(RE.off, clause)) {
      understood = true; // "без реверба" — nothing to add
    } else if (reverb || delay) {
      const drums = kinds.filter(isDrum);
      const other = kinds.filter((k) => !isDrum(k));
      if (reverb && drums.length) fx.add("drum_reverb");
      if (reverb && (other.length || !drums.length)) fx.add("vocal_reverb");
      if (delay) fx.add("delay");
      // Named non-kit sources get the send even if their preset has none ("реверб на гитару").
      kinds.forEach((k) => fxMentioned.add(k)); // "вокал с дилеем" — the vocal exists even if listed nowhere else
      // Only sources whose preset doesn't already feed that effect ("реверб на вокал" adds nothing).
      const wanted: [NonNullable<Setting["sendTo"]>[number], Src[]][] = [
        ["delay", delay ? kinds : []],
        ["vocal_reverb", reverb ? other : []],
        ["drum_reverb", reverb ? drums : []],
      ];
      for (const [fxKind, list] of wanted) {
        const extra = list.filter((k) => k !== "drum_kit" && !(CHANNEL_PRESETS[k as SourceKind].fx as string[]).includes(FX_ROLE[fxKind]));
        if (extra.length) settings.push({ sources: extra, sendTo: [fxKind] });
      }
      understood = true;
    }
    if (understood) {
      lastMix = null;
      continue;
    }

    // 7. Monitors: "вокалам мониторы", "барабанщику: кик и снейр", "мониторы всем", "всем ушные мониторы".
    const iem = iemWord ? true : wedgeWord ? false : null;
    if (has(EVERYONE, clause) && (has(RE.monitor, clause) || iemWord || wedgeWord)) {
      everyone = { iem };
      continue;
    }
    if (recipients.length || (has(RE.monitor, clause) && kinds.length && lastMix)) {
      const mixes: Mix[] = recipients.length ? recipients : [lastMix!];
      for (const r of mixes) {
        const m = mix(r); // create the mix even with no sources named (preset defaults apply)
        kinds.forEach((k) => m.set.add(k));
        if (iem !== null) m.iem = iem;
      }
      lastMix = mixes[mixes.length - 1];
      continue;
    }
    // "барабанщику: кик, снейр и бас" — a bare list right after a monitor clause continues it.
    if (lastMix && (afterColon || monitors.get(lastMix)!.set.size) && kinds.length && !/\d/.test(clause)) {
      kinds.forEach((k) => mix(lastMix!).set.add(k));
      continue;
    }
    lastMix = null;
    // "все мониторы ушные", "in-ear" with no recipient: every mix is in-ear.
    if (iemWord && !kinds.length) {
      iemAll = true;
      continue;
    }

    // 8. Lineup templates ("сцена для рок-группы") — used only if no instruments are named anywhere.
    const tpl = TEMPLATE_RE.find(([re]) => has(re, clause));
    if (tpl && !kinds.length) {
      template ??= tpl[1];
      continue;
    }

    // 9. Things the generator does anyway ("подпиши каналы", "назначь цвета").
    if (!kinds.length && !fullKit && (has(AUTO, clause) || has(PER_PERFORMER, clause))) continue;

    // 10. Source list.
    if (fullKit) for (const p of FULL_DRUM_KIT) sources.set(p.kind, (sources.get(p.kind) ?? 0) + p.count);
    // "Хор из 12 человек, ставим 4 микрофона": a bare mic count right after an uncounted source is its count.
    const mics = srcs.length === 1 && srcs[0].micOnly && srcs[0].explicit ? srcs[0] : null;
    if (mics && lastSource && !lastSource.explicit) {
      sources.set(lastSource.kind, (sources.get(lastSource.kind) ?? 0) - 1 + mics.count);
      lastSource = { kind: lastSource.kind, explicit: true };
      continue;
    }
    if (srcs.length || fullKit) {
      for (const s of srcs) sources.set(s.kind, (sources.get(s.kind) ?? 0) + s.count);
      const last = srcs[srcs.length - 1];
      lastSource = last ? { kind: last.kind, explicit: last.explicit } : null;
      continue;
    }
    unknown.push(clause);
  }

  // A template fills in whatever the request did not say itself. Auxiliary sources (ambience mics,
  // click, talkback) do not count as "naming the lineup" — they are added on top of the template.
  const usedTemplate = template && [...sources.keys()].every((k) => AUX_KINDS.includes(k)) ? template : null;
  if (usedTemplate) {
    for (const s of usedTemplate.intent.sources ?? []) sources.set(s.kind, (sources.get(s.kind) ?? 0) + s.count);
    if (!monitors.size) for (const m of usedTemplate.intent.monitors ?? []) monitors.set(m.for, { set: new Set(), iem: m.iem || null });
    if (!fx.size) usedTemplate.intent.fx?.forEach((f) => fx.add(f));
    if (stream === null && usedTemplate.intent.stream) stream = true;
  }

  // "Ударка: бочка, рабочий, хэт…" — the generic kit word just introduces the list of pieces.
  if (sources.has("drum_kit") && (sources.has("kick") || sources.has("snare"))) sources.delete("drum_kit");

  const present = (k: Src) =>
    sources.has(k) ||
    (sources.has("drum_kit") && KIT_PIECES.includes(k)) ||
    (k === "drum_kit" && DRUM_KINDS.some((d) => sources.has(d))); // "реверб на барабаны" when pieces are listed
  // Ambiguous short names refer to what is on stage: "гармошка" is the harmonica if one is listed.
  for (const [from, to] of ALIASES) {
    if (present(from) || !present(to)) continue;
    const swap = <T,>(list: T[]) => list.map((k) => (k === from ? to : k)) as T[];
    settings.forEach((s) => (s.sources = swap(s.sources)));
    levels.forEach((l) => (l.sources = swap(l.sources)));
    for (const set of [unmute, mute, fxMentioned, ...[...monitors.values()].map((m) => m.set)]) if (set.delete(from)) set.add(to);
  }

  // Sources referenced only by an action ("вокал с дилеем", "гитару погромче") exist too.
  const referenced = [
    ...settings.flatMap((s) => s.sources),
    ...levels.flatMap((l) => l.sources),
    ...unmute,
    ...mute,
    ...[...monitors.values()].flatMap((m) => [...m.set]),
    ...fxMentioned,
  ].filter((k): k is Src => k !== "all");
  for (const k of referenced) if (!present(k)) sources.set(k, 1);

  // "мониторы всем": one mix per musician family present.
  if (everyone) {
    for (const k of sources.keys()) {
      const fam = k === "drum_kit" ? "drummer" : FAMILY_MIX[k as keyof typeof FAMILY_MIX];
      if (!fam) continue;
      const m = mix(fam);
      if (everyone.iem !== null) m.iem = everyone.iem;
    }
  }

  const intent = IntentSchema.parse({
    sources: [...sources].map(([kind, count]) => ({ kind, count: Math.min(count, 16) })),
    monitors: [...monitors].map(([m, v]) => ({ for: m, contains: [...v.set], iem: v.iem ?? iemAll })),
    fx: [...fx],
    stream: stream ?? false,
    levels,
    unmute: [...unmute],
    mute: [...mute],
    settings,
    pages: pages.filter(Boolean),
  });
  return { intent, unknown, manual: [...manual], template: usedTemplate?.name ?? null };
}
