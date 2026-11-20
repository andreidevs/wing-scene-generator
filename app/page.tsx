"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, FileUp, Plus, Sparkles, SlidersHorizontal, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { validateBaseline, type BaselineReport } from "@/lib/baseline";
import { SOURCE_KINDS, type Intent, type SourceKind } from "@/lib/intent";
import { parseRequest } from "@/lib/parse";
import { COLORS, CONSOLES, DCA_GROUPS, type ColorId, type ConsoleModel } from "@/lib/presets";
import { buildReport } from "@/lib/report";
import { applyKind, editField, expand, newChannel, SceneSchema, sendLevelOf, type BusDef, type ChannelDraft, type EditableField, type Scene } from "@/lib/scene";
import { cn } from "@/lib/utils";
import { apply, compile, describe, diff, inputLabels, summarize, type BaselineSnap, type DiffSummary } from "@/lib/wing";

const KIND_LABELS: Record<SourceKind, string> = {
  kick: "Kick", snare: "Snare", hihat: "Hi-hat", tom: "Tom", overhead: "Overhead", perc: "Percussion", sampler: "Sampler / SPD",
  bass: "Bass", e_guitar: "E-guitar", ac_guitar: "Acoustic", keys: "Keys", accordion: "Accordion", harp: "Harp",
  violin: "Violin", cello: "Cello", sax: "Sax", trumpet: "Trumpet", trombone: "Trombone", horn: "Horn / Tuba",
  flute: "Flute", winds: "Woodwind", harmonica: "Harmonica", playback: "Playback", dj: "DJ", vocal: "Lead vocal",
  backvocal: "Back vocal", choir: "Choir", speech: "Speech / MC", ambience: "Ambience", click: "Click", talkback: "Talkback",
};

// Request examples shown under the text box (each one is covered by lib/parse.test.ts).
const EXAMPLES = [
  "4 вокала, 2 акустики, барабаны, бас, 2 гитары",
  "бочка, малый, хэт, 3 тома, оверы, перкуссия",
  "альт-саксофон, 2 трубы, тромбон, скрипка, виолончель",
  "ведущий, 2 радиомикрофона, хор, клик, толкбэк, ноутбук",
  "Сцена для рок-группы / джаз-трио / конференция / подкаст / свадьба",
  "полная ударка, бас, клавиши стерео, кларнет, туба, губная гармошка",
  "Вокалам мониторы, барабанщику: кик, снейр и бас",
  "Всем ушные мониторы / басисту напольный монитор, 2 микрофона на зал",
  "Мониторы басисту и гитаристу. Клавишнику: клавиши и вокал",
  "Реверб на вокал, реверб на барабаны, дилей на сакс",
  "Стриму стерео-микс / без стрима",
  "Вокал -10 дб, барабанщику кик погромче, всё в стрим -6",
  "HPF на вокале 150, без компрессии на басе, гейт на томы",
  "Вокалы не мьютить / ничего не мьютить, кроме клика / бас в ноль",
  "Вокалы, мониторы и dca на USER 1",
];
// The 12 WING colors, as the console names them.
const COLOR_LABELS: Record<ColorId, string> = {
  grayblue: "Серо-синий", blue: "Синий", darkblue: "Тёмно-синий", turquoise: "Бирюзовый", green: "Зелёный", olive: "Оливковый",
  yellow: "Жёлтый", orange: "Оранжевый", red: "Красный", coral: "Коралловый", pink: "Розовый", mauve: "Пурпурный",
};
const COLOR_SWATCH: Record<ColorId, string> = {
  grayblue: "bg-slate-400", blue: "bg-blue-500", darkblue: "bg-blue-800", turquoise: "bg-teal-400", green: "bg-green-500", olive: "bg-lime-700",
  yellow: "bg-yellow-400", orange: "bg-orange-500", red: "bg-red-600", coral: "bg-orange-300", pink: "bg-pink-400", mauve: "bg-fuchsia-500",
};
const NO_DCA = "none";
const CONSOLE_LABELS = Object.fromEntries(Object.entries(CONSOLES).map(([k, v]) => [k, v.label])) as Record<ConsoleModel, string>;
const BUS_KIND_LABEL: Record<BusDef["kind"], string> = { monitor: "монитор", fx: "эффект", group: "группа", stream: "стрим" };


