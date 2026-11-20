import { z } from "zod";
import { IntentSchema, SOURCE_KINDS, SourceKind, type Intent } from "./intent";
import {
  BUS_LAYOUT, CHANNEL_PRESETS, COLORS, DCA_GROUPS, DEFAULT_LEVEL_DB, DRUM_KINDS, DRUM_KIT, FX_ROLE, FX_ROLES, IEM_ICON, LAYOUT_ORDER,
  MAX_CHANNELS, MONITOR_ROLE, MONITOR_ROLES,
  type BusRole, type ChannelPreset, type ColorId, type DcaGroup, type MonitorRole,
} from "./presets";

const MonitorRoleSchema = z.enum(MONITOR_ROLES);
const FxRoleSchema = z.enum(FX_ROLES);
const EDITABLE = ["label", "color", "hpf", "comp", "gate", "mute", "fader", "monitorSends", "fxSends", "stream", "sendLevel", "dca", "groups", "toMain"] as const;
const Db = z.number().min(-144).max(10); // WING fader / send range

export const ChannelDraftSchema = z.object({
  ch: z.number().int().min(1).max(MAX_CHANNELS), // WING channel number, 1-based
  kind: SourceKind,
  label: z.string().min(1).max(32),
  color: z.enum(COLORS),
  hpf: z.number().min(20).max(2000), // WING low cut range
  comp: z.boolean(),
  gate: z.boolean(),
  mute: z.boolean(), // default true: a freshly loaded scene is silent until soundcheck
  fader: Db,
  monitorSends: z.array(z.string()), // ids of monitor buses this channel feeds
  fxSends: z.array(z.string()), // ids of FX buses this channel feeds
  stream: z.boolean(),
  sendLevel: z.record(z.string(), Db), // dB per bus id, used when that send is on (missing = -18)
  groups: z.array(z.string()).default([]), // subgroup bus ids (GRP send); a grouped channel skips Main 1
  toMain: z.boolean().default(true), // direct assignment to Main 1
  dca: z.enum(DCA_GROUPS).nullable(),
  edited: z.array(z.enum(EDITABLE)), // fields the user changed by hand; kind changes keep them
});
export type ChannelDraft = z.infer<typeof ChannelDraftSchema>;
export type EditableField = (typeof EDITABLE)[number];

// Monitor mixes and FX that this scene actually uses (from the intent).
const SceneMixesSchema = z.object({
  monitors: z.array(z.object({ role: MonitorRoleSchema, contains: z.array(SourceKind), iem: z.boolean() })),
  fx: z.array(FxRoleSchema),
  stream: z.boolean(),
});
export type SceneMixes = z.infer<typeof SceneMixesSchema>;

// Every bus the scene creates, with its WING number. Role buses keep their role as id ("mon_vocals",
// "fx_vocal", "stream"); named mixes are "mix1…", groups "grp1…".
const BusDefSchema = z.object({
  id: z.string(),
  bus: z.number().int().min(1).max(16),
  name: z.string().min(1).max(16),
  kind: z.enum(["monitor", "fx", "group", "stream"]),
  color: z.enum(COLORS),
  mono: z.boolean(),
  mode: z.enum(["PRE", "POST", "GRP"]), // how channels send into it
  toMain: z.boolean(),
  iem: z.boolean(),
  fader: Db,
  icon: z.number().int().min(0).max(999).optional(),
  fx: z.object({ slot: z.number().int().min(1).max(8), template: z.enum(["vocal_hall", "drum_room", "vocal_delay"]) }).optional(),
});
export type BusDef = z.infer<typeof BusDefSchema>;

// A custom surface page (USER 1 / USER 2), already expanded to channel kinds.
const PageSpecSchema = z.object({
  sources: z.array(z.union([SourceKind, z.literal("all")])),
  buses: z.boolean(),
  dca: z.boolean(),
});
export type PageSpec = z.infer<typeof PageSpecSchema>;

// scene.json — also the import format, so it is validated at the trust boundary.
export const SceneSchema = z.object({
  version: z.literal(1),
  text: z.string(), // original request, kept for debugging bad recognitions
  intent: IntentSchema,
  mixes: SceneMixesSchema,
  channels: z.array(ChannelDraftSchema).max(MAX_CHANNELS),
  buses: z.array(BusDefSchema).max(16).default([]),
  mains: z.array(z.object({ main: z.number().int().min(1).max(4), name: z.string().min(1).max(16) })).default([]),
  matrices: z.array(z.object({ mtx: z.number().int().min(1).max(8), name: z.string().min(1).max(16), from: z.number().int().min(1).max(4) })).default([]),
  pages: z.array(PageSpecSchema).max(2), // empty = standard pages only
});
export type Scene = z.infer<typeof SceneSchema>;

