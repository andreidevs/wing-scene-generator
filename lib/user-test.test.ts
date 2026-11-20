// The user's own test request (scripts/eval-cases.ts → USER_TEST_TEXT), built from its expected intent
// onto the clean baseline and checked requirement by requirement in the resulting .snap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { USER_TEST_EXPECT, USER_TEST_TEXT } from "../scripts/eval-cases";
import { IntentSchema } from "./intent";
import { expand } from "./scene";
import { apply, compile, diff, summarize } from "./wing";

const raw = readFileSync("fixtures/baseline.snap", "utf8");
const base = JSON.parse(raw);
const scene = expand(IntentSchema.parse({ monitors: [], fx: [], stream: false, ...USER_TEST_EXPECT }), USER_TEST_TEXT);
const snap = apply(raw, compile(scene, base));
const ae = JSON.parse(snap).ae_data;
const name = (n: number) => ae.ch[String(n)].name;
const bus = (name: string) => Number(Object.entries(ae.bus as Record<string, { name: string }>).find(([, b]) => b.name === name)![0]);
const send = (ch: number, b: number) => ae.ch[String(ch)].send[String(b)];

test("layout: Mic1–7, Speaker, Bass, E-Drums, Ac 1/2, Keys, Gtr (stereo = one channel), 2 reserved, Talkback", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(name), ["Mic1", "Mic2", "Mic3", "Mic4", "Mic5", "Mic6", "Mic7", "Speaker"]);
  assert.deepEqual([9, 10, 11, 12, 13, 14].map(name), ["Bass", "E-Drums", "Ac 1", "Ac 2", "Keys", "Gtr"]);
  assert.deepEqual([15, 16].map(name), ["", ""], "reserved channels stay empty");
  assert.equal(ae.ch["15"].mute, true, "reserved channels are muted");
  assert.equal(name(17), "TB");
  assert.equal(name(18), "", "nothing after talkback");
});

