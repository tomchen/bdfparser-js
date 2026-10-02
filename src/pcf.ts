/**
 * PCF (Portable Compiled Format) reader and writer.
 *
 * Browser-safe: only `Uint8Array` / `DataView` / `TextEncoder` /
 * `TextDecoder` (and `DecompressionStream` in `readPcfAsync`) are used.
 *
 * ===========================================================================
 * WRITER: rules reverse-engineered from `bdftopcf` (xfonts-utils bdftopcf 1.1,
 * i.e. libXfont2 `bdfread.c` + `bitmaputil.c` + `fontink.c` + `fontaccel.c` +
 * `pcfwrite.c`), verified byte-for-byte against `/usr/bin/bdftopcf`.
 * ===========================================================================
 *
 * Defaults (`bdftopcf` without flags): bit order MSB, byte order MSB, glyph
 * pad 4, scan unit 1. `format = scanIdx << 4 | bitMSB << 3 | byteMSB << 2 |
 * padIdx` (pad 1/2/4/8 -> 0/1/2/3, scan 1/2/4 -> 0/1/2). The same format bits
 * are OR-ed into every table's format word.
 *
 * Glyphs: one PCF glyph per BDF glyph, in model order: `font.glyphs` (Map
 * order = file order), then `font.unencoded`. Encoding of a glyph = its
 * codepoint; an unencoded glyph with an `altcode` >= 0 is encoded at the
 * altcode (bdfread: `ENCODING -1 n` => `enc = n`). Codepoints > 0xFFFF (or < 0)
 * are kept as glyphs (metrics/bitmap/name/swidth) but get no encoding entry.
 * On duplicate encodings the later glyph wins.
 *
 * Per-glyph metrics (xCharInfo, INT16): `lsb = bbxoff`, `rsb = bbxoff + bbw`,
 * `width = DWIDTH x`, `ascent = bbh + bbyoff`, `descent = -bbyoff`,
 * `attributes = 0`. Missing DWIDTH => headers `dwx0`, else
 * `max(0, bbxoff + bbw)`. SWIDTH table = SWIDTH x (missing => headers `swx0`,
 * else spec §2.8 `swidth(dwx)`).
 *
 * Bitmaps: each hex row is parsed like `bdfReadBitmap`: odd length gets a
 * trailing `0`; bytes beyond `ceil(bbw/8)` ignored; short rows zero padded;
 * when the row is long enough, the bits beyond `bbw` in its last byte are
 * cleared; invalid hex digits are skipped as in `bdfHexByte`; missing rows are
 * zero rows. Rows are padded to the glyph pad; then bits are reversed in every
 * byte if bit order is LSB; then, if bit order != byte order, bytes are
 * swapped in 2- or 4-byte groups (scan unit). `bitmapSizes[i]` = sum over
 * glyphs of `bbh * BYTES_PER_ROW(bbw, 1 << i)`.
 *
 * Properties: model order (`comment` and value-less keys skipped); name = the
 * remembered original spelling, else the upper-cased key; `string` => string
 * property, integer `number` => INT32 property (non-integer numbers are
 * written as strings). `FONT_ASCENT`, `FONT_DESCENT`, `DEFAULT_CHAR` (exact,
 * case-sensitive names) are consumed (int values only) and NOT written. Then
 * generated properties are appended, each only if absent:
 * `POINT_SIZE = trunc(float32(SIZE pointsize) * 10)`, `FONT = FONT header`
 * (string), `WEIGHT = 10`, `RESOLUTION = trunc(xres * 100 / 72.27)` (only if
 * xres == yres), `RESOLUTION_X = xres`, `RESOLUTION_Y = yres`, `X_HEIGHT`,
 * `QUAD_WIDTH`. Existing int `X_HEIGHT`/`QUAD_WIDTH`/`WEIGHT` equal to -1 are
 * also replaced by the computed value. `X_HEIGHT` = from the last glyph whose
 * name is exactly `x`: `bbh + bbyoff` (or `bbh` if that is <= 0), else
 * ink-minbounds.ascent of the encoded glyphs. `QUAD_WIDTH` = trunc(average
 * DWIDTH of glyphs named `0`..`9`), else trunc((ink-min.width +
 * ink-max.width) / 2) of the encoded glyphs. Glyph names are the first
 * whitespace-delimited token of the BDF name, max. 99 bytes (`%99s`).
 * If `FONT_ASCENT` / `FONT_DESCENT` are missing (bdftopcf refuses such
 * files) we use `fbby + fbbyoff` / `-fbbyoff`. `defaultCh` = DEFAULT_CHAR
 * & 0xFFFF, or 0 when absent.
 *
 * Bounds (`bitmapComputeFontBounds`): two `FontInfo`s. "extra" (all glyphs,
 * used by METRICS compression, ACCELERATORS) and "info" (encoded glyphs
 * only, visited by encoding cell order, used by BDF_ACCELERATORS, and by the
 * generated properties). min/max start at +32767/-32768 (attributes
 * 0xFFFF/0); a glyph whose 5 metrics are all 0 is skipped for min/max (but
 * not for attributes/maxOverlap). `maxOverlap = max(rsb - width)` (start
 * -32768). drawDirection: RightToLeft if more glyphs with negative width;
 * the counters are NOT reset between the two passes (info uses all+encoded).
 *
 * Terminal padding (`FontCouldBeTerminal(info)` => `bdfPadToTerminal`): if
 * info.min.lsb >= 0, info.max.rsb <= info.max.width, min.width == max.width,
 * max.ascent <= fontAscent, max.descent <= fontDescent, not already a
 * perfect cell (max.lsb != 0 || min.rsb != min.width || min.ascent !=
 * fontAscent || min.descent != fontDescent) and not (max.ascent == 0 &&
 * max.descent == 0): every glyph is re-shaped (bits copied, `FontCharReshape`)
 * to `lsb 0, rsb = width = info.min.width, ascent = fontAscent, descent =
 * fontDescent`, bitmapSizes recomputed, bounds recomputed.
 *
 * Accelerators (`FontComputeInfoAccelerators`, per info): noOverlap =
 * maxOverlap <= min.lsb; constantMetrics = all 5 metrics and attributes of
 * min == max; terminalFont = constantMetrics && max.lsb == 0 && max.rsb ==
 * max.width && max.ascent == fontAscent && max.descent == fontDescent;
 * constantWidth = min.width == max.width; inkInside = min.lsb >= 0 &&
 * maxOverlap <= 0 && min.ascent >= -fontDescent && max.ascent <= fontAscent
 * && -min.descent <= fontAscent && max.descent <= fontDescent.
 *
 * Ink metrics: computed (`FontCharInkMetrics`, on the stored padded,
 * bit-reversed and byte-swapped bytes, exactly as libXfont does) only when
 * info.constantMetrics; then INK_METRICS is written, both accelerator tables
 * get format ACCEL_W_INKBOUNDS and ink bounds are computed like the bounds;
 * otherwise ink bounds = bounds.
 *
 * Tables, in this order (type bit order): PROPERTIES(1), ACCELERATORS(2),
 * METRICS(4), BITMAPS(8), [INK_METRICS(16)], BDF_ENCODINGS(32), SWIDTHS(64),
 * GLYPH_NAMES(128), BDF_ACCELERATORS(256). TOC (`\x01fcp`, count, then
 * type/format/size/offset) is little-endian; each table starts with its
 * format as LSB32, the rest uses the format's byte order. Table sizes:
 * PROPERTIES `RoundUp(8 + 9n) + 4 + RoundUp(strings)`; ACCELERATORS 100 (!);
 * METRICS compressed `RoundUp(6 + 5n)` (when every metric of extra
 * min/max fits in -128..127 and attributes are 0) else `8 + 12n`; BITMAPS
 * `RoundUp(8 + 4n + 16 + bitmapSizes[pad])`; ENCODINGS `RoundUp(14 + 2m)`
 * (`m = (lastCol-firstCol+1) * (lastRow-firstRow+1)`; with no encoded glyph
 * firstCol=firstRow=256, lastCol=lastRow=0 so m = 65025 empty cells);
 * SWIDTHS `8 + 4n`; GLYPH_NAMES `8 + 4n + 4 + RoundUp(strings)`;
 * BDF_ACCELERATORS 100. Tables are laid out contiguously by these sizes, gaps
 * zero-filled. The accelerator tables only contain 48 (or 72 with ink
 * bounds) bytes although their size says 100: the file therefore ends 52 (or
 * 28) bytes before `last offset + 100`.
 * PROPERTIES: nprops, (nameOffset, isString(1 byte), value|stringOffset) * n,
 * zero pad to 4, string area size, NUL-terminated strings (name, then value
 * for string properties). Accelerator layout: noOverlap, constantMetrics,
 * terminalFont, constantWidth, inkInside, inkMetrics, drawDirection, 0 (bytes),
 * fontAscent, fontDescent, maxOverlap (INT32), minbounds, maxbounds
 * [, ink_minbounds, ink_maxbounds] (6 x INT16 each).
 *
 * Deviations from bdftopcf (documented, intentional; identical in the Python
 * implementation `bdfparser/pcf.py`):
 * - `glyphpad: 8` writes a correct pad-8 file. bdftopcf `-p8` is broken
 *   (`PCF_SIZE_TO_INDEX(8) == 0`: it labels the file pad 1 and writes the
 *   first bytes of the 8-padded rows, i.e. garbage bitmaps).
 * - bit order != byte order with scan unit > 1: bdftopcf byte-swaps while
 *   reading the BDF, i.e. BEFORE terminal padding (`FontCharReshape`) and ink
 *   metrics (`FontCharInkMetrics`), which then work on scrambled bytes (lost
 *   pixels, wrong ink metrics). We compute both on MSB-first, unswapped rows
 *   and reorder bits/bytes last. Output therefore differs from bdftopcf only
 *   for such option combinations on fonts with ink metrics (constant-metric /
 *   character-cell fonts). With `scanunit > glyphpad` bdftopcf even swaps
 *   across glyph boundaries (undefined behaviour): that combination throws.
 * - Inputs bdftopcf rejects are written with fallbacks: missing FONT_ASCENT /
 *   FONT_DESCENT (`fbby + fbbyoff` / `-fbbyoff`), SWIDTH, DWIDTH (above);
 *   value-less properties and properties whose name starts with `COMMENT`
 *   (bdftopcf's line reader drops such lines) are skipped; hex rows missing
 *   are zero rows, extra rows ignored; zero glyphs allowed; xres / yres that
 *   are not integers >= 1 become 75. Metric values outside INT16 throw.
 * - Not representable in the bdfparser model (so not reproducible): ENCODING
 *   -1 glyphs interleaved with encoded ones (the model appends them),
 *   duplicate codepoints, ATTRIBUTES, BDF lines longer than 1023 bytes.
 * - `-t` and `-i` are no-ops in bdftopcf 1.1, so there are no such options.
 *
 * ===========================================================================
 * READER (`readPcf`): any byte/bit order, glyph pad 1/2/4/8, scan unit
 * 1/2/4, compressed or uncompressed metrics. METRICS and BITMAPS are
 * required, every other table is optional (sizes declared beyond EOF are
 * fine: only the bytes actually read must exist). The bitmap block is
 * byte-swapped / bit-reversed as a whole (like libXfont's pcfread). Model
 * (spec §6):
 * - headers: `bdfversion 2.1`, `fontname` = first string property `FONT`
 *   (else ""), `pointsize` = round(POINT_SIZE / 10) (else PIXEL_SIZE, else
 *   fbby), `xres`/`yres` = RESOLUTION_X/Y (else 75), FONTBOUNDINGBOX from the
 *   ACCELERATORS min/max bounds (else BDF_ACCELERATORS, else computed from the
 *   metrics with the bounds rule above; 0 0 0 0 when no glyph counts),
 *   `metricsset 0`.
 * - props: every PCF property in table order, INCLUDING `FONT` (also copied
 *   to `headers.fontname`), so that PCF -> model -> `writePcf` reproduces a
 *   bdftopcf file byte for byte; then, when absent, FONT_ASCENT / FONT_DESCENT
 *   from the accelerators (bdftopcf drops them, BDF needs them) and
 *   DEFAULT_CHAR from the encoding table if defaultCh is neither 0 (bdftopcf's
 *   value for "none") nor 0xFFFF.
 * - glyphs in glyph-index order: every code of the encoding table (`cp = row
 *   << 8 | col`) gives an entry of `font.glyphs`; glyphs without code go to
 *   `font.unencoded` (altcode null). BBX = (rsb - lsb, ascent + descent, lsb,
 *   -descent), DWIDTH (width, 0), SWIDTH (swidth, 0) (no SWIDTHS table =>
 *   spec §2.8 `swidth(width)`), name from GLYPH_NAMES (else
 *   `defaultglyphname(cp)`, Unicode per `isUnicodeCharset(sanitizeCharset(
 *   CHARSET_REGISTRY, CHARSET_ENCODING))`, or `glyph{index}` for
 *   unencoded glyphs), rows as MSB-first upper-hex rows of ceil(bbw / 8)
 *   bytes with bits beyond bbw cleared (no rows if bbw or bbh is 0, as in
 *   BDF). A glyph referenced by several codes gives one entry per code.
 * - strings are decoded as UTF-8, falling back to Latin-1 per string.
 * - not recoverable: the original SIZE point size and FONTBOUNDINGBOX, the
 *   pre-padding glyph boxes of terminal fonts, the encoding of glyphs with
 *   codepoints > 0xFFFF (they become unencoded), and the X_HEIGHT /
 *   QUAD_WIDTH / WEIGHT value -1 (bdftopcf recomputes it on the next run).
 */

