// Evaluation scenes for the text → intent step (local parser and LLM).
// Each case is a request and the intent a sound engineer would expect from it. Scoring compares the
// resulting *scene* (channels, mixes, sends, levels…), so "барабаны" and "кик, снейр, 2 овера" are equal.
// Only what the text says is expected: nothing invented (no extra mixes, levels, HPF, unmute…).

import type { z } from "zod";
import type { IntentSchema } from "../lib/intent";

type In = z.input<typeof IntentSchema>;
type Mix = NonNullable<In["monitors"]>[number];

// "keys(st)": 1 = one stereo keys channel.
const s = (o: Record<string, number>) =>
  Object.entries(o).map(([k, count]) => ({ kind: k.replace("(st)", ""), count, stereo: k.endsWith("(st)") })) as In["sources"];
const mon = (m: Mix["for"], contains: Mix["contains"] = [], iem = false): Mix => ({ for: m, contains, iem });

// Unset fields mean "nothing of that": no mixes, no FX, no stream, no levels…
export type EvalCase = { id: string; text: string; expect: Partial<In> & Pick<In, "sources"> };

export const CASES: EvalCase[] = [
  {
    id: "tz",
    text: "Собери сцену для живого выступления: 4 вокальных микрофона, 2 акустики, барабаны, бас, 2 гитары. Вокалам мониторы, барабанщику кик и снейр, стриму стерео-микс. Подпиши каналы, назначь цвета, сделай HPF, компрессию на вокалах и барабанах, посылы на реверб и мониторы.",
    expect: {
      sources: s({ vocal: 4, ac_guitar: 2, drum_kit: 1, bass: 1, e_guitar: 2 }),
      monitors: [mon("vocals"), mon("drummer", ["kick", "snare"])],
      fx: ["vocal_reverb"],
      stream: true,
      settings: [{ sources: ["vocal", "drum_kit"], comp: true }],
    },
  },
  { id: "duo-simple", text: "Вокал и акустическая гитара.", expect: { sources: s({ vocal: 1, ac_guitar: 1 }) } },
  {
    id: "jazz-trio",
    text: "Трио: бочка, малый, оверы, контрабас, рояль. Мониторы всем.",
    expect: { sources: s({ kick: 1, snare: 1, overhead: 2, bass: 1, keys: 1 }), monitors: [mon("drummer"), mon("bass"), mon("keys")] },
  },
  {
    id: "conference",
    text: "Конференция: 4 радиомикрофона для спикеров, ноутбук, трансляция на YouTube.",
    expect: { sources: s({ speech: 4, playback: 1 }), stream: true },
  },
  {
    id: "cover-iem",
    text: "Кавер-группа: полная ударка, бас, гитара, клавиши стерео, 2 вокала, плейбэк стерео, клик. Всем ушные мониторы.",
    expect: {
      sources: s({ kick: 1, snare: 1, hihat: 1, tom: 3, overhead: 2, bass: 1, e_guitar: 1, "keys(st)": 1, vocal: 2, "playback(st)": 1, click: 1 }),
      monitors: [mon("drummer", [], true), mon("bass", [], true), mon("guitar", [], true), mon("keys", [], true), mon("vocals", [], true)],
    },
  },
  {
    id: "jazz-horns",
    text: "Джаз: саксофон, труба, тромбон, контрабас, пиано, барабаны. Реверб на духовые.",
    expect: { sources: s({ sax: 1, trumpet: 1, trombone: 1, bass: 1, keys: 1, drum_kit: 1 }), fx: ["vocal_reverb"] },
  },
  {
    id: "church",
    text: "Церковное служение: ведущий, пастор, 3 бэк-вокалиста и лид-вокал, акустика, клавиши. Стрим обязательно.",
    expect: { sources: s({ speech: 2, backvocal: 3, vocal: 1, ac_guitar: 1, keys: 1 }), stream: true },
  },
  {
    id: "wedding",
    text: "Свадьба: ведущий с радиомикрофоном, DJ, два вокалиста поют под минус. Реверб и дилей на вокал.",
    expect: { sources: s({ speech: 1, dj: 1, vocal: 2, playback: 1 }), fx: ["vocal_reverb", "delay"] },
  },
  {
    id: "panel-en",
    text: "Panel discussion: one lavalier and two wireless handhelds for the speakers, stream it.",
    expect: { sources: s({ speech: 3 }), stream: true },
  },
  {
    id: "rock-detailed",
    text: "Рок: кик, снейр, хэт, 3 тома, оверы, бас, 2 гитары, вокал и 2 бэка. Барабанщику: кик, снейр и бас. Вокалистам ушные мониторы. Реверб на вокал и барабаны.",
    expect: {
      sources: s({ kick: 1, snare: 1, hihat: 1, tom: 3, overhead: 2, bass: 1, e_guitar: 2, vocal: 1, backvocal: 2 }),
      monitors: [mon("drummer", ["kick", "snare", "bass"]), mon("vocals", [], true)],
      fx: ["vocal_reverb", "drum_reverb"],
    },
  },
  {
    id: "acoustic-open",
    text: "Акустический сет: акустическая гитара, укулеле, кахон, 2 голоса. Ничего не мьютить.",
    expect: { sources: s({ ac_guitar: 2, perc: 1, vocal: 2 }), unmute: ["all"] },
  },
  {
    id: "string-quartet",
    text: "Струнный квартет: 2 скрипки, альт, виолончель. И рояль. Реверб.",
    expect: { sources: s({ violin: 3, cello: 1, keys: 1 }), fx: ["vocal_reverb"] },
  },
  {
    id: "levels",
    text: "Вокал, гитара, бас. Вокал -10 дб, гитару погромче, бас потише.",
    expect: {
      sources: s({ vocal: 1, e_guitar: 1, bass: 1 }),
      levels: [
        { sources: ["vocal"], target: "fader", db: -10 },
        { sources: ["e_guitar"], target: "fader", db: -12 },
        { sources: ["bass"], target: "fader", db: -24 },
      ],
    },
  },
  {
    id: "mixed-monitors",
    text: "2 вокала, бас, барабаны. Басисту и барабанщику напольные мониторы, вокалистам ушные.",
    expect: {
      sources: s({ vocal: 2, bass: 1, drum_kit: 1 }),
      monitors: [mon("bass"), mon("drummer"), mon("vocals", [], true)],
    },
  },
  {
    id: "choir",
    text: "Хор на 6 микрофонов, орган, ведущий. Реверб на хор.",
    expect: { sources: s({ choir: 6, keys: 1, speech: 1 }), fx: ["vocal_reverb"] },
  },
  {
    id: "mute-except",
    text: "Клик, 2 вокала, гитара. Ничего не мьютить, кроме клика.",
    expect: { sources: s({ click: 1, vocal: 2, e_guitar: 1 }), unmute: ["all"], mute: ["click"] },
  },
  {
    id: "processing",
    text: "Вокал, бочка, бас. HPF на вокале 120 Гц, без гейта на бочке, компрессор на бас.",
    expect: {
      sources: s({ vocal: 1, kick: 1, bass: 1 }),
      settings: [
        { sources: ["vocal"], hpf: 120 },
        { sources: ["kick"], gate: false },
        { sources: ["bass"], comp: true },
      ],
    },
  },
  {
    id: "user-page",
    text: "3 вокала, гитара, бас. Вокалы, мониторы и DCA на USER 1.",
    expect: { sources: s({ vocal: 3, e_guitar: 1, bass: 1 }), pages: [{ sources: ["vocal"], buses: true, dca: true }] },
  },
  {
    id: "manual-only",
    text: "Вокал и 2 оверхеда. Включи фантом на оверы, EQ на вокал подними верха.",
    expect: { sources: s({ vocal: 1, overhead: 2 }) },
  },
  {
    id: "band-en",
    text: "Band setup: kick, snare, hi-hat, 2 toms, overheads, bass, two electric guitars, keys in stereo, three vocals. In-ear mixes for everyone. Stream to YouTube.",
    expect: {
      sources: s({ kick: 1, snare: 1, hihat: 1, tom: 2, overhead: 2, bass: 1, e_guitar: 2, "keys(st)": 1, vocal: 3 }),
      monitors: [mon("drummer", [], true), mon("bass", [], true), mon("guitar", [], true), mon("keys", [], true), mon("vocals", [], true)],
      stream: true,
    },
  },
  {
    id: "typos",
    text: "вакал 2, гетара, басс, барабны",
    expect: { sources: s({ vocal: 2, e_guitar: 1, bass: 1, drum_kit: 1 }) },
  },
  {
    id: "narrative",
    text: "Выступают двое: Маша играет на акустике и поёт, Петя на клавишах и тоже поёт.",
    expect: { sources: s({ ac_guitar: 1, keys: 1, vocal: 2 }) },
  },
  {
    id: "brass-monitor",
    text: "Трубач и саксофонист, по одному микрофону, и монитор для духовых.",
    expect: { sources: s({ trumpet: 1, sax: 1 }), monitors: [mon("brass")] },
  },
  {
    id: "dj-mc",
    text: "DJ-пульт стерео и микрофон для MC.",
    expect: { sources: s({ "dj(st)": 1, speech: 1 }) },
  },
  {
    id: "drummer-level",
    text: "Ударка: бочка, рабочий, хай-хэт, райд, флор-том. Барабанщику в монитор бочку погромче.",
    expect: {
      sources: s({ kick: 1, snare: 1, hihat: 1, overhead: 1, tom: 1 }),
      monitors: [mon("drummer", ["kick"])],
      levels: [{ sources: ["kick"], target: "monitor_drummer", db: -12 }],
    },
  },
  {
    id: "stream-levels",
    text: "Вокал, гитара. Всё в стрим на -6, вокал в ноль.",
    expect: {
      sources: s({ vocal: 1, e_guitar: 1 }),
      stream: true,
      levels: [
        { sources: ["all"], target: "stream", db: -6 },
        { sources: ["vocal"], target: "fader", db: 0 },
      ],
    },
  },
  {
    id: "theatre",
    text: "Для спектакля нужно 8 петличек и 2 канала фонограммы.",
    expect: { sources: s({ speech: 8, playback: 2 }) },
  },
  {
    id: "harmonica-delay",
    text: "Губная гармошка, акустика, вокал. Дилей на гармошку.",
    expect: { sources: s({ harmonica: 1, ac_guitar: 1, vocal: 1 }), fx: ["delay"] },
  },
  {
    id: "both-wedges",
    text: "Вокал и электрогитара, обоим напольные мониторы.",
    expect: { sources: s({ vocal: 1, e_guitar: 1 }), monitors: [mon("vocals"), mon("guitar")] },
  },
  {
    id: "electronic",
    text: "Электронный сет: драм-машина стерео, синтезатор стерео, ноутбук стерео, вокал с дилеем.",
    expect: { sources: s({ "sampler(st)": 1, "keys(st)": 1, "playback(st)": 1, vocal: 1 }), fx: ["delay"] },
  },
  {
    id: "stream-only",
    text: "Только трансляция: 2 вокала и акустика.",
    expect: { sources: s({ vocal: 2, ac_guitar: 1 }), stream: true },
  },
  {
    id: "no-reverb",
    text: "Барабаны, бас, гитара. Без реверба.",
    expect: { sources: s({ drum_kit: 1, bass: 1, e_guitar: 1 }) },
  },
  {
    id: "orchestra",
    text: "Духовая группа: флейта, кларнет, гобой, валторна, 2 трубы, тромбон, туба.",
    expect: { sources: s({ flute: 1, winds: 2, horn: 2, trumpet: 2, trombone: 1 }) },
  },
  {
    id: "ambience-iem",
    text: "Вокал, бас, барабаны, 2 микрофона на зал. Вокалу ушной монитор.",
    expect: { sources: s({ vocal: 1, bass: 1, drum_kit: 1, ambience: 2 }), monitors: [mon("vocals", [], true)] },
  },
  {
    id: "talkback-click",
    text: "Барабаны, бас, вокал, клик и толкбэк. Барабанщику монитор: клик, бочка, бас.",
    expect: { sources: s({ drum_kit: 1, bass: 1, vocal: 1, click: 1, talkback: 1 }), monitors: [mon("drummer", ["click", "kick", "bass"])] },
  },
  {
    id: "unmute-vocals",
    text: "4 вокала, клавиши, бас. Вокалы не мьютить, клавиши тоже открыть.",
    expect: { sources: s({ vocal: 4, keys: 1, bass: 1 }), unmute: ["vocal", "keys"] },
  },
];

