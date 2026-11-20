// Scene signature: what an intent actually produces (channels, mixes, sends, levels…), so two different
// intents that build the same scene compare equal. Used at runtime (LLM voting) and by the evals.

import { isDeepStrictEqual } from "node:util";
import { IntentSchema, type Intent } from "./intent";
import { BUS_ROLES, CHANNEL_PRESETS, DEFAULT_LEVEL_DB } from "./presets";
import { expand } from "./scene";

type EvalCase = { text: string; expect: Record<string, unknown> };

export type Sig = Record<string, unknown>;
const uniq = (a: string[]) => [...new Set(a)].sort();

export function signature(intent: Intent): Sig {
  const sc = expand(intent);
  const ch = sc.channels;
  const count = new Map<string, number>();
  ch.forEach((c) => count.set(c.kind, (count.get(c.kind) ?? 0) + 1));
  return {
    channels: [...count].map(([k, n]) => `${k}×${n}`).sort(),
    mixes: uniq(sc.mixes.monitors.map((m) => `${m.role}${m.iem ? "(iem)" : ""}`)),
    monitorSends: uniq(ch.flatMap((c) => c.monitorSends.map((r) => `${c.kind}>${r}`))),
    fx: uniq(sc.mixes.fx),
    fxSends: uniq(ch.flatMap((c) => c.fxSends.map((r) => `${c.kind}>${r}`))),
    stream: sc.mixes.stream,
    levels: uniq(
      ch.flatMap((c) => [
        ...(c.fader !== DEFAULT_LEVEL_DB ? [`${c.kind}:fader=${c.fader}`] : []),
        ...BUS_ROLES.filter((r) => c.sendLevel[r] !== DEFAULT_LEVEL_DB && (r === "stream" ? c.stream : [...c.monitorSends, ...c.fxSends].includes(r as never))).map(
          (r) => `${c.kind}:${r}=${c.sendLevel[r]}`,
        ),
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
  };
}

export const FIELDS = ["channels", "mixes", "monitorSends", "fx", "fxSends", "stream", "levels", "open", "processing", "pages"];

export function score(c: EvalCase, got: Intent | null) {
  const want = signature(IntentSchema.parse({ monitors: [], fx: [], stream: false, ...c.expect }));
  if (!got) return { exact: false, ok: 0, diffs: ["(нет ответа)"] };
  const have = signature(got);
  const diffs = FIELDS.filter((f) => !isDeepStrictEqual(want[f], have[f])).map((f) => `${f}: ждали ${JSON.stringify(want[f])}, получили ${JSON.stringify(have[f])}`);
  return { exact: diffs.length === 0, ok: FIELDS.length - diffs.length, diffs };
}

export const sigKey = (intent: Intent) => JSON.stringify(signature(intent));
