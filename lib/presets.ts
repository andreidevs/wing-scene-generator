import { FX_KINDS, MONITOR_MIXES, type SourceKind } from "./intent";

// Logical bus roles. The generator names/configures these buses; outputs are patched by hand.
export const MONITOR_ROLES = MONITOR_MIXES.map((m) => `mon_${m}` as const);
export const FX_ROLES = ["fx_vocal", "fx_drum", "fx_delay"] as const;
export const BUS_ROLES = [...MONITOR_ROLES, ...FX_ROLES, "stream"] as const;
export type BusRole = (typeof BUS_ROLES)[number];
export type MonitorRole = (typeof MONITOR_ROLES)[number];
export type FxRole = (typeof FX_ROLES)[number];

// Semantic names; the numeric WING color index lives in wing.ts.
export const COLORS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "gray"] as const;
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
// Icons: verified on fixtures/show-working.snap (Kick 201, Snare 202, HHat 205, Tom 207, OH 210, Bass 300,
// Acc 304, Solo gtr 306, Keys 408, Trumpet 311, MUSIC 613, MIX 612, Leader/Speaker 102, BackVoc 1,
// METRONOME 222, TALKBACK 100). Winds reuse the trumpet icon; strings/perc/accordion/harp/SPD/ambience
// have no verified icon yet and keep the baseline one.
export const CHANNEL_PRESETS = {
  kick:      { label: "Kick",   color: "red",    hpf: 40,  comp: true,  gate: true,  fx: [],                       monitor: ["mon_drummer", "mon_bass"], dca: "Drums", icon: 201 },
  snare:     { label: "Snare",  color: "red",    hpf: 80,  comp: true,  gate: true,  fx: ["fx_drum"],              monitor: ["mon_drummer"], dca: "Drums", icon: 202 },
  hihat:     { label: "HiHat",  color: "red",    hpf: 200, comp: false, gate: false, fx: [],                       monitor: [],              dca: "Drums", icon: 205 },
  tom:       { label: "Tom",    color: "red",    hpf: 60,  comp: true,  gate: true,  fx: ["fx_drum"],              monitor: [],              dca: "Drums", icon: 207 },
  overhead:  { label: "OH",     color: "orange", hpf: 120, comp: false, gate: false, fx: [],                       monitor: [],              dca: "Drums", icon: 210 },
  perc:      { label: "Perc",   color: "orange", hpf: 150, comp: false, gate: false, fx: ["fx_drum"],              monitor: ["mon_drummer"], dca: "Perc" },
  sampler:   { label: "SPD",    color: "red",    hpf: 30,  comp: false, gate: false, fx: [],                       monitor: ["mon_drummer"], dca: "Drums" },
  bass:      { label: "Bass",   color: "purple", hpf: 30,  comp: true,  gate: false, fx: [],                       monitor: ["mon_drummer", "mon_bass"], dca: "Bass", icon: 300 },
  e_guitar:  { label: "Gtr",    color: "blue",   hpf: 80,  comp: false, gate: false, fx: [],                       monitor: ["mon_guitar"],  dca: "Guitars", icon: 306 },
  ac_guitar: { label: "Ac",     color: "green",  hpf: 100, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_guitar"],  dca: "Acoustic", icon: 304 },
  keys:      { label: "Keys",   color: "cyan",   hpf: 40,  comp: false, gate: false, fx: [],                       monitor: ["mon_keys"],    dca: "Keys", icon: 408 },
  accordion: { label: "Accord", color: "cyan",   hpf: 80,  comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_keys"],    dca: "Keys" },
  harp:      { label: "Harp",   color: "pink",   hpf: 60,  comp: false, gate: false, fx: ["fx_vocal"],             monitor: ["mon_strings"], dca: "Strings" },
  violin:    { label: "Violin", color: "pink",   hpf: 150, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_strings"], dca: "Strings" },
  cello:     { label: "Cello",  color: "pink",   hpf: 60,  comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_strings"], dca: "Strings" },
  sax:       { label: "Sax",    color: "orange", hpf: 100, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_brass"],   dca: "Brass", icon: 311 },
  trumpet:   { label: "Tpt",    color: "orange", hpf: 150, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_brass"],   dca: "Brass", icon: 311 },
  trombone:  { label: "Tbn",    color: "orange", hpf: 80,  comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_brass"],   dca: "Brass", icon: 311 },
  horn:      { label: "Horn",   color: "orange", hpf: 50,  comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_brass"],   dca: "Brass", icon: 311 },
  flute:     { label: "Flute",  color: "orange", hpf: 200, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_brass"],   dca: "Brass", icon: 311 },
  winds:     { label: "Wind",   color: "orange", hpf: 120, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_brass"],   dca: "Brass", icon: 311 },
  harmonica: { label: "Harmonica", color: "orange", hpf: 150, comp: true, gate: false, fx: ["fx_vocal", "fx_delay"], monitor: ["mon_vocals", "mon_brass"], dca: "Brass" },
  playback:  { label: "PB",     color: "gray",   hpf: 20,  comp: false, gate: false, fx: [],                       monitor: [],              dca: "Playback", icon: 613 },
  dj:        { label: "DJ",     color: "gray",   hpf: 20,  comp: false, gate: false, fx: [],                       monitor: [],              dca: "Playback", icon: 612 },
  vocal:     { label: "Vox",    color: "yellow", hpf: 100, comp: true,  gate: false, fx: ["fx_vocal", "fx_delay"], monitor: ALL_PLAYER_MONITORS, dca: "Vocals", icon: 102 },
  backvocal: { label: "BVox",   color: "yellow", hpf: 120, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_vocals"],  dca: "Vocals", icon: 1 },
  choir:     { label: "Choir",  color: "yellow", hpf: 120, comp: true,  gate: false, fx: ["fx_vocal"],             monitor: ["mon_vocals"],  dca: "Vocals", icon: 1 },
  speech:    { label: "MC",     color: "pink",   hpf: 120, comp: true,  gate: false, fx: [],                       monitor: [],              dca: "Speech", icon: 102 },
  ambience:  { label: "Amb",    color: "gray",   hpf: 80,  comp: false, gate: false, fx: [],                       monitor: [...MONITOR_ROLES], dca: null, main: false, iemOnly: true },
  click:     { label: "Click",  color: "gray",   hpf: 20,  comp: false, gate: false, fx: [],                       monitor: ["mon_drummer"], dca: null, icon: 222, main: false },
  talkback:  { label: "TB",     color: "pink",   hpf: 120, comp: true,  gate: false, fx: [],                       monitor: [...MONITOR_ROLES], dca: null, icon: 100, main: false },
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

export const DCA_ICONS: Partial<Record<DcaGroup, number>> = {
  Drums: 210, Bass: 300, Guitars: 306, Acoustic: 304, Keys: 408, Playback: 613, Vocals: 112, Brass: 311, Speech: 102,
};
export const DCA_COLORS: Record<DcaGroup, ColorId> = {
  Drums: "red", Bass: "purple", Guitars: "blue", Acoustic: "green", Keys: "cyan", Playback: "gray", Vocals: "yellow",
  Brass: "orange", Strings: "pink", Perc: "orange", Speech: "pink",
};

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

// Monitor icons follow the working show: the bus gets the musician's instrument icon (M-Bass 300…).
// ponytail: fixed layout; make it editable in the UI when a second rig needs a different one.
export const BUS_LAYOUT: Record<BusRole, BusSpec> = {
  mon_vocals:  { bus: 1,  name: "MON Vox",   color: "yellow", mono: true,  mode: "PRE",  toMain: false, icon: 601 },
  mon_drummer: { bus: 2,  name: "MON Drum",  color: "red",    mono: true,  mode: "PRE",  toMain: false, icon: 210 },
  mon_bass:    { bus: 3,  name: "MON Bass",  color: "purple", mono: true,  mode: "PRE",  toMain: false, icon: 300 },
  mon_guitar:  { bus: 4,  name: "MON Gtr",   color: "blue",   mono: true,  mode: "PRE",  toMain: false, icon: 306 },
  mon_keys:    { bus: 5,  name: "MON Keys",  color: "cyan",   mono: true,  mode: "PRE",  toMain: false, icon: 408 },
  mon_brass:   { bus: 6,  name: "MON Brass", color: "orange", mono: true,  mode: "PRE",  toMain: false, icon: 311 },
  mon_strings: { bus: 7,  name: "MON Str",   color: "pink",   mono: true,  mode: "PRE",  toMain: false, icon: 601 },
  fx_vocal:    { bus: 13, name: "Vox Rev",   color: "cyan",   mono: false, mode: "POST", toMain: true, icon: 6, fx: { slot: 1, template: "vocal_hall" } },
  fx_drum:     { bus: 14, name: "Drum Rev",  color: "cyan",   mono: false, mode: "POST", toMain: true, icon: 6, fx: { slot: 2, template: "drum_room" } },
  fx_delay:    { bus: 15, name: "Delay",     color: "cyan",   mono: false, mode: "POST", toMain: true, icon: 6, fx: { slot: 3, template: "vocal_delay" } },
  stream:      { bus: 16, name: "Stream",    color: "green",  mono: false, mode: "POST", toMain: false },
};

export const ROLE_LABELS: Record<BusRole, string> = {
  mon_vocals: "Монитор вокала", mon_drummer: "Монитор барабанщика", mon_bass: "Монитор басиста",
  mon_guitar: "Монитор гитариста", mon_keys: "Монитор клавишника", mon_brass: "Монитор духовых",
  mon_strings: "Монитор струнных", fx_vocal: "Реверб вокала", fx_drum: "Реверб барабанов",
  fx_delay: "Дилей", stream: "Стрим",
};