// Held-out set: written after the parser fixes, never used to tune the parser or the prompt.
// Run with --holdout to measure how well both generalize.
export const CASES_HOLDOUT: EvalCase[] = [
  {
    id: "h-quintet",
    text: "Квинтет: альт-сакс, тенор-сакс, рояль, контрабас, барабаны. Мониторы всем, реверб.",
    expect: { sources: s({ sax: 2, keys: 1, bass: 1, drum_kit: 1 }), monitors: [mon("brass"), mon("keys"), mon("bass"), mon("drummer")], fx: ["vocal_reverb"] },
  },
  {
    id: "h-hosts",
    text: "Нужны 2 радика ведущим, видео с ноутбука в стерео, трансляция.",
    expect: { sources: s({ speech: 2, "playback(st)": 1 }), stream: true },
  },
  {
    id: "h-band-iem",
    text: "Группа: бас, гитара, вокалистка, барабанщик. Всем ушные мониторы.",
    expect: {
      sources: s({ bass: 1, e_guitar: 1, vocal: 1, drum_kit: 1 }),
      monitors: [mon("bass", [], true), mon("guitar", [], true), mon("vocals", [], true), mon("drummer", [], true)],
    },
  },
  {
    id: "h-fx-proc",
    text: "Вокал с реверберацией и дилеем, акустика без компрессора.",
    expect: { sources: s({ vocal: 1, ac_guitar: 1 }), fx: ["vocal_reverb", "delay"], settings: [{ sources: ["ac_guitar"], comp: false }] },
  },
  {
    id: "h-double-mics",
    text: "Барабаны: бочка внутрь и снаружи, малый верх и низ, хэт, 2 тома, оверы.",
    expect: { sources: s({ kick: 2, snare: 2, hihat: 1, tom: 2, overhead: 2 }) },
  },
  {
    id: "h-di-mic",
    text: "Электрогитара в стерео с двух комбиков, бас DI плюс микрофон.",
    expect: { sources: s({ "e_guitar(st)": 1, bass: 2 }) },
  },
  {
    id: "h-host-singer",
    text: "Ведущая и певица, плюс минусовка.",
    expect: { sources: s({ speech: 1, vocal: 1, playback: 1 }) },
  },
  {
    id: "h-choir-mics",
    text: "Хор из 12 человек, ставим 4 микрофона.",
    expect: { sources: s({ choir: 4 }) },
  },
  {
    id: "h-strings-mon",
    text: "Скрипка, виолончель и рояль. Струнным один общий монитор.",
    expect: { sources: s({ violin: 1, cello: 1, keys: 1 }), monitors: [mon("strings")] },
  },
  {
    id: "h-drummer-iem",
    text: "Барабаны, бас, клик. Барабанщику в уши клик и бас погромче.",
    expect: {
      sources: s({ drum_kit: 1, bass: 1, click: 1 }),
      monitors: [mon("drummer", ["click", "bass"], true)],
      levels: [{ sources: ["click", "bass"], target: "monitor_drummer", db: -12 }],
    },
  },
  {
    id: "h-levels2",
    text: "Две гитары, бас, вокал. Гитары на -15 дб, бас в ноль.",
    expect: {
      sources: s({ e_guitar: 2, bass: 1, vocal: 1 }),
      levels: [
        { sources: ["e_guitar"], target: "fader", db: -15 },
        { sources: ["bass"], target: "fader", db: 0 },
      ],
    },
  },
  { id: "h-mc-dj", text: "Микрофон для конферансье и DJ.", expect: { sources: s({ speech: 1, dj: 1 }) } },
  {
    id: "h-wedges-stream",
    text: "Два вокала и клавиши. Вокалистам напольные мониторы, стрим.",
    expect: { sources: s({ vocal: 2, keys: 1 }), monitors: [mon("vocals")], stream: true },
  },
  {
    id: "h-perc",
    text: "Перкуссия: конги, бонги, шейкер. Реверб на перкуссию.",
    expect: { sources: s({ perc: 3 }), fx: ["drum_reverb"] },
  },
  {
    id: "h-en-detailed",
    text: "Kick in and out, snare top and bottom, 3 toms, OH pair, bass DI, 2 guitars, keys L/R, 4 vox, IEM for all.",
    expect: {
      sources: s({ kick: 2, snare: 2, tom: 3, overhead: 2, bass: 1, e_guitar: 2, "keys(st)": 1, vocal: 4 }),
      monitors: [mon("drummer", [], true), mon("bass", [], true), mon("guitar", [], true), mon("keys", [], true), mon("vocals", [], true)],
    },
  },
];

