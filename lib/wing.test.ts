import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateBaseline } from "./baseline";
import { EXAMPLE_INTENT } from "./example";
import { expand } from "./scene";
import { apply, compile, diff, PatchError, summarize } from "./wing";

const raw = readFileSync("fixtures/baseline.snap", "utf8");
const ae = JSON.parse(raw).ae_data;
const scene = expand(EXAMPLE_INTENT, "ТЗ");
const build = () => apply(raw, compile(scene, JSON.parse(raw)));

test("clean baseline is valid", () => {
  const r = validateBaseline(raw);
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid, true);
  assert.equal(r.firmware, "3.3.1");
  assert.deepEqual(r.routes[1], ["LCL 1"], "clean base routes Bus 1 L to local out 1");
});

test("build is deterministic and leaves the baseline text untouched", () => {
  const copy = raw.slice();
  const a = build();
  const b = build();
  assert.equal(a, b, "byte-identical output for the same scene.json");
  assert.equal(raw, copy);
  assert.notEqual(a, raw);
});

test("ТЗ scene: only allowlisted fields change, guards stay at 0", () => {
  const s = summarize(diff(raw, build()));
  assert.deepEqual(s.outsideAllowlist, []);
  for (const g of s.guards) assert.equal(g.count, 0, `${g.label} must not change`);
  const out = JSON.parse(build()).ae_data;
  assert.equal(out.ch["10"].name, "Vox 1");
  assert.equal(out.ch["10"].col, 12, "vocals are mauve (WING color 12)");
  assert.equal(out.ch["10"].flt.lc, true);
  assert.equal(out.ch["10"].flt.lcf, 40);
  assert.equal(out.ch["10"].fdr, -18);
  assert.equal(out.ch["10"].icon, 101, "vocal: dynamic handheld icon");
  assert.equal(out.ch["1"].col, 9, "drums red");
  assert.equal(out.ch["5"].col, 3, "bass dark blue");
  assert.equal(out.ch["1"].icon, 201, "kick icon");
  assert.equal(out.bus["13"].icon, 6, "FX bus icon");
  assert.equal(out.dca["7"].icon, 112, "vocals DCA icon");
  assert.deepEqual(out.ch["10"].send["1"], { ...ae.ch["10"].send["1"], on: true, lvl: -18, mode: "PRE" });
  assert.equal(out.ch["10"].send["13"].mode, "POST");
  assert.equal(out.ch["1"].send["2"].on, true, "kick → MON Drum");
  assert.equal(out.ch["1"].send["1"].on, false, "kick not in vocal monitor");
  assert.equal(out.bus["13"].preins.ins, "FX1");
  assert.equal(out.fx["1"].mdl, "V-REV");
  assert.equal(out.bus["13"].main["1"].on, true, "reverb return in Main 1");
  assert.equal(out.bus["16"].name, "Stream");
  assert.equal(out.ch["10"].tags, "#D7");
  assert.equal(out.dca["7"].name, "Vocals");
  assert.equal(out.dca["7"].fdr, 0);
  assert.equal(out.ch["14"].name, "", "channels outside the scene are untouched");
  assert.equal(out.ch["10"].clink, false, "strip shows its own name/color, not the source's");
  assert.equal(out.ch["14"].clink, true, "channels outside the scene keep the baseline link");
  assert.deepEqual(out.io.in, ae.io.in, "input sources (names, gain, phantom) untouched");
});