import { isUnicodeCharset, sanitizeCharset } from './encoding'
import { pyStrip } from './fmt'
import { Font } from './Font'
import { propEntries } from './props'
import { defaultglyphname } from './Glyph'
import { BdfHeaders, GlyphMetaInFont } from './types'

/* ------------------------------------------------------------------------ */
/* Constants                                                                */
/* ------------------------------------------------------------------------ */

const PCF_PROPERTIES = 1 << 0
const PCF_ACCELERATORS = 1 << 1
const PCF_METRICS = 1 << 2
const PCF_BITMAPS = 1 << 3
const PCF_INK_METRICS = 1 << 4
const PCF_BDF_ENCODINGS = 1 << 5
const PCF_SWIDTHS = 1 << 6
const PCF_GLYPH_NAMES = 1 << 7
const PCF_BDF_ACCELERATORS = 1 << 8

const PCF_FORMAT_MASK = 0xffffff00
const PCF_DEFAULT_FORMAT = 0x00000000
const PCF_ACCEL_W_INKBOUNDS = 0x00000100
const PCF_COMPRESSED_METRICS = 0x00000100

const PCF_MAGIC = [0x01, 0x66, 0x63, 0x70] // "\x01fcp"

const MAXSHORT = 32767
const MINSHORT = -32768

/** PCF writer options */
export type PcfWriteOptions = {
  /** byte order of multi-byte integers (and of bitmap scan units); default `'msb'` */
  byteorder?: 'msb' | 'lsb'
  /** bit order inside bitmap bytes; default `'msb'` */
  bitorder?: 'msb' | 'lsb'
  /** glyph row padding in bytes; default `4` */
  glyphpad?: 1 | 2 | 4 | 8
  /** bitmap scan unit in bytes; default `1` */
  scanunit?: 1 | 2 | 4
}

/* ------------------------------------------------------------------------ */
/* Shared helpers                                                           */
/* ------------------------------------------------------------------------ */

type Metric = {
  lsb: number
  rsb: number
  width: number
  ascent: number
  descent: number
  attributes: number
}

const toI32 = (v: number): number => v | 0

/** integer property values are written as 32-bit words (signed or unsigned) */
const checkProp = (name: string, v: number): void => {
  if (v < -0x80000000 || v > 0xffffffff) {
    throw new RangeError(
      `PCF: property ${name} value ${v} does not fit in 32 bits`
    )
  }
}
const roundUp4 = (n: number): number => (n + 3) & ~3