// Detailed layout requests (named channels, reserved gaps, named in-ear mixes, groups, mains, matrix).
// Beyond the rule parser; measured for the LLM only (npm run eval -- --advanced …).
export const USER_TEST_TEXT = `Сцена под WING Rack
Первые 8 каналов резервируем под микрофоны будут называться Mic1 - 7 и Speaker
Далее Бас Барабаны (стерео электронные) Аккустика Аккустика 2 Клавиши (стерео) Электрогитара (стерео)
далее оставим место 2 канала
и талкбэк
Будет 2 Main первый это Топы второй это Сабы Main2 в него чисто посылами все будет добавляться по умолчанию все каналы идут только в 1 Main
Далее будет 10 InEar миксов основных пре фейдер, будут называтся для каждого инструмента InEarDrums InEarBass InEarAccustic InEarPiano InEarElectric и 3 вокальных InEarVocal1 - 3
по умолчанию в них идут миксы все каналы -18 а их канал напрмиер у барабнщика будут барабаны в 0, у аккустики - аккустика в 0 и тд
Группа Вокала все вокалы кроме speaker идут сначала в эту группу потом в мастер
Группа инстурментов так же идут все сначала сюда потом в мастер в Main1
Vocal Reverb  и Delay постфедер для вокалов
Матрица стрим
Mute группы: 1 — все вокалы кроме спикера, 2 — все инструменты
Подготовить выходы всех каналов на USB для записи
Подготовить выходы всех каналов для записи на флешку во встроенном рекордере`;

