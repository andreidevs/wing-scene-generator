// Local rule-based parser: Russian/English stage request → Intent. No LLM, no network, deterministic.
// Vocabulary lives in lib/vocab.ts; this file only applies it clause by clause:
//   page → mute/unmute → manual-only → level → processing → reverb/delay/stream → monitors → template → sources.
// Anything not understood goes to `unknown`, things deliberately left to the engineer go to `manual`.
// Full reference: docs/parser.md.

import { IntentSchema, MONITOR_MIXES, type Intent } from "./intent";
import { DRUM_KINDS, FULL_DRUM_KIT, STEREO_KINDS } from "./presets";
import {
  ACTION_WORDS, AUTO_WORDS, EVERYONE_WORDS, FAMILY_MIX, FULL_KIT_WORDS, FX_WORDS, IEM_WORDS, MIC_WORDS, NUM_WORDS,
  PAIR_KINDS, RECIPIENT_WORDS, SOURCE_WORDS, STEREO_WORDS, TEMPLATES, UNSUPPORTED_WORDS, WEDGE_WORDS, type Template,
} from "./vocab";

type Src = Intent["sources"][number]["kind"];
type Mix = (typeof MONITOR_MIXES)[number];
type Level = Intent["levels"][number];
type Setting = Intent["settings"][number];

// Unicode word boundaries (\b does not work for Cyrillic).
const W = (body: string) => new RegExp(`(?<![\\p{L}\\d])(?:${body})(?![\\p{L}])`, "giu");

const SOURCES = SOURCE_WORDS.map(([k, p]) => [k, W(p)] as const);
const MIC = W(MIC_WORDS);
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

// Source kinds mentioned in a clause, in order, each with the count written right before it.
function sourcesIn(clause: string): { kind: Src; count: number; at: number }[] {
  const found: { kind: Src; count: number; at: number }[] = [];
  const stereo = has(STEREO, clause);
  let rest = clause;
  for (const [kind, re] of SOURCES) {
    re.lastIndex = 0;
    const first = re.exec(rest);
    if (!first) continue;
    rest = rest.replace(re, (s) => " ".repeat(s.length)); // blank out so generic words don't re-match
    const pair = PAIR_KINDS.includes(kind) && /(?:ы|и|s)$/u.test(first[0]) ? 2 : 1;
    let count = countBefore(clause, first.index) ?? pair;
    if (stereo && STEREO_KINDS.includes(kind as never) && count === 1) count = 2; // "клавиши стерео" → L/R
    found.push({ kind, count, at: first.index });
  }
  if (!found.length) {
    MIC.lastIndex = 0;
    const m = MIC.exec(clause);
    if (m) found.push({ kind: "vocal", count: countBefore(clause, m.index) ?? 1, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at);
}

// Number in the ≤3 words before position `at` ("4 вокальных микрофона"), or "x4" right after the word.
function countBefore(clause: string, at: number): number | null {
  const before = clause.slice(0, at).split(/\s+/).filter(Boolean).slice(-3).join(" ");
  let n: number | null = null;
  COUNT.lastIndex = 0;
  for (let m; (m = COUNT.exec(before)); ) n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1]];
  if (n === null) {
    const after = /^\s*\p{L}*\s*[x×:]\s?(\d{1,2})/iu.exec(clause.slice(at));
    if (after) n = Number(after[1]);
  }
  return n && n >= 1 && n <= 16 ? n : null;
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
      for (const r of recipients) kinds.forEach((k) => mix(r).set.add(k)); // a level in a mix implies the source is in it
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
    if (reverb || delay) {
      const drums = kinds.filter(isDrum);
      const other = kinds.filter((k) => !isDrum(k));
      if (reverb && drums.length) fx.add("drum_reverb");
      if (reverb && (other.length || !drums.length)) fx.add("vocal_reverb");
      if (delay) fx.add("delay");
      // Named non-kit sources get the send even if their preset has none ("реверб на гитару").
      const named = kinds.filter((k) => k !== "drum_kit");
      if (named.length) {
        const sendTo: NonNullable<Setting["sendTo"]> = [];
        if (delay) sendTo.push("delay");
        if (reverb && other.length) sendTo.push("vocal_reverb");
        if (reverb && named.some(isDrum)) sendTo.push("drum_reverb");
        if (sendTo.length) settings.push({ sources: named, sendTo });
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
    if (!kinds.length && !fullKit && has(AUTO, clause)) continue;

    // 10. Source list.
    if (fullKit) for (const p of FULL_DRUM_KIT) sources.set(p.kind, (sources.get(p.kind) ?? 0) + p.count);
    if (srcs.length || fullKit) {
      for (const s of srcs) sources.set(s.kind, (sources.get(s.kind) ?? 0) + s.count);
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
