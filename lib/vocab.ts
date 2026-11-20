// Parser vocabulary. To teach the parser a new word, add it here — lib/parse.ts only applies these tables.
// Patterns are regex fragments matched on lower-case text with "ё" → "е", inside Unicode word boundaries.
// `\p{L}*` = any word ending (Russian cases: "гитара/гитары/гитарой…"). Full reference: docs/parser.md.

import type { FX_KINDS, Intent, MONITOR_MIXES, SourceKind } from "./intent";

type Src = SourceKind | "drum_kit";
type Mix = (typeof MONITOR_MIXES)[number];

// ---------------------------------------------------------------- sources
// Order matters: specific before generic, each match is blanked out ("бас-барабан" is a kick, not a bass;
// "губная гармошка" is a harmonica, not an accordion; "альт-саксофон" is a sax, not a viola).
export const SOURCE_WORDS: [Src, string][] = [
  ["ambience", "амбиен\\p{L}*|эмбиен\\p{L}*|ambien\\p{L}*|зальн\\p{L}*(?:\\s+микрофон\\p{L}*)?|микрофон\\p{L}*\\s+(?:на\\s+)?зал\\p{L}*|audience(?:\\s?mics?)?|crowd(?:\\s?mics?)?|room\\s?mics?"],
  ["kick", "бас-?барабан\\p{L}*|кик\\p{L}*|бочк\\p{L}*|бочек|бочон\\p{L}*|kick(?:\\s?drum)?|bass\\s?drum|bd"],
  ["sax", "(?:альт|тенор|баритон|сопрано)?-?саксофон\\p{L}*|(?:альт|тенор|баритон|сопрано)-?сакс\\p{L}*|сакс(?:ы|а|ов|ом)?|(?:alto|tenor|bari(?:tone)?|soprano)?\\s?sax(?:ophone)?s?"],
  ["harmonica", "губн\\p{L}*\\s+гармо\\p{L}*|гармоник\\p{L}*|harmonica|blues\\s?harp"],
  ["bass", "контрабас\\p{L}*|басух\\p{L}*|басист(?:ы|ка)?|бас(?!-?барабан)(?:[-\\s]?гитар\\p{L}*|а|у|е|ом|ы|ов|ам|ами|ах)?|bass(?:\\s?guitars?)?|upright|di\\s+бас\\p{L}*"],
  // "акустический сет/концерт" is a format, not an instrument.
  ["ac_guitar", "акуст\\p{L}*(?!\\s+(?:сет|концерт|программ|формат|выступлен|вечер))(?:\\s+гитар\\p{L}*)?|акустух\\p{L}*|12-?струн\\p{L}*|укулеле|мандолин\\p{L}*|банджо|домр\\p{L}*|балалайк\\p{L}*|ac(?:oustic)?(?:\\s?gtr|\\s?guitars?)?|ukulele|mandolin|banjo"],
  ["e_guitar", "(?:электро|соло-?|ритм-?)?гитар\\p{L}*|электрух\\p{L}*|комбик\\p{L}*|гитарн\\p{L}*\\s+комбо|gtrs?|e-?guitars?|guitars?|guitar\\s?amp"],
  ["harp", "арф\\p{L}*|harps?"],
  ["trombone", "тромбон\\p{L}*|trombones?|tbn"],
  ["horn", "валторн\\p{L}*|туб(?:а|ы|у|ой)|сузафон\\p{L}*|эуфониум\\p{L}*|tubas?|french\\s?horns?|sousaphone|euphonium"],
  ["trumpet", "трубач(?:и)?|труб(?:а|ы|у|ой|е)|корнет\\p{L}*|флюгельгорн\\p{L}*|trumpets?|cornets?|flugelhorn|tpt"],
  ["flute", "флейт\\p{L}*|пикколо|flutes?|piccolo"],
  ["winds", "кларнет\\p{L}*|гобо(?:й|я|и|ев)|фагот\\p{L}*|дудук\\p{L}*|свирел\\p{L}*|clarinets?|oboes?|bassoons?|duduk|woodwinds?"],
  ["violin", "скрипач(?:и|ка)?|скрип(?:к\\p{L}*|ок)|альт(?!-?сакс)(?:ы|а|ов)?|violins?|violas?|fiddles?"],
  ["cello", "виолончел\\p{L}*|cellos?"],
  ["accordion", "аккордеон\\p{L}*|баян\\p{L}*|гармонь|гармошк\\p{L}*|accordions?|bayan"],
  ["snare", "сне[йи]р\\p{L}*|снэр\\p{L}*|мал(?:ый|ого|ому|ым)(?:\\s+барабан\\p{L}*)?|рабоч(?:ий|его|ему)(?:\\s+барабан\\p{L}*)?|snares?|sd"],
  ["hihat", "(?:хай-?)?х[эе]т\\p{L}*|hi-?hats?|hh"],
  ["tom", "(?:флор-?|рэк-?|напольн\\p{L}*\\s+|подвесн\\p{L}*\\s+)?том(?:-том)?(?:ы|а|ов|ам|ами)?(?!\\s+числе)|флортом\\p{L}*|(?:floor|rack)?\\s?toms?"],
  ["overhead", "овер(?:хе[дт]|х[эе][дт])?\\p{L}*|тарелк\\p{L}*|железо|райд\\p{L}*|кр[эе]ш\\p{L}*|overheads?|oh|cymbals?|ride|crash"],
  ["perc", "перкусси\\p{L}*|кахон\\p{L}*|конг(?:а|и|ас)\\p{L}*|бонго|шейкер\\p{L}*|бубен|бубн\\p{L}*|тамбурин\\p{L}*|джембе|тимбал\\p{L}*|маракас\\p{L}*|ксилофон\\p{L}*|вибрафон\\p{L}*|маримб\\p{L}*|колокольчик\\p{L}*|percussion|perc|cajon|congas?|bongos?|shakers?|tambourines?|djembe|timbales|cowbell|vibraphone|marimba|glockenspiel|chimes"],
  ["sampler", "с[еэ]мплер\\p{L}*|spd|пэд\\p{L}*|октапад\\p{L}*|драм-?машин\\p{L}*|электронн\\p{L}*\\s+(?:барабан\\p{L}*|ударн\\p{L}*)|samplers?|octapad|drum\\s?machine|e-?drums|pads?"],
  ["drum_kit", "барабанщик(?:и)?|барабан(?!щик)\\p{L}*|ударн(?:ые|ых|ым|ая|ой|ую)(?!\\s*\\p{L}*ик)|ударк\\p{L}*|установк\\p{L}*|drums?|drum\\s?kit|kit"],
  ["keys", "клавишник(?:и)?|пианист(?:ка)?|клавиш(?!ник)\\p{L}*|клав(?:а|ы|у|ой)|синт\\p{L}*|пиано|фоно|фортепиано|рояль|рояля|орган(?!изу)\\p{L}*|электропиано|хаммонд\\p{L}*|rhodes|wurlitzer|nord|hammond|moog|keys|keyboards?|piano|synths?|organ|ep"],
  ["dj", "dj|ди-?дж[еэ]й\\p{L}*|диджей\\p{L}*|вертушк\\p{L}*|turntables?|cdj"],
  ["playback", "плей-?б[эе]к\\p{L}*|фонограм\\p{L}*|трек\\p{L}*|минусовк\\p{L}*|минус(?:а|ы)?|бэкинг\\p{L}*|секвенци\\p{L}*|ноутбук\\p{L}*|компьютер\\p{L}*|комп|плеер\\p{L}*|видео\\p{L}*|ableton|playback|backing|laptop|pc|tracks?|player|video"],
  ["click", "клик\\p{L}*|метроном\\p{L}*|click|metronome"],
  ["talkback", "толкб[эе]к\\p{L}*|токб[эе]к\\p{L}*|talk-?back|звукорежисс\\p{L}*|микрофон\\p{L}*\\s+связи"],
  ["choir", "хор(?:а|у|ом|ы|овой|ов)?|choir|choirs"],
  ["speech", "ведущ(?!\\p{L}*\\s+вокал)\\p{L}*|спикер\\p{L}*|конферансье|презентер\\p{L}*|докладчик\\p{L}*|лектор\\p{L}*|модератор\\p{L}*|пастор\\p{L}*|проповедник\\p{L}*|радиомик\\p{L}*|радиомикрофон\\p{L}*|радик\\p{L}*|петлич\\p{L}*|петл(?:я|и|ей)|гарнитур\\p{L}*|головн\\p{L}*\\s+микрофон\\p{L}*|headsets?|handhelds?|lav(?:alier)?s?|speech|mc|host|presenter|moderator|pastor|wireless"],
  ["backvocal", "бэк-?вокал\\p{L}*|бэк(?:и|ов|ам|а|ами)?|подпевк\\p{L}*|подпева\\p{L}*|backing\\s+vocals?|back\\s?vocals?|bvs?|bgvs?"],
  // "поёт/поют" — a singing performer means a vocal mic ("Маша играет на акустике и поёт").
  ["vocal", "(?:лид|основн\\p{L}*|главн\\p{L}*)?-?вокал(?!ист(?:у|ам|ке))\\p{L}*|вокальн\\p{L}*|голос\\p{L}*|лид|солист(?!у|ам|ке)\\p{L}*|певец|певица|певцы|по[её]т|поют|спо[её]т|vox|vocals?|lead|singers?|sings?"],
];
// "микрофон" alone means a vocal mic, but only when the clause names nothing else.
export const MIC_WORDS = "микрофон\\p{L}*|мик(?:а|и|ов)?|mics?|microphones?";
// Plural forms that mean a pair when no number is given ("оверы", "тарелки").
export const PAIR_KINDS: Src[] = ["overhead"];
// "полная ударка": kick, snare, hat, 3 toms, 2 OH.
export const FULL_KIT_WORDS = "полн\\p{L}*\\s+(?:ударк\\p{L}*|ударн\\p{L}*|барабан\\p{L}*|установк\\p{L}*|кит\\p{L}*)|full\\s+(?:drum\\s?)?kit";
// "клавиши стерео" → 2 channels for stereo-capable sources (STEREO_KINDS in presets).
export const STEREO_WORDS = "стерео|stereo|l\\s?/\\s?r|лево-?право|в\\s+стерео";

