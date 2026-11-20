import { test } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLE_TEXT } from "./example";
import { parseRequest } from "./parse";
import { expand } from "./scene";

const kinds = (i: ReturnType<typeof parseRequest>["intent"]) => Object.fromEntries(i.sources.map((s) => [s.kind + (s.stereo ? "(st)" : ""), s.count]));
const mix = (i: ReturnType<typeof parseRequest>["intent"], m: string) => i.monitors.find((x) => x.for === m)?.contains;

test("ТЗ text parses to the same scene as the hand-written example intent", () => {
  const { intent, unknown } = parseRequest(EXAMPLE_TEXT);
  assert.deepEqual(unknown, []);
  assert.deepEqual(kinds(intent), { vocal: 4, ac_guitar: 2, drum_kit: 1, bass: 1, e_guitar: 2 });
  assert.deepEqual(mix(intent, "vocals"), []);
  assert.deepEqual(mix(intent, "drummer"), ["kick", "snare"]);
  assert.deepEqual(intent.fx, ["vocal_reverb"]);
  assert.equal(intent.stream, true);
  const s = expand(intent);
  assert.equal(s.channels.length, 13);
  assert.deepEqual(s.channels.filter((c) => c.monitorSends.includes("mon_drummer")).map((c) => c.label), ["Kick", "Snare"]);
  assert.deepEqual(s.channels.filter((c) => c.monitorSends.includes("mon_vocals")).map((c) => c.label), ["Vox 1", "Vox 2", "Vox 3", "Vox 4"]);
});

test("other wording: kit pieces, number words, monitor list continuation, drum reverb, no stream", () => {
  const { intent, unknown } = parseRequest(
    "Вокал, две акустические гитары, бочка, малый, 2 тома, оверы, бас-гитара, клавиши. " +
      "Монитор барабанщику: кик, снейр и бас. Реверб на барабаны и вокал. Без стрима.",
  );
  assert.deepEqual(unknown, []);
  assert.deepEqual(kinds(intent), { vocal: 1, ac_guitar: 2, kick: 1, snare: 1, tom: 2, overhead: 2, bass: 1, keys: 1 });
  assert.deepEqual(mix(intent, "drummer"), ["kick", "snare", "bass"]);
  assert.deepEqual(intent.fx.sort(), ["drum_reverb", "vocal_reverb"]);
  assert.equal(intent.stream, false);
});

test("levels: dB values and relative words, per target", () => {
  const { intent } = parseRequest("4 вокала, барабаны. Барабанщику кик погромче; вокал -10 дб; всё в стрим -6; вокал в реверб -20");
  assert.deepEqual(intent.levels, [
    { sources: ["kick"], target: "monitor_drummer", db: -12 },
    { sources: ["vocal"], target: "fader", db: -10 },
    { sources: ["all"], target: "stream", db: -6 },
    { sources: ["vocal"], target: "vocal_reverb", db: -20 },
  ]);
  assert.deepEqual(mix(intent, "drummer"), ["kick"], "a level for a mix also puts the source in it");
  assert.equal(intent.stream, true, "a stream level also asks for the stream");
});

test("unmute and pages", () => {
  const a = parseRequest("2 вокала, бас. Вокалы не мьютить. Вокалы, мониторы и dca на USER 1");
  assert.deepEqual(a.intent.unmute, ["vocal"]);
  assert.deepEqual(a.intent.pages, [{ sources: ["vocal"], buses: true, dca: true }]);
  assert.deepEqual(parseRequest("бас. ничего не мьютить").intent.unmute, ["all"]);
  assert.deepEqual(parseRequest("бас. все каналы на user 2").intent.pages, [{ sources: ["all"], buses: false, dca: false }]);
});

test("english and compact forms", () => {
  const { intent, unknown } = parseRequest("vocals x3, kick, snare, 2 toms, bass, 2 guitars, keys, stream");
  assert.deepEqual(unknown, []);
  assert.deepEqual(kinds(intent), { vocal: 3, kick: 1, snare: 1, tom: 2, bass: 1, e_guitar: 2, keys: 1 });
  assert.equal(intent.stream, true);
});

test("unknown fragments are reported, not guessed", () => {
  const { intent, unknown } = parseRequest("бас, варган, 2 вокала");
  assert.deepEqual(kinds(intent), { bass: 1, vocal: 2 });
  assert.deepEqual(unknown, ["варган"]);
  assert.throws(() => parseRequest("просто привет"), "no sources → schema rejects an empty scene");
});