/** libXfont `BYTES_PER_ROW(bits, pad)` (pad 1, 2, 4 or 8 bytes) */
const bytesPerRow = (bits: number, pad: number): number =>
  ((bits + pad * 8 - 1) >> 3) & ~(pad - 1)

const padIndex = (pad: number): number =>
  pad === 1 ? 0 : pad === 2 ? 1 : pad === 4 ? 2 : 3

const REVERSE_BYTE = ((): Uint8Array => {
  const t = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    let r = 0
    for (let b = 0; b < 8; b++) {
      if (i & (1 << b)) {
        r |= 0x80 >> b
      }
    }
    t[i] = r
  }
  return t
})()

const bitOrderInvert = (buf: Uint8Array): void => {
  for (let i = 0; i < buf.length; i++) {
    buf[i] = REVERSE_BYTE[buf[i]]
  }
}

/**
 * Reverse the byte order inside every `unit`-byte group (unit 2 or 4); a
 * trailing partial group is swapped with zero bytes beyond the end.
 */
const byteSwap = (buf: Uint8Array, unit: number): void => {
  if (unit < 2) {
    return
  }
  const n = buf.length
  for (let i = 0; i < n; i += unit) {
    const grp: number[] = []
    for (let k = 0; k < unit; k++) {
      grp.push(i + k < n ? buf[i + k] : 0)
    }
    for (let k = 0; k < unit && i + k < n; k++) {
      buf[i + k] = grp[unit - 1 - k]
    }
  }
}

const isZeroMetric = (m: Metric): boolean =>
  !(m.ascent || m.descent || m.lsb || m.rsb || m.width)

const isGzip = (u8: Uint8Array): boolean =>
  u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b

const toU8 = (data: Uint8Array | ArrayBuffer): Uint8Array => {
  if (data instanceof Uint8Array) {
    return data
  }
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  }
  // not `instanceof`: also accept ArrayBuffers from other realms (iframes,
  // workers' transferred buffers, `vm` contexts)
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
    return new Uint8Array(data)
  }
  throw new TypeError('PCF data must be a Uint8Array or an ArrayBuffer')
}

/* ------------------------------------------------------------------------ */
/* Writer                                                                   */
/* ------------------------------------------------------------------------ */

type FontInfo = {
  minbounds: Metric
  maxbounds: Metric
  inkMin: Metric
  inkMax: Metric
  maxOverlap: number
  drawDirection: number
  fontAscent: number
  fontDescent: number
  noOverlap: boolean
  constantMetrics: boolean
  terminalFont: boolean
  constantWidth: boolean
  inkInside: boolean
  inkMetrics: boolean
}

type WGlyph = {
  m: Metric
  bits: Uint8Array
  name: Uint8Array
  swidth: number
  enc: number
}

type WProp = {
  name: string
  isString: boolean
  value: number | string
}

const initMin = (): Metric => ({
  lsb: MAXSHORT,
  rsb: MAXSHORT,
  width: MAXSHORT,
  ascent: MAXSHORT,
  descent: MAXSHORT,
  attributes: 0xffff,
})
const initMax = (): Metric => ({
  lsb: MINSHORT,
  rsb: MINSHORT,
  width: MINSHORT,
  ascent: MINSHORT,
  descent: MINSHORT,
  attributes: 0,
})

const minmax = (min: Metric, max: Metric, m: Metric): void => {
  if (isZeroMetric(m)) {
    return
  }
  min.ascent = Math.min(min.ascent, m.ascent)
  max.ascent = Math.max(max.ascent, m.ascent)
  min.descent = Math.min(min.descent, m.descent)
  max.descent = Math.max(max.descent, m.descent)
  min.lsb = Math.min(min.lsb, m.lsb)
  max.lsb = Math.max(max.lsb, m.lsb)
  min.rsb = Math.min(min.rsb, m.rsb)
  max.rsb = Math.max(max.rsb, m.rsb)
  min.width = Math.min(min.width, m.width)
  max.width = Math.max(max.width, m.width)
}

const newInfo = (fontAscent: number, fontDescent: number): FontInfo => ({
  minbounds: initMin(),
  maxbounds: initMax(),
  inkMin: initMin(),
  inkMax: initMax(),
  maxOverlap: MINSHORT,
  drawDirection: 0,
  fontAscent,
  fontDescent,
  noOverlap: false,
  constantMetrics: false,
  terminalFont: false,
  constantWidth: false,
  inkInside: false,
  inkMetrics: false,
})

/** `bitmapComputeFontBounds` */
const computeFontBounds = (
  glyphs: WGlyph[],
  encoded: number[],
  extra: FontInfo,
  info: FontInfo
): void => {
  let numneg = 0
  let numpos = 0
  const pass = (target: FontInfo, list: Iterable<WGlyph>): void => {
    const minb = initMin()
    const maxb = initMax()
    let maxOverlap = MINSHORT
    for (const g of list) {
      const m = g.m
      minmax(minb, maxb, m)
      if (m.width < 0) {
        numneg++
      } else {
        numpos++
      }
      minb.attributes &= m.attributes
      maxb.attributes |= m.attributes
      const overlap = m.rsb - m.width
      if (maxOverlap < overlap) {
        maxOverlap = overlap
      }
    }
    target.minbounds = minb
    target.maxbounds = maxb
    target.maxOverlap = maxOverlap
    target.drawDirection = numneg > numpos ? 1 : 0
  }
  pass(extra, glyphs)
  pass(
    info,
    encoded.map((i) => glyphs[i])
  )
}

/** `FontComputeInfoAccelerators` */
const computeAccelerators = (fi: FontInfo): void => {
  const min = fi.minbounds
  const max = fi.maxbounds
  fi.noOverlap = fi.maxOverlap <= min.lsb
  if (
    min.ascent === max.ascent &&
    min.descent === max.descent &&
    min.lsb === max.lsb &&
    min.rsb === max.rsb &&
    min.width === max.width &&
    min.attributes === max.attributes
  ) {
    fi.constantMetrics = true
    fi.terminalFont =
      max.lsb === 0 &&
      max.rsb === max.width &&
      max.ascent === fi.fontAscent &&
      max.descent === fi.fontDescent
  } else {
    fi.constantMetrics = false
    fi.terminalFont = false
  }
  fi.constantWidth = min.width === max.width
  fi.inkInside =
    min.lsb >= 0 &&
    fi.maxOverlap <= 0 &&
    min.ascent >= -fi.fontDescent &&
    max.ascent <= fi.fontAscent &&
    -min.descent <= fi.fontAscent &&
    max.descent <= fi.fontDescent
}

/** `FontCouldBeTerminal` */
const couldBeTerminal = (fi: FontInfo): boolean => {
  const min = fi.minbounds
  const max = fi.maxbounds
  if (
    min.lsb >= 0 &&
    max.rsb <= max.width &&
    min.width === max.width &&
    max.ascent <= fi.fontAscent &&
    max.descent <= fi.fontDescent &&
    (max.lsb !== 0 ||
      min.rsb !== min.width ||
      min.ascent !== fi.fontAscent ||
      min.descent !== fi.fontDescent)
  ) {
    return !(max.ascent === 0 && max.descent === 0)
  }
  return false
}

/** `FontCharReshape` (on MSB-first padded rows) */
const reshape = (
  src: Metric,
  srcBits: Uint8Array,
  dst: Metric,
  pad: number
): Uint8Array => {
  const outwidth = dst.rsb - dst.lsb
  const outheight = dst.descent + dst.ascent
  const outBytes = bytesPerRow(outwidth, pad)
  const inBytes = bytesPerRow(src.rsb - src.lsb, pad)
  const out = new Uint8Array(Math.max(0, outBytes * outheight))
  const yMin = Math.max(-src.ascent, -dst.ascent)
  const yMax = Math.min(src.descent, dst.descent)
  const xMin = Math.max(src.lsb, dst.lsb)
  const xMax = Math.min(src.rsb, dst.rsb)
  let inLine = (yMin + src.ascent) * inBytes
  let outLine = (yMin + dst.ascent) * outBytes
  for (let y = yMin; y < yMax; y++) {
    for (let x = xMin; x < xMax; x++) {
      const sx = x - src.lsb
      const dx = x - dst.lsb
      if (srcBits[inLine + (sx >> 3)] & (0x80 >> (sx & 7))) {
        out[outLine + (dx >> 3)] |= 0x80 >> (dx & 7)
      }
    }
    inLine += inBytes
    outLine += outBytes
  }
  return out
}