// ---------------------------------------------------------------- monitors
// Recipients ("кому"): dative ("басисту") or "для" + genitive ("для барабанщика"). Removed from the clause
// before looking for sources. Nominative ("трубач и саксофонист") is a performer → instrument (SOURCE_WORDS).
export const RECIPIENT_WORDS: Record<Mix, string> = {
  vocals: "вокал(?:у|ам|исту|истам|истке|исткам)|певц(?:у|ам)|певиц(?:е|ам)|солист(?:у|ам|ке)|для\\s+вокал\\p{L}*|(?:for|to)\\s+(?:the\\s+)?(?:singers?|vocals?|vocalists?)",
  drummer: "барабанщик(?:у|ам|а|ов)|ударник(?:у|ам|а|ов)|драммер(?:у|ам|а|ов)|(?:for|to)\\s+(?:the\\s+)?drummer",
  bass: "басист(?:у|ам|ке|а|ов)|(?:for|to)\\s+(?:the\\s+)?bass(?:ist|\\s+player)",
  guitar: "гитарист(?:у|ам|ке|а|ов)|(?:for|to)\\s+(?:the\\s+)?guitar(?:ist)?s?",
  keys: "клавишник(?:у|ам|а|ов)|пианист(?:у|ам|ке|а)|органист(?:у|ам|а)|(?:for|to)\\s+(?:the\\s+)?(?:keys|keyboardist|pianist)",
  brass: "духов(?:ым|ых|ики|икам|иков)|саксофонист(?:у|ам|ке|а|ов)|трубач(?:у|ам|а|ей)|тромбонист(?:у|ам|а)|флейтист(?:у|ам|ке|а)|(?:for|to)\\s+(?:the\\s+)?(?:horns|brass)",
  strings: "скрипач(?:у|ам|ке|а|ей)|виолончелист(?:у|ам|ке|а)|альтист(?:у|ам|ке|а)|струнн(?:ым|ых|ики|икам)|(?:for|to)\\s+(?:the\\s+)?strings",
};
// "мониторы всем": one mix per musician family present in the scene.
export const EVERYONE_WORDS = "всем|каждому|обоим|обеим|двоим|троим|для\\s+всех|всех\\s+музыкант\\p{L}*|всем\\s+музыкант\\p{L}*|всей\\s+групп\\p{L}*|everyone|everybody|both|for\\s+all|all\\s+musicians";
// Two mics on one source, written right after it: "бочка внутрь и снаружи", "малый верх и низ",
// "kick in and out", "snare top/bottom", "бас DI плюс микрофон", "OH pair".
export const PAIR_PHRASE_WORDS =
  "внутр\\p{L}*\\s+и\\s+снаруж\\p{L}*|снаруж\\p{L}*\\s+и\\s+внутр\\p{L}*|верх\\p{L}*\\s+и\\s+низ\\p{L}*|in\\s*(?:and|/|&)\\s*out|top\\s*(?:and|/|&)\\s*bottom|" +
  "di\\s*(?:\\+|плюс|и|and|&)\\s*(?:микрофон\\p{L}*|мик\\p{L}*|mics?)|пар(?:а|у)|pair";
