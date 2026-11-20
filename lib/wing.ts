import { z } from "zod";
import { FX_TEMPLATES } from "./fx-templates";
import { layerPlan, pageStrips, type Layers } from "./layers";
import { cloneNode, fromValue, getNode, parseOrdered, replaceNode, serialize, toValue } from "./ordered-json";
import {
  CHANNEL_PRESETS, COLORS, CONSOLES, DCA_COLORS, DCA_GROUPS, DCA_ICONS, TOM_ICONS, DCA_LEVEL_DB, DEFAULT_LEVEL_DB,
  type ChannelPreset, type ColorId,
} from "./presets";
import { sendLevelOf, type Scene } from "./scene";

// WING palette, indexes 1..12 (WING Remote Protocols, Appendix "WING Colors"):
// 1 gray blue, 2 medium blue, 3 dark blue, 4 turquoise, 5 green, 6 olive green,
// 7 yellow, 8 orange, 9 red, 10 coral, 11 pink, 12 mauve. FW 3.3 files also contain 13..18.
export const WING_COLOR = Object.fromEntries(COLORS.map((c, i) => [c, i + 1])) as Record<ColorId, number>;

// ---------- allowlist: path template → value schema + diff group ----------

export type Kind = "Входы" | "Запись" | "Имена" | "Цвета" | "Иконки" | "HPF" | "Gate" | "Компрессоры" | "Mute" | "Посылы" | "Фейдеры" | "DCA" | "Шины" | "FX" | "Страницы";

const PH: Record<string, string> = {
  ch: "([1-9]|[1-3]\\d|40)",
  bus: "([1-9]|1[0-6])",
  dca: "([1-9]|1[0-6])",
  main: "[1-4]",
  fx8: "[1-8]", // reverbs are only allowed in FX1..FX8
  mx: "[1-8]",
  sec: "(L|C|R|CMPCT|RCK|EXT|VRT|WEDIT)",
  pg: "\\d{1,2}",
  slot: "\\d{1,2}",
  grp: "(LCL|AUX|A|B|C|SC|USB|CRD|MOD|PLAY|AES|USR)",
  inp: "([1-9]|[1-5]\\d|6[0-4])",
  usb: "([1-9]|[1-3]\\d|4[0-8])",
  crd: "([1-9]|[1-5]\\d|6[0-4])",
};
const COUNTS: Record<string, number> = { usb: 48, crd: 64, ch: 40, bus: 16, dca: 16, main: 4, fx8: 8, mx: 8 };

const col = z.number().int().min(1).max(18);
const db = z.number().min(-144).max(10);
const icon = z.number().int().min(0).max(999);
const fxTemplates = Object.values(FX_TEMPLATES).map((t) => JSON.stringify(JSON.parse(t)));

const INPUT_GRP = z.enum(["LCL", "AUX", "A", "B", "C", "SC", "USB", "CRD", "MOD", "PLAY", "AES", "USR"]);