/**
 * `FontCharInkMetrics` (on MSB-first padded rows; equivalent to libXfont's
 * byte/bit scanning loops for such data)
 */
const inkMetrics = (m: Metric, bits: Uint8Array, pad: number): Metric => {
  const bitWidth = m.rsb - m.lsb
  const height = m.ascent + m.descent
  const byteWidth = (bitWidth + 7) >> 3
  const padded = bytesPerRow(bitWidth, pad)
  const rowHasInk = (r: number): boolean =>
    bits.subarray(r * padded, r * padded + byteWidth).some((b) => b !== 0)
  let top = 0
  while (top < height && !rowHasInk(top)) {
    top++
  }
  if (top === height) {
    // no ink: zero height at the left side bearing
    return { ...m, rsb: m.lsb, ascent: 0, descent: 0 }
  }
  let bottom = height - 1
  while (!rowHasInk(bottom)) {
    bottom--
  }
  const column = new Uint8Array(byteWidth)
  for (let r = top; r <= bottom; r++) {
    for (let c = 0; c < byteWidth; c++) {
      column[c] |= bits[r * padded + c]
    }
  }
  // ink exists and the bits beyond the bitmap width are clear, so both
  // scans find a pixel
  let left = 0
  while (!(column[left >> 3] & (0x80 >> (left & 7)))) {
    left++
  }
  let right = bitWidth - 1
  while (!(column[right >> 3] & (0x80 >> (right & 7)))) {
    right--
  }
  return {
    lsb: m.lsb + left,
    rsb: m.lsb + right + 1,
    width: m.width,
    ascent: m.ascent - top,
    descent: bottom - m.ascent + 1,
    attributes: m.attributes,
  }
}

/** `bdfHexByte`: invalid digits are skipped */
const hexByte = (s: Uint8Array, i: number): number => {
  let b = 0
  for (let k = 0; k < 2; k++) {
    const c = s[i + k]
    if (c >= 0x30 && c <= 0x39) {
      b = (b << 4) + (c - 0x30)
    } else if (c >= 0x41 && c <= 0x46) {
      b = (b << 4) + 10 + (c - 0x41)
    } else if (c >= 0x61 && c <= 0x66) {
      b = (b << 4) + 10 + (c - 0x61)
    }
  }
  return b & 0xff
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

/** `bdfReadBitmap` (before bit/byte reordering) */
const glyphBits = (
  hexdata: readonly string[],
  w: number,
  h: number,
  pad: number
): Uint8Array => {
  const widthBytes = bytesPerRow(w, pad)
  const pic = new Uint8Array(widthBytes * h)
  if (w === 0) {
    return pic
  }
  const widthHexChars = bytesPerRow(w, 1)
  const lastMask = (0xff << (8 - (w & 7))) & 0xff
  for (let row = 0; row < h; row++) {
    let line = utf8(pyStrip(String(hexdata[row] ?? '')))
    if (line.length & 1) {
      const l2 = new Uint8Array(line.length + 1)
      l2.set(line)
      l2[line.length] = 0x30
      line = l2
    }
    const inLen = line.length >> 1
    const n = Math.min(inLen, widthHexChars)
    const base = row * widthBytes
    for (let i = 0; i < n; i++) {
      pic[base + i] = hexByte(line, i * 2)
    }
    if (inLen >= widthHexChars && lastMask) {
      pic[base + widthHexChars - 1] &= lastMask
    }
  }
  return pic
}

/** first token delimited by C `isspace` characters, max. `max` bytes (`%Ns`) */
const scanToken = (s: string, max: number): Uint8Array => {
  const tok = s.replace(/^[ \t\n\v\f\r]+/, '').split(/[ \t\n\v\f\r]/)[0]
  const b = utf8(tok)
  return b.length > max ? b.slice(0, max) : b
}

/** writer into a buffer of the summed table sizes (always large enough) */
class ByteWriter {
  readonly buf: Uint8Array
  pos = 0
  constructor(
    size: number,
    private msb: boolean
  ) {
    this.buf = new Uint8Array(size)
  }
  u8(v: number): void {
    this.buf[this.pos++] = v & 0xff
  }
  lsb32(v: number): void {
    this.buf[this.pos++] = v & 0xff
    this.buf[this.pos++] = (v >>> 8) & 0xff
    this.buf[this.pos++] = (v >>> 16) & 0xff
    this.buf[this.pos++] = (v >>> 24) & 0xff
  }
  i32(v: number): void {
    if (this.msb) {
      this.buf[this.pos++] = (v >>> 24) & 0xff
      this.buf[this.pos++] = (v >>> 16) & 0xff
      this.buf[this.pos++] = (v >>> 8) & 0xff
      this.buf[this.pos++] = v & 0xff
    } else {
      this.lsb32(v)
    }
  }
  i16(v: number): void {
    if (this.msb) {
      this.buf[this.pos++] = (v >>> 8) & 0xff
      this.buf[this.pos++] = v & 0xff
    } else {
      this.buf[this.pos++] = v & 0xff
      this.buf[this.pos++] = (v >>> 8) & 0xff
    }
  }
  bytes(b: Uint8Array): void {
    this.buf.set(b, this.pos)
    this.pos += b.length
  }
  /** zero bytes up to the next table offset */
  padTo(offset: number): void {
    this.pos = offset
  }
  /** the file ends after the last byte written (bdftopcf behaviour) */
  result(): Uint8Array {
    return this.buf.slice(0, this.pos)
  }
}

const isInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v)

/** spec §2.8 `swidth(dwx)` from the headers */
const swidthOf = (h: Partial<BdfHeaders>, dwx: number): number => {
  const pointsize = h.pointsize
  const xres = h.xres
  if (pointsize && xres) {
    return Math.floor((dwx * 72000) / (pointsize * xres) + 0.5)
  }
  return Math.floor((dwx * 1000) / Math.max(h.fbbx || 1, 1) + 0.5)
}

/**
 * Write a font as PCF. With default options the output is byte-identical to
 * `bdftopcf` (libXfont2) for the same BDF font.
 *
 * @param font - The font
 * @param options - `byteorder` / `bitorder` (`'msb'` | `'lsb'`, default `'msb'`), `glyphpad` (1, 2, 4, 8; default 4), `scanunit` (1, 2, 4; default 1)
 *
 * @returns PCF file content
 */
