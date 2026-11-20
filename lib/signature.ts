// Scene signature: what an intent actually produces (channels, mixes, sends, levels…), so two different
// intents that build the same scene compare equal. Used at runtime (LLM voting) and by the evals.

import { isDeepStrictEqual } from "node:util";
import { IntentSchema, type Intent } from "./intent";
import { CHANNEL_PRESETS, DEFAULT_LEVEL_DB } from "./presets";
import { expand, sendLevelOf } from "./scene";

type EvalCase = { text: string; expect: Record<string, unknown> };

export type Sig = Record<string, unknown>;
const uniq = (a: string[]) => [...new Set(a)].sort();

export function signature(intent: Intent): Sig {
  const sc = expand(intent);
  const ch = sc.channels;
  const busName = (id: string) => sc.buses.find((b) => b.id === id)?.name ?? id;
  const count = new Map<string, number>();
  ch.forEach((c) => count.set(c.kind + (c.stereo ? "(st)" : ""), (count.get(c.kind + (c.stereo ? "(st)" : "")) ?? 0) + 1));
  return {
    channels: [...count].map(([k, n]) => `${k}×${n}`).sort(),
    mixes: uniq(sc.mixes.monitors.map((m) => `${m.role}${m.iem ? "(iem)" : ""}`)),
    monitorSends: uniq(ch.flatMap((c) => c.monitorSends.map((r) => `${c.kind}>${busName(r)}`))),
    fx: uniq(sc.mixes.fx),
    fxSends: uniq(ch.flatMap((c) => c.fxSends.map((r) => `${c.kind}>${r}`))),
    stream: sc.mixes.stream,
    levels: uniq(
      ch.flatMap((c) => [
        ...(c.fader !== DEFAULT_LEVEL_DB ? [`${c.kind}:fader=${c.fader}`] : []),
        ...sc.buses
          .filter((b) => sendLevelOf(c, b.id) !== DEFAULT_LEVEL_DB && (b.kind === "stream" ? c.stream : [...c.monitorSends, ...c.fxSends].includes(b.id)))
          .map((b) => `${c.label}:${b.name}=${sendLevelOf(c, b.id)}`),
      ]),
    ),
    open: uniq(ch.filter((c) => !c.mute).map((c) => c.kind)),
    processing: uniq(
      ch.flatMap((c) => {
        const p = CHANNEL_PRESETS[c.kind];
        return [
          ...(c.hpf !== p.hpf ? [`${c.kind}:hpf=${c.hpf}`] : []),
          ...(c.comp !== p.comp ? [`${c.kind}:comp=${c.comp}`] : []),
          ...(c.gate !== p.gate ? [`${c.kind}:gate=${c.gate}`] : []),
        ];
      }),
    ),
    pages: JSON.stringify(sc.pages),
    // Explicit layout and routing (named channels, reserved gaps, buses, groups, mains, matrices).
    layout: intent.channels.length ? ch.map((c) => `${c.ch}:${c.label}:${c.kind}${c.stereo ? ":st" : ""}`) : [],
    buses: sc.buses.map((b) => `${b.bus}:${b.name}:${b.kind}:${b.mode}${b.iem ? ":iem" : ""}`),
    routing: uniq(ch.map((c) => `${c.label}:${c.toMain ? "main" : "-"}:${c.groups.map(busName).join("+")}`)),
    mains: JSON.stringify(sc.mains),
    matrices: JSON.stringify(sc.matrices),
    record: JSON.stringify(sc.record),
    dca: uniq([...ch.map((c) => `${c.label}:${c.dca ?? "-"}`), ...sc.buses.filter((b) => b.dca).map((b) => `${b.name}:${b.dca}`)]),
    muteGroups: uniq([...sc.muteGroups.map((g) => `M${g.group}=${g.name ?? ""}`), ...ch.flatMap((c) => c.muteGroups.map((m) => `${c.label}:M${m}`))]),
  };
}

export const FIELDS = ["channels", "mixes", "monitorSends", "fx", "fxSends", "stream", "levels", "open", "processing", "pages", "layout", "buses", "routing", "mains", "matrices", "record", "muteGroups", "dca"];

export function score(c: EvalCase, got: Intent | null) {
  const want = signature(IntentSchema.parse({ monitors: [], fx: [], stream: false, ...c.expect }));
  if (!got) return { exact: false, ok: 0, diffs: ["(нет ответа)"] };
  const have = signature(got);
  const diffs = FIELDS.filter((f) => !isDeepStrictEqual(want[f], have[f])).map((f) => `${f}: ждали ${JSON.stringify(want[f])}, получили ${JSON.stringify(have[f])}`);
  return { exact: diffs.length === 0, ok: FIELDS.length - diffs.length, diffs };
}

export const sigKey = (intent: Intent) => JSON.stringify(signature(intent));
