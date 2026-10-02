# Cross-language parity harness (Python ⇄ TypeScript)

Differential tests for bdfparser v3: the Python library (`../bdfparser/src`)
and this TypeScript library (`src/`) implement one spec
(`../bdfparser/docs/SPEC-v3.md`) and must produce identical results. The
harness generates seeded random fonts and operation scripts, runs every
script through both libraries, serialises every result canonically and
compares them.

Nothing here is imported by the library or its tests. The harness reads the
library *sources* (`src/*.ts` via Bun, `../bdfparser/src` via `sys.path`), so
it always tests the working tree, not `dist/`.

## Running

From the `bdfparser-js` repository root:

```sh
python3 tools/parity/run_all.py                  # all phases, ~1 min with 8 jobs
python3 tools/parity/run_all.py --js node        # same, JS side under Node (bundled with `bun build`)
python3 tools/parity/run_all.py --n 20000 --n-all 5000 --seed 7 --jobs 16
python3 tools/parity/run_all.py --skip-corpus    # random cases only
```

To get a `bun run parity` command, add this script to `package.json` (not
added by the harness):

```json
"parity": "python3 tools/parity/run_all.py"
```

Requirements: Python ≥ 3.10 (stdlib only; the Python library is pure Python),
Bun (runs `run_js.ts` directly; with `--js node` Bun only bundles it and Node
runs it). `BDFPARSER_PY=/path/to/bdfparser/src` overrides the Python source
location. Outputs go to `tools/parity/out/` (git-ignored) or `--out DIR`.
Exit status is 1 if any phase finds a NEW (not yet analysed) divergence.

## Phases

| phase | what |
|---|---|
| `tables` | full charset tables on both sides: `cp2char` over 0x00–0xFF, every GL pair 0x2121–0x7E7E, every lead 0x81–0xFE × trail 0x40–0xFE (plus 4-byte GB18030 samples), `char2cp` over the whole BMP (+ astral samples), for every charset of SPEC §4 (GL and non-GL variants) and the extra names in `gen_cases.EXTRA_TABLE_NAMES`. Writes `tables_report.txt` and `agreed.json` (codes both sides map identically). |
| `random` | `--n` (default 2000) seeded random cases that avoid every known divergence trigger (`--avoid known`). This is the phase that finds new bugs. |
| `random_all` | `--n-all` (default 1000) seeded random cases with every feature enabled. All divergences must match a known issue; the report shows how often each occurs. |
| `probes` | one minimal reproducer per finding below, plus regression probes for bugs found by this harness and fixed upstream. Prints whether each finding still reproduces. `--heavy` adds K15 (allocates gigabytes). |
| `corpus` | every distinct `.bdf`, `.pcf`, `.pcf.gz` and `.ttf` file in `../bdfparser/tests/fonts`, `test/fonts` and `test/fixtures` (251 files) with a fixed script: load, model, `tobdf`, `topcf` (3 option sets), PCF read-back, `tottf` (3 option sets), TTF read-back (both shapes), `tosvgfont` (2 option sets), `drawall` / `draw` in several directions, `char2cp` / `cp2char` probes, `charsetconvert`, `transform`, `updatebbox`. Fonts over 1.5 MB (uncompressed) get a reduced script. |

### Random cases

`gen_cases.py random N SEED OUT [--agreed agreed.json] [--avoid TAGS|known]`.
Case *i* uses seed `SEED * 1000003 + i`, so any case can be regenerated alone
(`--start i`). A case is a structured font spec rendered to BDF text, plus an
operation script:

* **Fonts**: random `SIZE` (including 0), `FONTBOUNDINGBOX` (union of the glyph
  boxes, perturbed, or random), STARTFONT versions (`2.1`, `2`, `.5`, `1e1`,
  `02.1`, ...), METRICSSET / CONTENTVERSION / global SWIDTH, DWIDTH, SWIDTH1,
  DWIDTH1, VVECTOR (comma or space separated), header comments (quoted,
  unquoted, empty, lone `"`), 0–40 glyphs: odd widths, negative offsets,
  empty glyphs (BBX 0 0 / 0 h / w 0), unencoded glyphs (`ENCODING -1 [altcode]`,
  missing ENCODING, other negative codes), duplicate codepoints, glyph names
  with spaces / non-ASCII / > 63 chars, per-glyph metrics in random order,
  fewer or more hex rows than BBX height, extra hex digits, non-zero padding
  bits, lower-case hex, blank lines inside BITMAP, missing ENDCHAR / ENDFONT,
  wrong `CHARS` and `STARTPROPERTIES` counts, properties with int / `+5` /
  `007` / quoted / `""`-escaped / unterminated-quote / raw multi-word /
  key-only values, mixed-case names, COMMENT lines in the property block,
  LF / CRLF / CR line endings, indentation, tabs between tokens, blank lines,
  BOM, invalid UTF-8 bytes (loaded as bytes), occasional fatal errors (missing
  BBX, malformed numbers, truncated header).
