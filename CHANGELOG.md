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
- **Encodings without iconv**: exact conversion tables generated from Python's
  codecs (see "Hardening" below): single-byte charsets built in (ISO 8859-x,
  KOI8-R/U, CP125x, CP437/850/852/866/874, TIS-620, MacRoman, JIS X 0201…),
  multi-byte ones in the optional sub-module **`bdfparser/cjk`** (GB2312, GBK,
  CP936, GB18030 incl. 4-byte codes, Big5, Big5-HKSCS, CP950, Shift-JIS,
  CP932, EUC-JP / JIS X 0208, EUC-KR / KS C 5601, CP949, Johab;
  `bdfparser-cjk.global.js` for classic scripts); X11 GL-form detection for
  94×94 sets; `font.char2cp` / `font.cp2char`; `sanitizeCharset`,
  `canonicalCharset`, `charsetProps`, `charsetKeys`, `getCodec`,
  `registerCharsetTables`. The `iconv` option is still accepted (any
  `iconv-lite`-compatible object), as a replacement for `TextDecoder` when
  `bdfparser/cjk` is not loaded.
- **SVG**: `Bitmap.tosvg` merges all pixels into one minimal outline (holes
  included) and supports round dots (`shape: 'circle'`).
- **Warnings / errors**: `setWarningHandler()` (default `console.warn`,
  `null` silences); `BDFParseError` with the line number.
- **CLI** `bdfparser convert | info | preview` (Node.js).
- Browser examples (`examples/`): classic script, ES module, LED dot-matrix
  display with scrolling marquee; Node.js example.
- `defaultglyphname()`, `VERSION`, `Font.swidth()`.

### Hardening (SPEC-v3 §11, cross-language parity with the Python library)

Found by the differential harness `tools/parity` (`bun run parity`; findings
K02–K17 in `tools/parity/README.md`), decided in SPEC-v3 §11 and implemented
in both libraries:

- **Charsets are table-exact** (K13, K14, K17): one canonical charset table,
  canonicalisation and conversion tables generated from the Python library
  by `tools/gen_charsets.py` (`src/charsets/`), so the results no longer
  depend on the runtime's `TextDecoder` (Node.js's ICU decoders differed from
  Bun's for Big5, EUC-KR, EUC-JP…). New keys `cp437`, `cp850`, `cp852`,
  `cp866`, `cp874`, `cp932`, `cp936`, `cp949`, `cp950`, `johab` (also via
  `IBM-CP437`, `windows-874`, `MS932`…); `ISO8859-01` → `iso88591`;
  `KOI8-RU`, `HZ`, `latin2` and the other WHATWG-only labels are unknown
  (Unicode identity, one warning; module-level `char2cp` / `cp2char` warn
  once per name). Multi-byte charsets need `import 'bdfparser/cjk'` for exact
  results; without it they fall back to `TextDecoder` restricted to the
  charset's byte ranges, with one warning per charset.
- `char2cp()` returns a code only if it converts back to the same character
  and has an allowed byte length (1 for single-byte, 1–2 for double-byte
  charsets, 1, 2 or 4 for GB18030); `cp2char()` returns exactly one code
  point (Big5-HKSCS 0x8862 → `null`); undefined bytes of the Windows code
  pages and ISO 8859-9/-11 C1 bytes follow Python (no WHATWG
  windows-1254/874 substitution); GB18030 4-byte codes work without
  `iconv` (K10).
- **Strict numbers** (K05, K08): integer fields accept only ASCII
  `[+-]digits` within the signed 32-bit range (no `0x10`, `Infinity`, `1_2`),
  `STARTFONT` only `digits[.digits]`; otherwise `BDFParseError`. Unquoted
  property values are numbers only within −2³¹ … 2³²−1, otherwise they are
  kept as strings (`tobdf()` never writes `1e+21`). `Bitmap.todata(5)` throws
  `RangeError` for rows wider than 53 pixels (K11; Python returns big ints);
  `todata(4|5)` of zero-width rows give `''` / `0` (K02).
- **Properties** (K06): `font.props` is a null-prototype object (a property
  named `__proto__` or `constructor` works) and keeps the file / insertion
  order for integer-like names (`123`) in every writer (BDF, PCF, the TTF
  `BDFP` table). A property line `comment …` in any case is a comment, with a
  warning.
- **Whitespace** is ASCII space, `\t`, `\n`, `\v`, `\f`, `\r` only (K07;
  U+FEFF is an ordinary character except a leading BOM). `COMMENT` lines inside
  `BITMAP` are ignored. Negative `BBX` / `FONTBOUNDINGBOX` sizes →
  `BDFParseError` (K03).
- Drawing a glyph (and writing a TTF) with a non-hex character in a bitmap
  row throws an `Error` naming the glyph and the row (invalid digits were
  read as `0000`); the PCF writer keeps `bdftopcf`'s lenient reading.
- `Bitmap.crop()` with a negative size throws `RangeError` (K03); vertical
  `Bitmap.concatall()` skips empty bitmaps together with the offset before
  them (K16); `removeglyph(glyph)` with an already removed `Glyph` is a no-op
  instead of deleting the glyph that now has its codepoint (K09).
- PCF writer: range checks before any allocation (32-bit integer properties,
  16-bit `FONT_ASCENT` / `FONT_DESCENT`; K15: a huge `FONT_ASCENT` threw an
  obscure `RangeError` after allocating gigabytes).
- TrueType: the `cmap` never maps surrogates; the `readTtf()` size guard
  message is `Malformed TrueType font: glyph {gid} bounding box too large
  ({w}x{h} pixels)`. `tosvgfont()` writes Unicode values (`cp2char`) in
  `unicode` / `unicode-range`, so non-Unicode fonts are correct; unmappable
  glyphs get no `unicode` attribute; integer properties beyond 2⁵³ are
  exact.
- Numbers in text output follow Python's `repr` (`fmtnum`): integral values
  are written with all their digits, small ones as `1e-05`.
- The published type declarations need neither the DOM nor the Node.js
  types: `load_url(url: string | URLLike, init?: FetchInit)` and `$Font()`
  take any object with a string `href` (checked by `tools/check-dts.mjs`).
- The `bdfparser` CLI loads the exact multi-byte tables.

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