// Table of phrasings → expected sources. Add a row whenever the vocabulary grows.
const SOURCE_CASES: [string, Record<string, number>][] = [
  ["альт-саксофон, тенор-саксофон, 2 трубы, тромбон, флейта", { sax: 2, trumpet: 2, trombone: 1, flute: 1 }],
  ["две скрипки, альт, виолончель, контрабас", { violin: 3, cello: 1, bass: 1 }],
  ["кахон, конги, шейкер", { perc: 3 }],
  ["аккордеон, рояль, синтезатор", { accordion: 1, keys: 2 }],
  ["хор 4 микрофона", { choir: 1 }],
  ["хор, ведущий, 2 радиомикрофона, петличка", { choir: 1, speech: 4 }],
  ["ведущий вокал, 3 бэк-вокала", { vocal: 1, backvocal: 3 }],
  ["клик, толкбэк, ноутбук, dj", { click: 1, talkback: 1, playback: 1, dj: 1 }],
  ["бочка, рабочий барабан, хэт, 3 тома, оверы", { kick: 1, snare: 1, hihat: 1, tom: 3, overhead: 2 }],
  ["4 вокальных микрофона", { vocal: 4 }],
  ["2 mics", { vocal: 2 }],
  ["sax, trumpet, trombone, violin x2, cello, cajon", { sax: 1, trumpet: 1, trombone: 1, violin: 2, cello: 1, perc: 1 }],
  ["бас-барабан, малый, райд, крэш", { kick: 1, snare: 1, overhead: 2 }],
  ["кларнет, гобой, туба, валторна, губная гармошка, арфа", { winds: 2, horn: 2, harmonica: 1, harp: 1 }],
  ["укулеле, мандолина, банджо", { ac_guitar: 3 }],
  ["spd, драм-машина", { sampler: 2 }],
  ["2 микрофона на зал", { ambience: 2 }],
  ["клавиши стерео, плейбэк стерео", { "keys(st)": 1, "playback(st)": 1 }],
  ["полная ударка, бас", { kick: 1, snare: 1, hihat: 1, tom: 3, overhead: 2, bass: 1 }],
  ["солист, 2 бэка, подпевка", { vocal: 1, backvocal: 3 }],
  ["басуха, электруха, акустуха, клава", { bass: 1, e_guitar: 1, ac_guitar: 1, keys: 1 }],
  ["lead vocal, 2 bvs, kick, rack tom, floor tom, ride", { vocal: 1, backvocal: 2, kick: 1, tom: 2, overhead: 1 }],
];
for (const [text, want] of SOURCE_CASES) {
  test(`sources: «${text}»`, () => {
    const { intent, unknown } = parseRequest(text);
    assert.deepEqual(unknown, []);
    assert.deepEqual(kinds(intent), want);
  });
}

test("monitors for every musician, with and without contents", () => {
  const { intent } = parseRequest(
    "вокал, бас, гитара, клавиши, сакс, скрипка, барабаны. " +
      "Мониторы басисту и гитаристу. Клавишнику: клавиши и вокал. Духовым сакс. Скрипачу скрипку",
  );
  assert.deepEqual(mix(intent, "bass"), []);
  assert.deepEqual(mix(intent, "guitar"), []);
  assert.deepEqual(mix(intent, "keys"), ["keys", "vocal"]);
  assert.deepEqual(mix(intent, "brass"), ["sax"]);
  assert.deepEqual(mix(intent, "strings"), ["violin"]);
  const s = expand(intent);
  const on = (role: string) => s.channels.filter((c) => (c.monitorSends as string[]).includes(role)).map((c) => c.label);
  assert.deepEqual(on("mon_bass"), ["Kick", "Bass", "Vox"], "empty mix → preset defaults (bass + kick + vocal)");
  assert.deepEqual(on("mon_guitar"), ["Gtr", "Vox"]);
});

test("delay and per-source fx sends", () => {
  const { intent } = parseRequest("2 вокала, сакс, гитара. Дилей на вокал и сакс. Реверб на гитару");
  assert.deepEqual(intent.fx.sort(), ["delay", "vocal_reverb"]);
  const s = expand(intent);
  const ch = Object.fromEntries(s.channels.map((c) => [c.label, c]));
  assert.ok(ch["Sax"].fxSends.includes("fx_delay"), "sax gets delay although its preset has none");
  assert.ok(ch["Gtr"].fxSends.includes("fx_vocal"), "guitar gets the hall reverb on request");
  assert.ok(ch["Vox 1"].fxSends.includes("fx_delay"));
});