* **Charsets**: 40 % Unicode, otherwise one of the 30 registry/encoding pairs
  of SPEC §4 (ISO 8859-1/2/5/7/9/15, ISO646, KOI8-R/U, cp1250–1257, GB2312
  (GL and EUC form), GBK, GB18030, JIS X 0208, JIS X 0201, KS C 5601, KS X 1001,
  Big5, Big5-ETEN, Big5-HKSCS, SJIS, FontSpecific). Glyph codes are drawn from
  `agreed.json`, i.e. codes on which the two codec tables agree, so the known
  table variants do not drown other divergences.
* **Operations** (5–35 per case): `tobdf`; full model; `tosvgfont` (offsets,
  unicode formats, control chars); `topcf` (random options) and every one of
  the 48 option combinations in sweep cases; PCF and TTF write → read round
  trips; `tottf` (shape, dotsize incl. < 0.5 and invalid, ppu incl. invalid,
  metadata, timestamps incl. negative / > 2³²) and a 48-point TTF grid in sweep
  cases; `draw` / `drawcps` / `drawall` (all 12 directions + invalid, both
  modes, line limits, glyph spacing, missing-glyph replacement, order, ranges);
  `itercps` / `iterglyphs`; `Glyph.draw` (all modes, `bb`), `origin`, `chr`,
  `str`; `glyph(char)`, `lacksglyphs`, `char2cp`, `cp2char`; `setprop` /
  `delprop` / `getprop`; `addglyph` (partial metas, unknown keys, replace);
  `removeglyph` (by code and by Glyph); `newglyph`; attached Glyph handles:
  `setbitmap` (all modes, trim), `setmeta` (incl. codepoint moves to/from
  unencoded), `shift`, `transform`, `clone`, re-`addglyph`; `updatebbox`;
  `subset`; `merge` (second random font); `Font.transform`; `clone`;
  `charsetconvert`; `encoding()` overrides; `swidth`; module-level codecs
  (`charset_codec` ⇄ `getCodec`) and charset-name canonicalisation; and
  bitmap scripts over every Bitmap method: `crop`, `overlay`, `concat`,
  `concatall` (offsets, both directions, alignments), `enlarge`, `replace`,
  `shadow`, `glow`, `bytepad`, `todata` 0–5, `getpixel` / `setpixel`, `fliph`,
  `flipv`, `rotate`, `invert`, `shift`, `bbox`, `trim`, `bold`, `italic`,
  `paste`, `clone`, `fromstring`, `blank`, `width` / `height` / `str` /
  `equals`, `tosvg` (all formats, shapes, offsets, fractional pixel sizes),
  `bitmap_contours` ⇄ `bitmapContours` and `rasterize(bitmap_contours(b))`.
  About 3 % of arguments are deliberately out of domain (error parity).

### Comparison

Each runner writes, per operation, a canonical text (`canon()` in
`run_py.py` / `run_js.ts`: JSON-like, ASCII-only `\uXXXX` escapes per UTF-16
unit, numbers formatted like ECMAScript `Number#toString`). Bytes (PCF, TTF)
and texts / models longer than 600 characters are replaced by their SHA-256
(`--full` keeps everything, base64 for bytes). Font state is compared through
a digest of the whole model (headers, props, original property names, the 17
slots of every glyph in storage order, unencoded glyphs with altcodes,
charset) after every mutation.

Both sides raising counts as agreement (messages differ by language), unless
the operation is a mutation and the two sides leave the font in different
states (`error-state`). `compare.py` reports every *independent* divergence:
once an operation diverges, the registers it writes (fonts, the bitmap
register, glyph handles) are tainted and divergences of later operations that
read them are counted as cascades. Each divergence is labelled with the
first matching entry of `known_issues.py` or `NEW`. Codec divergences are only
labelled K13 if *every* differing element is a measured table difference.