test("stereo channels sit on ST input pairs (odd/even), inputs follow channel order", () => {
  const conn = (n: number) => `${ae.ch[String(n)].in.conn.grp}${ae.ch[String(n)].in.conn.in}`;
  assert.deepEqual([1, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(conn), ["LCL1", "LCL9", "LCL11", "LCL13", "LCL14", "LCL15", "LCL17", "LCL19", "LCL20", "LCL21"]);
  const mode = (k: number) => ae.io.in.LCL[String(k)].mode;
  for (const k of [11, 12, 15, 16, 17, 18]) assert.equal(mode(k), "ST", `LCL ${k} stereo`);
  for (const k of [1, 9, 10, 13, 14, 19, 21]) assert.equal(mode(k), "M", `LCL ${k} mono`);
  assert.equal(ae.ch["18"].in.conn.in, 18, "channels after the scene keep their baseline input");
});

test("mains: Main1 Tops, Main2 Subs; every channel goes to Main 1 only (or via its group)", () => {
  assert.equal(ae.main["1"].name, "Tops");
  assert.equal(ae.main["2"].name, "Subs");
  for (let n = 1; n <= 17; n++) assert.equal(ae.ch[String(n)].main["2"].on, false, `CH ${n} not in Main2`);
  assert.equal(ae.ch["8"].main["1"].on, true, "Speaker straight to Main1");
  assert.equal(ae.ch["17"].main["1"].on, false, "talkback never in the PA");
});

test("10 in-ear mixes, pre-fader, stereo; all channels at -18, the musician's own channel at 0", () => {
  const names = ["InEarDrums", "InEarBass", "InEarAccustic", "InEarPiano", "InEarElectric", "InEarVocal1", "InEarVocal2", "InEarVocal3", "InEar9", "InEar10"];
  assert.deepEqual(names.map(bus), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const b of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    assert.equal(ae.bus[String(b)].busmono, false, `Bus ${b} stereo`);
    assert.equal(ae.bus[String(b)].icon, 602, `Bus ${b} headphones icon`);
    assert.equal(ae.bus[String(b)].main["1"].on, false, `Bus ${b} not in the PA`);
    for (const ch of [1, 8, 9, 10, 13, 14, 17]) {
      assert.equal(send(ch, b).on, true, `CH ${ch} → Bus ${b}`);
      assert.equal(send(ch, b).mode, "PRE", `CH ${ch} → Bus ${b} pre-fader`);
    }
  }
  const own: [number, number[]][] = [[1, [10]], [2, [9]], [3, [11, 12]], [4, [13]], [5, [14]], [6, [1]], [7, [2]], [8, [3]]];
  for (const [b, chs] of own) {
    for (let ch = 1; ch <= 17; ch++) {
      if (ch === 15 || ch === 16) continue;
      assert.equal(send(ch, b).lvl, chs.includes(ch) ? 0 : -18, `CH ${ch} → ${ae.bus[String(b)].name}`);
    }
  }
  assert.equal(send(15, 1).on, false, "reserved channels feed nothing");
});

test("groups: vocals (not Speaker) and instruments go through their group bus, then Main1", () => {
  const vg = bus("Vocal Group");
  const ig = bus("Instr Group");
  for (let ch = 1; ch <= 7; ch++) {
    assert.deepEqual([send(ch, vg).on, send(ch, vg).mode, ae.ch[String(ch)].main["1"].on], [true, "GRP", false], `Mic${ch}`);
    assert.equal(send(ch, ig).on, false);
  }
  assert.equal(send(8, vg).on, false, "Speaker not in the vocal group");
  for (let ch = 9; ch <= 14; ch++) {
    assert.deepEqual([send(ch, ig).on, send(ch, ig).mode, ae.ch[String(ch)].main["1"].on], [true, "GRP", false], `CH ${ch}`);
  }
  for (const g of [vg, ig]) {
    assert.equal(ae.bus[String(g)].main["1"].on, true, "group → Main1");
    assert.equal(ae.bus[String(g)].fdr, 0, "group at unity");
  }
});

test("Vocal Reverb and Delay: post-fader sends from the vocals, returns into Main1", () => {
  const rev = bus("Vocal Reverb");
  const dly = bus("Delay");
  for (let ch = 1; ch <= 7; ch++) {
    for (const b of [rev, dly]) assert.deepEqual([send(ch, b).on, send(ch, b).mode, send(ch, b).lvl], [true, "POST", -18], `Mic${ch} → ${b}`);
  }
  assert.equal(send(8, rev).on, false, "Speaker dry");
  assert.equal(ae.bus[String(rev)].main["1"].on, true);
  assert.equal(ae.bus[String(dly)].main["1"].on, true);
  assert.equal(ae.fx[String(ae.bus[String(rev)].preins.ins.slice(2))].mdl, "V-REV");
  assert.equal(ae.fx[String(ae.bus[String(dly)].preins.ins.slice(2))].mdl, "ST-DL");
});

test("recording: every channel's input on USB 1… and on the WING-LIVE card CRD 1…, stereo = 2 tracks", () => {
  // CH1–9 → LCL1–9, E-Drums LCL11/12, Ac LCL13/14, Keys 15/16, Gtr 17/18, reserved 19/20, TB 21.
  const want = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  for (const out of ["USB", "CRD"]) {
    want.forEach((inp, k) => assert.deepEqual(ae.io.out[out][String(k + 1)], { grp: "LCL", in: inp }, `${out} ${k + 1}`));
    assert.equal(ae.io.out[out][String(want.length + 1)].grp, "OFF", `${out} after the last track stays off`);
  }
});

test("console: the request picks WING Rack; on a full WING (8 local inputs) the rest goes to AES50 A", () => {
  assert.equal(scene.console, "rack");
  const full = JSON.parse(apply(raw, compile({ ...scene, console: "wing" }, base))).ae_data;
  const conn = (n: number) => `${full.ch[String(n)].in.conn.grp}${full.ch[String(n)].in.conn.in}`;
  assert.deepEqual([1, 8, 9, 10, 11, 13, 14, 17].map(conn), ["LCL1", "LCL8", "A1", "A3", "A5", "A7", "A9", "A13"]);
  assert.deepEqual([3, 4].map((k) => full.io.in.A[String(k)].mode), ["ST", "ST"], "E-Drums on A3/4");
  assert.equal(full.io.in.A["2"].mode, "M", "A2 left free before the pair");
});

test("matrix Stream fed from Main1", () => {
  assert.equal(ae.mtx["1"].name, "Stream");
  assert.deepEqual([ae.main["1"].send.MX1.on, ae.main["1"].send.MX1.lvl], [true, 0]);
  assert.equal(Object.values(ae.bus as Record<string, { name: string }>).some((b) => b.name === "Stream"), false, "no stream bus");
});

test("nothing outside the contract changed", () => {
  const s = summarize(diff(raw, snap));
  assert.deepEqual(s.outsideAllowlist, []);
  for (const g of s.guards) assert.equal(g.count, 0, g.label);
});
