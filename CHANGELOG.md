# Changelog

## 3.0.0

A rewrite sharing one specification (`docs/SPEC-v3.md`) with the Python
library: same concepts, method names and defaults, and byte-identical BDF /
PCF / TTF / SVG output.

### Added

- **Formats**: PCF reader (any byte/bit order, padding, scan unit, compressed
  metrics, `.pcf.gz` via `DecompressionStream`) and writer byte-identical to
  `bdftopcf` (`font.topcf()`, `readPcf`, `writePcf`); pixel TrueType writer
  with square or round dots (`font.tottf({ shape, dotsize, ppu })`,
  `writeTtf`) and reader (`readTtf`, lossless round trip through a private
  `BDFP` table, rasterization of other TrueType fonts); outline helpers
  `bitmapContours` and `rasterize`.
- **Loading**: `load_string`, `load_bytes` (auto-detects BDF / PCF / TTF),
  `load_bytes_async` (also gzip), `load_url` (global `fetch`, works in
  browsers); `$Font()` accepts a URL, BDF text, bytes or (async) iterables of
  lines; `Font.create()` for new fonts.
- **Editing**: `setprop`, `getprop`, `delprop`, `addglyph(glyph, replace)`,
  `removeglyph`, `newglyph`, `updatebbox`, `subset`, `merge`, `transform`,
  `clone`; `Glyph.setbitmap` (inverse of `draw`), `setmeta`, `shift`,
  `transform`, `clone`; glyphs obtained from a font are *attached* and write
  their edits back. `Bitmap.fromstring`, `Bitmap.blank`, `getpixel`,
  `setpixel`, `fliph`, `flipv`, `rotate`, `invert`, `shift`, `bbox`, `trim`,
  `bold`, `italic`, `paste`, `equals`.
- **Encodings without iconv**: `TextDecoder`-based conversion for GB2312, GBK,
  GB18030, Big5, Shift-JIS, EUC-JP, EUC-KR, JIS X 0208/0201, KS C 5601,
  ISO 8859-x, KOI8-R/U, CP125x, TIS-620, MacRoman…; X11 GL-form detection for
  94×94 sets; `font.char2cp` / `font.cp2char`; `sanitizeCharset`,
  `canonicalCharset`, `charsetProps`, `getCodec`. The `iconv` option is still
  accepted (any `iconv-lite`-compatible object).
- **SVG**: `Bitmap.tosvg` merges all pixels into one minimal outline (holes
  included) and supports round dots (`shape: 'circle'`).
- **Warnings / errors**: `setWarningHandler()` (default `console.warn`,
  `null` silences); `BDFParseError` with the line number.
- **CLI** `bdfparser convert | info | preview` (Node.js).
- Browser examples (`examples/`): classic script, ES module, LED dot-matrix
  display with scrolling marquee; Node.js example.
- `defaultglyphname()`, `VERSION`, `Font.swidth()`.

### Changed (breaking)

- Node.js ≥ 20; ESM, CommonJS and IIFE (`bdfparser.global.js`) builds; no
  runtime dependencies and no Node.js APIs in the library (Deno via
  `npm:bdfparser`).
- Properties are typed: unquoted integers are numbers, quoted strings are
  unescaped (`""` → `"`), other unquoted values (non-Adobe / XFree86 style)
  are kept as strings — replaces the `NO_QUOTE_PROPS` heuristic (removed).
  Original property-name case (e.g. `MinSpace`) is kept when writing.
- `COMMENT` values only lose one pair of surrounding `"` (v2 stripped all
  quote characters).
- `font.headers` is `{}` before loading; `font.charset` is a canonical key
  (`'iso10646'` when there is no `CHARSET_REGISTRY`; a GL-form GB2312 font
  reports `'gb2312'`); an `encoding({ charset })` override persists when
  loading (`''` clears it).
- `char2cp` / `cp2char` / `Glyph.chr()` return `null` instead of throwing;
  characters that cannot be encoded are drawn as missing glyphs.
- `charsetconvert()` writes canonical `CHARSET_REGISTRY` / `CHARSET_ENCODING`
  values (e.g. `GB2312.1980` / `0` with GL codes, `ISO8859` / `2`), drops
  unrepresentable glyphs with one warning and clears `encoding()` overrides.
- `tobdf()` follows the exact FontForge layout (ends with a newline, writes
  `METRICSSET`, global metrics, unencoded glyphs and the true `CHARS` count),
  and throws if required headers are missing.
- `Bitmap.tosvg()` path data format changed (merged outline, `M x yH…V…Z`);
  `'rect'` fills `'2'` pixels black (was `fill="undefined"`); empty bitmaps
  give an `<svg>` without `<path>`.
- Unknown glyph meta keys throw; `new Glyph(meta, font)` copies `meta`.
- Warnings go through the warning handler (no direct `console.warn`).
- `setProperty` and `NO_QUOTE_PROPS` removed from the public exports;
  `PATTERN_VVECTOR_DELIMITER` is now a `RegExp` (`/[\s,]+/`).

### Fixed

- `draw2canvas(context, { x, y, pixelsize, pixelcolors })` can position and
  scale the bitmap (fixes [#2](https://github.com/tomchen/bdfparser-js/issues/2);
  supersedes [PR #3](https://github.com/tomchen/bdfparser-js/pull/3) by
  [@jordan-loeser](https://github.com/jordan-loeser) — thanks!). The old
  `draw2canvas(context, pixelcolors, xoff, yoff)` call still works.
- Non-Unicode fonts: `glyph()`, `draw()`, `lacksglyphs()` use the font's
  charset; GB2312.1980-0 fonts with GL codes (`ENCODING 12321` = 啊) work
  ([tomchen/bdfparser#4](https://github.com/tomchen/bdfparser/issues/4)).
- `VVECTOR` parsing (v3-rc called `String.prototype.split` on the pattern
  string); comma and/or whitespace delimiters accepted.
- CRLF / CR line endings, blank lines, tabs, `ENCODING -1 [altcode]`,
  duplicate codepoints, missing `ENDCHAR` / `ENDFONT` / `ENDPROPERTIES`,
  glyphs with fewer hex rows than their height (padded, one warning).
- Glyphs and bitmaps wider than 53 pixels (hex rows were converted through a
  float).
- `Bitmap.width()` of an empty bitmap is `0`; `Bitmap.concatall([])`.
- `addglyph()` built the glyph list from `Object.values(meta)` (key order
  dependent).
- `tosvgfont()`: metadata lines are emitted when their own property exists
  (v3-rc tested `creator`), typo `Founfry` → `Foundry`.
- Astral (non-BMP) characters in `draw()` / `lacksglyphs()`.
