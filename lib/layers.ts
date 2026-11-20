// Surface pages live in ce_data.layer.<section>.<page>: numbered slots {type, i, dst} plus name/ofs.
// Sections: L, C, R (WING), CMPCT, RCK, EXT, VRT, WEDIT (WING Edit's own surface).
// Strip ids: CH 1..40 channels, CH 41..48 AUX 1..8, BUS 1..16 buses, BUS 17..20 Main, BUS 21..28 Matrix, DCA 1..16.

import type { PageSpec } from "./scene";

export type Strip = { type: "CH" | "BUS" | "DCA" | "OFF"; i: number };
type Slot = { type: string; i: number };
type Page = Record<string, Slot | string | number>;
export type Layers = Record<string, Record<string, Page | number>>;

const range = (a: number, b: number): Strip[] =>
  Array.from({ length: Math.max(0, b - a + 1) }, (_, k) => ({ type: "CH", i: a + k }));

// Pages named "CH a-b" hold exactly channels a..b; "CH a-AUX" / "CH a-A8" run through AUX 8 (= CH 48).
// ponytail: name-based; pages with other names (BUSES, DCA, MAIN, ALL…) are left as they are.
export function standardStrips(name: string): Strip[] | null {
  const n = name.trim();
  let m = /^CH ?(\d+) ?- ?(\d+)$/i.exec(n);
  if (m) return range(Number(m[1]), Number(m[2]));
  m = /^CH ?(\d+) ?- ?(AUX|A8)$/i.exec(n);
  if (m) return range(Number(m[1]), 48);
  return null;
}

export function userPageIndex(name: string): number | null {
  const m = /^USER ?([12])$/i.exec(name.trim());
  return m ? Number(m[1]) : null;
}

export function pageStrips(
  spec: PageSpec,
  channels: { ch: number; kind: string }[],
  buses: number[],
  dcas: number[],
): Strip[] {
  const all = spec.sources.includes("all");
  return [
    ...channels.filter((c) => all || (spec.sources as string[]).includes(c.kind)).map((c): Strip => ({ type: "CH", i: c.ch })),
    ...(spec.buses ? buses.map((i): Strip => ({ type: "BUS", i })) : []),
    ...(spec.dca ? dcas.map((i): Strip => ({ type: "DCA", i })) : []),
  ];
}

// Desired content per page: standard pages normalized, USER pages filled from the scene's page specs.
export function layerPlan(
  layers: Layers,
  user: (Strip[] | undefined)[], // [USER 1 strips, USER 2 strips]
): { path: string; value: string | number }[] {
  const out: { path: string; value: string | number }[] = [];
  for (const [sec, pages] of Object.entries(layers)) {
    for (const [pg, page] of Object.entries(pages)) {
      if (typeof page !== "object" || typeof page.name !== "string") continue;
      const u = userPageIndex(page.name);
      const strips = u ? user[u - 1] : standardStrips(page.name);
      if (!strips) continue;
      const slots = Object.keys(page).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
      // ponytail: strips beyond the page's slot count (L 24, C/R 16, WING Edit 96) are dropped.
      slots.forEach((slot, j) => {
        const s = strips[j] ?? { type: "OFF", i: 0 };
        out.push({ path: `ce_data/layer/${sec}/${pg}/${slot}/type`, value: s.type });
        out.push({ path: `ce_data/layer/${sec}/${pg}/${slot}/i`, value: s.i });
      });
    }
  }
  return out;
}
