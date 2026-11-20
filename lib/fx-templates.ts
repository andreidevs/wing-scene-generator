// FX parameter blocks copied verbatim from a working WING Edit 3.3.1 show (fixtures/show-working.snap).
// Writing only {"mdl":"V-REV"} would leave the model without its parameters; these are known-good.
// Reverb models are only allowed in FX1..FX8.
export const FX_TEMPLATES = {
  vocal_hall: "{\"mdl\":\"V-REV\",\"fxmix\":100,\"pdel\":20,\"dcy\":3,\"lmult\":1.248330474,\"hmult\":0.670000017,\"mod\":84,\"lc\":74.72796631,\"hc\":12030.25,\"out\":\"FRONT\",\"trans\":false}",
  drum_room: "{\"mdl\":\"ROOM\",\"fxmix\":100,\"pdel\":60,\"size\":76,\"dcy\":1.759741187,\"mult\":1.214194894,\"damp\":5683.258301,\"lc\":144.4474182,\"hc\":20000.00195,\"shp\":0,\"sprd\":25,\"diff\":40,\"spin\":30,\"ecl\":250,\"ecr\":350,\"efl\":20,\"efr\":20}",
  vocal_delay: "{\"mdl\":\"ST-DL\",\"fxmix\":100,\"time\":481,\"mode\":\"ST\",\"fact\":\"1\",\"pat\":\"1:1\",\"offs\":7,\"feed\":28,\"flc\":100.8291702,\"fhc\":1261.914795,\"lc\":20,\"hc\":20000.00195}",
} as const;
export type FxTemplate = keyof typeof FX_TEMPLATES;