test("processing switches: hpf frequency, comp/gate on and off", () => {
  const { intent } = parseRequest("вокал, бас, 2 тома. HPF на вокале 150 гц. Без компрессии на басе. Гейт на томы");
  assert.deepEqual(intent.settings, [
    { sources: ["vocal"], hpf: 150 },
    { sources: ["bass"], comp: false },
    { sources: ["tom"], gate: true },
  ]);
  const ch = Object.fromEntries(expand(intent).channels.map((c) => [c.label, c]));
  assert.equal(ch["Vox"].hpf, 150);
  assert.equal(ch["Bass"].comp, false);
  assert.equal(ch["Tom 1"].gate, true);
});

test("ТЗ: «компрессию на вокалах и барабанах» turns comp on for vocals and the whole kit", () => {
  const ch = expand(parseRequest(EXAMPLE_TEXT).intent).channels;
  assert.ok(ch.filter((c) => ["vocal", "kick", "snare", "overhead"].includes(c.kind)).every((c) => c.comp));
});

test("manual-only requests are reported as such, not as unknown", () => {
  const { manual, unknown } = parseRequest("бас, вокал. Включи фантом на вокал. Подними гейн. Выведи мониторы на выходы 1-2. Панорама гитар влево");
  assert.deepEqual(unknown, []);
  assert.deepEqual(manual.sort(), [
    "выходы и роутинг настраиваются вручную",
    "гейн и трим выставляются вручную",
    "панорама не настраивается",
    "фантомное питание (48V) включается вручную",
  ]);
});

test("in-ear: per mix, for everyone, wedge stays mono; ambience goes only to ears", () => {
  const a = parseRequest("вокал, бас, барабаны, 2 микрофона на зал. Вокалам ушные мониторы. Басисту напольный монитор");
  assert.equal(a.intent.monitors.find((m) => m.for === "vocals")?.iem, true);
  assert.equal(a.intent.monitors.find((m) => m.for === "bass")?.iem, false);
  const s = expand(a.intent);
  const amb = s.channels.find((c) => c.kind === "ambience")!;
  assert.deepEqual(amb.monitorSends, ["mon_vocals"], "ambience only in the in-ear mix");
  const b = parseRequest("вокал, гитара, бас, барабаны, клавиши. Всем ушные мониторы");
  assert.deepEqual(b.intent.monitors.map((m) => `${m.for}:${m.iem}`).sort(), ["bass:true", "drummer:true", "guitar:true", "keys:true", "vocals:true"]);
  const c = parseRequest("вокал, барабаны. Мониторы вокалистам и барабанщику. Все мониторы in-ear");
  assert.ok(c.intent.monitors.every((m) => m.iem));
});

test("lineup templates fill in only when no instruments are named", () => {
  const rock = parseRequest("Сцена для рок-группы, стрим");
  assert.equal(rock.template, "Рок-группа");
  assert.equal(kinds(rock.intent).e_guitar, 2);
  assert.equal(rock.intent.stream, true);
  assert.ok(rock.intent.fx.includes("drum_reverb"));
  const conf = parseRequest("конференция");
  assert.deepEqual(kinds(conf.intent), { speech: 4, "playback(st)": 1 });
  assert.equal(conf.intent.stream, true);
  const withAux = parseRequest("рок-группа, 2 микрофона на зал, клик. Всем ушные мониторы");
  assert.equal(withAux.template, "Рок-группа", "ambience/click do not cancel the template");
  assert.equal(kinds(withAux.intent).ambience, 2);
  assert.ok(withAux.intent.monitors.length >= 5 && withAux.intent.monitors.every((m) => m.iem));
  const own = parseRequest("рок-группа: 3 гитары, бас, барабаны");
  assert.equal(own.template, null, "explicit instruments win over the template");
  assert.equal(kinds(own.intent).e_guitar, 3);
});

test("mute rules: «ничего не мьютить, кроме клика», «замьють плейбэк», «в ноль»", () => {
  const a = parseRequest("вокал, клик, плейбэк. Ничего не мьютить, кроме клика. Вокал в ноль");
  assert.deepEqual(a.intent.unmute, ["all"]);
  assert.deepEqual(a.intent.mute, ["click"]);
  assert.deepEqual(a.intent.levels, [{ sources: ["vocal"], target: "fader", db: 0 }]);
  const ch = Object.fromEntries(expand(a.intent).channels.map((c) => [c.kind, c]));
  assert.equal(ch.vocal.mute, false);
  assert.equal(ch.click.mute, true);
  assert.equal(ch.vocal.fader, 0);
});

test("false friends: «в том числе» is not a tom, «бас-барабан» is a kick, «басисту» is not a bass", () => {
  const { intent } = parseRequest("вокал, в том числе бэки. Бас-барабан. Басисту монитор");
  assert.equal(kinds(intent).tom, undefined);
  assert.equal(kinds(intent).kick, 1);
  assert.equal(kinds(intent).bass, undefined);
  assert.deepEqual(mix(intent, "bass"), []);
});