// "по одному микрофону" — counts mics per performer, not an extra vocal.
export const PER_PERFORMER_WORDS = "по\\s+(?:одному|1|одн\\p{L}*)\\s+(?:микрофон\\p{L}*|мик\\p{L}*)";
// Typo tolerance: when nothing matches, a word close to one of these stems counts as that source.
export const FUZZY_STEMS: [Src, string][] = [
  ["vocal", "вокал"], ["e_guitar", "гитар"], ["bass", "бас"], ["drum_kit", "барабан"], ["keys", "клавиш"],
  ["ac_guitar", "акустик"], ["kick", "бочк"], ["snare", "снейр"], ["overhead", "овер"], ["sax", "саксофон"],
  ["trumpet", "труб"], ["violin", "скрипк"], ["cello", "виолончел"], ["choir", "хор"], ["playback", "плейбэк"],
];
// Which mix a source family belongs to for "мониторы всем".
export const FAMILY_MIX: Partial<Record<SourceKind, Mix>> = {
  vocal: "vocals", backvocal: "vocals", choir: "vocals", harmonica: "vocals",
  kick: "drummer", snare: "drummer", hihat: "drummer", tom: "drummer", overhead: "drummer", perc: "drummer", sampler: "drummer",
  bass: "bass", e_guitar: "guitar", ac_guitar: "guitar", keys: "keys", accordion: "keys",
  sax: "brass", trumpet: "brass", trombone: "brass", horn: "brass", flute: "brass", winds: "brass",
  violin: "strings", cello: "strings", harp: "strings",
};
// In-ear vs wedge.
export const IEM_WORDS = "ушн\\p{L}*|ушки|ушах|наушник\\p{L}*|in-?ears?|iems?|ин-?ир\\p{L}*|инир\\p{L}*|персональн\\p{L}*\\s+мониторинг\\p{L}*|в\\s+уши";
export const WEDGE_WORDS = "напольн\\p{L}*\\s+монитор\\p{L}*|wedges?|клин\\p{L}*|мониторы\\s+на\\s+полу";

