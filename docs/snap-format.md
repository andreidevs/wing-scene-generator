# WING snapshot format (as seen in WING Edit 3.3.1, `snapshot.11`)

Изучено на `fixtures/baseline.snap` (чистая сцена) и `fixtures/show-working.snap` (рабочее шоу).
Справка по диапазонам: WING Remote Protocols V3.0.5-1 (P.-G. Maillot).

## Файл
- Обычный UTF-8 JSON без BOM, минифицирован, без перевода строки в конце.
- Корень: `type` ("snapshot.11"), `creator` ("WING Edit"), `creator_vers` ("3.3.1"), `creator_model` ("wing"), `creator_name`, `ae_data` (аудио-движок), `ce_data` (консоль: слои, user, GPIO, OSC…).
- `ae_data`: `cfg io ch aux bus main mtx dca mgrp fx cards play rec`.
- **`JSON.parse` → `JSON.stringify` не байт-в-байт**: целочисленные ключи переупорядочиваются (`cards.wlive` = `{"sdlink":…, "1":…}`). Поэтому запись идёт через `lib/ordered-json.ts`, который хранит порядок ключей и исходный текст чисел.

## Канал `ae_data.ch.{1..40}`
| Поле | Тип | Значения |
|---|---|---|
| `clink` | bool | **true = полоска показывает имя/цвет/иконку источника** (`io.in.<grp>.<n>`), false = свои `name`/`col`. В чистой сцене true; генератор ставит false |
| `name` | string | ≤16 символов |
| `col` | int | 1..12 по документации; FW 3.3 пишет и 13..18 |
| `icon` | int | 0..999 |
| `flt.lc` / `flt.lcf` | bool / float | HPF вкл / 20..2000 Hz |
| `gate.on`, `dyn.on` | bool | гейт / компрессор (`dyn.mdl` — модель) |
| `fdr` | float | dB, −144 = −∞ |
| `mute` | bool | |
| `send.{1..16,MX1..MX8}` | object | `on` bool, `lvl` −144..10 dB, `mode` PRE/POST/GRP, `pon`, `plink`, `pan` |
| `main.{1..4}` | object | `on`, `lvl`, `pre` — назначение в Main |
| `tags` | string | ≤80, через запятую: `#D1` = DCA 1, `#M1` = mute group 1 |
| `in.conn` | object | `grp` (LCL, A, B, C, SC, USB, CRD, MOD, OFF…) + `in` — **routing, не трогаем** |
| `in.set.trim` | float | **гейн, не трогаем** |

Значения on/off — JSON `true/false`, уровни — float в dB.

## Цвета (индекс → цвет)
1 gray blue · 2 medium blue · 3 dark blue · 4 turquoise · 5 green · 6 olive green · 7 yellow · 8 orange · 9 red · 10 coral · 11 pink · 12 mauve

## Шина `ae_data.bus.{1..16}`
`name` (≤16), `col`, `busmono` (bool), `fdr`, `mute`, `main.{1..4}.{on,lvl,pre}`, `send.*`, `preins.{on,ins}` / `postins` (`ins` = `NONE` | `FX1..FX16`), `tags`.

## FX `ae_data.fx.{1..16}`
`{ "mdl": "NONE", "fxmix": 100 }` в чистой сцене. При выборе модели объект содержит все её параметры (`V-REV`: pdel, dcy, lmult…). Реверберы допустимы только в FX1..FX8. Генератор пишет FX только целыми блоками из `lib/fx-templates.ts`, снятыми с рабочего шоу.

## DCA `ae_data.dca.{1..16}`
`name` (**≤8** символов), `col`, `fdr`, `mute`, `icon`, `led`, `mon`. Членство задаётся не здесь, а через `ch.N.tags` (`#D{n}`).

## Выходы `ae_data.io.out.{LCL,AUX,A,B,C,SC,USB,CRD,MOD,REC,AES}.{n}`
`{ "grp": "BUS"|"MAIN"|"MTX"|"MON"|"OFF"|<вход>, "in": k }`. Источник — по каналам: у стерео-шины N левый = `2N−1`, правый = `2N`. В чистой сцене LCL 1..6 = Bus 1..6 (L), LCL 7/8 = Main 1 L/R, USB — OFF.

## Вход `ae_data.io.in.{grp}.{n}`
`g` — гейн, `vph` — фантом, `mute`, `name`, `col`. **Не трогаем.**

## Чистая сцена (fixtures/baseline.snap)
Все имена пустые, `col` 1 (шины 1–8: 10, 9–10: 6, 11–16: 12), все FX `NONE`, инсертов нет. Каналы 1–24 = LCL1–24, 25–40 = OFF. Все каналы назначены в Main 1. Фейдеры каналов, шин 1–8, DCA и Main = −∞ (шины 9–16 = 0 dB).

## Страницы пульта `ce_data.layer.<секция>.<страница>`
Секции: `L`, `C`, `R` (WING), `CMPCT` (Compact), `RCK` (Rack), `EXT`, `VRT`, `WEDIT` (страницы самого WING Edit).
Страница: `name`, `ofs` и нумерованные слоты `{ "type": "CH"|"BUS"|"DCA"|"OFF", "i": n, "dst": 1 }`.
Слотов: L 24, C/R 16 (R «CH1-40» — 40), Compact 24, Rack 16/40, WING Edit 96.
Номера полос: CH 1..40 каналы, CH 41..48 AUX 1..8, BUS 1..16 шины, BUS 17..20 Main 1..4, BUS 21..28 Matrix 1..8, DCA 1..16.
В «чистом» base страницы WING Edit «CH 1-16» и «CH 17-32» были сбиты с прошлой работы — генератор приводит страницы «CH a-b» к стандарту.
`ch.N.mute` — mute канала (bool); в чистой сцене false везде, генератор ставит true.