export function writePcf(
  font: Font,
  options: PcfWriteOptions = {}
): Uint8Array {
  const byteorder = options.byteorder ?? 'msb'
  const bitorder = options.bitorder ?? 'msb'
  const pad = options.glyphpad ?? 4
  const scan = options.scanunit ?? 1
  if (byteorder !== 'msb' && byteorder !== 'lsb') {
    throw new RangeError(`Invalid PCF byteorder: ${String(byteorder)}`)
  }
  if (bitorder !== 'msb' && bitorder !== 'lsb') {
    throw new RangeError(`Invalid PCF bitorder: ${String(bitorder)}`)
  }
  if (![1, 2, 4, 8].includes(pad)) {
    throw new RangeError(`Invalid PCF glyphpad: ${String(pad)}`)
  }
  if (![1, 2, 4].includes(scan)) {
    throw new RangeError(`Invalid PCF scanunit: ${String(scan)}`)
  }
  const byteMSB = byteorder === 'msb'
  const bitMSB = bitorder === 'msb'
  if (bitMSB !== byteMSB && scan > pad) {
    throw new RangeError(
      'PCF scanunit must not exceed glyphpad when bitorder differs from byteorder'
    )
  }
  // missing headers get bdftopcf-like defaults (like the Python library: a
  // font without FONTBOUNDINGBOX, even an empty one, is written)
  const h = (font.headers ?? {}) as Partial<BdfHeaders>
  const format =
    (padIndex(scan) << 4) |
    ((bitMSB ? 1 : 0) << 3) |
    ((byteMSB ? 1 : 0) << 2) |
    padIndex(pad)

  /* ---- properties (bdfReadProperties) ---- */
  const props: WProp[] = []
  let fontAscent: number | null = null
  let fontDescent: number | null = null
  let defaultCh = 0
  const seen = new Map<string, WProp>()
  for (const [key, value] of propEntries(font.props, font._propnames)) {
    if (value === null || value === undefined) {
      continue
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      continue
    }
    const name = font._propnames.get(key) ?? key.toUpperCase()
    if (name.startsWith('COMMENT')) {
      // bdftopcf's line reader drops every line starting with COMMENT
      continue
    }
    const isString = !isInt(value)
    if (!isString) {
      checkProp(name, value as number)
    }
    if (name === 'FONT_ASCENT' || name === 'FONT_DESCENT') {
      if (!isString) {
        if (name === 'FONT_ASCENT') {
          fontAscent = value as number
        } else {
          fontDescent = value as number
        }
      }
      continue
    }
    if (name === 'DEFAULT_CHAR') {
      if (!isString) {
        defaultCh = (value as number) & 0xffff
      }
      continue
    }
    const p: WProp = {
      name,
      isString,
      value: isString ? String(value) : (value as number),
    }
    props.push(p)
    seen.set(name, p)
  }
  const hint = (v: unknown, dflt: number): number => (isInt(v) ? v : dflt)
  if (fontAscent === null) {
    fontAscent = hint(h.fbby, 0) + hint(h.fbbyoff, 0)
  }
  if (fontDescent === null) {
    fontDescent = -hint(h.fbbyoff, 0)
  }
  let xres = hint(h.xres, 75)
  let yres = hint(h.yres, 75)
  if (xres < 1) {
    xres = 75
  }
  if (yres < 1) {
    yres = 75
  }
  const gen = (
    name: string,
    isString: boolean,
    value: number | string
  ): void => {
    if (!seen.has(name)) {
      const p = { name, isString, value }
      props.push(p)
      seen.set(name, p)
    }
  }
  gen(
    'POINT_SIZE',
    false,
    Math.trunc(Math.fround(Number(h.pointsize) || 0) * 10)
  )
  gen('FONT', true, String(h.fontname ?? ''))
  gen('WEIGHT', false, -1)
  if (xres === yres) {
    gen('RESOLUTION', false, Math.trunc((xres * 100) / 72.27))
  }
  gen('RESOLUTION_X', false, xres)
  gen('RESOLUTION_Y', false, yres)
  gen('X_HEIGHT', false, -1)
  gen('QUAD_WIDTH', false, -1)

  // range guards before any bitmap is built (SPEC-v3 §11.2): property values
  // must fit their 32-bit words; the font ascent / descent (16-bit in the X
  // font info and in the metrics of a terminal font's character cell) and the
  // cell height must fit 16 bits
  for (const p of props) {
    if (!p.isString) {
      checkProp(p.name, p.value as number)
    }
  }
  for (const v of [fontAscent, fontDescent, fontAscent + fontDescent]) {
    if (v < MINSHORT || v > MAXSHORT) {
      throw new RangeError(
        `PCF: FONT_ASCENT ${fontAscent} / FONT_DESCENT ${fontDescent} do not fit in 16 bits`
      )
    }
  }

  /* ---- glyphs (bdfReadCharacters) ---- */
  const hdwx0 = isInt(h.dwx0) ? h.dwx0 : undefined
  const hswx0 = isInt(h.swx0) ? h.swx0 : undefined
  const glyphs: WGlyph[] = []
  const bitmapSizes = [0, 0, 0, 0]
  let exHeight = 0
  let digitWidths = 0
  let digitCount = 0
  let firstRow = 256
  let lastRow = 0
  let firstCol = 256
  let lastCol = 0
  const cells = new Map<number, number>()

  const addGlyph = (meta: GlyphMetaInFont, enc: number): void => {
    const nameBytes = scanToken(String(meta[0] ?? ''), 99)
    const label = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      nameBytes
    )
    const bw = meta[2] || 0
    const bh = meta[3] || 0
    const bl = meta[4] || 0
    const bb = meta[5] || 0
    if (bw < 0 || bh < 0) {
      throw new RangeError(
        `Glyph "${label}" has a negative sized bitmap, ${bw}x${bh}`
      )
    }
    const dwx = meta[8] ?? hdwx0 ?? Math.max(0, bl + bw)
    const swx = meta[6] ?? hswx0 ?? swidthOf(h, dwx)
    for (const v of [dwx, bl, bb, bl + bw, bh + bb, -bb]) {
      if (v < MINSHORT || v > MAXSHORT) {
        throw new RangeError(
          `Glyph "${label}": metric value ${v} does not fit in 16 bits`
        )
      }
    }
    if (nameBytes.length === 1) {
      const c = nameBytes[0]
      if (c >= 0x30 && c <= 0x39) {
        digitWidths += dwx
        digitCount++
      } else if (c === 0x78) {
        exHeight = bh + bb <= 0 ? bh : bh + bb
      }
    }
    const m: Metric = {
      lsb: bl,
      rsb: bl + bw,
      ascent: bh + bb,
      descent: -bb,
      width: dwx,
      attributes: 0,
    }
    const w = m.rsb - m.lsb
    const ht = m.ascent + m.descent
    const bits = glyphBits(meta[16] ?? [], w, ht, pad)
    for (let i = 0; i < 4; i++) {
      bitmapSizes[i] += bytesPerRow(w, 1 << i) * ht
    }
    const idx = glyphs.length
    if (enc >= 0 && enc <= 0xffff) {
      const row = (enc >> 8) & 0xff
      const col = enc & 0xff
      firstRow = Math.min(firstRow, row)
      lastRow = Math.max(lastRow, row)
      firstCol = Math.min(firstCol, col)
      lastCol = Math.max(lastCol, col)
      cells.set(enc, idx)
    }
    glyphs.push({ m, bits, name: nameBytes, swidth: toI32(swx), enc })
  }
  for (const [cp, meta] of font.glyphs) {
    addGlyph(meta, cp)
  }
  for (const { altcode, meta } of font.unencoded) {
    addGlyph(meta, altcode !== null && altcode >= 0 ? altcode : -1)
  }

  const ncols = lastCol - firstCol + 1
  const nrows = lastRow - firstRow + 1
  const nencodings = ncols * nrows
  const encodingTable = new Int32Array(nencodings).fill(-1)
  const encodedOrder: number[] = []
  if (ncols > 0 && nrows > 0) {
    for (const [enc, idx] of cells) {
      const r = ((enc >> 8) & 0xff) - firstRow
      const c = (enc & 0xff) - firstCol
      encodingTable[r * ncols + c] = idx
    }
    for (const idx of encodingTable) {
      if (idx >= 0) {
        encodedOrder.push(idx)
      }
    }
  }

  /* ---- bounds, terminal padding, accelerators, ink (bdfReadFont) ---- */
  const extra = newInfo(fontAscent, fontDescent)
  const info = newInfo(fontAscent, fontDescent)
  computeFontBounds(glyphs, encodedOrder, extra, info)
  if (couldBeTerminal(info)) {
    const width = info.minbounds.width
    for (const g of glyphs) {
      const nm: Metric = {
        lsb: 0,
        rsb: width,
        width,
        ascent: fontAscent,
        descent: fontDescent,
        attributes: g.m.attributes,
      }
      g.bits = reshape(g.m, g.bits, nm, pad)
      g.m = nm
    }
    for (let i = 0; i < 4; i++) {
      bitmapSizes[i] =
        glyphs.length * bytesPerRow(width, 1 << i) * (fontAscent + fontDescent)
    }
    computeFontBounds(glyphs, encodedOrder, extra, info)
  }
  computeAccelerators(info)
  computeAccelerators(extra)
  let inks: Metric[] | null = null
  if (info.constantMetrics) {
    inks = glyphs.map((g) => inkMetrics(g.m, g.bits, pad))
    info.inkMetrics = true
  }
  extra.inkMetrics = info.inkMetrics
  if (inks === null) {
    extra.inkMin = { ...extra.minbounds }
    extra.inkMax = { ...extra.maxbounds }
    info.inkMin = { ...info.minbounds }
    info.inkMax = { ...info.maxbounds }
  } else {
    for (const ci of inks) {
      minmax(extra.inkMin, extra.inkMax, ci)
      extra.inkMin.attributes &= ci.attributes
      extra.inkMax.attributes |= ci.attributes
    }
    for (const idx of encodedOrder) {
      const ci = inks[idx]
      minmax(info.inkMin, info.inkMax, ci)
      info.inkMin.attributes &= ci.attributes
      info.inkMax.attributes |= ci.attributes
    }
  }

  /* ---- bit / byte order of the stored bitmaps ---- */
  for (const g of glyphs) {
    if (!bitMSB) {
      bitOrderInvert(g.bits)
    }
    if (bitMSB !== byteMSB) {
      byteSwap(g.bits, scan)
    }
  }

  /* ---- generated property values ---- */
  const xh = seen.get('X_HEIGHT')
  if (xh && xh.value === -1) {
    xh.value = exHeight ? exHeight : info.inkMin.ascent
  }
  const qw = seen.get('QUAD_WIDTH')
  if (qw && qw.value === -1) {
    qw.value = digitCount
      ? Math.trunc(digitWidths / digitCount) | 0
      : Math.trunc((info.inkMin.width + info.inkMax.width) / 2) | 0
  }
  const wt = seen.get('WEIGHT')
  if (wt && wt.value === -1) {
    wt.value = 10
  }

  /* ---- table sizes (pcfWriteFont) ---- */
  const nchars = glyphs.length
  const propStrings: Uint8Array[] = []
  const propRecs: [number, number, number][] = []
  let propStringSize = 0
  for (const p of props) {
    const nb = utf8(p.name)
    propStrings.push(nb)
    const nameOff = propStringSize
    propStringSize += nb.length + 1
    if (p.isString) {
      const vb = utf8(String(p.value))
      propStrings.push(vb)
      propRecs.push([nameOff, 1, propStringSize])
      propStringSize += vb.length + 1
    } else {
      propRecs.push([nameOff, 0, p.value as number])
    }
  }
  const canCompress = (m: Metric): boolean =>
    [m.lsb, m.rsb, m.width, m.ascent, m.descent].every(
      (v) => v >= -128 && v <= 127
    ) && m.attributes === 0
  const metricsCompressed =
    canCompress(extra.minbounds) && canCompress(extra.maxbounds)
  const inkCompressed =
    inks !== null && canCompress(extra.inkMin) && canCompress(extra.inkMax)
  let glyphStringSize = 0
  for (const g of glyphs) {
    glyphStringSize += g.name.length + 1
  }
  const propSize = 8 + 9 * props.length
  const propPad = roundUp4(propSize) - propSize

  type Table = { type: number; format: number; size: number; offset: number }
  const tables: Table[] = []
  const add = (type: number, fmt: number, size: number): void => {
    tables.push({ type, format: fmt | format, size, offset: 0 })
  }
  add(
    PCF_PROPERTIES,
    PCF_DEFAULT_FORMAT,
    roundUp4(propSize) + 4 + roundUp4(propStringSize)
  )
  add(
    PCF_ACCELERATORS,
    extra.inkMetrics ? PCF_ACCEL_W_INKBOUNDS : PCF_DEFAULT_FORMAT,
    100
  )
  if (metricsCompressed) {
    add(PCF_METRICS, PCF_COMPRESSED_METRICS, roundUp4(6 + nchars * 5))
  } else {
    add(PCF_METRICS, PCF_DEFAULT_FORMAT, 8 + nchars * 12)
  }
  add(
    PCF_BITMAPS,
    PCF_DEFAULT_FORMAT,
    roundUp4(8 + nchars * 4 + 16 + bitmapSizes[padIndex(pad)])
  )
  if (inks !== null) {
    if (inkCompressed) {
      add(PCF_INK_METRICS, PCF_COMPRESSED_METRICS, roundUp4(6 + nchars * 5))
    } else {
      add(PCF_INK_METRICS, PCF_DEFAULT_FORMAT, 8 + nchars * 12)
    }
  }
  add(PCF_BDF_ENCODINGS, PCF_DEFAULT_FORMAT, roundUp4(14 + nencodings * 2))
  add(PCF_SWIDTHS, PCF_DEFAULT_FORMAT, 8 + nchars * 4)
  add(
    PCF_GLYPH_NAMES,
    PCF_DEFAULT_FORMAT,
    8 + nchars * 4 + 4 + roundUp4(glyphStringSize)
  )
  add(
    PCF_BDF_ACCELERATORS,
    info.inkMetrics ? PCF_ACCEL_W_INKBOUNDS : PCF_DEFAULT_FORMAT,
    100
  )
  let offset = 8 + tables.length * 16
  for (const t of tables) {
    t.offset = offset
    offset += t.size
  }

  /* ---- output ---- */
  const w = new ByteWriter(offset, byteMSB)
  w.lsb32(0x70636601)
  w.lsb32(tables.length)
  for (const t of tables) {
    w.lsb32(t.type)
    w.lsb32(t.format)
    w.lsb32(t.size)
    w.lsb32(t.offset)
  }
  const putMetric = (m: Metric, compressed: boolean): void => {
    if (compressed) {
      w.u8(m.lsb + 0x80)
      w.u8(m.rsb + 0x80)
      w.u8(m.width + 0x80)
      w.u8(m.ascent + 0x80)
      w.u8(m.descent + 0x80)
    } else {
      w.i16(m.lsb)
      w.i16(m.rsb)
      w.i16(m.width)
      w.i16(m.ascent)
      w.i16(m.descent)
      w.i16(m.attributes)
    }
  }
  const putAccel = (fi: FontInfo, withInk: boolean): void => {
    w.u8(fi.noOverlap ? 1 : 0)
    w.u8(fi.constantMetrics ? 1 : 0)
    w.u8(fi.terminalFont ? 1 : 0)
    w.u8(fi.constantWidth ? 1 : 0)
    w.u8(fi.inkInside ? 1 : 0)
    w.u8(fi.inkMetrics ? 1 : 0)
    w.u8(fi.drawDirection)
    w.u8(0)
    w.i32(fi.fontAscent)
    w.i32(fi.fontDescent)
    w.i32(fi.maxOverlap)
    putMetric(fi.minbounds, false)
    putMetric(fi.maxbounds, false)
    if (withInk) {
      putMetric(fi.inkMin, false)
      putMetric(fi.inkMax, false)
    }
  }
  const putMetrics = (list: Metric[], compressed: boolean): void => {
    if (compressed) {
      w.i16(list.length)
    } else {
      w.i32(list.length)
    }
    for (const m of list) {
      putMetric(m, compressed)
    }
  }
  for (const t of tables) {
    w.padTo(t.offset)
    w.lsb32(t.format)
    switch (t.type) {
      case PCF_PROPERTIES: {
        w.i32(props.length)
        for (const [n, s, v] of propRecs) {
          w.i32(n)
          w.u8(s)
          w.i32(v)
        }
        for (let i = 0; i < propPad; i++) {
          w.u8(0)
        }
        w.i32(propStringSize)
        for (const s of propStrings) {
          w.bytes(s)
          w.u8(0)
        }
        break
      }
      case PCF_ACCELERATORS:
        putAccel(extra, extra.inkMetrics)
        break
      case PCF_METRICS:
        putMetrics(
          glyphs.map((g) => g.m),
          metricsCompressed
        )
        break
      case PCF_BITMAPS: {
        w.i32(nchars)
        let off = 0
        for (const g of glyphs) {
          w.i32(off)
          off += g.bits.length
        }
        for (let i = 0; i < 4; i++) {
          w.i32(bitmapSizes[i])
        }
        for (const g of glyphs) {
          w.bytes(g.bits)
        }
        break
      }
      case PCF_INK_METRICS:
        putMetrics(inks as Metric[], inkCompressed)
        break
      case PCF_BDF_ENCODINGS:
        w.i16(firstCol)
        w.i16(lastCol)
        w.i16(firstRow)
        w.i16(lastRow)
        w.i16(defaultCh)
        for (const idx of encodingTable) {
          w.i16(idx >= 0 ? idx : 0xffff)
        }
        break
      case PCF_SWIDTHS:
        w.i32(nchars)
        for (const g of glyphs) {
          w.i32(g.swidth)
        }
        break
      case PCF_GLYPH_NAMES: {
        w.i32(nchars)
        let off = 0
        for (const g of glyphs) {
          w.i32(off)
          off += g.name.length + 1
        }
        w.i32(off)
        for (const g of glyphs) {
          w.bytes(g.name)
          w.u8(0)
        }
        break
      }
      case PCF_BDF_ACCELERATORS:
        putAccel(info, info.inkMetrics)
        break
    }
  }
  return w.result()
}