test("apply rejects anything outside the contract", () => {
  const ok = { op: "set" as const };
  assert.throws(() => apply(raw, [{ ...ok, path: "ch/1/in/conn/altin", value: 5 }]), PatchError, "routing not allowlisted");
  assert.throws(() => apply(raw, [{ ...ok, path: "main/1/fdr", value: 0 }]), PatchError, "main not allowlisted");
  assert.throws(() => apply(raw, [{ ...ok, path: "io/in/LCL/1/vph", value: true }]), PatchError, "phantom not allowlisted");
  assert.throws(() => apply(raw, [{ ...ok, path: "io/in/LCL/1/g", value: 10 }]), PatchError, "gain not allowlisted");
  assert.throws(() => apply(raw, [{ ...ok, path: "ch/41/name", value: "x" }]), PatchError, "unknown channel");
  assert.throws(() => apply(raw, [{ ...ok, path: "ch/1/flt/lcf", value: 5000 }]), PatchError, "out of range");
  assert.throws(() => apply(raw, [{ ...ok, path: "ch/1/name", value: 42 }]), PatchError, "wrong type");
  assert.throws(() => apply(raw, [{ ...ok, path: "ch/1/name", value: "a" }, { ...ok, path: "ch/1/name", value: "b" }]), PatchError, "double patch");
  assert.throws(() => apply(raw, [{ ...ok, path: "fx/1", value: { mdl: "V-REV" } }]), PatchError, "FX only from templates");
  const missing = JSON.stringify({ ...JSON.parse(raw), ae_data: { ...ae, dca: { ...ae.dca, 1: {} } } });
  assert.throws(() => apply(missing, [{ ...ok, path: "dca/1/name", value: "x" }]), PatchError, "path missing in baseline");
});

test("baseline without a bus section or from another device is rejected", () => {
  const noBus = validateBaseline(JSON.stringify({ ...JSON.parse(raw), ae_data: { ...ae, bus: undefined } }));
  assert.equal(noBus.valid, false);
  assert.match(noBus.errors.join(), /ae_data\.bus/);
  assert.equal(validateBaseline("{nope").valid, false);
  assert.equal(validateBaseline(JSON.stringify({ ...JSON.parse(raw), creator_model: "x32" })).valid, false);
});

test("working show: warns before overwriting existing buses and FX", () => {
  const r = validateBaseline(readFileSync("fixtures/show-working.snap", "utf8"));
  assert.equal(r.valid, true);
  assert.ok(r.warnings.some((w) => w.includes("Bus 13") && w.includes("G-Vocals")));
  assert.ok(r.warnings.some((w) => w.startsWith("FX1 (V-REV)")));
});

const strips = (page: Record<string, { type: string; i: number }>) =>
  Object.keys(page).filter((k) => /^\d+$/.test(k)).map((k) => page[k]).filter((s) => s.type !== "OFF").map((s) => `${s.type}${s.i}`);

test("pages: standard by default — WING Edit «CH 1-16»/«CH 17-32» fixed, other pages untouched", () => {
  const out = JSON.parse(build());
  const L = out.ce_data.layer;
  const base = JSON.parse(raw).ce_data.layer;
  assert.deepEqual(strips(L.WEDIT["1"]), Array.from({ length: 16 }, (_, i) => `CH${i + 1}`));
  assert.deepEqual(strips(L.WEDIT["2"]), Array.from({ length: 16 }, (_, i) => `CH${i + 17}`));
  assert.deepEqual(L.L, base.L, "console L section was already standard");
  assert.deepEqual(L.WEDIT["6"], base.WEDIT["6"], "BUSES page untouched");
  assert.deepEqual(L.WEDIT["10"], base.WEDIT["10"], "USER 1 stays empty without a request");
  assert.equal(out.ce_data.layer.WEDIT["1"].name, "CH 1-16", "page names untouched");
});

test("pages: a requested USER 1 page gets the scene's channels, buses and DCAs on every section", () => {
  const s = expand({ ...EXAMPLE_INTENT, pages: [{ sources: ["vocal"], buses: true, dca: true }] });
  const L = JSON.parse(apply(raw, compile(s, JSON.parse(raw)))).ce_data.layer;
  const want = ["CH10", "CH11", "CH12", "CH13", "BUS1", "BUS2", "BUS13", "BUS16", "DCA1", "DCA2", "DCA3", "DCA4", "DCA7"];
  assert.deepEqual(strips(L.WEDIT["10"]), want);
  assert.deepEqual(strips(L.L["6"]), want, "L USER1");
  assert.deepEqual(strips(L.C["5"]), want, "C USER1 (16 slots)");
  assert.deepEqual(strips(L.WEDIT["11"]), [], "USER 2 untouched");
});