const RULES: { tpl: string; schema: z.ZodType; kind: Kind }[] = [
  // Input patch + source mode, laid out per console model (see inputPatch).
  { tpl: "ch/{ch}/in/conn/grp", schema: INPUT_GRP, kind: "Входы" },
  { tpl: "ch/{ch}/in/conn/in", schema: z.number().int().min(1).max(64), kind: "Входы" },
  { tpl: "io/in/{grp}/{inp}/mode", schema: z.enum(["M", "ST"]), kind: "Входы" },
  { tpl: "ch/{ch}/in/conn/altgrp", schema: INPUT_GRP, kind: "Входы" },
  { tpl: "ch/{ch}/in/conn/altin", schema: z.number().int().min(1).max(64), kind: "Входы" },
  // Input select GLOBAL: the channel follows the console's main/alt switch (as in show-working.snap, CH 1–24).
  { tpl: "ch/{ch}/in/set/srcauto", schema: z.literal(true), kind: "Входы" },
  // Recording outputs: USB (DAW) and the WING-LIVE card, fed straight from the channel inputs.
  { tpl: "io/out/USB/{usb}/grp", schema: INPUT_GRP, kind: "Запись" },
  { tpl: "io/out/USB/{usb}/in", schema: z.number().int().min(1).max(64), kind: "Запись" },
  { tpl: "io/out/CRD/{crd}/grp", schema: INPUT_GRP, kind: "Запись" },
  { tpl: "io/out/CRD/{crd}/in", schema: z.number().int().min(1).max(64), kind: "Запись" },
  { tpl: "ch/{ch}/name", schema: z.string().min(1).max(16), kind: "Имена" },
  // clink=true: strip shows the *source* name/color (clean base default); false: its own. Verified
  // on show-working.snap: clink=true channels show the source name, clink=false keep their own.
  { tpl: "ch/{ch}/clink", schema: z.literal(false), kind: "Имена" },
  { tpl: "ch/{ch}/col", schema: col, kind: "Цвета" },
  { tpl: "ch/{ch}/icon", schema: icon, kind: "Иконки" },
  { tpl: "ch/{ch}/flt/lc", schema: z.boolean(), kind: "HPF" },
  { tpl: "ch/{ch}/flt/lcf", schema: z.number().min(20).max(2000), kind: "HPF" },
  { tpl: "ch/{ch}/gate/on", schema: z.boolean(), kind: "Gate" },
  { tpl: "ch/{ch}/dyn/on", schema: z.boolean(), kind: "Компрессоры" },
  { tpl: "ch/{ch}/mute", schema: z.boolean(), kind: "Mute" },
  { tpl: "ch/{ch}/fdr", schema: db, kind: "Фейдеры" },
  { tpl: "ch/{ch}/main/{main}/on", schema: z.boolean(), kind: "Посылы" },
  { tpl: "ch/{ch}/send/{bus}/on", schema: z.boolean(), kind: "Посылы" },
  { tpl: "ch/{ch}/send/{bus}/lvl", schema: db, kind: "Посылы" },
  { tpl: "ch/{ch}/send/{bus}/mode", schema: z.enum(["PRE", "POST", "GRP"]), kind: "Посылы" },
  { tpl: "ch/{ch}/tags", schema: z.string().max(80).regex(/^(#[A-Za-z]\d{1,2}(,#[A-Za-z]\d{1,2})*)?$/), kind: "DCA" },
  { tpl: "bus/{bus}/name", schema: z.string().min(1).max(16), kind: "Шины" },
  { tpl: "bus/{bus}/col", schema: col, kind: "Шины" },
  { tpl: "bus/{bus}/icon", schema: icon, kind: "Иконки" },
  { tpl: "bus/{bus}/busmono", schema: z.boolean(), kind: "Шины" },
  { tpl: "bus/{bus}/fdr", schema: db, kind: "Фейдеры" },
  { tpl: "bus/{bus}/main/{main}/on", schema: z.boolean(), kind: "Шины" },
  // Bus → bus sends: FX returns into in-ear mixes (as in the working show: Hall → M-Voc2, Room → M-Drums).
  { tpl: "bus/{bus}/send/{bus}/on", schema: z.boolean(), kind: "Посылы" },
  { tpl: "bus/{bus}/send/{bus}/lvl", schema: db, kind: "Посылы" },
  { tpl: "bus/{bus}/main/{main}/lvl", schema: db, kind: "Шины" },
  { tpl: "bus/{bus}/preins/on", schema: z.boolean(), kind: "FX" },
  { tpl: "bus/{bus}/preins/ins", schema: z.string().regex(/^(NONE|FX([1-9]|1[0-6]))$/), kind: "FX" },
  { tpl: "fx/{fx8}", schema: z.unknown().refine((v) => fxTemplates.includes(JSON.stringify(v)), "не известный шаблон FX"), kind: "FX" },
  // Mains and matrices: names only, plus the Main → Matrix send that feeds a stream matrix.
  { tpl: "main/{main}/name", schema: z.string().min(1).max(16), kind: "Шины" },
  { tpl: "main/{main}/send/MX{mx}/on", schema: z.boolean(), kind: "Шины" },
  { tpl: "main/{main}/send/MX{mx}/lvl", schema: db, kind: "Шины" },
  { tpl: "mtx/{mx}/name", schema: z.string().min(1).max(16), kind: "Шины" },
  { tpl: "mtx/{mx}/col", schema: col, kind: "Шины" },
  { tpl: "mtx/{mx}/icon", schema: icon, kind: "Иконки" },
  { tpl: "mtx/{mx}/fdr", schema: db, kind: "Фейдеры" },
  { tpl: "mgrp/{mx}/name", schema: z.string().min(1).max(16), kind: "DCA" },
  { tpl: "dca/{dca}/name", schema: z.string().min(1).max(8), kind: "DCA" },
  { tpl: "dca/{dca}/col", schema: col, kind: "DCA" },
  { tpl: "dca/{dca}/icon", schema: icon, kind: "Иконки" },
  { tpl: "dca/{dca}/fdr", schema: db, kind: "DCA" },
  // Surface pages. Paths starting with "ce_data/" are root-relative; everything else is under ae_data.
  { tpl: "ce_data/layer/{sec}/{pg}/{slot}/type", schema: z.enum(["CH", "BUS", "DCA", "OFF"]), kind: "Страницы" },
  { tpl: "ce_data/layer/{sec}/{pg}/{slot}/i", schema: z.number().int().min(0).max(48), kind: "Страницы" },
];

const ALLOWED = RULES.map((r) => ({
  ...r,
  re: new RegExp(`^${r.tpl.replace(/\{(\w+)\}/g, (_, p) => PH[p])}$`),
}));

const ruleFor = (path: string) => ALLOWED.find((r) => r.re.test(path));

// Every concrete path the allowlist can touch; the baseline validator checks they all exist.
export function allowedPaths(): string[] {
  const expand = (tpl: string): string[] => {
    const m = /\{(\w+)\}/.exec(tpl);
    if (!m) return [tpl];
    return Array.from({ length: COUNTS[m[1]] }, (_, i) => expand(tpl.replace(m[0], String(i + 1)))).flat();
  };
  // Page slots vary per section, so they are checked when patched, not up front.
  // Page slots vary per section and input groups per console, so those are checked when patched.
  return RULES.filter((r) => !r.tpl.startsWith("ce_data/") && !r.tpl.includes("{grp}")).flatMap((r) => expand(r.tpl));
}

// ---------- compile: scene → patches ----------

export type Patch = { op: "set"; path: string; value: string | number | boolean | object };

// Role ids among the scene's buses (for callers that think in roles: reports, the baseline validator).
const dcaNumber = (g: string) => DCA_GROUPS.indexOf(g as (typeof DCA_GROUPS)[number]) + 1;

// Replace DCA tags (#D…) and, when the scene defines mute groups, #M… too; keep user tags.
function withTags(tags: string, dca: number | null, mutes: number[] | null): string {
  const rest = tags.split(",").filter((t) => t && !/^#D\d+$/.test(t) && !(mutes && /^#M\d+$/.test(t)));
  return [...(dca ? [`#D${dca}`] : []), ...(mutes ?? []).map((m) => `#M${m}`), ...rest].join(",");
}

export type BaselineSnap = {
  ae_data: { ch: Record<string, { tags: string; in?: { conn: { grp: string; in: number } } }>; io?: { in: Record<string, Record<string, unknown>> } };
  ce_data?: { layer?: Layers };
};

// Inputs follow the channel order on the chosen console: local inputs first (WING 8, Rack/Compact 24),
// then the AES50 A stage box. WING stereo lives on the source, not the channel: an ST input pair (always
// odd/even, e.g. LCL 11/12) feeds one channel connected to the odd input. CH 1…last scene channel are patched,
// reserved ones too (they keep an input for later). A baseline whose CH 1 is not on LCL keeps its group.
export type InputPatch = { channels: Map<number, { grp: string; in: number; stereo: boolean }>; modes: Map<string, ("M" | "ST")[]> };

const AES50_SIZE = 48;

// "LCL11/12" per channel: the patch the build will write, else the baseline's.
export function inputLabels(scene: Scene, base: BaselineSnap): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [n, c] of Object.entries(base.ae_data.ch)) if (c.in) out[Number(n)] = `${c.in.conn.grp}${c.in.conn.in}`;
  let patch: InputPatch | null = null;
  try {
    patch = inputPatch(scene, base);
  } catch {
    return out; // too many inputs: the build reports it
  }
  if (patch) for (const [n, i] of patch.channels) out[n] = `${i.grp}${i.in}${i.stereo ? `/${i.in + 1}` : ""}`;
  return out;
}

// Recording tracks in channel order (CH 1…last scene channel, reserved ones too): each channel's input,
// two tracks for a stereo pair starting on an odd number (so the card can play it back as an ST pair).
// `out` is the track number: USB out / CRD out k, and CRD in k as the channel's ALT input.
export type Track = { ch: number; label: string; grp: string; in: number; out: number; stereo: boolean };

export function recordTracks(scene: Scene, base: BaselineSnap): Track[] {
  const patch = inputPatch(scene, base);
  const labels = new Map(scene.channels.map((c) => [c.ch, c.label]));
  const last = Math.max(0, ...scene.channels.map((c) => c.ch));
  const tracks: Track[] = [];
  let out = 1;
  for (let n = 1; n <= last; n++) {
    const p = patch?.channels.get(n);
    const conn = p ?? base.ae_data.ch[String(n)]?.in?.conn;
    if (!conn || conn.grp === "OFF") continue;
    const label = labels.get(n) ?? `CH ${n}`;
    if (p?.stereo) {
      if (out % 2 === 0) out++; // the even track before the pair stays empty
      tracks.push({ ch: n, label: `${label} L`, grp: p.grp, in: p.in, out, stereo: true }, { ch: n, label: `${label} R`, grp: p.grp, in: p.in + 1, out: out + 1, stereo: true });
      out += 2;
    } else tracks.push({ ch: n, label, grp: conn.grp, in: conn.in, out: out++, stereo: false });
  }
  return tracks;
}

export function inputPatch(scene: Scene, base: BaselineSnap): InputPatch | null {
  const first = base.ae_data.ch["1"]?.in?.conn.grp;
  if (!first || first === "OFF" || !scene.channels.length) return null; // ponytail: unpatched baseline → inputs stay manual
  const size = (g: string) => Object.keys(base.ae_data.io?.in[g] ?? {}).length;
  const groups: [string, number][] =
    first === "LCL" ? [["LCL", Math.min(CONSOLES[scene.console].local, size("LCL"))], ["A", Math.min(AES50_SIZE, size("A"))]] : [[first, size(first)]];
  const stereo = new Set(scene.channels.filter((c) => c.stereo).map((c) => c.ch));
  const last = Math.max(...scene.channels.map((c) => c.ch));
  const channels: InputPatch["channels"] = new Map();
  const modes: InputPatch["modes"] = new Map(groups.map(([g]) => [g, []])); // modes.get(g)[k-1] = mode of input k
  let gi = 0;
  for (let n = 1; n <= last; n++) {
    const st = stereo.has(n);
    for (;;) {
      if (gi >= groups.length) throw new Error(`Не хватает входов: ${groups.map(([g, k]) => `${g} ${k}`).join(" + ")} на ${CONSOLES[scene.console].label}`);
      const [g, cap] = groups[gi];
      const m = modes.get(g)!;
      const at = m.length + 1 + (st && m.length % 2 === 1 ? 1 : 0); // pairs start on an odd input
      if (at + (st ? 1 : 0) > cap) {
        gi++;
        continue;
      }
      if (at > m.length + 1) m.push("M"); // the skipped even input stays free
      channels.set(n, { grp: g, in: at, stereo: st });
      m.push(...(st ? (["ST", "ST"] as const) : (["M"] as const)));
      break;
    }
  }
  return { channels, modes };
}

const segsOf = (path: string) => (path.startsWith("ce_data/") ? path.split("/") : ["ae_data", ...path.split("/")]);

// `base` is the parsed baseline (read-only): channel tags to merge, and the page layout.
export function compile(scene: Scene, base: BaselineSnap): Patch[] {
  const ae = base.ae_data;
  const p: Patch[] = [];
  const set = (path: string, value: Patch["value"]) => p.push({ op: "set", path, value });
  const buses = scene.buses;

  const inputs = inputPatch(scene, base);
  if (inputs) {
    for (const [n, i] of inputs.channels) {
      set(`ch/${n}/in/set/srcauto`, true);
      set(`ch/${n}/in/conn/grp`, i.grp);
      set(`ch/${n}/in/conn/in`, i.in);
    }
    for (const [g, m] of inputs.modes) m.forEach((mode, k) => set(`io/in/${g}/${k + 1}/mode`, mode));
  }
  const tracks = recordTracks(scene, base);
  const lastTrack = tracks.at(-1)?.out ?? 0;
  const targets = [...(scene.record.usb ? [["USB", 48]] : []), ...(scene.record.card ? [["CRD", 64]] : [])] as [string, number][];
  for (const [out, size] of targets) {
    if (lastTrack > size) throw new Error(`На запись ${lastTrack} дорожек, а выходов ${out} только ${size}`);
    for (const t of tracks) {
      set(`io/out/${out}/${t.out}/grp`, t.grp);
      set(`io/out/${out}/${t.out}/in`, t.in);
    }
  }
  // ALT input = the channel's own track on the WING-LIVE card (playback / virtual soundcheck through the
  // global main/alt switch, input select GLOBAL).
  if (inputs && lastTrack <= 64) {
    for (const t of tracks) {
      set(`io/in/CRD/${t.out}/mode`, t.stereo ? "ST" : "M");
      if (t.label.endsWith(" R") && t.stereo) continue;
      set(`ch/${t.ch}/in/conn/altgrp`, "CRD");
      set(`ch/${t.ch}/in/conn/altin`, t.out);
    }
  }

  for (const b of buses) {
    set(`bus/${b.bus}/name`, b.name);
    set(`bus/${b.bus}/col`, WING_COLOR[b.color]);
    if (b.icon !== undefined) set(`bus/${b.bus}/icon`, b.icon);
    set(`bus/${b.bus}/busmono`, b.mono);
    set(`bus/${b.bus}/fdr`, b.fader);
    set(`bus/${b.bus}/main/1/on`, b.toMain);
    if (b.toMain) set(`bus/${b.bus}/main/1/lvl`, 0);
    if (b.fx) {
      set(`fx/${b.fx.slot}`, JSON.parse(FX_TEMPLATES[b.fx.template]));
      set(`bus/${b.bus}/preins/on`, true);
      set(`bus/${b.bus}/preins/ins`, `FX${b.fx.slot}`);
    }
  }

  // In-ear mixes get the FX returns (reverb/delay), at the default level.
  for (const fxb of buses.filter((b) => b.fx)) {
    for (const mon of buses.filter((b) => b.kind === "monitor" && b.iem)) {
      set(`bus/${fxb.bus}/send/${mon.bus}/on`, true);
      set(`bus/${fxb.bus}/send/${mon.bus}/lvl`, DEFAULT_LEVEL_DB);
    }
  }

  for (const g of scene.muteGroups) if (g.name) set(`mgrp/${g.group}/name`, g.name);

  // Main names ("Tops", "Subs"); channels are assigned to Main 1 only (Main 2+ is fed by hand).
  for (const m of scene.mains) set(`main/${m.main}/name`, m.name);
  // Matrices fed from a main ("Stream" ← Main 1).
  for (const mx of scene.matrices) {
    set(`mtx/${mx.mtx}/name`, mx.name);
    set(`mtx/${mx.mtx}/col`, WING_COLOR.grayblue);
    set(`mtx/${mx.mtx}/icon`, 605);
    set(`mtx/${mx.mtx}/fdr`, 0);
    set(`main/${mx.from}/send/MX${mx.mtx}/on`, true);
    set(`main/${mx.from}/send/MX${mx.mtx}/lvl`, 0);
  }

  const groups = new Set<string>();
  let tomIndex = 0;
  for (const c of scene.channels) {
    const ch = `ch/${c.ch}`;
    set(`${ch}/clink`, false); // show the channel's own name/color, not the source's
    set(`${ch}/name`, c.label);
    set(`${ch}/col`, WING_COLOR[c.color]);
    const preset: ChannelPreset = CHANNEL_PRESETS[c.kind];
    const icon = c.kind === "tom" ? TOM_ICONS[Math.min(tomIndex++, TOM_ICONS.length - 1)] : preset.icon;
    if (icon !== undefined) set(`${ch}/icon`, icon);
    set(`${ch}/main/1/on`, c.toMain); // off for click/talkback/ambience and for channels that go through a group
    set(`${ch}/flt/lc`, true);
    set(`${ch}/flt/lcf`, c.hpf);
    set(`${ch}/gate/on`, c.gate);
    set(`${ch}/dyn/on`, c.comp);
    set(`${ch}/mute`, c.mute);
    set(`${ch}/fdr`, c.fader);
    for (const b of buses) {
      const on =
        b.kind === "stream" ? c.stream : b.kind === "group" ? c.groups.includes(b.id) : b.kind === "fx" ? c.fxSends.includes(b.id) : c.monitorSends.includes(b.id);
      set(`${ch}/send/${b.bus}/on`, on);
      if (on) {
        set(`${ch}/send/${b.bus}/lvl`, b.kind === "group" ? 0 : sendLevelOf(c, b.id));
        set(`${ch}/send/${b.bus}/mode`, b.mode);
      }
    }
    if (c.dca) groups.add(c.dca);
    set(`${ch}/tags`, withTags(ae.ch[String(c.ch)]?.tags ?? "", c.dca ? dcaNumber(c.dca) : null, scene.muteGroups.length ? [...c.muteGroups].sort() : null));
  }

  for (const g of DCA_GROUPS.filter((g) => groups.has(g))) {
    const n = dcaNumber(g);
    set(`dca/${n}/name`, g);
    set(`dca/${n}/col`, WING_COLOR[DCA_COLORS[g]]);
    const icon = DCA_ICONS[g];
    if (icon !== undefined) set(`dca/${n}/icon`, icon);
    set(`dca/${n}/fdr`, DCA_LEVEL_DB);
  }

  // Every channel starts muted, including channels outside the scene.
  const inScene = new Set(scene.channels.map((c) => c.ch));
  for (let n = 1; n <= 40; n++) if (!inScene.has(n)) set(`ch/${n}/mute`, true);

  const layers = base.ce_data?.layer;
  if (layers) {
    const busNums = buses.map((b) => b.bus);
    const dcas = DCA_GROUPS.filter((g) => groups.has(g)).map(dcaNumber);
    const user = [0, 1].map((k) => scene.pages[k] && pageStrips(scene.pages[k], scene.channels, busNums, dcas));
    for (const { path, value } of layerPlan(layers, user)) set(path, value);
  }
  return p;
}

// ---------- apply: baseline text + patches → new snapshot text ----------

export class PatchError extends Error {}

export function apply(baselineRaw: string, patches: Patch[]): string {
  const root = parseOrdered(baselineRaw); // fresh tree: the baseline text is never mutated
  const seen = new Set<string>();
  for (const { path, value } of patches) {
    const rule = ruleFor(path);
    if (!rule) throw new PatchError(`Путь не разрешён: ${path}`);
    const ok = rule.schema.safeParse(value);
    if (!ok.success) throw new PatchError(`Неверное значение для ${path}: ${JSON.stringify(value)} (${ok.error.issues[0]?.message})`);
    if (seen.has(path)) throw new PatchError(`Повторный патч одного пути: ${path}`);
    seen.add(path);
    const segs = segsOf(path);
    const old = getNode(root, segs);
    if (!old) throw new PatchError(`Пути нет в baseline: ${path}`);
    const next = fromValue(value);
    // Keep the original token when the value is unchanged (e.g. 100 vs 100.0), so untouched stays byte-identical.
    if (JSON.stringify(toValue(old)) !== JSON.stringify(value)) replaceNode(root, segs, typeof value === "object" ? cloneNode(next) : next);
  }
  return serialize(root);
}

// ---------- diff: full structural comparison, independent of the patch list ----------

export type DiffEntry = { path: string; before: unknown; after: unknown };

function leaves(v: unknown, prefix: string, out: Map<string, unknown>) {
  if (v !== null && typeof v === "object") {
    for (const [k, c] of Object.entries(v)) leaves(c, prefix ? `${prefix}/${k}` : k, out);
  } else out.set(prefix, v);
  return out;
}

export function diff(beforeRaw: string, afterRaw: string): DiffEntry[] {
  const a = leaves(JSON.parse(beforeRaw), "", new Map());
  const b = leaves(JSON.parse(afterRaw), "", new Map());
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  return keys.filter((k) => a.get(k) !== b.get(k)).map((path) => ({ path, before: a.get(path), after: b.get(path) }));
}

// Guard counters: things the generator must never change. Computed from the real diff.
const GUARDS: { label: string; re: RegExp }[] = [
  // Outputs other than the recording ones (input patch and ALT inputs are allowlisted as "Входы").
  { label: "Routing", re: /^ae_data\/io\/out\/(?!(?:USB|CRD)\/\d+\/(?:grp|in)$)/ },
  { label: "Gain", re: /^ae_data\/(io\/in\/[^/]+\/\d+\/g$|ch\/\d+\/in\/set\/trim$)/ },
  { label: "Phantom", re: /^ae_data\/io\/in\/[^/]+\/\d+\/vph$/ },
  // Main processing/fader/mute/output; names and the Main → Matrix send are allowlisted on purpose.
  { label: "Main bus", re: /^ae_data\/main\/\d+\/(?!name$|send\/MX\d\/(?:on|lvl)$)/ },
  { label: "I/O card", re: /^ae_data\/cards\// },
  { label: "Console config", re: /^(ce_data\/(?!layer\/)|ae_data\/cfg\/|[^/]+$)/ },
];

export type DiffSummary = {
  byKind: Partial<Record<Kind, number>>;
  guards: { label: string; count: number }[];
  outsideAllowlist: DiffEntry[]; // must be empty
  entries: DiffEntry[];
};

// FX slots are replaced as whole objects, so their leaves map to the "fx/N" rule.
const ruleForLeaf = (p: string) =>
  p.startsWith("ce_data/") ? ruleFor(p) : (ruleFor(p.replace(/^ae_data\//, "")) ?? ruleFor(p.replace(/^ae_data\/(fx\/\d+)\/.*$/, "$1")));

export function summarize(entries: DiffEntry[]): DiffSummary {
  const byKind: DiffSummary["byKind"] = {};
  const outsideAllowlist: DiffEntry[] = [];
  for (const e of entries) {
    const r = ruleForLeaf(e.path);
    if (r) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    else outsideAllowlist.push(e);
  }
  const guards = GUARDS.map((g) => ({ label: g.label, count: entries.filter((e) => g.re.test(e.path)).length }));
  return { byKind, guards, outsideAllowlist, entries };
}

// Human-readable line for one diff entry.
export function describe(e: DiffEntry): string {
  const p = e.path.replace(/^ae_data\//, "");
  const v = (x: unknown) => (x === undefined ? "—" : typeof x === "boolean" ? (x ? "on" : "off") : JSON.stringify(x));
  const lay = /^ce_data\/layer\/(\w+)\/(\d+)\/(\d+)\/(type|i)$/.exec(p);
  if (lay) return `Page ${lay[1]}/${lay[2]} slot ${lay[3]} ${lay[4]}: ${v(e.before)} → ${v(e.after)}`;
  const m = /^(ch|bus|dca|fx|main|mtx)\/(\d+)\/?(.*)$/.exec(p);
  if (!m) return `${p}: ${v(e.before)} → ${v(e.after)}`;
  const [, sec, n, rest] = m;
  const who = { ch: "CH", bus: "Bus", dca: "DCA", fx: "FX", main: "Main", mtx: "MTX" }[sec] + " " + n;
  const send = /^send\/(MX)?(\d+)\/(on|lvl|mode)$/.exec(rest);
  if (send) return `${who} → ${send[1] ? "MTX" : "Bus"} ${send[2]} ${send[3]}: ${v(e.before)} → ${v(e.after)}`;
  const label: Record<string, string> = { clink: "name/color from source", name: "name", col: "color", icon: "icon", "flt/lc": "HPF", "flt/lcf": "HPF Hz", "gate/on": "gate", "dyn/on": "comp", mute: "mute", fdr: "fader dB", tags: "tags", busmono: "mono", "preins/on": "insert", "preins/ins": "insert slot", "main/1/on": "→ Main 1", "main/1/lvl": "→ Main 1 dB" };
  return `${who} ${label[rest] ?? rest}: ${v(e.before)} → ${v(e.after)}`;
}

// Where each role bus currently goes in the baseline (outputs are patched by hand).
export function busRoutes(ae: { io: { out: Record<string, Record<string, { grp: string; in: number }>> } }, bus: number): string[] {
  const out: string[] = [];
  for (const [grp, slots] of Object.entries(ae.io.out)) {
    for (const [n, s] of Object.entries(slots)) {
      if (s.grp === "BUS" && (s.in === 2 * bus - 1 || s.in === 2 * bus)) out.push(`${grp} ${n}`);
    }
  }
  return out;
}