/* ------------------------------------------------------------------------ */
/* Reader                                                                   */
/* ------------------------------------------------------------------------ */

class TableReader {
  pos: number
  readonly msb: boolean
  constructor(
    private dv: DataView,
    offset: number,
    readonly format: number,
    private what: string
  ) {
    this.pos = offset
    this.msb = (format & 4) !== 0
  }
  need(n: number): void {
    if (n < 0 || this.pos < 0 || this.pos + n > this.dv.byteLength) {
      throw new Error(`PCF data truncated while reading ${this.what}`)
    }
  }
  u8(): number {
    this.need(1)
    return this.dv.getUint8(this.pos++)
  }
  i16(): number {
    this.need(2)
    const v = this.dv.getInt16(this.pos, !this.msb)
    this.pos += 2
    return v
  }
  u16(): number {
    this.need(2)
    const v = this.dv.getUint16(this.pos, !this.msb)
    this.pos += 2
    return v
  }
  i32(): number {
    this.need(4)
    const v = this.dv.getInt32(this.pos, !this.msb)
    this.pos += 4
    return v
  }
  u32(): number {
    this.need(4)
    const v = this.dv.getUint32(this.pos, !this.msb)
    this.pos += 4
    return v
  }
  /** read a count of records of `recordSize` bytes that must fit in the file */
  count(n: number, recordSize: number): number {
    if (n * recordSize > this.dv.byteLength - this.pos) {
      throw new Error(`PCF data truncated while reading ${this.what}`)
    }
    return n
  }
}

