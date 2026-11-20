import { FX_KINDS, MONITOR_MIXES, type SourceKind } from "./intent";

// Logical bus roles. The generator names/configures these buses; outputs are patched by hand.
export const MONITOR_ROLES = MONITOR_MIXES.map((m) => `mon_${m}` as const);
export const FX_ROLES = ["fx_vocal", "fx_drum", "fx_delay"] as const;
export const BUS_ROLES = [...MONITOR_ROLES, ...FX_ROLES, "stream"] as const;
export type BusRole = (typeof BUS_ROLES)[number];
export type MonitorRole = (typeof MONITOR_ROLES)[number];
export type FxRole = (typeof FX_ROLES)[number];

// The 12 WING colors, in console order (index = position + 1; mapping in wing.ts).
// Group scheme: vocals mauve, drums red (OH/perc orange), bass dark blue, guitars green, keys turquoise,
// strings/brass/winds yellow, FX/atmosphere/playback gray blue, speech coral.
export const COLORS = ["grayblue", "blue", "darkblue", "turquoise", "green", "olive", "yellow", "orange", "red", "coral", "pink", "mauve"] as const;
export type ColorId = (typeof COLORS)[number];

// Fixed DCA numbering: DCA n = DCA_GROUPS[n-1]. Deterministic across builds. Names ≤8 chars (WING limit).
export const DCA_GROUPS = ["Drums", "Bass", "Guitars", "Acoustic", "Keys", "Playback", "Vocals", "Brass", "Strings", "Perc", "Speech"] as const;
export type DcaGroup = (typeof DCA_GROUPS)[number];

export type ChannelPreset = {
  label: string;
  color: ColorId;
  hpf: number; // Hz
  comp: boolean;
  gate: boolean;
  fx: FxRole[];
  monitor: MonitorRole[]; // default membership when a monitor mix lists no sources
  dca: DcaGroup | null;
  icon?: number; // WING icon index from the working show; omitted = no verified icon, leave baseline
  main?: false; // false = keep out of Main 1 (click, talkback, ambience)
  iemOnly?: true; // default monitor membership only in in-ear mixes (ambience mics)
};

const ALL_PLAYER_MONITORS: MonitorRole[] = ["mon_vocals", "mon_bass", "mon_guitar", "mon_keys", "mon_brass", "mon_strings"];