### Investigating a divergence

```sh
python3 tools/parity/compare.py results out/random_py.jsonl out/random_js.jsonl out/random.jsonl --tables out/agreed.json
python3 tools/parity/minimize.py out/random.jsonl r1-00042 --out out/min    # shrink + show both outputs
python3 tools/parity/run_py.py out/random.jsonl /dev/stdout --full --only r1-00042
bun tools/parity/run_js.ts out/random.jsonl /dev/stdout --full --only r1-00042
```

`minimize.py` greedily drops operations, glyphs, properties, header lines,
noise flags, list elements and dict keys while the case still diverges with
the same signature, then prints the reproducer (BDF lines + operations) and
the full Python and JavaScript results.

## Files

| file | role |
|---|---|
| `run_all.py` | driver: phases, sharding (`--jobs`), source fingerprints, summary (`out/summary.json`) |
| `gen_cases.py` | random font / script generator, corpus cases, charset-table spec |
| `run_py.py` | Python runner (also `--tables`) |
| `run_js.ts` | TypeScript runner, mirror of `run_py.py` (also `--tables`) |
| `compare.py` | result and table comparison, labelling |
| `known_issues.py` | matchers for the analysed divergences below |
| `probes.py` | one minimal reproducer per finding |
| `minimize.py` | test-case shrinker |

## Findings

Status as of bdfparser `844c1c7` / bdfparser-js `efda8f7` (2026-10-02). Both
repositories were being changed while the harness was built; two divergences
it found early were fixed upstream during that time and are kept as
regression probes: **R01** `drawall`/`draw` with nothing to draw (Python
raised `ValueError: max() arg is an empty sequence`, JS returned an empty
Bitmap) and **R02** write-back through a stale attached Glyph.

"Side" names the implementation that deviates from the spec (or both when
the spec does not decide; then a spec decision is needed).

