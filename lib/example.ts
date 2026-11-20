import { IntentSchema, type Intent } from "./intent";

// The ТЗ request and its expected intent. Used by tests (lib/parse.test.ts checks the parser matches it).
export const EXAMPLE_TEXT =
  "Собери сцену для живого выступления: 4 вокальных микрофона, 2 акустики, барабаны, бас, 2 гитары. " +
  "Вокалам мониторы, барабанщику кик и снейр, стриму стерео-микс. Подпиши каналы, назначь цвета, " +
  "сделай HPF, компрессию на вокалах и барабанах, посылы на реверб и мониторы.";

export const EXAMPLE_INTENT: Intent = IntentSchema.parse({
  sources: [
    { kind: "vocal", count: 4 },
    { kind: "ac_guitar", count: 2 },
    { kind: "drum_kit", count: 1 },
    { kind: "bass", count: 1 },
    { kind: "e_guitar", count: 2 },
  ],
  monitors: [
    { for: "vocals", contains: ["vocal"], iem: false },
    { for: "drummer", contains: ["kick", "snare"], iem: false },
  ],
  fx: ["vocal_reverb"],
  stream: true,
  levels: [],
  unmute: [],
  mute: [],
  settings: [],
  pages: [],
});