const toggle = <T,>(list: T[], value: T, on: boolean) =>
  on ? (list.includes(value) ? list : [...list, value]) : list.filter((v) => v !== value);

const sendOn = (c: ChannelDraft, b: BusDef) =>
  b.kind === "stream" ? c.stream : b.kind === "group" ? c.groups.includes(b.id) : b.kind === "fx" ? c.fxSends.includes(b.id) : c.monitorSends.includes(b.id);

function setSend(c: ChannelDraft, b: BusDef, on: boolean): ChannelDraft {
  if (b.kind === "stream") return editField(c, "stream", on);
  if (b.kind === "fx") return editField(c, "fxSends", toggle(c.fxSends, b.id, on));
  if (b.kind === "monitor") return editField(c, "monitorSends", toggle(c.monitorSends, b.id, on));
  // Group: joining sends GRP to the group and takes the channel off Main 1; leaving the last group puts it back.
  const groups = toggle(c.groups, b.id, on);
  return editField(editField(c, "groups", groups), "toMain", groups.length === 0);
}

function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

type Baseline = { name: string; raw: string; report: BaselineReport; conn: Record<number, string>; snap: BaselineSnap };
type Build = { scene: Scene; snap: string; summary: DiffSummary; report: string };

export default function Home() {
  const [text, setText] = useState("");
  const [scene, setScene] = useState<Scene | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [build, setBuild] = useState<Build | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [manual, setManual] = useState<string[]>([]);
  const [addKind, setAddKind] = useState<SourceKind>("vocal");
  const [template, setTemplate] = useState<string | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);
  // Server-side LLM (owner's key on Vercel): the button appears only when the server has a key.
  const [serverLlm, setServerLlm] = useState<{ enabled: boolean; model: string | null }>({ enabled: false, model: null });
  useEffect(() => {
    fetch("/api/llm")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setServerLlm({ enabled: Boolean(d.enabled), model: d.model ?? null }))
      .catch(() => {});
  }, []);
  function loadIntent(intent: Intent) {
    setScene(expand(intent, text));
    setError(null);
  }

  async function recognizeLlm() {
    setLlmBusy(true);
    try {
      const res = await fetch("/api/llm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      loadIntent(data.intent);
      setUnknown([]);
      setManual([]);
      setTemplate(null);
    } catch (e) {
      setError(`LLM: ${(e as Error).message}`);
    } finally {
      setLlmBusy(false);
    }
  }
  const sceneFile = useRef<HTMLInputElement>(null);
  const snapFile = useRef<HTMLInputElement>(null);

  // Local, rule-based: no network, no API key.
  function recognize() {
    try {
      const { intent, unknown, manual, template } = parseRequest(text);
      loadIntent(intent);
      setUnknown(unknown);
      setManual(manual);
      setTemplate(template);
    } catch {
      setUnknown([]);
      setManual([]);
      setError("Не нашёл ни одного источника. Перечисли инструменты: «4 вокала, 2 гитары, барабаны, бас…»");
    }
  }

  async function importScene(file: File) {
    try {
      const parsed = SceneSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error(issues(parsed.error));
      setScene(parsed.data);
      setText(parsed.data.text);
      setError(null);
    } catch (e) {
      setError(`scene.json не принят: ${(e as Error).message}`);
    }
  }

  async function loadBaseline(file: File) {
    const raw = await file.text();
    const report = validateBaseline(raw);
    let conn: Record<number, string> = {};
    let snap: BaselineSnap = { ae_data: { ch: {} } };
    if (report.valid) {
      const parsed: BaselineSnap & { ae_data: { ch: Record<string, { in: { conn: { grp: string; in: number } } }> } } = JSON.parse(raw);
      snap = parsed;
      conn = Object.fromEntries(Object.entries(parsed.ae_data.ch).map(([n, c]) => [Number(n), `${c.in.conn.grp}${c.in.conn.in}`]));
    }
    setBaseline({ name: file.name, raw, report, conn, snap });
    setBuild(null);
  }

  function runBuild() {
    if (!scene || !baseline?.report.valid) return;
    const parsed = SceneSchema.safeParse(scene);
    if (!parsed.success) return setError(`Сцена невалидна: ${issues(parsed.error)}`);
    try {
      const snap = apply(baseline.raw, compile(parsed.data, baseline.snap));
      const summary = summarize(diff(baseline.raw, snap));
      const report = buildReport({ baselineName: baseline.name, baseline: baseline.report, snap: baseline.snap, scene: parsed.data, summary, conn: inputLabels(parsed.data, baseline.snap), generatedAt: new Date() });
      setBuild({ scene, snap, summary, report });
      setError(null);
    } catch (e) {
      setError(`Сборка остановлена: ${(e as Error).message}`);
    }
  }

  function exportScene() {
    const parsed = SceneSchema.safeParse(scene);
    if (!parsed.success) return setError(`Сцена невалидна: ${issues(parsed.error)}`);
    download("scene.json", JSON.stringify(parsed.data, null, 2));
  }

  const update = (ch: number, fn: (c: ChannelDraft) => ChannelDraft) =>
    setScene((s) => s && { ...s, channels: s.channels.map((c) => (c.ch === ch ? fn(c) : c)) });

  const edited = (c: ChannelDraft, f: EditableField) => c.edited.includes(f) && "ring-2 ring-amber-400/70";
  const stale = build !== null && build.scene !== scene;
  // Send columns: every bus the scene creates (in-ear/monitor mixes, groups, FX, stream), in bus order.
  const sendCols: BusDef[] = scene?.buses ?? [];
  const dcaNames: string[] = scene?.dcas.length ? scene.dcas.map((d) => d.name) : [...DCA_GROUPS]; // explicit DCAs, else presets
  const conn = scene && baseline ? inputLabels(scene, baseline.snap) : (baseline?.conn ?? {});
  const outName = baseline ? `${baseline.name.replace(/\.snap$/i, "")}_generated_${new Date().toISOString().slice(0, 10)}` : "scene";

  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-6 px-4 py-8">
      <header className="flex items-center gap-3">
        <div className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-2xl shadow-sm shadow-primary/20">
          <SlidersHorizontal className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WING Scene Generator</h1>
          <p className="text-muted-foreground text-sm">Текст → каналы → патч baseline-снапшота → проверка в WING EDIT.</p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Запрос</CardTitle>
            <CardDescription>
              Разбор локальный, без ключей и интернета: инструменты, мониторы, реверб, стрим, уровни (−10 дб, погромче), mute, страницы USER. Каналы, HPF, цвета и шины задаёт код.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Например: 4 вокала, 2 акустики, барабаны, бас, 2 гитары. Вокалам мониторы, барабанщику кик и снейр. Реверб на вокал, стрим."
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={recognize} disabled={!text.trim()}>Распознать</Button>
              {serverLlm.enabled && (
                <Button variant="outline" onClick={recognizeLlm} disabled={!text.trim() || llmBusy} title={serverLlm.model ?? undefined}>
                  <Sparkles /> {llmBusy ? "LLM думает…" : "Через LLM"}
                </Button>
              )}
              <Button variant="outline" onClick={() => sceneFile.current?.click()}>Импорт scene.json</Button>
              <Button variant="outline" onClick={exportScene} disabled={!scene}>Экспорт scene.json</Button>
              <FileInput refObj={sceneFile} accept=".json,application/json" onFile={importScene} />
            </div>
            <details className="text-muted-foreground text-sm">
              <summary className="cursor-pointer">Что понимает разбор</summary>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {EXAMPLES.map((e) => (
                  <li key={e}>
                    <button className="hover:text-foreground text-left" onClick={() => setText((t) => (t.trim() ? `${t.trim()} ${e}.` : `${e}.`))}>
                      «{e}»
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2">Фантом, гейн, EQ, панорама и выходы не меняются: разбор отметит их как «вручную».</p>
            </details>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Baseline</CardTitle>
            <CardDescription>Снапшот из WING EDIT. Генератор меняет только разрешённые поля, routing и выходы не трогает.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button variant="outline" onClick={() => snapFile.current?.click()}>
              <FileUp /> {baseline ? "Заменить .snap" : "Загрузить .snap"}
            </Button>
            <FileInput refObj={snapFile} accept=".snap,application/json" onFile={loadBaseline} />
            {baseline && <BaselineStatus b={baseline} />}
          </CardContent>
        </Card>
      </div>

      {unknown.length > 0 && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Не распознано, проверь таблицу</AlertTitle>
          <AlertDescription>{unknown.map((u) => `«${u}»`).join(", ")}</AlertDescription>
        </Alert>
      )}

      {template && (
        <Alert>
          <AlertTitle>Шаблон «{template}»</AlertTitle>
          <AlertDescription>Инструменты не названы, взят типовой состав. Поправь таблицу или допиши инструменты в запрос.</AlertDescription>
        </Alert>
      )}

      {manual.length > 0 && (
        <Alert>
          <AlertTitle>Настрой вручную</AlertTitle>
          <AlertDescription>{manual.join("; ")}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Ошибка</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {scene && (
        <Card>
          <CardHeader className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5">
            <CardTitle>Каналы</CardTitle>
            <CardDescription>
              {scene.channels.length} каналов. Уровни в dB (по умолчанию −18), каналы в mute. Правленные вручную поля обведены, смена типа их не перезапишет.
            </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select items={KIND_LABELS} value={addKind} onValueChange={(v) => v && setAddKind(v as SourceKind)}>
                <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCE_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={scene.channels.length >= 40}
                onClick={() =>
                  setScene((s) => {
                    const c = s && newChannel(s, addKind);
                    return s && c ? { ...s, channels: [...s.channels, c].sort((a, b) => a.ch - b.ch) } : s;
                  })
                }
              >
                <Plus /> Канал
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">Ch</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Имя</TableHead>
                  <TableHead>Цвет</TableHead>
                  <TableHead>Вход</TableHead>
                  <TableHead title="Стерео-канал: один канал на паре входов в режиме ST">Стерео</TableHead>
                  <TableHead>HPF, Hz</TableHead>
                  <TableHead className="text-center">Comp</TableHead>
                  <TableHead className="text-center">Gate</TableHead>
                  <TableHead className="text-center">Mute</TableHead>
                  <TableHead>Fader</TableHead>
                  <TableHead title="Канал идёт в Main 1 напрямую (участники групп идут через группу)">Main 1</TableHead>
                  {sendCols.map((b) => (
                    <TableHead key={b.id} title={`Bus ${b.bus} · ${BUS_KIND_LABEL[b.kind]}${b.iem ? " · in-ear" : ""} · ${b.mode}`}>
                      {b.name}
                    </TableHead>
                  ))}
                  <TableHead>DCA</TableHead>
                  <TableHead title="Mute groups (#M), задаются в запросе">Mute</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {scene.channels.map((c) => (
                  <TableRow key={c.ch}>
                    <TableCell className="text-muted-foreground font-mono">{c.ch}</TableCell>
                    <TableCell>
                      <Select items={KIND_LABELS} value={c.kind} onValueChange={(v) => v && update(c.ch, (d) => applyKind(d, v as SourceKind, scene.mixes))}>
                        <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SOURCE_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={c.label}
                        maxLength={16}
                        aria-invalid={!c.label.trim() || undefined}
                        className={cn("h-8 w-28", edited(c, "label"))}
                        onChange={(e) => update(c.ch, (d) => editField(d, "label", e.target.value))}
                      />
                    </TableCell>
                    <TableCell>
                      <Select items={COLOR_LABELS} value={c.color} onValueChange={(v) => v && update(c.ch, (d) => editField(d, "color", v as ColorId))}>
                        <SelectTrigger size="sm" className={cn("w-36", edited(c, "color"))}>
                          <span className={cn("size-3 shrink-0 rounded-full", COLOR_SWATCH[c.color])} />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COLORS.map((col) => (
                            <SelectItem key={col} value={col}>
                              <span className={cn("size-3 rounded-full", COLOR_SWATCH[col])} />
                              {COLOR_LABELS[col]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{conn[c.ch] ?? "—"}</TableCell>
                    <TableCell className="text-center">
                      <Checkbox checked={c.stereo} className={cn(edited(c, "stereo"))} onCheckedChange={(on) => update(c.ch, (d) => editField(d, "stereo", on))} />
                    </TableCell>
                    <TableCell>
                      <NumberCell value={c.hpf} min={20} max={2000} className={edited(c, "hpf")} onCommit={(n) => update(c.ch, (d) => editField(d, "hpf", n))} />
                    </TableCell>
                    {(["comp", "gate", "mute"] as const).map((f) => (
                      <TableCell key={f} className="text-center">
                        <Checkbox checked={c[f]} className={cn(edited(c, f))} onCheckedChange={(on) => update(c.ch, (d) => editField(d, f, on))} />
                      </TableCell>
                    ))}
                    <TableCell>
                      <NumberCell value={c.fader} min={-144} max={10} step={0.5} className={edited(c, "fader")} onCommit={(n) => update(c.ch, (d) => editField(d, "fader", n))} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox checked={c.toMain} className={cn(edited(c, "toMain"))} onCheckedChange={(on) => update(c.ch, (d) => editField(d, "toMain", on))} />
                    </TableCell>
                    {sendCols.map((b) => {
                      const on = sendOn(c, b);
                      return (
                        <TableCell key={b.id}>
                          <div className="flex items-center gap-1.5">
                            <Checkbox checked={on} onCheckedChange={(v) => update(c.ch, (d) => setSend(d, b, v))} />
                            {b.kind !== "group" && (
                              <NumberCell
                                value={sendLevelOf(c, b.id)}
                                min={-144}
                                max={10}
                                step={0.5}
                                disabled={!on}
                                className={cn("w-16", edited(c, "sendLevel"))}
                                onCommit={(n) => update(c.ch, (d) => editField(d, "sendLevel", { ...d.sendLevel, [b.id]: n }))}
                              />
                            )}
                          </div>
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      <Select
                        items={{ [NO_DCA]: "—", ...Object.fromEntries(dcaNames.map((g) => [g, g])) }}
                        value={c.dca ?? NO_DCA}
                        onValueChange={(v) => update(c.ch, (d) => editField(d, "dca", v === NO_DCA || !v ? null : (v as ChannelDraft["dca"])))}
                      >
                        <SelectTrigger size="sm" className={cn("w-28", edited(c, "dca"))}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_DCA}>—</SelectItem>
                          {dcaNames.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{c.muteGroups.map((m) => `M${m}`).join(" ") || "—"}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Удалить CH ${c.ch}`}
                        onClick={() => setScene((s) => s && { ...s, channels: s.channels.filter((x) => x.ch !== c.ch) })}
                      >
                        <X />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {scene && (
        <Card>
          <CardHeader>
            <CardTitle>Сборка</CardTitle>
            <CardDescription>
              Шины: {sendCols.map((b) => `Bus ${b.bus} ${b.name}${b.fx ? ` (FX${b.fx.slot})` : ""}`).join(" · ") || "—"}.
              {scene.mains.length > 0 && <> Main: {scene.mains.map((m) => `${m.main} ${m.name}`).join(", ")}.</>}
              {scene.dcas.length > 0 && <> DCA: {scene.dcas.map((d) => `${d.dca} ${d.name}`).join(", ")}.</>}
              {scene.muteGroups.length > 0 && <> Mute groups: {scene.muteGroups.map((g) => `${g.group}${g.name ? ` ${g.name}` : ""}`).join(", ")}.</>}
              {scene.matrices.length > 0 && <> Матрицы: {scene.matrices.map((m) => `MX${m.mtx} ${m.name} ← Main ${m.from}`).join(", ")}.</>}
              {" "}Страницы: стандартные
              {scene.pages.map((pg, k) => ` · USER ${k + 1}: ${pg.sources.join(", ")}${pg.buses ? " + шины" : ""}${pg.dca ? " + DCA" : ""}`).join("")}.
              {" "}Все каналы по умолчанию в mute.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-muted-foreground">Пульт:</span>
              <Select items={CONSOLE_LABELS} value={scene.console} onValueChange={(v) => v && setScene((s) => s && { ...s, console: v as ConsoleModel })}>
                <SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONSOLES) as ConsoleModel[]).map((k) => (
                    <SelectItem key={k} value={k}>{CONSOLE_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">{CONSOLES[scene.console].local} локальных входов, дальше AES50 A</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-muted-foreground">Запись всех каналов (со входов):</span>
              {(
                [
                  ["usb", "USB (DAW)"],
                  ["card", "WING-LIVE (SD)"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-1.5">
                  <Checkbox checked={scene.record[k]} onCheckedChange={(on) => setScene((s) => s && { ...s, record: { ...s.record, [k]: on } })} />
                  {label}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={runBuild} disabled={!baseline?.report.valid}>
                {build && !stale ? "Пересобрать" : "Собрать .snap"}
              </Button>
              {!baseline && <span className="text-muted-foreground text-sm">Сначала загрузи baseline.</span>}
              {baseline && !baseline.report.valid && <span className="text-destructive text-sm">Baseline не прошёл проверку.</span>}
              {stale && <Badge variant="outline">Сцена изменилась, пересобери</Badge>}
              {build && !stale && (
                <>
                  <Button variant="outline" onClick={() => download(`${outName}.snap`, build.snap)}><Download /> .snap</Button>
                  <Button variant="outline" onClick={() => download(`${outName}_report.md`, build.report, "text/markdown")}><Download /> Отчёт</Button>
                </>
              )}
            </div>
            {build && <BuildResult build={build} />}
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function FileInput({ refObj, accept, onFile }: { refObj: React.RefObject<HTMLInputElement | null>; accept: string; onFile: (f: File) => void }) {
  return (
    <input
      ref={refObj}
      type="file"
      accept={accept}
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        e.target.value = "";
      }}
    />
  );
}

function BaselineStatus({ b }: { b: Baseline }) {
  const r = b.report;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {r.valid ? <CheckCircle2 className="text-primary size-4" /> : <TriangleAlert className="text-destructive size-4" />}
        <span className="font-medium">{b.name}</span>
        {r.format && <Badge variant="secondary">{r.format}</Badge>}
        {r.firmware && <Badge variant="secondary">{r.creator} {r.firmware}</Badge>}
      </div>
      {r.errors.map((e) => <p key={e} className="text-destructive">{e}</p>)}
      {r.missingPaths.length > 0 && <p className="text-muted-foreground font-mono text-xs">{r.missingPaths.slice(0, 5).join(", ")}…</p>}
      {r.valid && (
        <ul className="text-muted-foreground space-y-0.5">
          <li>
            Выходы шин в baseline:{" "}
            {Object.entries(r.routes).filter(([, o]) => o.length).map(([n, o]) => `Bus ${n} → ${o.join(", ")}`).join(" · ") || "не назначены"}
          </li>
        </ul>
      )}
      {r.warnings.map((w) => <p key={w} className="text-amber-700">⚠ {w}</p>)}
    </div>
  );
}

function BuildResult({ build }: { build: Build }) {
  const { summary } = build;
  const lines = useMemo(() => summary.entries.map(describe), [summary]);
  const clean = summary.outsideAllowlist.length === 0 && summary.guards.every((g) => g.count === 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {Object.entries(summary.byKind).map(([k, n]) => <Badge key={k} variant="secondary">{k}: {n}</Badge>)}
      </div>
      <div className={cn("flex flex-wrap gap-2 rounded-xl border p-3 text-sm", clean ? "border-primary/30 bg-primary/5" : "border-destructive/40 bg-destructive/5")}>
        {summary.guards.map((g) => (
          <span key={g.label} className={g.count ? "text-destructive font-medium" : "text-muted-foreground"}>
            {g.label}: {g.count}
          </span>
        ))}
        <span className={summary.outsideAllowlist.length ? "text-destructive font-medium" : "text-muted-foreground"}>
          Вне allowlist: {summary.outsideAllowlist.length}
        </span>
      </div>
      <details className="rounded-xl border p-3">
        <summary className="cursor-pointer text-sm font-medium">Все изменения ({lines.length})</summary>
        <pre className="text-muted-foreground mt-2 max-h-96 overflow-auto font-mono text-xs leading-relaxed">{lines.join("\n")}</pre>
      </details>
      <details className="rounded-xl border p-3">
        <summary className="cursor-pointer text-sm font-medium">Raw diff {"{path, before, after}"}</summary>
        <pre className="text-muted-foreground mt-2 max-h-96 overflow-auto font-mono text-xs">{JSON.stringify(summary.entries, null, 1)}</pre>
      </details>
    </div>
  );
}

// Uncontrolled while typing, clamped and committed on blur/Enter; remounts when the value changes elsewhere.
function NumberCell(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string | false;
  onCommit: (n: number) => void;
}) {
  const step = props.step ?? 1;
  const commit = (raw: string, el: HTMLInputElement) => {
    const n = Math.round(Number(raw) / step) * step;
    if (raw.trim() === "" || !Number.isFinite(n)) {
      el.value = String(props.value);
      return;
    }
    const clamped = Math.min(props.max, Math.max(props.min, n));
    el.value = String(clamped);
    if (clamped !== props.value) props.onCommit(clamped);
  };
  return (
    <Input
      key={props.value}
      type="number"
      defaultValue={props.value}
      min={props.min}
      max={props.max}
      step={step}
      disabled={props.disabled}
      className={cn("h-8 w-20", props.className)}
      onBlur={(e) => commit(e.target.value, e.target)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