// ---------------------------------------------------------------- channels

type Slot = { kind: SourceKind; label?: string } | null; // null = reserved channel, left untouched

function expandKinds(intent: Intent): Slot[] {
  const counts = new Map<SourceKind, number>();
  for (const s of intent.sources) {
    const parts = s.kind === "drum_kit" ? DRUM_KIT.map((d) => ({ ...d, count: d.count * s.count })) : [{ kind: s.kind, count: s.count }];
    for (const p of parts) counts.set(p.kind, (counts.get(p.kind) ?? 0) + p.count);
  }
  return LAYOUT_ORDER.flatMap((kind) => Array.from({ length: counts.get(kind) ?? 0 }, () => ({ kind })));
}

// Explicit layout in the order given: "Mic{n}" ×7 → Mic1…Mic7, stereo → "Keys L"/"Keys R", reserve → gap.
function explicitSlots(intent: Intent): Slot[] {
  const slots: Slot[] = [];
  for (const c of intent.channels) {
    if (c.kind === "reserve") {
      for (let i = 0; i < c.count; i++) slots.push(null);
      continue;
    }
    for (let i = 1; i <= c.count; i++) {
      const base = c.label === undefined ? undefined : c.label.includes("{n}") ? c.label.replace("{n}", String(i)) : c.count > 1 ? `${c.label} ${i}` : c.label;
      // Stereo pairs are named "<name> L/R"; without a given name the preset one ("Keys L", "SPD R").
      if (c.stereo) for (const side of ["L", "R"]) slots.push({ kind: c.kind, label: `${base ?? CHANNEL_PRESETS[c.kind].label} ${side}`.slice(0, 16) });
      else slots.push({ kind: c.kind, label: base?.slice(0, 16) });
    }
  }
  return slots;
}

const expandContains = (kinds: Intent["monitors"][number]["contains"]): SourceKind[] =>
  kinds.flatMap((k) => (k === "drum_kit" ? DRUM_KIT.map((d) => d.kind) : [k]));

export function mixesFrom(intent: Intent): SceneMixes {
  return {
    monitors: intent.mixes.length ? [] : intent.monitors.map((m) => ({ role: MONITOR_ROLE[m.for], contains: expandContains(m.contains), iem: m.iem })),
    fx: [...new Set(intent.fx.map((f) => FX_ROLE[f]))],
    stream: intent.stream && intent.streamVia === "bus",
  };
}

// Preset-derived values for a kind, limited to the role mixes the scene uses.
function presetFields(kind: SourceKind, mixes: SceneMixes) {
  const p = CHANNEL_PRESETS[kind];
  return {
    label: p.label,
    color: p.color as ColorId,
    hpf: p.hpf,
    comp: p.comp,
    gate: p.gate,
    fxSends: p.fx.filter((f) => mixes.fx.includes(f)) as string[],
    monitorSends: mixes.monitors
      .filter((m) =>
        m.contains.length
          ? m.contains.includes(kind)
          : (p.monitor as MonitorRole[]).includes(m.role) && (!("iemOnly" in p) || m.iem), // ambience only in ears
      )
      .map((m) => m.role) as string[],
    stream: mixes.stream,
    dca: p.dca as DcaGroup | null,
  };
}

// Channels a reference points at: "all", a kind ("vocal", "drum_kit") or a label ("Mic1", "Drums" → Drums L/R).
export function resolveRef<T extends { kind: SourceKind; label: string }>(ref: string, channels: T[]): T[] {
  const r = ref.trim().toLowerCase();
  if (r === "all") return channels;
  if (r === "drum_kit") return channels.filter((c) => DRUM_KINDS.includes(c.kind));
  if ((SOURCE_KINDS as readonly string[]).includes(r)) return channels.filter((c) => c.kind === r);
  return channels.filter((c) => {
    const l = c.label.toLowerCase();
    return l === r || l.startsWith(r + " ");
  });
}

// Everything starts muted; `unmute` opens sources, explicit `mute` closes them again.
function muted(intent: Intent, kind: SourceKind): boolean {
  const hit = (list: Intent["unmute"]) => list.includes("all") || expandContains(list.filter((k) => k !== "all") as never).includes(kind);
  return hit(intent.mute) || !hit(intent.unmute);
}

// ---------------------------------------------------------------- buses

type BusDraft = Omit<BusDef, "bus"> & { prefer?: number };