// ponytail: starting values for live sound, tune by ear on the real rig.
// Icons: WING icon picker, categories by hundreds, 5 per row (0 connectors/FX, 100 mics, 200 drums,
// 300 strings/guitars/winds, 400 keys, 600 devices). Cross-checked on fixtures/show-working.snap:
// Kick 201, Snare 202, HHat 205, F-tom 209, kit 210, Bass 300, Acc 304, Strat 306, Keys 408, choir 112, ear 601, FX 6.
export const CHANNEL_PRESETS = {
  kick:      { label: "Kick",   color: "red",       hpf: 40,  comp: true,  gate: true,  fx: [],                       monitor: ["mon_drummer", "mon_bass"], dca: "Drums", icon: 201 },
  snare:     { label: "Snare",  color: "red",       hpf: 80,  comp: true,  gate: true,  fx: ["fx_drum"],              monitor: ["mon_drummer"], dca: "Drums", icon: 202 },
  hihat:     { label: "HiHat",  color: "red",       hpf: 200, comp: false, gate: false, fx: [],                       monitor: [],              dca: "Drums", icon: 205 },
  tom:       { label: "Tom",    color: "red",       hpf: 60,  comp: true,  gate: true,  fx: ["fx_drum"],              monitor: [],              dca: "Drums", icon: 206 }, // H/M/L/F by order, see TOM_ICONS
  overhead:  { label: "OH",     color: "orange",    hpf: 120, comp: false, gate: false, fx: [],                       monitor: [],              dca: "Drums", icon: 210 },
  perc:      { label: "Perc",   color: "orange",    hpf: 150, comp: false, gate: false, fx: ["fx_drum"],              monitor: ["mon_drummer"], dca: "Perc", icon: 216 },
  sampler:   { label: "SPD",    color: "orange",    hpf: 30,  comp: false, gate: false, fx: [],                       monitor: ["mon_drummer"], dca: "Drums", icon: 223 },
  bass:      { label: "Bass",   color: "darkblue",  hpf: 30,  comp: true,  gate: false, fx: [],                       monitor: ["mon_drummer", "mon_bass"], dca: "Bass", icon: 300 },
  e_guitar:  { label: "Gtr",    color: "green",     hpf: 80,  comp: false, gate: false, fx: [],                       monitor: ["mon_guitar"],  dca: "Guitars", icon: 306 },
  ac_guitar: { label: "Ac",     color: "green",     hpf: 100, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_guitar"],  dca: "Acoustic", icon: 304 },
  keys:      { label: "Keys",   color: "turquoise", hpf: 40,  comp: false, gate: false, fx: [],                       monitor: ["mon_keys"],    dca: "Keys", icon: 408 },
  accordion: { label: "Accord", color: "turquoise", hpf: 80,  comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_keys"],    dca: "Keys", icon: 316 },
  harp:      { label: "Harp",   color: "yellow",    hpf: 60,  comp: false, gate: false, fx: ["fx_vocal"],             monitor: ["mon_strings"], dca: "Strings", icon: 315 },
  violin:    { label: "Violin", color: "yellow",    hpf: 150, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_strings"], dca: "Strings", icon: 309 },
  cello:     { label: "Cello",  color: "yellow",    hpf: 60,  comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_strings"], dca: "Strings", icon: 310 },
  sax:       { label: "Sax",    color: "yellow",    hpf: 100, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_brass"],   dca: "Brass", icon: 312 },
  trumpet:   { label: "Tpt",    color: "yellow",    hpf: 150, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_brass"],   dca: "Brass", icon: 314 },
  trombone:  { label: "Tbn",    color: "yellow",    hpf: 80,  comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_brass"],   dca: "Brass", icon: 313 },
  horn:      { label: "Horn",   color: "yellow",    hpf: 50,  comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_brass"],   dca: "Brass", icon: 313 },
  flute:     { label: "Flute",  color: "yellow",    hpf: 200, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_brass"],   dca: "Brass", icon: 318 },
  winds:     { label: "Wind",   color: "yellow",    hpf: 120, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_brass"],   dca: "Brass", icon: 319 },
  harmonica: { label: "Harmonica", color: "yellow", hpf: 150, comp: true,  gate: false, fx: ["fx_vocal", "fx_delay"], monitor: ["mon_vocals", "mon_brass"], dca: "Brass", icon: 317 },
  playback:  { label: "PB",     color: "grayblue",  hpf: 20,  comp: false, gate: false, fx: [],                       monitor: [],              dca: "Playback", icon: 605 },
  dj:        { label: "DJ",     color: "grayblue",  hpf: 20,  comp: false, gate: false, fx: [],                       monitor: [],              dca: "Playback", icon: 611 },
  vocal:     { label: "Vox",    color: "mauve",     hpf: 100, comp: true,  gate: false, fx: ["fx_vocal", "fx_delay"], monitor: ALL_PLAYER_MONITORS, dca: "Vocals", icon: 101 },
  backvocal: { label: "BVox",   color: "mauve",     hpf: 120, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_vocals"],  dca: "Vocals", icon: 112 },
  choir:     { label: "Choir",  color: "mauve",     hpf: 120, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_vocals"],  dca: "Vocals", icon: 112 },
  speech:    { label: "MC",     color: "coral",     hpf: 120, comp: true,  gate: false, fx: [],                       monitor: [],              dca: "Speech", icon: 102 },
  ambience:  { label: "Amb",    color: "grayblue",  hpf: 80,  comp: false, gate: false, fx: [],                       monitor: [...MONITOR_ROLES], dca: null, icon: 109, main: false, iemOnly: true },
  click:     { label: "Click",  color: "grayblue",  hpf: 20,  comp: false, gate: false, fx: [],                       monitor: ["mon_drummer"], dca: null, icon: 222, main: false },
  talkback:  { label: "TB",     color: "coral",     hpf: 120, comp: true,  gate: false, fx: [],                       monitor: [...MONITOR_ROLES], dca: null, icon: 100, main: false },
} satisfies Record<SourceKind, ChannelPreset>;

// Channel layout order on the console.
export const LAYOUT_ORDER: SourceKind[] = [
  "kick", "snare", "hihat", "tom", "overhead", "perc", "sampler",
  "bass", "e_guitar", "ac_guitar", "keys", "accordion", "harp",
  "violin", "cello", "sax", "trumpet", "trombone", "horn", "flute", "winds", "harmonica",
  "playback", "dj", "vocal", "backvocal", "choir", "speech", "ambience", "click", "talkback",
];

export const DRUM_KIT: { kind: SourceKind; count: number }[] = [
  { kind: "kick", count: 1 },
  { kind: "snare", count: 1 },
  { kind: "overhead", count: 2 },
];
export const DRUM_KINDS: SourceKind[] = ["kick", "snare", "hihat", "tom", "overhead", "perc", "sampler"];
// "полная ударка": the bigger kit.
export const FULL_DRUM_KIT: { kind: SourceKind; count: number }[] = [
  { kind: "kick", count: 1 }, { kind: "snare", count: 1 }, { kind: "hihat", count: 1 },
  { kind: "tom", count: 3 }, { kind: "overhead", count: 2 },
];
// Sources that come as L/R pairs when the request says "стерео" ("клавиши стерео" → 2 channels).
export const STEREO_KINDS: SourceKind[] = ["keys", "playback", "dj", "sampler", "accordion", "ambience"];

export const MONITOR_ROLE = Object.fromEntries(MONITOR_MIXES.map((m) => [m, `mon_${m}`])) as {
  [K in (typeof MONITOR_MIXES)[number]]: `mon_${K}`;
};
export const FX_ROLE = { vocal_reverb: "fx_vocal", drum_reverb: "fx_drum", delay: "fx_delay" } as const satisfies Record<(typeof FX_KINDS)[number], FxRole>;

export const MAX_CHANNELS = 40; // WING input channels

// ponytail: one default for channel faders, send levels and role bus faders; tune on the rig.
export const DEFAULT_LEVEL_DB = -18;
export const DCA_LEVEL_DB = 0; // unity: a DCA at -inf (clean base default) would silence its channels

// Toms in console order get the H / M / L / F tom icons.
export const TOM_ICONS = [206, 207, 208, 209];

export const DCA_ICONS: Partial<Record<DcaGroup, number>> = {
  Drums: 210, Bass: 300, Guitars: 306, Acoustic: 304, Keys: 408, Playback: 605, Vocals: 112, Brass: 312, Strings: 309, Perc: 216, Speech: 102,
};
export const DCA_COLORS: Record<DcaGroup, ColorId> = {
  Drums: "red", Bass: "darkblue", Guitars: "green", Acoustic: "green", Keys: "turquoise", Playback: "grayblue", Vocals: "mauve",
  Brass: "yellow", Strings: "yellow", Perc: "orange", Speech: "coral",
};
// In-ear mixes get the headphones icon instead of the musician's instrument.
export const IEM_ICON = 602;

// How the generator builds each role bus. Physical outputs/USB are patched by hand (see report).
export type BusSpec = {
  bus: number; // WING bus 1..16
  name: string; // ≤16 chars
  color: ColorId;
  mono: boolean;
  mode: "PRE" | "POST" | "GRP"; // channel send mode into this bus
  toMain: boolean; // FX returns go to Main 1
  icon?: number; // WING icon index; omitted = leave as in baseline
  fx?: { slot: number; template: "vocal_hall" | "drum_room" | "vocal_delay" }; // reverbs/delays only in FX1..FX8
};

// Monitor buses take the musician's group color and instrument icon (as in the working show: M-Bass 300…);
// WING has no darker shades, so "darker version of the group color" is the same group color.
// ponytail: fixed layout; make it editable in the UI when a second rig needs a different one.
export const BUS_LAYOUT: Record<BusRole, BusSpec> = {
  mon_vocals:  { bus: 1,  name: "MON Vox",   color: "mauve", mono: true,  mode: "PRE",  toMain: false, icon: 601 },
  mon_drummer: { bus: 2,  name: "MON Drum",  color: "red",    mono: true,  mode: "PRE",  toMain: false, icon: 210 },
  mon_bass:    { bus: 3,  name: "MON Bass",  color: "darkblue", mono: true,  mode: "PRE",  toMain: false, icon: 300 },
  mon_guitar:  { bus: 4,  name: "MON Gtr",   color: "green",   mono: true,  mode: "PRE",  toMain: false, icon: 306 },
  mon_keys:    { bus: 5,  name: "MON Keys",  color: "turquoise",   mono: true,  mode: "PRE",  toMain: false, icon: 408 },
  mon_brass:   { bus: 6,  name: "MON Brass", color: "yellow", mono: true,  mode: "PRE",  toMain: false, icon: 312 },
  mon_strings: { bus: 7,  name: "MON Str",   color: "yellow", mono: true,  mode: "PRE",  toMain: false, icon: 309 },
  fx_vocal:    { bus: 13, name: "Vox Rev",   color: "grayblue",   mono: false, mode: "POST", toMain: true, icon: 6, fx: { slot: 1, template: "vocal_hall" } },
  fx_drum:     { bus: 14, name: "Drum Rev",  color: "grayblue",   mono: false, mode: "POST", toMain: true, icon: 6, fx: { slot: 2, template: "drum_room" } },
  fx_delay:    { bus: 15, name: "Delay",     color: "grayblue",   mono: false, mode: "POST", toMain: true, icon: 6, fx: { slot: 3, template: "vocal_delay" } },
  stream:      { bus: 16, name: "Stream",    color: "grayblue", mono: false, mode: "POST", toMain: false, icon: 605 },
};

export const ROLE_LABELS: Record<BusRole, string> = {
  mon_vocals: "Монитор вокала", mon_drummer: "Монитор барабанщика", mon_bass: "Монитор басиста",
  mon_guitar: "Монитор гитариста", mon_keys: "Монитор клавишника", mon_brass: "Монитор духовых",
  mon_strings: "Монитор струнных", fx_vocal: "Реверб вокала", fx_drum: "Реверб барабанов",
  fx_delay: "Дилей", stream: "Стрим",
};
