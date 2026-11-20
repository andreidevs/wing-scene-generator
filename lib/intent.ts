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
// A reference to channels: a source kind ("vocal", "drum_kit"), "all", or a channel label ("Mic1", "Drums").
const Ref = z.string().min(1).max(32);
const Name = z.string().min(1).max(16); // WING name limit

export const IntentSchema = z
  .object({
  // Simple lineup: kinds and counts, laid out by the code. Empty when `channels` gives an explicit layout.
  sources: z.array(z.object({ kind: IntentSourceKind, count: z.number().int().min(1).max(16), stereo: z.boolean().default(false) })).default([]),
  // Explicit layout, in console order: "первые 8 каналов Mic1-7 и Speaker, потом бас…, резерв 2 канала".
  // label "Mic{n}" + count 7 → Mic1…Mic7; stereo → one stereo channel (WING ST source); kind "reserve" = leave channels untouched.
  channels: z
    .array(
      z.object({
        kind: z.union([SourceKind, z.literal("reserve")]),
        label: Name.optional(),
        count: z.number().int().min(1).max(16).default(1),
        stereo: z.boolean().default(false),
      }),
    )
    .default([]),
  // Named monitor mixes ("InEarDrums", "InEarVocal1"…): everything in `contains` at -18 dB, `own` at 0 dB.
  // When present they replace the per-family `monitors`.
  mixes: z
    .array(
      z.object({
        name: Name,
        iem: z.boolean().default(true),
        contains: z.array(Ref).default(["all"]),
        own: z.array(Ref).default([]),
      }),
    )
    .max(16)
    .default([]),
  // Subgroups: members go to the group bus (GRP send) instead of Main 1; the group goes to Main 1.
  groups: z.array(z.object({ name: Name, members: z.array(Ref).min(1), except: z.array(Ref).default([]) })).max(4).default([]),
  // Explicit DCAs ("DCA: Вокал, Инструменты, FX"), replacing the per-preset ones. members: kinds, channel
  // labels, bus names or "fx" (all FX return buses); name ≤ 8 chars (WING limit).
  dcas: z
    .array(z.object({ name: z.string().min(1).max(8), members: z.array(Ref).min(1), except: z.array(Ref).default([]) }))
    .max(16)
    .default([]),
  // Mute groups (WING has 8): "mute group 1 — все вокалы кроме спикера". group = its number, else the list order.
  muteGroups: z
    .array(z.object({ group: z.number().int().min(1).max(8).optional(), name: Name.optional(), members: z.array(Ref).min(1), except: z.array(Ref).default([]) }))
    .max(8)
    .default([]),
  // Names for the mains ("Main1 — Топы, Main2 — Сабы"). Channels always go to Main 1 only.
  mains: z.array(z.object({ main: z.number().int().min(1).max(4), name: Name })).default([]),
  // Stream as a bus with per-channel sends (default) or as a matrix fed from Main 1.
  streamVia: z.enum(["bus", "matrix"]).default("bus"),
  // Multitrack recording: every channel's input to the USB outputs (DAW) and/or the WING-LIVE card (CRD, SD).
  record: z.object({ usb: z.boolean().default(false), card: z.boolean().default(false) }).default({ usb: false, card: false }),
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
  })
  .refine((i) => i.sources.length > 0 || i.channels.some((c) => c.kind !== "reserve"), { message: "Нужен хотя бы один источник", path: ["sources"] });
export type Intent = z.infer<typeof IntentSchema>;