// ---------------------------------------------------------------- effects
export const FX_WORDS: Record<(typeof FX_KINDS)[number] | "reverb", string> = {
  reverb: "ревер\\p{L}*|reverb|холл|hall|room|рум|плейт|plate|эмбиент\\s+ревер\\p{L}*",
  vocal_reverb: "", // chosen by context: reverb + vocals / no drums
  drum_reverb: "", // chosen by context: reverb + drums
  delay: "дил[еэ]\\p{L}*|делэ\\p{L}*|delay|эхо|echo|слэпбэк|slap-?back",
};

// ---------------------------------------------------------------- numbers
export const NUM_WORDS: Record<string, number> = {
  один: 1, одна: 1, одно: 1, одного: 1, одной: 1, два: 2, две: 2, двух: 2, пара: 2, пару: 2, три: 3, трёх: 3, трех: 3,
  двое: 2, трое: 3, четверо: 4, пятеро: 5, шестеро: 6,
  четыре: 4, четырёх: 4, четырех: 4, пять: 5, пяти: 5, шесть: 6, шести: 6, семь: 7, семи: 7, восемь: 8, восьми: 8,
  девять: 9, девяти: 9, десять: 10, десяти: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14,
  пятнадцать: 15, шестнадцать: 16,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, pair: 2,
};