| id | side | spec | divergence (minimal input → Python vs JS) |
|---|---|---|---|
| K02 | Python | §1.3 (empty bitmaps are valid) | `Bitmap(['','']).todata(5)` → `ValueError: invalid literal for int() with base 2: ''` vs `[0, 0]`; `todata(4)` → error vs `['', '']`. `bitmap.py: Bitmap.todata` calls `int(row, 2)` on zero-width rows. |
| K03 | both (undefined) | §1.3, §2.5 | Negative sizes: `Bitmap(['101']).crop(-1, 2, 0, 0)` → Python `['', '10']` (ragged) vs JS `RangeError` (`'0'.repeat(-1)` in `Bitmap.ts __crop_string/__crop_bitmap`). A BDF with `FONTBOUNDINGBOX -1 2 0 0` loads on both sides, then every `draw(mode=0)` gives `['','']` in Python and throws in JS. Inside `Font.transform` both raise, after mutating different glyphs. Suggest: reject negative sizes in both (and a negative FBB at parse time). |
| K04 | both (spec gap) | §2.5 (`overlay` "v2 kept") | `Bitmap(['1001110']).overlay(Bitmap([]))` → Python `[]` vs JS `['1001110']`; Python `zip()`s rows and columns (result = smaller size), JS maps over `this` (result = size of `this`). Suggest specifying JS behaviour (like `paste`: size unchanged). |
| K05 | JS | §3 (`^[+-]?\d+$` ⇒ int), §5 (exact writer) | `FOO 99999999999999999999` / `SWIDTH 99999999999999999999 0` / `BAR 1000000000000000000000`: Python keeps exact ints; JS `parseInt` gives `100000000000000000000` and `tobdf` writes `BAR 1e+21`, which is not even an integer token. `Font.ts BdfParser.propvalue / ints`, `tobdf` (`fmtnum`). Applies to every integer field. |
| K06a | JS | §1.1, §5 (property order = file order) | `B 1`, `123 5`, `A 2` → JS `props` is a plain object, integer-like keys are enumerated first: `tobdf` writes `123 5` first. `Font.ts` `props: Props = {}`. |
| K06b | JS | §1.1 | Property `__proto__ "x"` is silently lost in JS (`props['__proto__'] = 'x'` sets the prototype slot); `tobdf` writes `STARTPROPERTIES 1` instead of 2. |
| K06c/d | both (spec gap); Python crash | §1.1 (`props['comment']` reserved) | A lower-case property line `comment "abc"` collides with the COMMENT list: Python `tobdf` writes `STARTPROPERTIES 0` + `COMMENT "a"`, `COMMENT "b"`, `COMMENT "c"`; JS drops it. `comment 5` followed by a `COMMENT x` line: Python `AttributeError: 'int' object has no attribute 'append'` (not a `BDFParseError`, `font.py` `__parse`, `props.setdefault('comment', []).append`), JS loads it. |
| K07 | both (spec gap) | §3 ("strip whitespace") | Python `str.split()/strip()` treat U+001C–001F and U+0085 as whitespace, JS `\s`/`trim()` treat U+FEFF as whitespace: `SWIDTH 500 0\x1f` loads in Python, `BDFParseError` in JS; `COMMENT hello\x85` → `hello` vs `hello\x85`; `COMMENT y﻿` → `y﻿` vs `y`; a line starting with U+FEFF (`﻿COMMENT x`) is an ignored unknown keyword in Python, a comment in JS. Suggest: BDF whitespace = space / tab only. |
| K08 | both | §2.9 (malformed numbers ⇒ `BDFParseError`) | Python `int()` accepts `ENCODING 1_2` (→ 12), `BBX 1_0 ...`, non-ASCII digits (`٣`); `float()` accepts `STARTFONT inf`, `nan`, `2_1`. JS `Number()` accepts `STARTFONT 0x10` (→ 16) and `Infinity`; `STARTFONT Infinity` is written back as `inf` (Python) vs `Infinity` (JS). `font.py` `ints()` / ENCODING / STARTFONT; `Font.ts` STARTFONT (`Number(value)`). |
| K09 | JS | §2.3 (`removeglyph` no-op if missing) | `g = font.glyphbycp(5); font.removeglyph(g); font.addglyph({codepoint: 5}, replace=False); font.removeglyph(g)` → Python leaves the new glyph, JS deletes it: `Glyph.ts get _store` returns `null` once detached, so `Font.ts removeglyph` falls back to deleting by codepoint. |
| K10 | (sanctioned) | §4 | GB18030 4-byte codes: Python converts U+B650 → 0x8239E535 and `char2cp('😀')` → 0x9439FC36, JS (no iconv) drops / returns null. Allowed by the spec; listed for completeness. |
| K11 | JS (precision) | §2.5 (`todata` "v2 kept") | `Bitmap(['1'*60]).todata(5)` → `[1152921504606846975]` vs `[1152921504606847000]` (`parseInt(s, 2)` above 2⁵³). |
| K12 | invalid input | §1.3 | Ragged bitmaps (e.g. after `replace('10', '2')`): `rotate()` → Python `IndexError` vs JS rows containing the text `undefined`. |
| K13 | codec tables | §4 | See below. |
| K14 | both | §4 (canonicalisation) | `encoding(charset='ISO8859-01')` → Python key `iso885901`, JS `iso88591` (`canonical_charset` keeps the leading zero, `canonicalCharset` falls back to the `-` split). `KOI8-RU` → Python `koi8r` (props `KOI8`/`R`), JS `koi8ru` = WHATWG koi8-u (props `KOI8RU`/`0`). |
| K15 | both (resource) | §6 | PCF writer pads bitmaps to the font height: with `FONT_ASCENT 300000000` both produce an identical 1.2 GB PCF (`bdftopcf` rejects the file); above 2³¹ bytes (e.g. `FONT_ASCENT 1197492318`, glyphpad 2) JS throws `RangeError: length cannot be negative` (int32 overflow) while Python writes 2.4 GB. Suggest validating FONT_ASCENT/DESCENT. |
| K16 | Python | §1.3 (equal-length rows) | `Bitmap.concatall([[], [], ['0110','0010']], direction=-1, align=0, offsetlist=[-2, 3])` → Python `['0110','0010','0000','0000','0000','','']` (zero-width rows: `__listofstr_offset_concat` takes the width from an empty list, `zip()` truncates), JS pads to width 4. |
| K17 | JS (runtime) | §4 ("WHATWG TextDecoder") | The JS results for legacy charsets depend on the JS runtime: Node's ICU-backed `TextDecoder` differs from Bun's (and from the WHATWG tables) for big5 / big5hkscs (6253 codes), euc-kr / ks c 5601 (9042: Node decodes plain EUC-KR, not UHC), euc-jp / jisx0208 (33), shift_jis (1). Node also returns PUA characters for big5 0xFF / 0x8140 in `fatal` mode instead of throwing. Compare `tables_js.json` of a `--js node` and a default run. |