// Role buses keep their usual numbers when free; everything else takes the lowest free bus.
function allocate(drafts: BusDraft[]): BusDef[] {
  const preferred = new Set(drafts.flatMap((d) => (d.prefer ? [d.prefer] : [])));
  const used = new Set<number>();
  const free = (avoid: Set<number>) => {
    for (const skip of [avoid, new Set<number>()]) {
      for (let n = 1; n <= 16; n++) {
        if (used.has(n) || skip.has(n)) continue;
        used.add(n);
        return n;
      }
    }
    throw new Error("Сцене нужно больше 16 шин");
  };
  // Named mixes and groups take the lowest free buses, keeping role numbers (MON 1–7, FX 13–15, Stream 16) clear;
  // role buses then take their usual number, or the next free one if a named mix already holds it.
  const num = new Map<BusDraft, number>();
  for (const d of drafts) if (!d.prefer) num.set(d, free(preferred));
  for (const d of drafts) {
    if (!d.prefer) continue;
    if (used.has(d.prefer)) num.set(d, free(new Set()));
    else {
      used.add(d.prefer);
      num.set(d, d.prefer);
    }
  }
  return drafts
    .map((d) => {
      const { prefer, ...rest } = d;
      void prefer;
      return { ...rest, bus: num.get(d)! };
    })
    .sort((a, b) => a.bus - b.bus);
}

function roleBus(role: BusRole, iem: boolean): BusDraft {
  const b = BUS_LAYOUT[role];
  const kind = role === "stream" ? "stream" : role.startsWith("fx_") ? "fx" : "monitor";
  return {
    id: role,
    prefer: b.bus,
    name: iem ? b.name.replace(/^MON/, "IEM") : b.name,
    kind,
    color: b.color,
    mono: iem ? false : b.mono,
    mode: b.mode,
    toMain: b.toMain,
    iem,
    fader: DEFAULT_LEVEL_DB,
    icon: iem ? IEM_ICON : b.icon,
    fx: b.fx,
  };
}

// ---------------------------------------------------------------- expand

export function expand(intent: Intent, text = ""): Scene {
  const slots = intent.channels.length ? explicitSlots(intent) : expandKinds(intent);
  if (slots.length > MAX_CHANNELS) throw new Error(`Нужно ${slots.length} каналов, у WING только ${MAX_CHANNELS}`);
  const mixes = mixesFrom(intent);
  const total = new Map<SourceKind, number>();
  for (const s of slots) if (s && !s.label) total.set(s.kind, (total.get(s.kind) ?? 0) + 1);
  const seen = new Map<SourceKind, number>();

  const channels: ChannelDraft[] = [];
  slots.forEach((slot, i) => {
    if (!slot) return; // reserved channel
    const { kind } = slot;
    const f = presetFields(kind, mixes);
    let label = slot.label;
    if (!label) {
      const n = (seen.get(kind) ?? 0) + 1;
      seen.set(kind, n);
      label = total.get(kind)! > 1 ? `${f.label} ${n}` : f.label;
    }
    channels.push({
      ch: i + 1,
      kind,
      ...f,
      label,
      mute: muted(intent, kind),
      fader: DEFAULT_LEVEL_DB,
      sendLevel: {},
      groups: [],
      toMain: (CHANNEL_PRESETS[kind] as ChannelPreset).main !== false,
      edited: [],
    });
  });

  // Buses: named mixes, groups, then role buses (monitors, FX, stream).
  const drafts: BusDraft[] = [];
  intent.mixes.forEach((m, k) => {
    const own = m.own.flatMap((r) => resolveRef(r, channels));
    drafts.push({
      id: `mix${k + 1}`,
      name: m.name,
      kind: "monitor",
      color: own[0]?.color ?? "grayblue",
      mono: !m.iem,
      mode: "PRE",
      toMain: false,
      iem: m.iem,
      fader: DEFAULT_LEVEL_DB,
      icon: m.iem ? IEM_ICON : 601,
    });
    const members = new Set(m.contains.flatMap((r) => resolveRef(r, channels)));
    for (const c of channels) {
      const isOwn = own.includes(c);
      if (members.has(c) || isOwn) c.monitorSends.push(`mix${k + 1}`);
      if (isOwn) c.sendLevel[`mix${k + 1}`] = 0; // the musician's own instrument at unity
    }
  });
  intent.groups.forEach((g, k) => {
    const except = new Set(g.except.flatMap((r) => resolveRef(r, channels)));
    const members = g.members.flatMap((r) => resolveRef(r, channels)).filter((c) => !except.has(c));
    drafts.push({
      id: `grp${k + 1}`,
      name: g.name,
      kind: "group",
      color: members[0]?.color ?? "grayblue",
      mono: false,
      mode: "GRP",
      toMain: true,
      iem: false,
      fader: 0, // a group passes its members through at unity
      icon: 5,
    });
    for (const c of new Set(members)) {
      c.groups.push(`grp${k + 1}`);
      c.toMain = false; // "сначала в группу, потом в мастер"
    }
  });
  for (const m of mixes.monitors) drafts.push(roleBus(m.role, m.iem));
  for (const f of mixes.fx) drafts.push(roleBus(f, false));
  if (mixes.stream) drafts.push(roleBus("stream", false));
  const buses = allocate(drafts);

  // Explicit levels from the request override the -18 dB default, in the order given.
  for (const l of intent.levels) {
    const kinds = new Set(l.sources.flatMap((k) => (k === "all" ? kinds_all(channels) : expandContains([k]))));
    for (const c of channels) {
      if (!kinds.has(c.kind)) continue;
      if (l.target === "fader") c.fader = l.db;
      else c.sendLevel[levelRole(l.target)] = l.db;
    }
  }
  // Explicit processing overrides ("hpf на вокале 150", "без компрессии на басе").
  for (const st of intent.settings) {
    const kinds = new Set(st.sources.flatMap((k) => (k === "all" ? kinds_all(channels) : expandContains([k]))));
    for (const c of channels) {
      if (!kinds.has(c.kind)) continue;
      if (st.hpf !== undefined) c.hpf = st.hpf;
      if (st.comp !== undefined) c.comp = st.comp;
      if (st.gate !== undefined) c.gate = st.gate;
      for (const f of st.sendTo ?? []) {
        const role = FX_ROLE[f];
        if (mixes.fx.includes(role) && !c.fxSends.includes(role)) c.fxSends = [...c.fxSends, role];
      }
    }
  }
  const pages = intent.pages.map((p) => ({
    ...p,
    sources: p.sources.flatMap((k) => (k === "all" ? ["all" as const] : expandContains([k]))),
  }));
  const matrices = intent.stream && intent.streamVia === "matrix" ? [{ mtx: 1, name: "Stream", from: 1 }] : [];
  return { version: 1, text, intent, mixes, channels, buses, mains: intent.mains, matrices, pages };
}

