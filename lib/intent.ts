import { z } from "zod";

// What the text parser (lib/parse.ts) extracts. Nothing here is a console address or a value:
// channel numbers, HPF, colors, levels, routing and gain are decided in code.
export const SOURCE_KINDS = [
  "kick", "snare", "hihat", "tom", "overhead", "perc", "sampler",
  "bass", "e_guitar", "ac_guitar", "keys", "accordion", "harp",
  "violin", "cello", "sax", "trumpet", "trombone", "horn", "flute", "winds", "harmonica",
  "playback", "dj", "vocal", "backvocal", "choir", "speech", "ambience", "click", "talkback",
] as const;
export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKind>;

// `drum_kit` exists only in the intent: "барабаны" without details. scene.ts expands it.
export const IntentSourceKind = z.enum([...SOURCE_KINDS, "drum_kit"]);

export const MONITOR_MIXES = ["vocals", "drummer", "bass", "guitar", "keys", "brass", "strings"] as const;
export const FX_KINDS = ["vocal_reverb", "drum_reverb", "delay"] as const;

// Level targets a request may name. "fader" = channel fader, the rest = send into that mix.
export const LEVEL_TARGETS = ["fader", ...MONITOR_MIXES.map((m) => `monitor_${m}` as const), ...FX_KINDS, "stream"] as const;

const Sources = z.array(z.union([IntentSourceKind, z.literal("all")]));

export const IntentSchema = z.object({
  sources: z
    .array(z.object({ kind: IntentSourceKind, count: z.number().int().min(1).max(16) }))
    .min(1),
  monitors: z.array(
    z.object({
      for: z.enum(MONITOR_MIXES),
      // Empty = use preset defaults for this mix.
      contains: z.array(IntentSourceKind),
      iem: z.boolean().default(false), // in-ear: stereo bus + FX returns + ambience; false = mono wedge
    }),
  ),
  fx: z.array(z.enum(FX_KINDS)),
  stream: z.boolean(),
  // Only when the request explicitly talks about levels; everything else defaults to -18 dB in code.
  levels: z
    .array(
      z.object({
        sources: Sources.min(1),
        target: z.enum(LEVEL_TARGETS),
        db: z.number().min(-60).max(10),
      }),
    )
    .default([]),
  // Mute: every channel is muted by default; only sources named here start unmuted.
  unmute: Sources.default([]),
  mute: Sources.default([]), // explicit mute wins over unmute ("всё открыть, кроме клика")
  // Per-source processing overrides ("hpf на вокале 150", "без компрессии на басе", "гейт на томы").
  settings: z
    .array(
      z.object({
        sources: Sources.min(1),
        hpf: z.number().min(20).max(2000).optional(),
        comp: z.boolean().optional(),
        gate: z.boolean().optional(),
        sendTo: z.array(z.enum(FX_KINDS)).optional(), // add FX sends ("дилей на сакс")
      }),
    )
    .default([]),
  // Custom surface pages, only when asked. Entry 1 → USER 1, entry 2 → USER 2; other pages stay standard.
  pages: z
    .array(
      z.object({
        sources: Sources,
        buses: z.boolean(), // add the scene's role buses (MON, Rev, Stream)
        dca: z.boolean(), // add the scene's DCAs
      }),
    )
    .max(2)
    .default([]),
});
export type Intent = z.infer<typeof IntentSchema>;
