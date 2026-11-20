import { getNode, parseOrdered } from "./ordered-json";
import { BUS_LAYOUT, BUS_ROLES, ROLE_LABELS, type BusRole } from "./presets";
import { allowedPaths, busRoutes } from "./wing";

export type BaselineReport = {
  valid: boolean;
  format?: string; // e.g. "snapshot.11"
  firmware?: string; // creator_vers, e.g. "3.3.1"
  creator?: string;
  channelCount: number;
  errors: string[];
  missingPaths: string[];
  warnings: string[];
  // Where each role bus is routed in the baseline. Outputs are patched by hand, so this is info only.
  routes: Record<BusRole, string[]>;
};

type Ae = {
  ch: Record<string, unknown>;
  bus: Record<string, { name: string; preins: { ins: string } }>;
  fx: Record<string, { mdl: string }>;
  dca: Record<string, unknown>;
  main: Record<string, unknown>;
  io: { out: Record<string, Record<string, { grp: string; in: number }>> };
};

const FX_TEMPLATES_VERSION = "3.3.1"; // firmware the FX templates were captured from

export function validateBaseline(raw: string): BaselineReport {
  const report: BaselineReport = {
    valid: false, channelCount: 0, errors: [], missingPaths: [], warnings: [],
    routes: Object.fromEntries(BUS_ROLES.map((r) => [r, []])) as unknown as Record<BusRole, string[]>,
  };
  let snap: { type?: string; creator?: string; creator_vers?: string; creator_model?: string; ae_data?: Ae; ce_data?: { layer?: unknown } };
  let tree;
  try {
    tree = parseOrdered(raw);
    snap = JSON.parse(raw);
  } catch (e) {
    report.errors.push(`Файл не является JSON: ${(e as Error).message}`);
    return report;
  }

  report.format = snap.type;
  report.firmware = snap.creator_vers;
  report.creator = snap.creator;
  if (!/^snapshot\.\d+$/.test(snap.type ?? "")) report.errors.push(`Это не snapshot WING (type = ${JSON.stringify(snap.type)})`);
  if (snap.creator_model !== "wing") report.errors.push(`Файл не от WING (creator_model = ${JSON.stringify(snap.creator_model)})`);

  const ae = snap.ae_data;
  for (const sec of ["ch", "bus", "fx", "dca", "main", "io"] as const) {
    if (!ae?.[sec]) report.errors.push(`Нет секции ae_data.${sec}`);
  }
  if (report.errors.length) return report;
  const a = ae!;

  report.channelCount = Object.keys(a.ch).length;
  for (const [sec, n] of [["ch", 40], ["bus", 16], ["dca", 16], ["fx", 16]] as const) {
    const count = Object.keys(a[sec]).length;
    if (count !== n) report.errors.push(`Ожидалось ${n} в ${sec}, найдено ${count}`);
  }

  report.missingPaths = allowedPaths().filter((p) => !getNode(tree, ["ae_data", ...p.split("/")]));
  if (report.missingPaths.length) report.errors.push(`В baseline нет ${report.missingPaths.length} полей, которые пишет генератор`);

  if (!snap.ce_data?.layer) report.warnings.push("Нет ce_data.layer: страницы пульта не будут изменены");
  if (snap.creator_vers && snap.creator_vers !== FX_TEMPLATES_VERSION) {
    report.warnings.push(`Прошивка ${snap.creator_vers}, а шаблоны FX сняты с ${FX_TEMPLATES_VERSION}. Проверь реверберы в WING EDIT.`);
  }
  for (const role of BUS_ROLES) {
    const b = BUS_LAYOUT[role];
    const bus = a.bus[String(b.bus)];
    if (bus?.name && bus.name !== b.name) report.warnings.push(`Bus ${b.bus} «${bus.name}» будет переименована в «${b.name}» (${ROLE_LABELS[role]})`);
    if (bus?.preins?.ins && bus.preins.ins !== "NONE" && bus.preins.ins !== `FX${b.fx?.slot}`) {
      report.warnings.push(`На Bus ${b.bus} стоит инсерт ${bus.preins.ins}${b.fx ? `, он будет заменён на FX${b.fx.slot}` : ""}`);
    }
    if (b.fx) {
      const mdl = a.fx[String(b.fx.slot)]?.mdl;
      if (mdl && mdl !== "NONE") report.warnings.push(`FX${b.fx.slot} (${mdl}) будет заменён шаблоном ${b.fx.template}`);
    }
    report.routes[role] = busRoutes(a, b.bus);
  }

  report.valid = report.errors.length === 0;
  return report;
}
