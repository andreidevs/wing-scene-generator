import { z } from "zod";
import { FX_TEMPLATES } from "./fx-templates";
import { layerPlan, pageStrips, type Layers } from "./layers";
import { cloneNode, fromValue, getNode, parseOrdered, replaceNode, serialize, toValue } from "./ordered-json";
import {
  BUS_LAYOUT, CHANNEL_PRESETS, DCA_COLORS, DCA_GROUPS, DCA_ICONS, DCA_LEVEL_DB, DEFAULT_LEVEL_DB,
  type BusRole, type ChannelPreset, type ColorId,
} from "./presets";
import type { Scene } from "./scene";

// WING palette, indexes 1..12 (WING Remote Protocols, Appendix "WING Colors"):
// 1 gray blue, 2 medium blue, 3 dark blue, 4 turquoise, 5 green, 6 olive green,
// 7 yellow, 8 orange, 9 red, 10 coral, 11 pink, 12 mauve. FW 3.3 files also contain 13..18.
export const WING_COLOR: Record<ColorId, number> = {
  gray: 1, blue: 2, cyan: 4, green: 5, yellow: 7, orange: 8, red: 9, pink: 11, purple: 12,
};

// ---------- allowlist: path template → value schema + diff group ----------

export type Kind = "Имена" | "Цвета" | "Иконки" | "HPF" | "Gate" | "Компрессоры" | "Mute" | "Посылы" | "Фейдеры" | "DCA" | "Шины" | "FX" | "Страницы";

const PH: Record<string, string> = {
  ch: "([1-9]|[1-3]\\d|40)",
  bus: "([1-9]|1[0-6])",
  dca: "([1-9]|1[0-6])",
  main: "[1-4]",
  fx8: "[1-8]", // reverbs are only allowed in FX1..FX8
  sec: "(L|C|R|CMPCT|RCK|EXT|VRT|WEDIT)",
  pg: "\\d{1,2}",
  slot: "\\d{1,2}",
};
const COUNTS: Record<string, number> = { ch: 40, bus: 16, dca: 16, main: 4, fx8: 8 };

const col = z.number().int().min(1).max(18);
const db = z.number().min(-144).max(10);
const icon = z.number().int().min(0).max(999);
const fxTemplates = Object.values(FX_TEMPLATES).map((t) => JSON.stringify(JSON.parse(t)));

const RULES: { tpl: string; schema: z.ZodType; kind: Kind }[] = [
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
  return RULES.filter((r) => !r.tpl.startsWith("ce_data/")).flatMap((r) => expand(r.tpl));
}

// ---------- compile: scene → patches ----------

export type Patch = { op: "set"; path: string; value: string | number | boolean | object };

export function usedRoles(scene: Scene): BusRole[] {
  const roles = new Set<BusRole>();
  for (const c of scene.channels) {
    c.monitorSends.forEach((r) => roles.add(r));
    c.fxSends.forEach((r) => roles.add(r));
    if (c.stream) roles.add("stream");
  }
  return Object.keys(BUS_LAYOUT).filter((r) => roles.has(r as BusRole)) as BusRole[];
}

const dcaNumber = (g: string) => DCA_GROUPS.indexOf(g as (typeof DCA_GROUPS)[number]) + 1;

