import type { BaselineReport } from "./baseline";
import { BUS_LAYOUT, ROLE_LABELS } from "./presets";
import type { Scene } from "./scene";
import { describe, usedRoles, type DiffSummary } from "./wing";

export function buildReport(opts: {
  baselineName: string;
  baseline: BaselineReport;
  scene: Scene;
  summary: DiffSummary;
  conn: Record<number, string>; // channel → baseline input, e.g. "LCL5"
  generatedAt: Date;
}): string {
  const { baselineName, baseline, scene, summary, conn, generatedAt } = opts;
  const roles = usedRoles(scene);
  const L: string[] = [];
  L.push("# WING Scene Generator Report", "");
  L.push(`- Baseline: ${baselineName}`);
  L.push(`- Generated: ${generatedAt.toISOString().slice(0, 16).replace("T", " ")}`);
  L.push(`- Format: ${baseline.format ?? "?"}, ${baseline.creator ?? "?"} ${baseline.firmware ?? "?"}`);
  L.push(`- Channels: ${scene.channels.length}`);
  L.push(`- Buses: ${roles.map((r) => `Bus ${BUS_LAYOUT[r].bus} ${BUS_LAYOUT[r].name}`).join(", ") || "—"}`);
  L.push("");
  if (scene.text) L.push("## Запрос", "", `> ${scene.text}`, "");

  L.push("## Patch list", "", "| CH | Имя | Вход (baseline) | Mute | Fader | DCA |", "|---|---|---|---|---|---|");
  for (const c of scene.channels) L.push(`| ${c.ch} | ${c.label} | ${conn[c.ch] ?? "?"} | ${c.mute ? "mute" : "open"} | ${c.fader} dB | ${c.dca ?? "—"} |`);
  L.push("");
  L.push("## Страницы", "");
  L.push("- Стандартные страницы «CH a-b» приведены к каналам a…b (L, C, R, Compact, Rack, WING Edit).");
  scene.pages.forEach((pg, k) =>
    L.push(`- USER ${k + 1}: ${pg.sources.join(", ") || "—"}${pg.buses ? " + шины" : ""}${pg.dca ? " + DCA" : ""}`),
  );
  L.push("");

  L.push("## Изменено", "");
  for (const [kind, n] of Object.entries(summary.byKind)) L.push(`- ${kind}: ${n}`);
  L.push("", "## Не изменено (контроль)", "");
  for (const g of summary.guards) L.push(`- ${g.label}: ${g.count === 0 ? "без изменений" : `ИЗМЕНЕНО ${g.count}`}`);
  L.push(`- Поля вне allowlist: ${summary.outsideAllowlist.length}`);
  L.push("");

  L.push("## Сделать вручную в WING EDIT / на пульте", "");
  for (const r of roles) {
    const b = BUS_LAYOUT[r];
    const routes = baseline.routes[r];
    if (b.toMain) {
      L.push(`- Bus ${b.bus} ${b.name} (${ROLE_LABELS[r]}): возврат идёт в Main 1, отдельный выход не нужен. Проверь реверб FX${b.fx?.slot}.`);
      continue;
    }
    L.push(`- Bus ${b.bus} ${b.name} (${ROLE_LABELS[r]}): ${routes.length ? `сейчас выведена на ${routes.join(", ")}, проверь` : "не выведена, назначь выход"}${r === "stream" ? " (USB для стрима)" : ""}`);
  }
  L.push("- Фейдеры каналов, шин и посылы стоят на заданных уровнях (по умолчанию −18 dB). Main не тронут, подними на саундчеке.");
  L.push("- Все каналы замьючены (кроме явно открытых в запросе). Снимай mute на саундчеке.");
  if (baseline.warnings.length) {
    L.push("", "## Предупреждения", "");
    baseline.warnings.forEach((w) => L.push(`- ${w}`));
  }

  L.push("", "## Все изменения", "", "```");
  summary.entries.forEach((e) => L.push(describe(e)));
  L.push("```", "");
  return L.join("\n");
}