// ---------------------------------------------------------------- actions
export const ACTION_WORDS = {
  page: "user\\s?[12]|юзер\\s?[12]|страниц\\p{L}*|сло[йяеи]\\p{L}*|layer|page",
  unmute: "не\\s+м[ьу]ют\\p{L}*|без\\s+м[ьу]ют\\p{L}*|размьют\\p{L}*|откр(?:ыт|ой)\\p{L}*|unmute|не\\s+глуш\\p{L}*",
  mute: "замьют\\p{L}*|м[ьу]ют\\p{L}*|заглуш\\p{L}*|закр(?:ыт|ой)\\p{L}*|mute",
  except: "кроме|except|but",
  all: "вс[её]|все\\p{L}*|ничего|all|everything|everyone",
  streamOff: "без\\s+стрим\\p{L}*|стрим\\p{L}*\\s+не\\s+нуж\\p{L}*|no\\s+stream",
  stream: "стрим\\p{L}*|трансляц\\p{L}*|эфир\\p{L}*|stream\\p{L}*|broadcast|запис\\p{L}*|recording|youtube|ютуб\\p{L}*|twitch|онлайн",
  monitor: "монитор\\p{L}*|ушн\\p{L}*|in-?ears?|iem|wedges?|мониторн\\p{L}*|прослушк\\p{L}*",
  buses: "шин\\p{L}*|bus\\p{L}*|монитор\\p{L}*|ревер\\p{L}*|дил[еэ]\\p{L}*|стрим\\p{L}*",
  dca: "dca|дса|дка|дца",
  // Levels: relative words map to dB from the -18 default.
  unity: "в\\s+ноль|на\\s+ноль|unity|номинал\\p{L}*",
  muchLouder: "(?:намного|сильно|гораздо|значительно)\\s+громче|much\\s+louder|максимально\\s+громк\\p{L}*",
  louder: "громче|погромче|louder|побольше|прибав\\p{L}*",
  quieter: "тише|потише|quieter|поменьше|убав\\p{L}*",
  barely: "еле\\s+слышн\\p{L}*|чуть\\s+слышн\\p{L}*|чуть-чуть|немного|barely|a\\s+little",
  // Processing switches.
  hpf: "hpf|хпф|обрез\\p{L}*\\s+низ\\p{L}*|low\\s?cut|лоу\\s?кат|фильтр\\p{L}*|срез\\p{L}*",
  comp: "компрес\\p{L}*|компресс\\p{L}*|comp(?:ressor|ression)?",
  gate: "гейт\\p{L}*|г[еэ]йт\\p{L}*|gate|шумодав\\p{L}*",
  off: "без|выключ\\p{L}*|убер\\p{L}*|не\\s+нуж\\p{L}*|не\\s+надо|отключ\\p{L}*|off|no",
};

