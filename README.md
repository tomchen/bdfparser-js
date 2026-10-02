# bdfparser (TypeScript / JavaScript)

BDF / PCF bitmap font **parser, editor and converter** for Node.js, Deno, Bun
and browsers. Read BDF ([Glyph Bitmap Distribution Format](https://en.wikipedia.org/wiki/Glyph_Bitmap_Distribution_Format), [spec](https://font.tomchen.org/bdf_spec/)), PCF (also `.pcf.gz`) and TrueType fonts; render pixel text in any writing direction; edit glyphs and bitmaps; write BDF, PCF (byte-identical to `bdftopcf`), pixel TrueType fonts with **square or round dots**, SVG and SVG fonts.

[![npm package](https://img.shields.io/badge/npm%20i-bdfparser-brightgreen)](https://www.npmjs.com/package/bdfparser) [![version number](https://img.shields.io/npm/v/bdfparser?color=green&label=version)](https://github.com/tomchen/bdfparser-js/releases) [![Actions Status](https://github.com/tomchen/bdfparser-js/workflows/Test/badge.svg)](https://github.com/tomchen/bdfparser-js/actions) [![Node.js](https://img.shields.io/badge/node-%3E=20-brightgreen.svg?logo=node.js)](https://nodejs.org/) [![License](https://img.shields.io/github/license/tomchen/bdfparser-js)](https://github.com/tomchen/bdfparser-js/blob/master/LICENSE)

- **Zero runtime dependencies**, no Node.js APIs in the library (`TextDecoder`, `DataView`, `fetch` and `DecompressionStream` only), so the same code runs everywhere; the type declarations need neither the DOM nor the Node.js types.
- Same API as the **Python library** ([bdfparser on PyPI](https://pypi.org/project/bdfparser/), [GitHub](https://github.com/tomchen/bdfparser)); both produce byte-identical BDF / PCF / TTF / SVG output (cross-language golden tests).
- Robust parser: LF / CRLF / CR, blank lines, unencoded glyphs (`ENCODING -1`), typed properties (integers, quoted strings with `""` escapes, raw non-Adobe values), original property-name case, `BDFParseError` with line numbers. `tobdf()` reproduces FontForge-written files byte for byte.
- Non-Unicode fonts work, with conversion tables generated from Python's codecs, so both libraries map every code identically: single-byte charsets (ISO 8859-x, KOI8, CP125x, CP437/850/852/866/874, TIS-620, Mac Roman, …) are built in; the multi-byte ones (GB2312, GBK, GB18030, Big5, Big5-HKSCS, Shift-JIS, CP932, EUC-JP / JIS X 0208, EUC-KR / KS C 5601, CP949, Johab, …) are in the optional sub-module [`bdfparser/cjk`](#encodings). X11 GL-form fonts (`GB2312.1980-0`) are detected.
- `bdfparser` command line tool: `convert`, `info`, `preview`.

Documentation: <https://font.tomchen.org/bdfparser_js/> · Examples: [`examples/`](examples/)

## Install

```bash
npm install bdfparser     # or: bun add bdfparser / pnpm add bdfparser / yarn add bdfparser
```

## Quick start

### Node.js

```js
import { readFileSync, writeFileSync } from 'node:fs'
import { Font } from 'bdfparser' // CommonJS: const { Font } = require('bdfparser')

// BDF, PCF or TTF bytes; the format is auto-detected
const font = new Font().load_bytes(readFileSync('unifont.bdf'))

console.log(font.headers.fontname, font.length, 'glyphs')
console.log(font.draw('Hello!').toString()) // # and . art

writeFileSync('unifont.pcf', font.topcf())
writeFileSync('unifont-dots.ttf', font.tottf({ shape: 'circle' }))
```

`new Font().load_string(text)` parses BDF text, and
`await new Font().load_filelines(lines)` accepts any (async) iterable of lines,
e.g. [`readlineiter`](https://github.com/tomchen/fetchline) as in v2.
Gzip-compressed files (`.pcf.gz`) can be loaded with
`await new Font().load_bytes_async(bytes)`.

### Browser — classic `<script>` (global `bdfparser`)

```html
<canvas id="canvas" width="400" height="80"></canvas>
<script src="https://cdn.jsdelivr.net/npm/bdfparser@3/dist/bdfparser.global.js"></script>
<!-- or https://unpkg.com/bdfparser@3/dist/bdfparser.global.js -->
<script>
  bdfparser.$Font(new URL('fonts/unifont.bdf', location.href)).then((font) => {
    const ctx = document.getElementById('canvas').getContext('2d')
    // top-left corner at (10, 20), each font pixel drawn as a 3×3 square
    font.draw('Hello!').draw2canvas(ctx, { x: 10, y: 20, pixelsize: 3 })
  })
</script>
```

### Browser — ES module

```html
<script type="module">
  import { $Font } from 'https://cdn.jsdelivr.net/npm/bdfparser@3/+esm'

  const font = await $Font(new URL('fonts/unifont.bdf', location.href))
  document.body.innerHTML = font.draw('Hi').tosvg(8)
</script>
```

`$Font(source)` accepts a URL (fetched, `.gz` decompressed), BDF text, bytes
(`Uint8Array` / `ArrayBuffer`) or an (async) iterable of lines.

### Deno

```ts
import { Font } from 'npm:bdfparser@3'

const font = new Font().load_bytes(await Deno.readFile('unifont.bdf'))
console.log(font.draw('Deno').toString())
```

### Bun

```ts
import { Font } from 'bdfparser'

const font = new Font().load_bytes(await Bun.file('unifont.bdf').bytes())
await Bun.write('unifont.ttf', font.tottf())
```

## Drawing to a canvas

```js
bitmap.draw2canvas(ctx, {
  x: 0, // canvas position of the bitmap's top-left corner
  y: 0,
  pixelsize: 1, // canvas units per font pixel
  pixelcolors: { 0: null, 1: 'black', 2: 'red' }, // null = transparent
})
```

The v2 call `draw2canvas(ctx, pixelcolors, xoff, yoff)` still works.
[`examples/led-matrix.html`](examples/led-matrix.html) renders text on an
LED dot-matrix (round LEDs, scrolling marquee, frame → bytes for real LED
drivers).

## Editing

```js
import { Bitmap, Font } from 'bdfparser'

const font = Font.create({ pixelsize: 8, familyname: 'Tiny' })

// a new glyph from a text drawing ('#' = ink, '.' = blank);
// mode 1: the bitmap's bottom-left corner is the glyph's (bbxoff, bbyoff) = (0, 0)
font.newglyph(0x41, Bitmap.fromstring(`
.##.
#..#
####
#..#
#..#`), { mode: 1, dwidth: 5 })

const a = font.glyph('A') // attached: edits are written back to the font
a.setmeta({ glyphname: 'A' }).shift(0, 1)
a.transform((b) => b.bold()) // draw → transform → setbitmap

font.transform((b) => b.italic()) // every glyph
font.setprop('WEIGHT_NAME', 'Bold').updatebbox()

const ascii = bigfont.subset([0x20, 0x7e]) // new font with a codepoint range
ascii.merge(otherfont) // copy missing glyphs from another font
font.charsetconvert('iso8859-2') // re-encode the codepoints
```

`Bitmap` methods: `crop`, `overlay`, `concat`, `enlarge`, `replace`, `shadow`,
`glow`, `bytepad`, `fliph`, `flipv`, `rotate`, `invert`, `shift`, `bbox`,
`trim`, `bold`, `italic`, `paste`, `getpixel`, `setpixel`, `equals`,
`Bitmap.fromstring`, `Bitmap.blank`, `Bitmap.concatall`, `todata`, `tosvg`,
`draw2canvas`.

## Conversions

| method                        | output                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `font.tobdf()`                | BDF text                                                                                                                               |
| `font.topcf(options?)`        | PCF bytes, identical to `bdftopcf`; options `byteorder`, `bitorder`, `glyphpad`, `scanunit`                                            |
| `font.tottf(options?)`        | TrueType bytes; `shape: 'square' \| 'circle'`, `dotsize` (0–1.5], `ppu`, `metadata`, `timestamp`. Reading it back is lossless           |
| `font.tosvgfont(options?)`    | SVG font                                                                                                                               |
| `bitmap.tosvg(ps, format, …)` | SVG (`'path'`: all pixels merged into one outline, `'pathOnly'`, `'rect'`; `shape: 'circle'` for round dots)                           |
| `readPcf`, `readTtf`, …       | module functions (`writePcf`, `writeTtf`, `bitmapContours`, `rasterize`)                                                               |

## Encodings

`font.charset` is the canonical charset from `CHARSET_REGISTRY` /
`CHARSET_ENCODING` (e.g. `'iso10646'`, `'gb2312'`, `'iso88592'`, `'cp1252'`);
`font.glyph(char)`, `font.draw(text)`, `font.lacksglyphs(text)`,
`glyph.chr()`, `font.tosvgfont()` and the TrueType `cmap` convert through it.
The charset table and the conversion tables are generated from the Python
library (Python's codecs are the reference), so both libraries give the same
results in every runtime; unknown charsets map as Unicode (with a warning).

```js
font.encoding({ charset: 'big5' }) // force a charset ('' clears it)
font.encoding({ char2cp: (c) => …, cp2char: (cp) => … }) // custom mapping
```

### Multi-byte (CJK) charsets: `bdfparser/cjk`

Single-byte charsets are built in. The exact tables of the multi-byte
charsets — `gb2312` (also `euccn`, `iso2022cn`), `gbk`, `cp936`, `gb18030`
(including the 4-byte codes), `big5`, `big5hkscs`, `cp950`, `shiftjis`,
`cp932`, `eucjp` / `jisx0208`, `euckr` / `ksc5601`, `cp949`, `johab` — are in
an optional sub-module (about 115 kB minified, 67 kB gzipped), loaded once
for the whole application:

```js
// Node.js, Deno, Bun, bundlers
import { Font } from 'bdfparser'
import 'bdfparser/cjk' // CommonJS: require('bdfparser/cjk')
```

```html
<!-- browser, classic scripts: after bdfparser.global.js -->
<script src="https://cdn.jsdelivr.net/npm/bdfparser@3/dist/bdfparser.global.js"></script>
<script src="https://cdn.jsdelivr.net/npm/bdfparser@3/dist/bdfparser-cjk.global.js"></script>
```

Without it, multi-byte charsets fall back to the runtime's `TextDecoder`
restricted to the charset's byte ranges, with one warning per charset: the
results may then differ from the Python library and between runtimes (e.g.
Node.js's ICU decoders), and GB18030 4-byte characters cannot be converted to
codes. An `iconv-lite`-compatible object (`font.encoding({ iconv })`) can be
used instead of `TextDecoder` in that case. The `bdfparser` command line tool
always loads the tables. `getCodec(name).exact` tells whether the exact
tables are used; `registerCharsetTables(tables)` registers tables explicitly
(the sub-module exports its `cjkTables`).

Conversions are strict: `cp2char(code)` returns exactly one character (a code
whose bytes decode to two characters, such as Big5-HKSCS 0x8862, is
unmapped), and `char2cp(char)` returns a code only if it converts back to the
same character and has an allowed length (1 byte for single-byte charsets,
1–2 bytes for double-byte charsets, 1, 2 or 4 bytes for GB18030), e.g.
`char2cp('¥', 'shiftjis')` is `null` (Shift_JIS 0x5C is `\`).

## Warnings and errors

Recoverable problems are reported through a replaceable handler (default:
`console.warn('[bdfparser] …')`). Fatal parse errors throw `BDFParseError`
(with `lineno`).

```js
import { setWarningHandler, BDFParseError } from 'bdfparser'

setWarningHandler((message) => myLog.push(message)) // null = silent
```

## Command line

```bash
npx bdfparser convert font.bdf font.pcf
npx bdfparser convert font.pcf.gz font.ttf --shape circle --dotsize 0.9 --ppu 64
npx bdfparser convert font.bdf font-gb.bdf --charset gb2312
npx bdfparser convert font.ttf font.bdf --pixelsize 16   # TTFs not written by bdfparser
npx bdfparser info font.bdf
npx bdfparser preview font.bdf "Hello"
```

Inputs: `.bdf`, `.pcf`, `.pcf.gz`, `.ttf`; outputs: `.bdf`, `.pcf`, `.ttf`,
`.svg`. `-q` hides warnings.

## Migrating from v2

- Node ≥ 20; ESM + CommonJS + IIFE builds; the Deno-specific `deno/` folder is gone — use `npm:bdfparser`.
- Properties are typed: unquoted integers are `number`, quoted strings are unescaped (`""` → `"`), non-Adobe unquoted values are kept as strings; original property names are kept when writing.
- `COMMENT` values only lose one pair of surrounding `"` (v2 stripped every quote character).
- `font.headers` is `{}` (not `undefined`) before loading; `font.charset` is a canonical key (`'iso10646'` by default).
- `char2cp` / `cp2char` / `glyph.chr()` return `null` when not representable (no exceptions); no `iconv` needed for legacy charsets (multi-byte charsets: `import 'bdfparser/cjk'`).
- Glyphs from `glyphbycp` / `glyph` / `iterglyphs` are attached: editing methods write back to the font.
- `Bitmap.tosvg()` path output is now one merged outline (`M…H…V…Z`); `draw2canvas` takes an options object (old signature still accepted).
- Warnings go through `setWarningHandler` instead of `console.warn` directly.

See [CHANGELOG.md](CHANGELOG.md) for the full list.

## License

MIT © [Tom Chen](https://github.com/tomchen/). The test and example fonts are
GNU Unifont (SIL OFL 1.1 / GPLv2+ with font embedding exception) and
HanWangYanKai (GPL); see [test/fonts/README.md](test/fonts/README.md).
