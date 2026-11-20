import { test } from "node:test";
import assert from "node:assert/strict";
import { IntentSchema } from "./intent";
import { applyKind, editField, expand, SceneSchema, sendLevelOf } from "./scene";
import { EXAMPLE_INTENT } from "./example";

const intent = IntentSchema.parse(EXAMPLE_INTENT);

test("ТЗ example lays out 13 channels in console order", () => {
  const { channels } = expand(intent);
  assert.deepEqual(
    channels.map((c) => `${c.ch}:${c.label}`),
    ["1:Kick", "2:Snare", "3:OH 1", "4:OH 2", "5:Bass", "6:Gtr 1", "7:Gtr 2", "8:Ac 1", "9:Ac 2", "10:Vox 1", "11:Vox 2", "12:Vox 3", "13:Vox 4"],
  );
});

test("sends follow the intent: vox → MON vocals + FX vocal, kick/snare → MON drummer, all → stream", () => {
  const ch = Object.fromEntries(expand(intent).channels.map((c) => [c.label, c]));
  assert.deepEqual(ch["Vox 1"].monitorSends, ["mon_vocals"]);
  assert.deepEqual(ch["Vox 1"].fxSends, ["fx_vocal"]);
  assert.deepEqual(ch["Kick"].monitorSends, ["mon_drummer"]);
  assert.deepEqual(ch["Snare"].monitorSends, ["mon_drummer"]);
  assert.deepEqual(ch["Snare"].fxSends, [], "drum reverb not requested");
  assert.deepEqual(ch["Bass"].monitorSends, [], "explicit contains overrides preset default");
  assert.deepEqual(ch["Ac 1"].fxSends, ["fx_vocal"]);
  assert.ok(Object.values(ch).every((c) => c.stream));
  assert.equal(ch["Kick"].hpf, 40);
  assert.equal(ch["Vox 1"].hpf, 100);
  assert.ok(ch["Vox 1"].comp && ch["Kick"].comp && ch["Kick"].gate);
});

test("empty `contains` falls back to preset monitor defaults", () => {
  const s = expand({ ...intent, monitors: [{ for: "drummer", contains: [], iem: false }] });
  const onDrummer = s.channels.filter((c) => c.monitorSends.includes("mon_drummer")).map((c) => c.label);
  assert.deepEqual(onDrummer, ["Kick", "Snare", "Bass"]);
});

test("applyKind keeps hand-edited fields", () => {
  const s = expand(intent);
  const edited = editField(s.channels[0], "color", "blue");
  const changed = applyKind(edited, "vocal", s.mixes);
  assert.equal(changed.kind, "vocal");
  assert.equal(changed.color, "blue", "edited field kept");
  assert.equal(changed.hpf, 100, "unedited field from new preset");
  assert.deepEqual(changed.fxSends, ["fx_vocal"]);
});

test("more than 40 channels is rejected", () => {
  assert.throws(() => expand({ ...intent, sources: [{ kind: "vocal", count: 16, stereo: false }, { kind: "keys", count: 16, stereo: false }, { kind: "tom", count: 16, stereo: false }] }));
});

test("expand output is a valid scene.json (import schema stays in sync)", () => {
  assert.doesNotThrow(() => SceneSchema.parse(expand(intent, "text")));
});

test("levels default to -18 dB; explicit intent levels override per source and target", () => {
  const def = expand(intent).channels[0];
  assert.equal(def.fader, -18);
  assert.equal(sendLevelOf(def, "mon_drummer"), -18);
  const s = expand({
    ...intent,
    levels: [
      { sources: ["kick"], target: "monitor_drummer", db: -10 },
      { sources: ["drum_kit"], target: "fader", db: -12 },
      { sources: ["all"], target: "stream", db: -6 },
    ],
  });
  const ch = Object.fromEntries(s.channels.map((c) => [c.label, c]));
  assert.equal(sendLevelOf(ch["Kick"], "mon_drummer"), -10);
  assert.equal(sendLevelOf(ch["Snare"], "mon_drummer"), -18);
  assert.equal(ch["OH 1"].fader, -12, "drum_kit expands to kit pieces");
  assert.equal(ch["Vox 1"].fader, -18);
  assert.ok(s.channels.every((c) => sendLevelOf(c, "stream") === -6));
});