test("mute: every channel muted by default; `unmute` from the request opens named sources", () => {
  const out = JSON.parse(build()).ae_data;
  assert.ok(Object.values(out.ch as Record<string, { mute: boolean }>).every((c) => c.mute), "all 40 channels muted");
  const s = expand({ ...EXAMPLE_INTENT, unmute: ["vocal"] });
  const o2 = JSON.parse(apply(raw, compile(s, JSON.parse(raw)))).ae_data;
  assert.equal(o2.ch["10"].mute, false, "Vox 1 unmuted");
  assert.equal(o2.ch["1"].mute, true, "Kick still muted");
  assert.equal(o2.ch["20"].mute, true, "channel outside the scene muted");
});

test("click and talkback stay out of Main 1; delay bus gets FX3 ST-DL; unverified icons left as in baseline", () => {
  const s = expand({ ...EXAMPLE_INTENT, sources: [{ kind: "vocal", count: 1, stereo: false }, { kind: "violin", count: 1, stereo: false }, { kind: "click", count: 1, stereo: false }, { kind: "talkback", count: 1, stereo: false }], fx: ["delay"] });
  const out = JSON.parse(apply(raw, compile(s, JSON.parse(raw)))).ae_data;
  const ch = Object.fromEntries(s.channels.map((c) => [c.kind, c.ch]));
  assert.equal(out.ch[ch.click].main["1"].on, false);
  assert.equal(out.ch[ch.talkback].main["1"].on, false);
  assert.equal(out.ch[ch.vocal].main["1"].on, true, "musicians stay in Main");
  assert.equal(out.ch[ch.click].icon, 222);
  assert.equal(out.ch[ch.violin].icon, 309, "violin icon");
  assert.equal(out.ch[ch.violin].col, 7, "strings yellow");
  assert.equal(out.bus["15"].name, "Delay");
  assert.equal(out.bus["15"].preins.ins, "FX3");
  assert.equal(out.fx["3"].mdl, "ST-DL");
});

test("in-ear mix: stereo bus named IEM, FX returns sent into it; wedge stays mono", () => {
  const s = expand({
    ...EXAMPLE_INTENT,
    monitors: [{ for: "vocals", contains: [], iem: true }, { for: "drummer", contains: ["kick"], iem: false }],
    fx: ["vocal_reverb", "delay"],
  });
  const out = JSON.parse(apply(raw, compile(s, JSON.parse(raw)))).ae_data;
  assert.equal(out.bus["1"].name, "IEM Vox");
  assert.equal(out.bus["1"].busmono, false, "in-ear is stereo");
  assert.equal(out.bus["2"].busmono, true, "wedge is mono");
  assert.equal(out.bus["13"].send["1"].on, true, "Vox Rev → IEM Vox");
  assert.equal(out.bus["15"].send["1"].on, true, "Delay → IEM Vox");
  assert.equal(out.bus["13"].send["2"].on, false, "no FX in the wedge");
  const sum = summarize(diff(raw, apply(raw, compile(s, JSON.parse(raw)))));
  assert.deepEqual(sum.outsideAllowlist, []);
});

test("toms get H/M/L/F icons in order; in-ear buses get the headphones icon", () => {
  const s = expand({ ...EXAMPLE_INTENT, sources: [{ kind: "tom", count: 4, stereo: false }, { kind: "vocal", count: 1, stereo: false }], monitors: [{ for: "vocals", contains: [], iem: true }] });
  const out = JSON.parse(apply(raw, compile(s, JSON.parse(raw)))).ae_data;
  assert.deepEqual([1, 2, 3, 4].map((n) => out.ch[String(n)].icon), [206, 207, 208, 209]);
  assert.equal(out.bus["1"].icon, 602);
});