// ---------------------------------------------------------------- lineup templates
// "сцена для рок-группы" → this lineup, used only when the request names no instruments itself.
export type Template = { name: string; words: string; intent: Partial<Pick<Intent, "sources" | "monitors" | "fx" | "stream">> };
const S = (list: [Src, number][]) => list.map(([kind, count]) => ({ kind, count }));
const M = (mixes: Mix[], iem = false) => mixes.map((m) => ({ for: m, contains: [], iem }));
export const TEMPLATES: Template[] = [
  { name: "Рок-группа", words: "рок-?групп\\p{L}*|рок-?бэнд\\p{L}*|rock\\s?band", intent: { sources: S([["kick", 1], ["snare", 1], ["hihat", 1], ["tom", 3], ["overhead", 2], ["bass", 1], ["e_guitar", 2], ["keys", 1], ["vocal", 1], ["backvocal", 2]]), monitors: M(["vocals", "drummer", "bass", "guitar", "keys"]), fx: ["vocal_reverb", "drum_reverb"] } },
  { name: "Поп/кавер-группа", words: "поп-?групп\\p{L}*|кавер-?групп\\p{L}*|кавер-?бэнд\\p{L}*|pop\\s?band|cover\\s?band|party\\s?band", intent: { sources: S([["kick", 1], ["snare", 1], ["hihat", 1], ["tom", 2], ["overhead", 2], ["bass", 1], ["e_guitar", 1], ["keys", 2], ["playback", 2], ["click", 1], ["vocal", 2], ["backvocal", 2]]), monitors: M(["vocals", "drummer", "bass", "guitar", "keys"], true), fx: ["vocal_reverb", "drum_reverb", "delay"] } },
  { name: "Джаз-трио", words: "джаз(?:ов\\p{L}*)?[-\\s]?трио|jazz\\s?trio", intent: { sources: S([["kick", 1], ["snare", 1], ["overhead", 2], ["bass", 1], ["keys", 2]]), monitors: M(["drummer", "bass", "keys"]), fx: ["vocal_reverb"] } },
  { name: "Джаз-квартет", words: "джаз(?:ов\\p{L}*)?[-\\s]?квартет\\p{L}*|jazz\\s?quartet", intent: { sources: S([["kick", 1], ["snare", 1], ["overhead", 2], ["bass", 1], ["keys", 2], ["sax", 1]]), monitors: M(["drummer", "bass", "keys", "brass"]), fx: ["vocal_reverb"] } },
  { name: "Акустический дуэт", words: "акустическ\\p{L}*\\s+дуэт\\p{L}*|acoustic\\s+duo", intent: { sources: S([["ac_guitar", 1], ["vocal", 2]]), monitors: M(["vocals"]), fx: ["vocal_reverb"] } },
  { name: "Акустическое трио", words: "акустическ\\p{L}*\\s+трио|acoustic\\s+trio", intent: { sources: S([["ac_guitar", 2], ["perc", 1], ["vocal", 2]]), monitors: M(["vocals", "guitar"]), fx: ["vocal_reverb"] } },
  { name: "Церковь", words: "церк\\p{L}*|служени\\p{L}*|прославлени\\p{L}*|богослужени\\p{L}*|worship|church", intent: { sources: S([["kick", 1], ["snare", 1], ["overhead", 2], ["bass", 1], ["e_guitar", 1], ["ac_guitar", 1], ["keys", 2], ["vocal", 1], ["backvocal", 3], ["choir", 2], ["speech", 2], ["playback", 2]]), monitors: M(["vocals", "drummer", "keys"], true), fx: ["vocal_reverb"], stream: true } },
  { name: "Конференция", words: "конференци\\p{L}*|форум\\p{L}*|семинар\\p{L}*|панельн\\p{L}*|дискусси\\p{L}*|презентаци\\p{L}*|conference|panel|seminar|keynote", intent: { sources: S([["speech", 4], ["playback", 2]]), stream: true } },
  { name: "Подкаст", words: "подкаст\\p{L}*|podcast|интервью|interview", intent: { sources: S([["speech", 3], ["playback", 2]]), stream: true } },
  { name: "DJ-сет", words: "dj-?сет\\p{L}*|диджей-?сет\\p{L}*|dj\\s?set|вечеринк\\p{L}*", intent: { sources: S([["dj", 2], ["speech", 1]]) } },
  { name: "Свадьба/корпоратив", words: "свадьб\\p{L}*|корпоратив\\p{L}*|банкет\\p{L}*|юбиле\\p{L}*|wedding|corporate|gala", intent: { sources: S([["speech", 2], ["dj", 2], ["vocal", 2], ["playback", 2]]), monitors: M(["vocals"]), fx: ["vocal_reverb"] } },
  { name: "Караоке", words: "караоке|karaoke", intent: { sources: S([["vocal", 2], ["playback", 2]]), monitors: M(["vocals"]), fx: ["vocal_reverb", "delay"] } },
  { name: "Струнный квартет", words: "струнн\\p{L}*\\s+квартет\\p{L}*|string\\s+quartet", intent: { sources: S([["violin", 3], ["cello", 1]]), monitors: M(["strings"]), fx: ["vocal_reverb"] } },
  { name: "Духовой оркестр/брасс-бэнд", words: "духов\\p{L}*\\s+оркестр\\p{L}*|брасс-?бэнд\\p{L}*|brass\\s?band|horn\\s+section", intent: { sources: S([["trumpet", 2], ["trombone", 2], ["sax", 2], ["horn", 1], ["kick", 1], ["snare", 1]]), monitors: M(["brass", "drummer"]), fx: ["vocal_reverb"] } },
  { name: "Хор", words: "хоров\\p{L}*\\s+концерт\\p{L}*|выступлени\\p{L}*\\s+хора|choir\\s+concert", intent: { sources: S([["choir", 4], ["keys", 1], ["speech", 1]]), monitors: M(["vocals"]), fx: ["vocal_reverb"] } },
  { name: "Театр", words: "театр\\p{L}*|спектакл\\p{L}*|мюзикл\\p{L}*|theatre|theater|musical", intent: { sources: S([["speech", 8], ["playback", 2]]), fx: ["vocal_reverb"] } },
];