### K13: codec table differences (Python codecs vs WHATWG decoders)

The spec accepts GB2312 table variants (e.g. 0xA1A4). The table phase
measures all differences (`out/tables_report.txt`; 35 of 59 tables differ,
counts are cp2char / char2cp differing entries under Bun):

* **gb2312 / euccn / iso2022cn** (16498 / 16497 non-GL, 1394 / 1395 GL): JS
  decodes with `gbk`, so GBK-only codes (0x8140 丂 ...), 0x80 → €, 0xA1A4 · vs
  ・ and 0xA1AA — vs ―, GB2312 rows 2/8 extensions. **gbk**: 2150 (0x80 €, PUA
  0xA140...). **gb18030**: 22 cp2char (0xA3A0, 0xA6D9..., GB18030-2005 vs
  2022) + all 4-byte codes (K10).
* **big5** 5144 (WHATWG big5 = HKSCS: 0x8740..., 0xA145 • vs ‧, ¢ £ ¥),
  **big5hkscs** 203.
* **shift_jis / euc-jp / jisx0208**: 2732 / 463: JIS X 0208 vs windows-31j
  (〜 vs ～, ‖ vs ∥, − vs －, ¢ £ ¬ vs fullwidth, NEC rows), 0x80.
* **euc-kr / ksc5601**: 8823 (WHATWG euc-kr is UHC, 0x8141 갂...); GL form: 1
  (0x2454 HANGUL FILLER).
* **cp1250–1258**: 1–14 each: undefined bytes (0x81, 0x8D, ...) are C1
  controls in WHATWG, unmapped in Python.
* **iso8859-9, iso8859-11, tis620**: WHATWG maps the labels to windows-1254 /
  windows-874, so 0x80–0x9F decode to €, ‚, ƒ ... instead of C1 controls (the
  same reason the spec special-cases ISO 8859-1 for JS; the special case is
  missing for -9 and -11).
* **koi8u**: WHATWG koi8-u is KOI8-RU (0xAE ў vs ╝, 0xBE Ў vs ╬).
* **Python `char2cp` returns codes that are not valid font codes** (§4:
  cp ⇄ bytes is 1, 2 or 4 bytes and conversions are inverse): 3-byte JIS X 0212
  codes for a JIS X 0208 / EUC-JP font (`ß` → 0x8FA9CE, `¡` → 0x8FA2C2), 8-byte
  KS X 1001:1998 composition sequences for Hangul outside KS X 1001
  (`갂` → 0xA4D4A4A1A4BFA4A2), and `¥` → 0x5C (`cp2char(0x5C)` is `\`). None
  round-trips through `cp2char`; `charsetconvert` then creates glyphs at
  these codes. `encoding.py: CharsetCodec.char2cp` (should check the byte
  length and round-trip).
* **Charsets only JS knows**: cp866, cp874, cp932, cp936, cp949, cp950, hz
  (and every other WHATWG label) are decoded by JS but are "anything else ⇒
  Unicode identity + warning" in Python (§4): JS deviates from the spec table
  (or the spec should list them).

Everything else (ISO 8859-1..8/10/13..16, ISO646/ASCII, KOI8-R, cp1256,
JIS X 0201, Mac Roman, the Unicode keys, unknown charsets) is identical.

## Results of the reference run

At the commits above (Bun 1.4.2, Node 24.21, Python 3.12, 20-core machine):

| run | cases | operations | NEW | wall time |
|---|---|---|---|---|
| `run_all.py` (defaults, 8 jobs): tables / random / random_all / probes / corpus | 59 tables, 2000 + 1000 + 29 + 251 | 49179 + 24099 + 64 + 5221 | 0 | 66 s (tables 9 s, random 11 s, random_all 8 s, corpus 36 s) |
| `--n 20000 --n-all 5000 --seed 101 --jobs 12 --skip-corpus --skip-probes` | 25000 | 613240 | 0 | 151 s |
| `--js node --seed 202` (all phases) | 3280 + 59 tables | 78539 | 0 | 142 s |

In `random_all` every divergence is one of K02–K14; under Node the corpus
shows 26 instead of 19 K13 divergences (K17).
