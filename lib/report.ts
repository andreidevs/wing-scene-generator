import type { BaselineReport } from "./baseline";
import { CONSOLES } from "./presets";
import type { Scene } from "./scene";
import { describe, recordTracks, type BaselineSnap, type DiffSummary } from "./wing";

export function buildReport(opts: {
  baselineName: string;
  baseline: BaselineReport;
  snap: BaselineSnap; // parsed baseline, for the recording track list
  scene: Scene;
  summary: DiffSummary;
  conn: Record<number, string>; // channel → baseline input, e.g. "LCL5"
  generatedAt: Date;
}): string {
  const { baselineName, baseline, snap, scene, summary, conn, generatedAt } = opts;
  const L: string[] = [];
  L.push("# WING Scene Generator Report", "");
  L.push(`- Baseline: ${baselineName}`);
  L.push(`- Generated: ${generatedAt.toISOString().slice(0, 16).replace("T", " ")}`);
  L.push(`- Format: ${baseline.format ?? "?"}, ${baseline.creator ?? "?"} ${baseline.firmware ?? "?"}`);
  L.push(`- Channels: ${scene.channels.length}`);
  L.push(`- Console: ${CONSOLES[scene.console].label} (${CONSOLES[scene.console].local} локальных входов, дальше AES50 A)`);
  L.push(`- Buses: ${scene.buses.map((b) => `Bus ${b.bus} ${b.name} (${b.mode})`).join(", ") || "—"}`);
  if (scene.mains.length) L.push(`- Mains: ${scene.mains.map((m) => `Main ${m.main} ${m.name}`).join(", ")}`);
  if (scene.muteGroups.length) {
    const who = (n: number) => scene.channels.filter((c) => c.muteGroups.includes(n)).map((c) => c.label).join(", ") || "—";
    L.push(`- Mute groups: ${scene.muteGroups.map((g) => `${g.group}${g.name ? ` ${g.name}` : ""} (${who(g.group)})`).join("; ")}`);
  }
  if (scene.matrices.length) L.push(`- Matrix: ${scene.matrices.map((m) => `MX${m.mtx} ${m.name} ← Main ${m.from}`).join(", ")}`);
  L.push("");
  if (scene.text) L.push("## Запрос", "", `> ${scene.text}`, "");

  L.push("## Patch list", "", "| CH | Имя | Вход | Mute | Fader | DCA |", "|---|---|---|---|---|---|");
  for (const c of scene.channels) L.push(`| ${c.ch} | ${c.label} | ${conn[c.ch] ?? "?"} | ${c.mute ? "mute" : "open"} | ${c.fader} dB | ${c.dca ?? "—"} |`);
  L.push("");
  const outs = [...(scene.record.usb ? ["USB"] : []), ...(scene.record.card ? ["CRD (WING-LIVE)"] : [])];
  if (outs.length) {
    const tracks = recordTracks(scene, snap);
    L.push("## Запись", "", `Выходы ${outs.join(" и ")} 1…${tracks.at(-1)?.out ?? 0} — прямо со входов каналов (до обработки):`, "");
    tracks.forEach((t) => L.push(`- ${t.out}: ${t.grp}${t.in} — ${t.label}`));
    L.push("", "ALT-вход каждого канала = его дорожка на карте WING-LIVE (CRD), input select GLOBAL: общий переключатель MAIN/ALT включает воспроизведение с карты.");
    if (scene.record.card && (tracks.at(-1)?.out ?? 0) > 32) L.push("", `- ${tracks.at(-1)?.out} дорожек: одна SD-карта WING-LIVE пишет 32, нужны обе карты.`);
    L.push("");
  }
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
  for (const b of scene.buses) {
    if (b.toMain) {
      L.push(`- Bus ${b.bus} ${b.name}: идёт в Main 1, отдельный выход не нужен.${b.fx ? ` Проверь FX${b.fx.slot}.` : ""}`);
      continue;
    }
    const routes = baseline.routes[b.bus] ?? [];
    L.push(`- Bus ${b.bus} ${b.name}: ${routes.length ? `сейчас выведена на ${routes.join(", ")}, проверь` : "не выведена, назначь выход"}${b.kind === "stream" ? " (USB для стрима)" : ""}`);
  }
  for (const m of scene.matrices) L.push(`- MX${m.mtx} ${m.name}: назначь выход матрицы (USB / стрим-выход).`);
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