// Replace DCA tags (#D…), keep everything else (mute groups #M…, user tags).
function withDca(tags: string, dca: number | null): string {
  const rest = tags.split(",").filter((t) => t && !/^#D\d+$/.test(t));
  return [...(dca ? [`#D${dca}`] : []), ...rest].join(",");
}

export type BaselineSnap = { ae_data: { ch: Record<string, { tags: string }> }; ce_data?: { layer?: Layers } };

const segsOf = (path: string) => (path.startsWith("ce_data/") ? path.split("/") : ["ae_data", ...path.split("/")]);

// `base` is the parsed baseline (read-only): channel tags to merge, and the page layout.
export function compile(scene: Scene, base: BaselineSnap): Patch[] {
  const ae = base.ae_data;
  const p: Patch[] = [];
  const set = (path: string, value: Patch["value"]) => p.push({ op: "set", path, value });
  const roles = usedRoles(scene);

  const iem = new Set(scene.mixes.monitors.filter((m) => m.iem).map((m) => m.role as BusRole));
  for (const role of roles) {
    const b = BUS_LAYOUT[role];
    const ears = iem.has(role);
    set(`bus/${b.bus}/name`, ears ? b.name.replace(/^MON/, "IEM") : b.name);
    set(`bus/${b.bus}/col`, WING_COLOR[b.color]);
    if (b.icon !== undefined) set(`bus/${b.bus}/icon`, b.icon);
    set(`bus/${b.bus}/busmono`, ears ? false : b.mono); // in-ear mixes are stereo
    set(`bus/${b.bus}/fdr`, DEFAULT_LEVEL_DB);
    set(`bus/${b.bus}/main/1/on`, b.toMain);
    if (b.toMain) set(`bus/${b.bus}/main/1/lvl`, 0);
    if (b.fx) {
      set(`fx/${b.fx.slot}`, JSON.parse(FX_TEMPLATES[b.fx.template]));
      set(`bus/${b.bus}/preins/on`, true);
      set(`bus/${b.bus}/preins/ins`, `FX${b.fx.slot}`);
    }
  }

  // In-ear mixes get the FX returns (reverb/delay), at the default level.
  for (const fxRole of roles.filter((r) => BUS_LAYOUT[r].fx)) {
    for (const mon of roles.filter((r) => iem.has(r))) {
      set(`bus/${BUS_LAYOUT[fxRole].bus}/send/${BUS_LAYOUT[mon].bus}/on`, true);
      set(`bus/${BUS_LAYOUT[fxRole].bus}/send/${BUS_LAYOUT[mon].bus}/lvl`, DEFAULT_LEVEL_DB);
    }
  }

  const groups = new Set<string>();
  for (const c of scene.channels) {
    const ch = `ch/${c.ch}`;
    set(`${ch}/clink`, false); // show the channel's own name/color, not the source's
    set(`${ch}/name`, c.label);
    set(`${ch}/col`, WING_COLOR[c.color]);
    const preset: ChannelPreset = CHANNEL_PRESETS[c.kind];
    if (preset.icon !== undefined) set(`${ch}/icon`, preset.icon);
    if (preset.main === false) set(`${ch}/main/1/on`, false); // click / talkback stay out of FOH
    set(`${ch}/flt/lc`, true);
    set(`${ch}/flt/lcf`, c.hpf);
    set(`${ch}/gate/on`, c.gate);
    set(`${ch}/dyn/on`, c.comp);
    set(`${ch}/mute`, c.mute);
    set(`${ch}/fdr`, c.fader);
    for (const role of roles) {
      const b = BUS_LAYOUT[role];
      const on = role === "stream" ? c.stream : (c.monitorSends as string[]).includes(role) || (c.fxSends as string[]).includes(role);
      set(`${ch}/send/${b.bus}/on`, on);
      if (on) {
        set(`${ch}/send/${b.bus}/lvl`, c.sendLevel[role]);
        set(`${ch}/send/${b.bus}/mode`, b.mode);
      }
    }
    if (c.dca) groups.add(c.dca);
    set(`${ch}/tags`, withDca(ae.ch[String(c.ch)]?.tags ?? "", c.dca ? dcaNumber(c.dca) : null));
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
    const buses = roles.map((r) => BUS_LAYOUT[r].bus);
    const dcas = DCA_GROUPS.filter((g) => groups.has(g)).map(dcaNumber);
    const user = [0, 1].map((k) => scene.pages[k] && pageStrips(scene.pages[k], scene.channels, buses, dcas));
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
  { label: "Routing", re: /^ae_data\/(io\/out\/|ch\/\d+\/in\/conn\/)/ },
  { label: "Gain", re: /^ae_data\/(io\/in\/[^/]+\/\d+\/g$|ch\/\d+\/in\/set\/trim$)/ },
  { label: "Phantom", re: /^ae_data\/io\/in\/[^/]+\/\d+\/vph$/ },
  { label: "Main bus", re: /^ae_data\/main\// },
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
  const m = /^(ch|bus|dca|fx)\/(\d+)\/?(.*)$/.exec(p);
  if (!m) return `${p}: ${v(e.before)} → ${v(e.after)}`;
  const [, sec, n, rest] = m;
  const who = { ch: "CH", bus: "Bus", dca: "DCA", fx: "FX" }[sec] + " " + n;
  const send = /^send\/(\d+)\/(on|lvl|mode)$/.exec(rest);
  if (send) return `${who} → Bus ${send[1]} ${send[2]}: ${v(e.before)} → ${v(e.after)}`;
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