type RAccel = {
  fontAscent: number
  fontDescent: number
  minbounds: Metric
  maxbounds: Metric
}

/** UTF-8, falling back to Latin-1 for invalid UTF-8 */
const decodeBytes = (b: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b)
  } catch {
    let s = ''
    for (const c of b) {
      s += String.fromCharCode(c)
    }
    return s
  }
}

const cString = (
  u8: Uint8Array,
  start: number,
  end: number,
  what: string
): string => {
  if (start < 0 || start >= end) {
    throw new Error(`PCF string offset out of range in ${what}`)
  }
  let e = start
  while (e < end && u8[e] !== 0) {
    e++
  }
  return decodeBytes(u8.subarray(start, e))
}

/**
 * Read a PCF font (uncompressed; use {@link readPcfAsync} for `.pcf.gz`).
 *
 * @param data - PCF file content
 *
 * @returns The `Font` object
 */
export function readPcf(data: Uint8Array | ArrayBuffer): Font {
  const u8 = toU8(data)
  if (isGzip(u8)) {
    throw new Error(
      'PCF data is gzip-compressed (.pcf.gz): use the async readPcfAsync() or decompress it first'
    )
  }
  if (u8.length < 4 || PCF_MAGIC.some((b, i) => u8[i] !== b)) {
    throw new Error('Not a PCF file (bad magic, expected "\\x01fcp")')
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const head = new TableReader(dv, 4, 0, 'table count')
  const ntables = head.u32()
  if (ntables > 1024) {
    throw new Error(`Implausible PCF table count ${ntables}`)
  }
  const toc = new Map<number, number>()
  const tocReader = new TableReader(dv, 8, 0, 'table of contents')
  for (let i = 0; i < ntables; i++) {
    const type = tocReader.u32()
    tocReader.u32()
    tocReader.u32()
    const offset = tocReader.u32()
    if (!toc.has(type)) {
      toc.set(type, offset)
    }
  }
  const open = (type: number, what: string): TableReader | null => {
    const offset = toc.get(type)
    if (offset === undefined) {
      return null
    }
    const fmt = new TableReader(dv, offset, 0, `${what} format`).u32()
    return new TableReader(dv, offset + 4, fmt, what)
  }

  /* metrics */
  const readMetrics = (type: number, what: string): Metric[] | null => {
    const r = open(type, what)
    if (!r) {
      return null
    }
    const fclass = (r.format & PCF_FORMAT_MASK) >>> 0
    const out: Metric[] = []
    if (fclass === PCF_COMPRESSED_METRICS) {
      const n = r.count(r.u16(), 5)
      for (let i = 0; i < n; i++) {
        out.push({
          lsb: r.u8() - 0x80,
          rsb: r.u8() - 0x80,
          width: r.u8() - 0x80,
          ascent: r.u8() - 0x80,
          descent: r.u8() - 0x80,
          attributes: 0,
        })
      }
    } else if (fclass === PCF_DEFAULT_FORMAT) {
      const n = r.count(r.u32(), 12)
      for (let i = 0; i < n; i++) {
        out.push({
          lsb: r.i16(),
          rsb: r.i16(),
          width: r.i16(),
          ascent: r.i16(),
          descent: r.i16(),
          attributes: r.i16(),
        })
      }
    } else {
      throw new Error(
        `Unsupported PCF ${what} format 0x${(r.format >>> 0).toString(16)}`
      )
    }
    return out
  }
  const metrics = readMetrics(PCF_METRICS, 'metrics')
  if (!metrics) {
    throw new Error('PCF file has no METRICS table')
  }
  const n = metrics.length
  for (const m of metrics) {
    if (m.rsb < m.lsb || m.ascent + m.descent < 0) {
      throw new Error('PCF glyph metrics describe a negative sized bitmap')
    }
  }

  /* bitmaps */
  const br = open(PCF_BITMAPS, 'bitmaps')
  if (!br) {
    throw new Error('PCF file has no BITMAPS table')
  }
  const bformat = br.format
  const nbitmaps = br.u32()
  if (nbitmaps !== n) {
    throw new Error(`PCF bitmap count ${nbitmaps} != metrics count ${n}`)
  }
  br.count(n, 4)
  const offsets: number[] = []
  for (let i = 0; i < n; i++) {
    offsets.push(br.u32())
  }
  const sizes = [br.u32(), br.u32(), br.u32(), br.u32()]
  const gpad = 1 << (bformat & 3)
  const scanIdx = (bformat >> 4) & 3
  if (scanIdx > 2) {
    throw new Error(
      `Invalid PCF scan unit in format 0x${(bformat >>> 0).toString(16)}`
    )
  }
  const bitsSize = sizes[bformat & 3]
  br.need(bitsSize)
  const block = u8.slice(br.pos, br.pos + bitsSize)
  const fbitMSB = (bformat & 8) !== 0
  const fbyteMSB = (bformat & 4) !== 0
  if (fbitMSB !== fbyteMSB) {
    byteSwap(block, 1 << scanIdx)
  }
  if (!fbitMSB) {
    bitOrderInvert(block)
  }
  const HEX = Array.from({ length: 256 }, (_, i) =>
    i.toString(16).toUpperCase().padStart(2, '0')
  )
  const hexrows: string[][] = metrics.map((m, i) => {
    const w = m.rsb - m.lsb
    const h = m.ascent + m.descent
    if (w === 0 || h === 0) {
      return [] // what a BDF file can express (no empty rows)
    }
    const bpr = bytesPerRow(w, gpad)
    const start = offsets[i]
    if (start + bpr * h > bitsSize) {
      throw new Error(`PCF bitmap of glyph ${i} exceeds the bitmap data`)
    }
    const nb = (w + 7) >> 3
    const mask = w & 7 ? (0xff << (8 - (w & 7))) & 0xff : 0xff
    const rows: string[] = []
    for (let r = 0; r < h; r++) {
      const o = start + r * bpr
      let row = ''
      for (let c = 0; c < nb - 1; c++) {
        row += HEX[block[o + c]]
      }
      rows.push(row + HEX[block[o + nb - 1] & mask])
    }
    return rows
  })

  /* properties */
  const plist: [string, string | number][] = []
  const pr = open(PCF_PROPERTIES, 'properties')
  if (pr) {
    const nprops = pr.count(pr.u32(), 9)
    const entries: [number, number, number][] = []
    for (let i = 0; i < nprops; i++) {
      entries.push([pr.u32(), pr.u8(), pr.i32()])
    }
    pr.pos += (4 - (nprops & 3)) & 3
    const ssize = pr.count(pr.u32(), 1)
    const sstart = pr.pos
    const send = sstart + ssize
    for (const [nameOff, isString, value] of entries) {
      const name = cString(u8, sstart + nameOff, send, 'properties')
      plist.push([
        name,
        isString ? cString(u8, sstart + value, send, 'properties') : value,
      ])
    }
  }

  /* accelerators */
  const readAccel = (type: number): RAccel | null => {
    const r = open(type, 'accelerators')
    if (!r) {
      return null
    }
    r.pos += 8
    const fontAscent = r.i32()
    const fontDescent = r.i32()
    r.i32()
    const met = (): Metric => ({
      lsb: r.i16(),
      rsb: r.i16(),
      width: r.i16(),
      ascent: r.i16(),
      descent: r.i16(),
      attributes: r.i16(),
    })
    const minbounds = met()
    const maxbounds = met()
    return { fontAscent, fontDescent, minbounds, maxbounds }
  }
  const accel = readAccel(PCF_ACCELERATORS) ?? readAccel(PCF_BDF_ACCELERATORS)

  /* encodings */
  const codes: number[][] = Array.from({ length: n }, () => [])
  let defaultCh = 0xffff
  const er = open(PCF_BDF_ENCODINGS, 'encodings')
  if (er) {
    const firstCol = er.u16()
    const lastCol = er.u16()
    const firstRow = er.u16()
    const lastRow = er.u16()
    defaultCh = er.u16()
    if (firstCol <= lastCol && firstRow <= lastRow) {
      const ncols = lastCol - firstCol + 1
      er.count(ncols * (lastRow - firstRow + 1), 2)
      for (let row = firstRow; row <= lastRow; row++) {
        for (let col = firstCol; col <= lastCol; col++) {
          const gi = er.u16()
          if (gi !== 0xffff) {
            if (gi >= n) {
              throw new Error(`PCF encoding refers to missing glyph ${gi}`)
            }
            codes[gi].push((row << 8) | col)
          }
        }
      }
    }
  }

  /* swidths */
  let swidths: number[] | null = null
  const sr = open(PCF_SWIDTHS, 'swidths')
  if (sr) {
    const cnt = sr.u32()
    if (cnt !== n) {
      throw new Error(`PCF swidth count ${cnt} != metrics count ${n}`)
    }
    sr.count(n, 4)
    swidths = []
    for (let i = 0; i < n; i++) {
      swidths.push(sr.i32())
    }
  }

  /* glyph names */
  let names: string[] | null = null
  const nr = open(PCF_GLYPH_NAMES, 'glyph names')
  if (nr) {
    const cnt = nr.u32()
    if (cnt !== n) {
      throw new Error(`PCF glyph name count ${cnt} != metrics count ${n}`)
    }
    nr.count(n, 4)
    const noffs: number[] = []
    for (let i = 0; i < n; i++) {
      noffs.push(nr.u32())
    }
    const ssize = nr.count(nr.u32(), 1)
    const sstart = nr.pos
    names = noffs.map((o) =>
      cString(u8, sstart + o, sstart + ssize, 'glyph names')
    )
  }

  /* ---- build the model ---- */
  const font = new Font()
  const plower = new Map<string, string | number>()
  for (const [name, value] of plist) {
    plower.set(name.toLowerCase(), value)
  }
  const fontEntry = plist.find(
    ([name, value]) => name === 'FONT' && typeof value === 'string'
  )
  let minb: Metric
  let maxb: Metric
  if (accel) {
    minb = accel.minbounds
    maxb = accel.maxbounds
  } else {
    minb = initMin()
    maxb = initMax()
    for (const m of metrics) {
      minmax(minb, maxb, m)
    }
  }
  const fbb =
    maxb.rsb >= minb.lsb &&
    maxb.ascent + maxb.descent >= 0 &&
    minb.lsb !== MAXSHORT
      ? [
          maxb.rsb - minb.lsb,
          maxb.ascent + maxb.descent,
          minb.lsb,
          0 - maxb.descent,
        ]
      : [0, 0, 0, 0]
  const ps = plower.get('point_size')
  const pxs = plower.get('pixel_size')
  const rx = plower.get('resolution_x')
  const ry = plower.get('resolution_y')
  const headers: BdfHeaders = {
    bdfversion: 2.1,
    fontname: fontEntry ? (fontEntry[1] as string) : '',
    pointsize:
      typeof ps === 'number'
        ? Math.floor(ps / 10 + 0.5)
        : typeof pxs === 'number'
          ? pxs
          : fbb[1],
    xres: typeof rx === 'number' ? rx : 75,
    yres: typeof ry === 'number' ? ry : 75,
    fbbx: fbb[0],
    fbby: fbb[1],
    fbbxoff: fbb[2],
    fbbyoff: fbb[3],
    metricsset: 0,
  }
  font.headers = headers
  const setprop = (name: string, value: string | number): void => {
    const k = name.toLowerCase()
    font.props[k] = value
    if (!font._propnames.has(k)) {
      font._propnames.set(k, name)
    }
  }
  for (const [name, value] of plist) {
    setprop(name, value)
  }
  if (accel) {
    if (!('font_ascent' in font.props)) {
      setprop('FONT_ASCENT', accel.fontAscent)
    }
    if (!('font_descent' in font.props)) {
      setprop('FONT_DESCENT', accel.fontDescent)
    }
  }
  if (
    !('default_char' in font.props) &&
    defaultCh !== 0 &&
    defaultCh !== 0xffff
  ) {
    setprop('DEFAULT_CHAR', defaultCh)
  }

  const unicode = isUnicodeCharset(
    sanitizeCharset(
      font.props['charset_registry'] as string | number | null | undefined,
      font.props['charset_encoding'] as string | number | null | undefined
    )
  )
  for (let i = 0; i < n; i++) {
    const m = metrics[i]
    const sw = swidths ? swidths[i] : swidthOf(headers, m.width)
    const meta = (cp: number, name: string): GlyphMetaInFont => [
      name,
      cp,
      m.rsb - m.lsb,
      m.ascent + m.descent,
      m.lsb,
      0 - m.descent,
      sw,
      0,
      m.width,
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      hexrows[i].slice(),
    ]
    if (codes[i].length === 0) {
      font.unencoded.push({
        altcode: null,
        meta: meta(-1, names ? names[i] : `glyph${i}`),
      })
    } else {
      for (const cp of codes[i]) {
        font.glyphs.set(
          cp,
          meta(cp, names ? names[i] : defaultglyphname(cp, unicode))
        )
      }
    }
  }
  return font
}

/**
 * Read a PCF font, also accepting gzip-compressed data (`.pcf.gz`, decompressed
 * with the standard `DecompressionStream`).
 *
 * @param data - PCF or gzip-compressed PCF file content
 *
 * @returns Promise of the `Font` object
 */
export async function readPcfAsync(
  data: Uint8Array | ArrayBuffer
): Promise<Font> {
  const u8 = toU8(data)
  if (!isGzip(u8)) {
    return readPcf(u8)
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'Cannot decompress gzip-compressed PCF: DecompressionStream is not available'
    )
  }
  const stream = new Blob([u8 as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  let buf: ArrayBuffer
  try {
    buf = await new Response(stream).arrayBuffer()
  } catch (e) {
    throw new Error(
      `Cannot decompress gzip-compressed PCF: ${(e as Error).message}`,
      { cause: e }
    )
  }
  return readPcf(new Uint8Array(buf))
}
