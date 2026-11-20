import { z } from "zod";
import { IntentSchema, SourceKind, type Intent } from "./intent";
import {
  BUS_ROLES, CHANNEL_PRESETS, COLORS, DCA_GROUPS, DEFAULT_LEVEL_DB, DRUM_KIT, FX_ROLE, FX_ROLES, LAYOUT_ORDER, MAX_CHANNELS,
  MONITOR_ROLE, MONITOR_ROLES,
  type BusRole, type DcaGroup, type MonitorRole,
} from "./presets";

const MonitorRoleSchema = z.enum(MONITOR_ROLES);
const FxRoleSchema = z.enum(FX_ROLES);
const EDITABLE = ["label", "color", "hpf", "comp", "gate", "mute", "fader", "monitorSends", "fxSends", "stream", "sendLevel", "dca"] as const;
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
  monitorSends: z.array(MonitorRoleSchema),
  fxSends: z.array(FxRoleSchema),
  stream: z.boolean(),
  sendLevel: z.record(z.enum(BUS_ROLES), Db), // dB per role bus, used when that send is on
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
  pages: z.array(PageSpecSchema).max(2), // empty = standard pages only
});
export type Scene = z.infer<typeof SceneSchema>;

function expandKinds(intent: Intent): SourceKind[] {
  const counts = new Map<SourceKind, number>();
  for (const s of intent.sources) {
    const parts = s.kind === "drum_kit" ? DRUM_KIT.map((d) => ({ ...d, count: d.count * s.count })) : [{ kind: s.kind, count: s.count }];
    for (const p of parts) counts.set(p.kind, (counts.get(p.kind) ?? 0) + p.count);
  }
  return LAYOUT_ORDER.flatMap((k) => Array(counts.get(k) ?? 0).fill(k));
}

const expandContains = (kinds: Intent["monitors"][number]["contains"]): SourceKind[] =>
  kinds.flatMap((k) => (k === "drum_kit" ? DRUM_KIT.map((d) => d.kind) : [k]));

export function mixesFrom(intent: Intent): SceneMixes {
  return {
    monitors: intent.monitors.map((m) => ({ role: MONITOR_ROLE[m.for], contains: expandContains(m.contains), iem: m.iem })),
    fx: [...new Set(intent.fx.map((f) => FX_ROLE[f]))],
    stream: intent.stream,
  };
}

// Preset-derived values for a kind, limited to the mixes the scene uses.
function presetFields(kind: SourceKind, mixes: SceneMixes) {
  const p = CHANNEL_PRESETS[kind];
  return {
    label: p.label,
    color: p.color,
    hpf: p.hpf,
    comp: p.comp,
    gate: p.gate,
    fxSends: p.fx.filter((f) => mixes.fx.includes(f)),
    monitorSends: mixes.monitors
      .filter((m) =>
        m.contains.length
          ? m.contains.includes(kind)
          : (p.monitor as MonitorRole[]).includes(m.role) && (!("iemOnly" in p) || m.iem), // ambience only in ears
      )
      .map((m) => m.role),
    stream: mixes.stream,
    dca: p.dca as DcaGroup | null,
  };
}

// Everything starts muted; `unmute` opens sources, explicit `mute` closes them again.
function muted(intent: Intent, kind: SourceKind): boolean {
  const hit = (list: Intent["unmute"]) => list.includes("all") || expandContains(list.filter((k) => k !== "all") as never).includes(kind);
  return hit(intent.mute) || !hit(intent.unmute);
}

export function expand(intent: Intent, text = ""): Scene {
  const kinds = expandKinds(intent);
  if (kinds.length > MAX_CHANNELS) throw new Error(`Нужно ${kinds.length} каналов, у WING только ${MAX_CHANNELS}`);
  const mixes = mixesFrom(intent);
  const total = new Map<SourceKind, number>();
  for (const k of kinds) total.set(k, (total.get(k) ?? 0) + 1);
  const seen = new Map<SourceKind, number>();

  const channels = kinds.map((kind, i): ChannelDraft => {
    const n = (seen.get(kind) ?? 0) + 1;
    seen.set(kind, n);
    const f = presetFields(kind, mixes);
    return {
      ch: i + 1,
      kind,
      ...f,
      label: total.get(kind)! > 1 ? `${f.label} ${n}` : f.label,
      mute: muted(intent, kind),
      fader: DEFAULT_LEVEL_DB,
      sendLevel: Object.fromEntries(BUS_ROLES.map((r) => [r, DEFAULT_LEVEL_DB])) as Record<BusRole, number>,
      edited: [],
    };
  });
  // Explicit levels from the request override the -18 dB default, in the order given.
  for (const l of intent.levels) {
    const kinds = new Set(l.sources.flatMap((k) => (k === "all" ? kinds_all(channels) : expandContains([k]))));
    for (const c of channels) {
      if (!kinds.has(c.kind)) continue;
      if (l.target === "fader") c.fader = l.db;
      else c.sendLevel[levelRole(l.target)] = l.db;
    }
  }
  // Explicit processing overrides ("hpf на вокале 150", "без компрессии на басе"). Marked as edited
  // so a later kind change in the table keeps them.
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
  return { version: 1, text, intent, mixes, channels, pages };
}

const kinds_all = (channels: ChannelDraft[]) => channels.map((c) => c.kind);
// "monitor_bass" → "mon_bass", "delay" → "fx_delay", "stream" → "stream".
const levelRole = (t: Exclude<Intent["levels"][number]["target"], "fader">): BusRole =>
  t === "stream" ? "stream" : t.startsWith("monitor_") ? MONITOR_ROLE[t.slice(8) as keyof typeof MONITOR_ROLE] : FX_ROLE[t as keyof typeof FX_ROLE];

// A new channel of `kind` on the first free WING channel, preset defaults, muted. null when all 40 are used.
export function newChannel(scene: Scene, kind: SourceKind): ChannelDraft | null {
  const used = new Set(scene.channels.map((c) => c.ch));
  let ch = 1;
  while (used.has(ch)) ch++;
  if (ch > MAX_CHANNELS) return null;
  return {
    ch,
    kind,
    ...presetFields(kind, scene.mixes),
    mute: true,
    fader: DEFAULT_LEVEL_DB,
    sendLevel: Object.fromEntries(BUS_ROLES.map((r) => [r, DEFAULT_LEVEL_DB])) as Record<BusRole, number>,
    edited: [],
  };
}

// Change a channel's kind: preset values replace only fields the user has not edited.
export function applyKind(draft: ChannelDraft, kind: SourceKind, mixes: SceneMixes): ChannelDraft {
  const f = presetFields(kind, mixes);
  const next: ChannelDraft = { ...draft, kind };
  for (const key of Object.keys(f) as (keyof typeof f)[]) {
    if (!draft.edited.includes(key)) (next as Record<string, unknown>)[key] = f[key];
  }
  return next;
}

// User edit from the table: set the value and remember it was hand-edited.
export function editField<K extends EditableField>(draft: ChannelDraft, key: K, value: ChannelDraft[K]): ChannelDraft {
  return { ...draft, [key]: value, edited: draft.edited.includes(key) ? draft.edited : [...draft.edited, key] };
}