const kinds_all = (channels: ChannelDraft[]) => channels.map((c) => c.kind);
// "monitor_bass" → "mon_bass", "delay" → "fx_delay", "stream" → "stream".
const levelRole = (t: Exclude<Intent["levels"][number]["target"], "fader">): BusRole =>
  t === "stream" ? "stream" : t.startsWith("monitor_") ? MONITOR_ROLE[t.slice(8) as keyof typeof MONITOR_ROLE] : FX_ROLE[t as keyof typeof FX_ROLE];

// Send level into a bus (missing = the -18 dB default).
export const sendLevelOf = (c: ChannelDraft, busId: string) => c.sendLevel[busId] ?? DEFAULT_LEVEL_DB;

// A new channel of `kind` on the first free WING channel, preset defaults, muted. null when all 40 are used.
// Named mixes that take "all" channels get it too.
export function newChannel(scene: Scene, kind: SourceKind): ChannelDraft | null {
  const used = new Set(scene.channels.map((c) => c.ch));
  let ch = 1;
  while (used.has(ch)) ch++;
  if (ch > MAX_CHANNELS) return null;
  const f = presetFields(kind, scene.mixes);
  const allMixes = scene.intent.mixes.flatMap((m, k) => (m.contains.includes("all") || m.contains.includes(kind) ? [`mix${k + 1}`] : []));
  return {
    ch,
    kind,
    ...f,
    monitorSends: [...f.monitorSends, ...allMixes],
    mute: true,
    fader: DEFAULT_LEVEL_DB,
    sendLevel: {},
    groups: [],
    toMain: (CHANNEL_PRESETS[kind] as ChannelPreset).main !== false,
    edited: [],
  };
}

// Change a channel's kind: preset values replace only fields the user has not edited.
// Named-mix and group memberships are kept (they are about the channel, not the instrument type).
export function applyKind(draft: ChannelDraft, kind: SourceKind, mixes: SceneMixes): ChannelDraft {
  const f = presetFields(kind, mixes);
  const roleIds = new Set<string>(MONITOR_ROLES);
  const next: ChannelDraft = { ...draft, kind };
  for (const key of Object.keys(f) as (keyof typeof f)[]) {
    if (draft.edited.includes(key)) continue;
    if (key === "monitorSends") next.monitorSends = [...f.monitorSends, ...draft.monitorSends.filter((id) => !roleIds.has(id))];
    else (next as Record<string, unknown>)[key] = f[key];
  }
  return next;
}

// User edit from the table: set the value and remember it was hand-edited.
export function editField<K extends EditableField>(draft: ChannelDraft, key: K, value: ChannelDraft[K]): ChannelDraft {
  return { ...draft, [key]: value, edited: draft.edited.includes(key) ? draft.edited : [...draft.edited, key] };
}