// ---------------------------------------------------------------- manual-only
// Mentioned but intentionally not changed by the generator: reported as "настрой вручную".
export const UNSUPPORTED_WORDS: [string, string][] = [
  ["фантом\\p{L}*|48\\s?[вv]|phantom", "фантомное питание (48V) включается вручную"],
  ["гейн\\p{L}*|gain|предусил\\p{L}*|чувствительн\\p{L}*|трим\\p{L}*|trim", "гейн и трим выставляются вручную"],
  ["эквал\\p{L}*|эквализ\\p{L}*|eq|частот\\p{L}*|пресет\\p{L}*\\s+eq", "EQ генератор не трогает"],
  ["панорам\\p{L}*|pan|влево|вправо|левее|правее", "панорама не настраивается"],
  ["выход\\p{L}*|выведи\\p{L}*|роутинг\\p{L}*|routing|патч\\p{L}*|usb|aes50|стейдж-?бокс\\p{L}*|stage\\s?box|dante|madi", "выходы и роутинг настраиваются вручную"],
  ["подгрупп\\p{L}*|subgroups?|групп\\p{L}*\\s+шин", "подгруппы не создаются"],
  ["лимитер\\p{L}*|limiter|де-?эссер\\p{L}*|de-?esser|сайд-?ч[еэ]йн\\p{L}*|sidechain|мультибэнд\\p{L}*|multiband", "лимитер, де-эссер и сайдчейн не настраиваются"],
  ["матриц\\p{L}*|matrix|сабвуфер\\p{L}*|саб(?:ы|ов)?|subs?|фронт-?филл\\p{L}*|front\\s?fill|линии\\s+задержки|delay\\s+lines?", "матрицы и акустическая система настраиваются вручную"],
  ["врем\\p{L}*\\s+(?:реверб\\p{L}*|ревер\\p{L}*|дил[еэ]\\p{L}*)|decay|предзадержк\\p{L}*|pre-?delay|длинн\\p{L}*\\s+ревер\\p{L}*|коротк\\p{L}*\\s+ревер\\p{L}*", "параметры эффектов не меняются (стоят шаблоны V-REV / ROOM / ST-DL)"],
  ["автомикс\\p{L}*|automix|снапшот\\p{L}*|snapshot|кью|cue\\s?list|сцен\\p{L}*\\s+на\\s+пес\\p{L}*", "автомикс и кью-лист не создаются"],
  ["м[ьу]ют-?групп\\p{L}*|mute\\s?groups?", "mute-группы не назначаются"],
  ["иконк\\p{L}*\\s+\\d+|icon\\s+\\d+", "номер иконки задаётся пресетом инструмента"],
];

// Things the generator does on its own or filler; mentioning them is fine, nothing to extract.
export const AUTO_WORDS =
  "подпиш\\p{L}*|назнач\\p{L}*|цвет\\p{L}*|иконк\\p{L}*|сделай|сделать|собер\\p{L}*|сцен\\p{L}*|выступлен\\p{L}*|концерт\\p{L}*|" +
  "посыл\\p{L}*|каналы|канал|стерео\\p{L}*|микс\\p{L}*|уровн\\p{L}*|настро\\p{L}*|подготов\\p{L}*|раскрас\\p{L}*|" +
  "живо\\p{L}*|live|band|группа|групп\\p{L}*|dca|hpf|компрес\\p{L}*|гейт\\p{L}*|фильтр\\p{L}*|пожалуйста|please|" +
  "нужн\\p{L}*|надо|хочу|организ\\p{L}*|состав\\p{L}*|line-?up|input\\s?list|инпут-?лист\\p{L}*|райдер\\p{L}*|rider|" +
  "площадк\\p{L}*|клуб\\p{L}*|зал\\p{L}*|фестивал\\p{L}*|мероприяти\\p{L}*|event|show|шоу|программ\\p{L}*";