const iem = (name: string, own: string[] = []) => ({ name, iem: true, contains: ["all"], own });

export const USER_TEST_EXPECT: EvalCase["expect"] = {
  sources: [],
  channels: [
    { kind: "vocal", label: "Mic{n}", count: 7 },
    { kind: "speech", label: "Speaker" },
    { kind: "bass" },
    { kind: "sampler", stereo: true },
    { kind: "ac_guitar", count: 2 },
    { kind: "keys", stereo: true },
    { kind: "e_guitar", stereo: true },
    { kind: "reserve", count: 2 },
    { kind: "talkback" },
  ],
  mixes: [
    iem("InEarDrums", ["sampler"]),
    iem("InEarBass", ["bass"]),
    iem("InEarAccustic", ["ac_guitar"]),
    iem("InEarPiano", ["keys"]),
    iem("InEarElectric", ["e_guitar"]),
    iem("InEarVocal1", ["Mic1"]),
    iem("InEarVocal2", ["Mic2"]),
    iem("InEarVocal3", ["Mic3"]),
    iem("InEar9"),
    iem("InEar10"),
  ],
  groups: [
    { name: "Vocal Group", members: ["vocal"], except: ["Speaker"] },
    { name: "Instr Group", members: ["bass", "sampler", "ac_guitar", "keys", "e_guitar"] },
  ],
  muteGroups: [
    { group: 1, members: ["vocal"], except: ["Speaker"] },
    { group: 2, members: ["bass", "sampler", "ac_guitar", "keys", "e_guitar"] },
  ],
  mains: [
    { main: 1, name: "Tops" },
    { main: 2, name: "Subs" },
  ],
  fx: ["vocal_reverb", "delay"],
  stream: true,
  streamVia: "matrix",
  record: { usb: true, card: true },
};

export const CASES_ADVANCED: EvalCase[] = [{ id: "user-test", text: USER_TEST_TEXT, expect: USER_TEST_EXPECT }];
