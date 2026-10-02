/**
 * Pixel TrueType writer (SPEC-v3 §8) and reader (SPEC-v3 §8.1).
 *
 * Browser-safe: only `DataView`, `TextEncoder` / `TextDecoder` are used
 * (UTF-16BE is encoded / decoded by hand).
 *
 * Byte-level choices where SPEC-v3 §8 is ambiguous or silent. They are the
 * same as in the Python implementation (`bdfparser/ttf.py`, header comment),
 * and cross-language golden tests assert byte-identical output:
 *
 *  1. Options are validated: `ppu` even integer ≥ 2, `shape` `'square'` /
 *     `'circle'`, `dotsize` in (0, 1.5], `timestamp` an integer; `upem` outside
 *     16…16384 throws. Any value that does not fit its TrueType field (negative
 *     advance, coordinates outside int16, …) throws; nothing is clamped.
 *  2. "int prop" = property whose value is an integer `number`; "str prop" =
 *     a `string`. bold / italic / SPACING only look at strings.
 *  3. Name strings (`COPYRIGHT`, `FAMILY_NAME`, `NOTICE`, header `fontname`)
 *     are "present" only if not null and non-empty after `String()`.
 *     `FONT_VERSION` is used only if it is a non-empty string.
 *  4. Glyph / header `dwx0` are used when not null. `.notdef` copies the
 *     `DEFAULT_CHAR` glyph's contours and advance (that glyph keeps its own gid).
 *  5. `OS/2.xAvgCharWidth` averages all glyphs incl. gid 0 with advance > 0, as
 *     `floor((2·sum + count) / (2·count))`. Every `//` is a floor division.
 *  6. head bounds, hhea min/max and maxp maxima include gid 0.
 *  7. Unicode: `font.cp2char(cp)` (identity if unavailable / throwing) must
 *     return exactly one code point (code points, not UTF-16 units).
 *  8. cmap format 4 holds codes 0x0000…0xFFFE only (U+FFFF is always the
 *     terminator segment); if it would exceed 65535 bytes, whole runs are
 *     dropped from the high end. Format 12 always holds every mapping.
 *  9. Glyph names: the fallback `glyph{gid}` is not checked against used
 *     names; all names except `.notdef` are custom post names (258 + k).
 * 10. `BDFP` (SPEC-v3 §8): each `"glyphs"` entry is the 18-element list
 *     `[gid, cp, name, bbw, bbh, bbxoff, bbyoff, swx0, swy0, dwx0, dwy0, swx1,
 *     swy1, dwx1, dwy1, vvectorx, vvectory, altcode]`, listed in storage order
 *     (`font.glyphs` insertion order, then `font.unencoded`), so that the
 *     reader restores untrimmed boxes, all metrics, altcodes and glyph order.
 *     `props` excludes `comment`; `propnames` is the whole lower → original
 *     map; `headers` has `bdfversion` as the `fmtver` string; `dotsize` via
 *     `String(n)`. The reader also accepts the legacy 3-element form.
 * 11. `usWinAscent` is not clamped (throws if negative); `usWinDescent` is
 *     clamped at 0.
 * 12. Checksums of `head` (directory and whole file) are computed with
 *     `checkSumAdjustment = 0`.
 * 13. `prep` (SPEC-v3 §8) = `B8 01 FF 85 B0 04 8D` (dropout control on), with
 *     maxp `maxStackElements = 1`; the directory is always
 *     `[BDFP] OS/2 cmap glyf head hhea hmtx loca maxp name post prep`. The
 *     reader ignores `prep`.
 *
 * Reader choices: unsupported cmap formats are skipped in the preference order
 * (3,10), (0,4), (0,6), (3,1), (0,3), then the other records in directory order;
 * a glyph mapped by several code points gets the smallest; name = post name
 * (if non-empty) else `defaultglyphname(cp)` else `glyph{gid}`; `fontname` =
 * name ID 6, else 4, else `"Untitled"`; `FAMILY_NAME` = name ID 1 else
 * `fontname`. Glyph bounds are recomputed from all (transformed) points.
 * Composite glyphs: offsets (never scaled), point matching, scale / x-y scale /
 * 2×2. With a full `BDFP` glyph entry the outline is rasterized into the stored
 * box without trimming.
 *
 * @module
 */

import { Font } from './Font'
import { defaultglyphname } from './Glyph'
import {
  bitmapContours,
  Contour,
  ContourPoint,
  DotShape,
  rasterize,
} from './outline'
import type { BdfHeaders, GlyphMetaInFont, Props } from './types'

// ---------------------------------------------------------------------------
// shared helpers

const rnd = (v: number): number => Math.floor(v + 0.5)

/** `fmtnum`: integer string if integral, else shortest round-trip repr */
const fmtnum = (n: number): string => String(n)

/** `fmtver`: integral → "{n}.0", else shortest repr */
const fmtver = (n: number): string =>
  Number.isInteger(n) ? `${n}.0` : String(n)

type PropValue = string | number | null | string[] | undefined

const getProp = (props: Props, key: string): PropValue =>
  (props as Record<string, PropValue>)[key]

const intProp = (props: Props, key: string): number | undefined => {
  const v = getProp(props, key)
  return typeof v === 'number' && Number.isInteger(v) ? v : undefined
}

const strProp = (props: Props, key: string): string | undefined => {
  const v = getProp(props, key)
  return typeof v === 'string' ? v : undefined
}

/**
 * Unicode code point of a font codepoint via `font.cp2char` (falls back to
 * identity if `cp2char` is unavailable or throws). `null` if not exactly one
 * character.
 */
const cpToUnicode = (font: Font, cp: number): number | null => {
  let s: unknown
  try {
    const f = (font as unknown as { cp2char?: (cp: number) => unknown }).cp2char
    if (typeof f !== 'function') {
      throw new Error('no cp2char')
    }
    s = f.call(font, cp)
  } catch {
    try {
      s = String.fromCodePoint(cp)
    } catch {
      return null
    }
  }
  if (typeof s !== 'string') {
    return null
  }
  const chars = [...s]
  if (chars.length !== 1) {
    return null
  }
  return chars[0].codePointAt(0) as number
}

/** Draw the glyph's own bounding box (= `Glyph.draw(1)`), robust for wide glyphs */
const drawBb = (meta: GlyphMetaInFont): string[] => {
  const bbw = meta[2]
  const bbh = meta[3]
  const hexdata = meta[16] ?? []
  if (!(bbw > 0) || !(bbh > 0)) {
    return []
  }
  const rows: string[] = []
  for (let i = 0; i < bbh; i++) {
    const hex = hexdata[i] ?? ''
    let bits = ''
    for (let j = 0; j < hex.length && bits.length < bbw; j++) {
      const v = parseInt(hex[j], 16)
      bits += (Number.isNaN(v) ? 0 : v).toString(2).padStart(4, '0')
    }
    rows.push(bits.slice(0, bbw).padEnd(bbw, '0'))
  }
  return rows
}

/**
 * Bitmap rows → BDF hex rows: UPPER-case, `ceil(bbw/8)*2` digits, bits
 * left-aligned, zero-padded.
 */
const encodeBitmap = (bindata: readonly string[], bbw: number): string[] => {
  const nbytes = Math.ceil(bbw / 8)
  return bindata.map((row) => {
    const bits = [...row.slice(0, bbw)]
      .map((ch) => (ch === '0' ? '0' : '1'))
      .join('')
      .padEnd(nbytes * 8, '0')
    let hex = ''
    for (let k = 0; k < bits.length; k += 4) {
      hex += parseInt(bits.slice(k, k + 4), 2)
        .toString(16)
        .toUpperCase()
    }
    return hex
  })
}

/**
 * `setbitmap(bindata, mode=-1, bb=(_, _, xoff, yoff), trim=True)`:
 * returns `[bbw, bbh, bbxoff, bbyoff, hexdata]`.
 */
const trimToHex = (
  bindata: readonly string[],
  xoff: number,
  yoff: number
): [number, number, number, number, string[]] => {
  const h = bindata.length
  const w = h > 0 ? bindata[0].length : 0
  let top = -1
  let bottom = -1
  let left = w
  let right = -1
  for (let r = 0; r < h; r++) {
    const row = bindata[r]
    for (let c = 0; c < w; c++) {
      if (row[c] !== '0') {
        if (top < 0) {
          top = r
        }
        bottom = r
        if (c < left) {
          left = c
        }
        if (c > right) {
          right = c
        }
      }
    }
  }
  if (top < 0) {
    return [0, 0, 0, 0, []]
  }
  const bbw = right - left + 1
  const bbh = bottom - top + 1
  const hexdata = encodeBitmap(
    bindata.slice(top, bottom + 1).map((row) => row.slice(left, right + 1)),
    bbw
  )
  return [bbw, bbh, left + xoff, h - 1 - bottom + yoff, hexdata]
}

// ---------------------------------------------------------------------------
// binary writer

class Writer {
  private buf: Uint8Array
  private dv: DataView
  public length = 0

  constructor(size = 256) {
    this.buf = new Uint8Array(size)
    this.dv = new DataView(this.buf.buffer)
  }

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) {
      return
    }
    let size = this.buf.length * 2
    while (size < this.length + n) {
      size *= 2
    }
    const nb = new Uint8Array(size)
    nb.set(this.buf.subarray(0, this.length))
    this.buf = nb
    this.dv = new DataView(nb.buffer)
  }

  private check(v: number, min: number, max: number, what: string): void {
    if (!Number.isInteger(v) || v < min || v > max) {
      throw new RangeError(`TTF writer: ${what} value ${v} out of range`)
    }
  }

  u8(v: number): this {
    this.check(v, 0, 0xff, 'uint8')
    this.ensure(1)
    this.dv.setUint8(this.length, v)
    this.length += 1
    return this
  }

  u16(v: number): this {
    this.check(v, 0, 0xffff, 'uint16')
    this.ensure(2)
    this.dv.setUint16(this.length, v)
    this.length += 2
    return this
  }

  i16(v: number): this {
    this.check(v, -0x8000, 0x7fff, 'int16')
    this.ensure(2)
    this.dv.setInt16(this.length, v)
    this.length += 2
    return this
  }

  u32(v: number): this {
    this.check(v, 0, 0xffffffff, 'uint32')
    this.ensure(4)
    this.dv.setUint32(this.length, v)
    this.length += 4
    return this
  }

  i64(v: number): this {
    this.check(v, -(2 ** 53), 2 ** 53, 'int64')
    this.ensure(8)
    this.dv.setBigInt64(this.length, BigInt(v))
    this.length += 8
    return this
  }

  bytes(b: Uint8Array): this {
    this.ensure(b.length)
    this.buf.set(b, this.length)
    this.length += b.length
    return this
  }

  pad4(): this {
    while (this.length % 4 !== 0) {
      this.u8(0)
    }
    return this
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length)
  }
}

const utf16be = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[2 * i] = c >> 8
    out[2 * i + 1] = c & 0xff
  }
  return out
}

const isWellFormed = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1)
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false
      i++
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false
    }
  }
  return true
}

const decodeUtf16be = (b: Uint8Array): string => {
  let s = ''
  for (let i = 0; i + 1 < b.length; i += 2) {
    s += String.fromCharCode((b[i] << 8) | b[i + 1])
  }
  return s
}

const checksum = (b: Uint8Array): number => {
  let sum = 0
  const n = b.length
  for (let i = 0; i < n; i += 4) {
    const v =
      ((b[i] ?? 0) * 0x1000000 +
        ((b[i + 1] ?? 0) << 16) +
        ((b[i + 2] ?? 0) << 8) +
        (b[i + 3] ?? 0)) >>>
      0
    sum = (sum + v) % 0x100000000
  }
  return sum
}

const log2floor = (n: number): number => {
  let e = 0
  while (2 ** (e + 1) <= n) {
    e++
  }
  return e
}

// ---------------------------------------------------------------------------
// TTF writer

export type WriteTtfOptions = {
  /** dot shape, default `'square'` */
  shape?: DotShape
  /** dot size relative to the pixel, in (0, 1.5], default 1 */
  dotsize?: number
  /** font units per pixel, even integer ≥ 2, default 64 */
  ppu?: number
  /** embed the private `BDFP` table (lossless round trip), default true */
  metadata?: boolean
  /** Unix seconds for head.created / head.modified, default 0 */
  timestamp?: number
}

type OutGlyph = {
  name: string
  unicode: number | null
  contours: Contour[]
  advance: number
  /** xMin, yMin, xMax, yMax; null if no contours */
  bounds: [number, number, number, number] | null
}

const GLYPH_NAME_RE = /^[A-Za-z_.][A-Za-z0-9_.]{0,62}$/

const contourBounds = (
  contours: Contour[]
): [number, number, number, number] | null => {
  let xMin = Infinity
  let yMin = Infinity
  let xMax = -Infinity
  let yMax = -Infinity
  for (const c of contours) {
    for (const [x, y] of c) {
      if (x < xMin) xMin = x
      if (y < yMin) yMin = y
      if (x > xMax) xMax = x
      if (y > yMax) yMax = y
    }
  }
  return xMin === Infinity ? null : [xMin, yMin, xMax, yMax]
}

const int16Check = (v: number, what: string): number => {
  if (!Number.isInteger(v) || v < -0x8000 || v > 0x7fff) {
    throw new RangeError(`TTF writer: ${what} value ${v} out of range (int16)`)
  }
  return v
}

const encodeGlyf = (g: OutGlyph): Uint8Array => {
  if (g.bounds === null) {
    return new Uint8Array(0)
  }
  const nc = g.contours.length
  let n = 0
  for (const c of g.contours) n += c.length
  const flags = new Uint8Array(n)
  const dxs = new Int32Array(n)
  const dys = new Int32Array(n)
  let xlen = 0
  let ylen = 0
  let px = 0
  let py = 0
  let k = 0
  for (const c of g.contours) {
    for (const [x, y, on] of c) {
      let f = on ? 0x01 : 0
      const dx = x - px
      const dy = y - py
      px = x
      py = y
      if (dx === 0) {
        f |= 0x10
      } else if (dx >= -255 && dx <= 255) {
        f |= dx > 0 ? 0x12 : 0x02
        xlen += 1
      } else {
        int16Check(dx, 'x delta')
        xlen += 2
      }
      if (dy === 0) {
        f |= 0x20
      } else if (dy >= -255 && dy <= 255) {
        f |= dy > 0 ? 0x24 : 0x04
        ylen += 1
      } else {
        int16Check(dy, 'y delta')
        ylen += 2
      }
      flags[k] = f
      dxs[k] = dx
      dys[k] = dy
      k++
    }
  }
  if (n > 0xffff) {
    throw new RangeError(`TTF writer: too many points (${n}) in a glyph`)
  }
  const size = 10 + 2 * nc + 2 + n + xlen + ylen
  const out = new Uint8Array(Math.ceil(size / 4) * 4)
  const dv = new DataView(out.buffer)
  dv.setInt16(0, int16Check(nc, 'numberOfContours'))
  for (let b = 0; b < 4; b++) {
    dv.setInt16(2 + 2 * b, int16Check(g.bounds[b], 'glyph bounds'))
  }
  let p = 10
  let end = -1
  for (const c of g.contours) {
    end += c.length
    dv.setUint16(p, end)
    p += 2
  }
  p += 2 // instructionLength 0
  out.set(flags, p)
  p += n
  for (let i = 0; i < n; i++) {
    const d = dxs[i]
    if (d === 0) continue
    if (d >= -255 && d <= 255) {
      out[p++] = d < 0 ? -d : d
    } else {
      dv.setInt16(p, d)
      p += 2
    }
  }
  for (let i = 0; i < n; i++) {
    const d = dys[i]
    if (d === 0) continue
    if (d >= -255 && d <= 255) {
      out[p++] = d < 0 ? -d : d
    } else {
      dv.setInt16(p, d)
      p += 2
    }
  }
  return out
}

type Run = [start: number, end: number, startGid: number]

const mappingRuns = (pairs: [number, number][]): Run[] => {
  const runs: Run[] = []
  for (const [code, gid] of pairs) {
    const last = runs[runs.length - 1]
    if (
      last !== undefined &&
      code === last[1] + 1 &&
      gid === last[2] + (code - last[0])
    ) {
      last[1] = code
    } else {
      runs.push([code, code, gid])
    }
  }
  return runs
}

const buildCmap = (mapping: Map<number, number>): Uint8Array => {
  const pairs = [...mapping.entries()].sort((a, b) => a[0] - b[0])
  // format 4
  // codes 0..0xFFFE only (U+FFFF is the terminator); drop runs from the high
  // end if the subtable would exceed 65535 bytes
  const bmpRuns = mappingRuns(pairs.filter(([c]) => c <= 0xfffe)).slice(
    0,
    Math.floor((65535 - 16) / 8) - 1
  )
  const segs: [number, number, number][] = bmpRuns.map(([s, e, g]) => [
    s,
    e,
    (((g - s) % 65536) + 65536) % 65536,
  ])
  segs.push([0xffff, 0xffff, 1])
  const segCount = segs.length
  const es = log2floor(segCount)
  const searchRange = 2 * 2 ** es
  const f4 = new Writer()
  f4.u16(4)
  f4.u16(16 + 8 * segCount)
  f4.u16(0)
  f4.u16(2 * segCount)
  f4.u16(searchRange)
  f4.u16(es)
  f4.u16(2 * segCount - searchRange)
  for (const s of segs) f4.u16(s[1])
  f4.u16(0)
  for (const s of segs) f4.u16(s[0])
  for (const s of segs) f4.u16(s[2])
  for (let i = 0; i < segCount; i++) f4.u16(0)
  // format 12
  const allRuns = mappingRuns(pairs)
  const f12 = new Writer()
  f12
    .u16(12)
    .u16(0)
    .u32(16 + 12 * allRuns.length)
    .u32(0)
    .u32(allRuns.length)
  for (const [s, e, g] of allRuns) {
    f12.u32(s).u32(e).u32(g)
  }
  const b4 = f4.result()
  const b12 = f12.result()
  const w = new Writer()
  w.u16(0).u16(2)
  w.u16(3).u16(1).u32(20)
  w.u16(3)
    .u16(10)
    .u32(20 + b4.length)
  w.bytes(b4).bytes(b12)
  return w.result()
}

const jsonHeaders = (headers: BdfHeaders): Record<string, unknown> => {
  const o: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) {
      continue
    }
    o[k] = k === 'bdfversion' && typeof v === 'number' ? fmtver(v) : v
  }
  return o
}

/**
 * Converts a font to a TrueType font (SPEC-v3 §8): every pixel becomes a
 * square (merged outline) or a separate square / round dot.
 *
 * @param font - source font
 * @param options - see {@link WriteTtfOptions}
 *
 * @returns TTF file bytes
 */
export const writeTtf = (
  font: Font,
  options: WriteTtfOptions = {}
): Uint8Array => {
  const shape = options.shape ?? 'square'
  const dotsize = options.dotsize ?? 1
  const ppu = options.ppu ?? 64
  const metadata = options.metadata ?? true
  const timestamp = options.timestamp ?? 0
  if (shape !== 'square' && shape !== 'circle') {
    throw new Error(
      `Invalid shape "${String(shape)}": must be "square" or "circle"`
    )
  }
  if (!(typeof dotsize === 'number' && dotsize > 0 && dotsize <= 1.5)) {
    throw new RangeError(
      `Invalid dotsize ${String(dotsize)}: must be in (0, 1.5]`
    )
  }
  if (!Number.isInteger(ppu) || ppu < 2 || ppu % 2 !== 0) {
    throw new RangeError(
      `Invalid ppu ${String(ppu)}: must be an even integer >= 2`
    )
  }
  if (!Number.isInteger(timestamp)) {
    throw new RangeError(`Invalid timestamp ${String(timestamp)}`)
  }
  const H = font.headers
  if (H === undefined || H === null) {
    throw new Error('Font is not loaded')
  }
  const props: Props = font.props ?? {}

  const fbby = H.fbby ?? 0
  const fbbyoff = H.fbbyoff ?? 0
  const fbbx = H.fbbx ?? 0
  const ascent = intProp(props, 'font_ascent') ?? fbby + fbbyoff
  const descent = intProp(props, 'font_descent') ?? -fbbyoff
  const pixelSize = intProp(props, 'pixel_size')
  const em =
    pixelSize !== undefined && pixelSize > 0
      ? pixelSize
      : ascent + descent > 0
        ? ascent + descent
        : fbby
  const upem = em * ppu
  if (!(upem >= 16 && upem <= 16384)) {
    throw new RangeError(
      `unitsPerEm ${upem} (em ${em} × ppu ${ppu}) out of range 16…16384`
    )
  }
  const weightName = strProp(props, 'weight_name')
  const bold =
    weightName !== undefined && weightName.toLowerCase().includes('bold')
  const slant = strProp(props, 'slant')
  const italic = slant !== undefined && ['i', 'o'].includes(slant.toLowerCase())

  const contoursOf = (meta: GlyphMetaInFont): Contour[] =>
    bitmapContours(drawBb(meta), {
      shape,
      dotsize,
      ppu,
      xoff: meta[4],
      yoff: meta[5],
    })
  const advanceOf = (meta: GlyphMetaInFont): number => {
    const dw = meta[8] ?? H.dwx0 ?? Math.max(0, meta[4] + meta[2])
    return dw * ppu
  }

  // ---- glyph list
  const glyphs: OutGlyph[] = []
  const defChar = intProp(props, 'default_char')
  const defMeta = defChar !== undefined ? font.glyphs.get(defChar) : undefined
  if (defMeta !== undefined) {
    const contours = contoursOf(defMeta)
    glyphs.push({
      name: '.notdef',
      unicode: null,
      contours,
      advance: advanceOf(defMeta),
      bounds: contourBounds(contours),
    })
  } else {
    glyphs.push({
      name: '.notdef',
      unicode: null,
      contours: [],
      advance: fbbx * ppu,
      bounds: null,
    })
  }
  const used = new Set<string>()
  const pushGlyph = (meta: GlyphMetaInFont, cp: number): void => {
    const gid = glyphs.length
    const unicode = cp >= 0 ? cpToUnicode(font, cp) : null
    const bdfname = meta[0]
    let name: string
    if (
      typeof bdfname === 'string' &&
      GLYPH_NAME_RE.test(bdfname) &&
      bdfname !== '.notdef' &&
      !used.has(bdfname)
    ) {
      name = bdfname
    } else if (unicode !== null && !used.has(defaultglyphname(unicode))) {
      name = defaultglyphname(unicode)
    } else {
      name = `glyph${gid}`
    }
    used.add(name)
    const contours = contoursOf(meta)
    glyphs.push({
      name,
      unicode,
      contours,
      advance: advanceOf(meta),
      bounds: contourBounds(contours),
    })
  }
  const cps = [...font.glyphs.keys()].sort((a, b) => a - b)
  const gidOfCp = new Map<number, number>()
  for (const cp of cps) {
    gidOfCp.set(cp, glyphs.length)
    pushGlyph(font.glyphs.get(cp) as GlyphMetaInFont, cp)
  }
  const unencoded = font.unencoded ?? []
  const firstUnencodedGid = glyphs.length
  for (const u of unencoded) {
    pushGlyph(u.meta, -1)
  }
  const numGlyphs = glyphs.length
  if (numGlyphs > 0xffff) {
    throw new RangeError(`Too many glyphs (${numGlyphs}) for TrueType`)
  }

  // ---- global metrics
  let xMin = 0
  let yMin = 0
  let xMax = 0
  let yMax = 0
  let anyBounds = false
  let minLsb = 0
  let minRsb = 0
  let maxExtent = 0
  let maxPoints = 0
  let maxContours = 0
  let advMax = 0
  let advSum = 0
  let advCount = 0
  for (const g of glyphs) {
    if (g.advance > advMax) advMax = g.advance
    if (g.advance > 0) {
      advSum += g.advance
      advCount++
    }
    if (g.bounds === null) {
      continue
    }
    const [gx0, gy0, gx1, gy1] = g.bounds
    const rsb = g.advance - gx1
    if (!anyBounds) {
      anyBounds = true
      ;[xMin, yMin, xMax, yMax] = g.bounds
      minLsb = gx0
      minRsb = rsb
      maxExtent = gx1
    } else {
      xMin = Math.min(xMin, gx0)
      yMin = Math.min(yMin, gy0)
      xMax = Math.max(xMax, gx1)
      yMax = Math.max(yMax, gy1)
      minLsb = Math.min(minLsb, gx0)
      minRsb = Math.min(minRsb, rsb)
      maxExtent = Math.max(maxExtent, gx1)
    }
    let pts = 0
    for (const c of g.contours) pts += c.length
    maxPoints = Math.max(maxPoints, pts)
    maxContours = Math.max(maxContours, g.contours.length)
  }
  const hheaAscender = ascent * ppu
  const hheaDescender = -descent * ppu

  // ---- cmap mapping
  const mapping = new Map<number, number>()
  glyphs.forEach((g, gid) => {
    if (g.unicode !== null && !mapping.has(g.unicode)) {
      mapping.set(g.unicode, gid)
    }
  })
  let minUni = Infinity
  let maxUni = -Infinity
  for (const u of mapping.keys()) {
    if (u < minUni) minUni = u
    if (u > maxUni) maxUni = u
  }

  const tables = new Map<string, Uint8Array>()

  // ---- glyf + loca
  const glyf = new Writer(1024)
  const loca = new Writer()
  for (const g of glyphs) {
    loca.u32(glyf.length)
    glyf.bytes(encodeGlyf(g))
  }
  loca.u32(glyf.length)
  tables.set('glyf', glyf.result())
  tables.set('loca', loca.result())

  // ---- head (checkSumAdjustment filled in later)
  const ts = timestamp + 2082844800
  const head = new Writer(54)
  head.u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5)
  head.u16(0x000b).u16(upem).i64(ts).i64(ts)
  head.i16(xMin).i16(yMin).i16(xMax).i16(yMax)
  head.u16((bold ? 1 : 0) | (italic ? 2 : 0))
  head.u16(em).i16(2).i16(1).i16(0)
  tables.set('head', head.result())

  // ---- hhea
  const hhea = new Writer(36)
  hhea.u32(0x00010000).i16(hheaAscender).i16(hheaDescender).i16(0)
  hhea.u16(advMax).i16(minLsb).i16(minRsb).i16(maxExtent)
  hhea.i16(1).i16(0).i16(0)
  hhea.i16(0).i16(0).i16(0).i16(0)
  hhea.i16(0).u16(numGlyphs)
  tables.set('hhea', hhea.result())

  // ---- hmtx
  const hmtx = new Writer()
  for (const g of glyphs) {
    hmtx.u16(g.advance).i16(g.bounds === null ? 0 : g.bounds[0])
  }
  tables.set('hmtx', hmtx.result())

  // ---- maxp
  const maxp = new Writer(32)
  maxp.u32(0x00010000).u16(numGlyphs).u16(maxPoints).u16(maxContours)
  // maxStackElements = 1 (prep)
  for (const v of [0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0]) maxp.u16(v)
  tables.set('maxp', maxp.result())

  // ---- OS/2
  const xh = intProp(props, 'x_height')
  const hasXh = xh !== undefined && xh > 0
  const capHeight = intProp(props, 'cap_height')
  const os2 = new Writer(96)
  os2.u16(4)
  os2.i16(
    advCount > 0 ? Math.floor((2 * advSum + advCount) / (2 * advCount)) : 0
  )
  os2
    .u16(bold ? 700 : 400)
    .u16(5)
    .u16(0)
  const sub = Math.floor((upem * 65) / 100)
  os2
    .i16(sub)
    .i16(sub)
    .i16(0)
    .i16(Math.floor((upem * 14) / 100))
  os2
    .i16(sub)
    .i16(sub)
    .i16(0)
    .i16(Math.floor((upem * 48) / 100))
  os2.i16(ppu)
  os2.i16(hasXh ? Math.floor((xh * ppu) / 2) : Math.floor((ascent * ppu) / 3))
  os2.i16(0)
  for (let i = 0; i < 10; i++) os2.u8(0)
  os2.u32(0).u32(0).u32(0).u32(0)
  os2.bytes(new Uint8Array([0x42, 0x44, 0x46, 0x50])) // "BDFP"
  os2.u16(
    (italic ? 0x01 : 0) |
      (bold ? 0x20 : 0) |
      (!italic && !bold ? 0x40 : 0) |
      0x80
  )
  os2.u16(mapping.size > 0 ? Math.min(minUni, 0xffff) : 0)
  os2.u16(mapping.size > 0 ? Math.min(maxUni, 0xffff) : 0)
  os2.i16(hheaAscender).i16(hheaDescender).i16(0)
  os2.u16(Math.max(hheaAscender, yMax))
  os2.u16(Math.max(-hheaDescender, -yMin, 0))
  os2.u32(1).u32(0)
  os2.i16(hasXh ? xh * ppu : 0)
  os2.i16(capHeight !== undefined ? capHeight * ppu : ascent * ppu)
  os2.u16(0).u16(32).u16(0)
  tables.set('OS/2', os2.result())

  // ---- cmap
  tables.set('cmap', buildCmap(mapping))

  // ---- name
  /** "present": not null/undefined and non-empty after String() */
  const present = (v: unknown): string | undefined => {
    if (v === undefined || v === null) {
      return undefined
    }
    const t = String(v)
    return t === '' ? undefined : t
  }
  const nameStr = (key: string): string | undefined =>
    present(getProp(props, key))
  const family = nameStr('family_name') ?? present(H.fontname) ?? 'Untitled'
  const subfamily =
    bold && italic
      ? 'Bold Italic'
      : bold
        ? 'Bold'
        : italic
          ? 'Italic'
          : 'Regular'
  const fullName = subfamily === 'Regular' ? family : `${family} ${subfamily}`
  const psName =
    fullName.replace(/[^A-Za-z0-9-]/g, '').slice(0, 63) || 'Untitled'
  const fontVersion = strProp(props, 'font_version')
  const nameRecords: [number, string][] = []
  const copyright = nameStr('copyright')
  if (copyright !== undefined) nameRecords.push([0, copyright])
  nameRecords.push([1, family])
  nameRecords.push([2, subfamily])
  nameRecords.push([3, psName])
  nameRecords.push([4, fullName])
  nameRecords.push([
    5,
    fontVersion ? `Version ${fontVersion}` : 'Version 1.000',
  ])
  nameRecords.push([6, psName])
  const notice = nameStr('notice')
  if (notice !== undefined) nameRecords.push([10, notice])
  const name = new Writer()
  name
    .u16(0)
    .u16(nameRecords.length)
    .u16(6 + 12 * nameRecords.length)
  const strData = new Writer()
  for (const [id, s] of nameRecords) {
    const b = utf16be(s)
    name.u16(3).u16(1).u16(0x0409).u16(id).u16(b.length).u16(strData.length)
    strData.bytes(b)
  }
  name.bytes(strData.result())
  tables.set('name', name.result())

  // ---- post
  const spacing = strProp(props, 'spacing')
  const fixed =
    spacing !== undefined && ['m', 'c'].includes(spacing.toLowerCase())
  const ulPos = intProp(props, 'underline_position')
  const ulThick = intProp(props, 'underline_thickness')
  const post = new Writer()
  post.u32(0x00020000).u32(0)
  post.i16(ulPos !== undefined ? -ulPos * ppu : -ppu)
  post.i16(ulThick !== undefined ? ulThick * ppu : ppu)
  post
    .u32(fixed ? 1 : 0)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
  post.u16(numGlyphs)
  post.u16(0)
  for (let gid = 1; gid < numGlyphs; gid++) {
    post.u16(258 + gid - 1)
  }
  for (let gid = 1; gid < numGlyphs; gid++) {
    const n = glyphs[gid].name
    post.u8(n.length)
    for (let i = 0; i < n.length; i++) post.u8(n.charCodeAt(i))
  }
  tables.set('post', post.result())

  // ---- prep: PUSHW 0x01FF, SCANCTRL, PUSHB 4, SCANTYPE (dropout control on).
  // Without any instructions FreeType auto-hints and distorts merged squares.
  tables.set('prep', new Uint8Array([0xb8, 0x01, 0xff, 0x85, 0xb0, 0x04, 0x8d]))

  // ---- BDFP
  if (metadata) {
    const propsObj: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(props)) {
      if (k !== 'comment' && v !== undefined) propsObj[k] = v
    }
    const propnamesObj: Record<string, string> = {}
    for (const [k, v] of font._propnames) propnamesObj[k] = v
    // storage order: font.glyphs insertion order, then font.unencoded
    const glyphList: unknown[][] = []
    for (const [cp, meta] of font.glyphs) {
      glyphList.push([gidOfCp.get(cp), cp, meta[0], ...meta.slice(2, 16), null])
    }
    unencoded.forEach((u, i) => {
      glyphList.push([
        firstUnencodedGid + i,
        -1,
        u.meta[0],
        ...u.meta.slice(2, 16),
        u.altcode ?? null,
      ])
    })
    const json =
      '{"version":1' +
      `,"ppu":${ppu}` +
      `,"shape":${JSON.stringify(shape)}` +
      `,"dotsize":${fmtnum(dotsize)}` +
      `,"headers":${JSON.stringify(jsonHeaders(H))}` +
      `,"props":${JSON.stringify(propsObj)}` +
      `,"propnames":${JSON.stringify(propnamesObj)}` +
      `,"glyphs":${JSON.stringify(glyphList)}` +
      '}'
    tables.set('BDFP', new TextEncoder().encode(json))
  }

  return assembleSfnt(tables)
}

const assembleSfnt = (tables: Map<string, Uint8Array>): Uint8Array => {
  const tags = [...tables.keys()].sort((a, b) => {
    for (let i = 0; i < 4; i++) {
      const d = a.charCodeAt(i) - b.charCodeAt(i)
      if (d !== 0) return d
    }
    return 0
  })
  const n = tags.length
  const es = log2floor(n)
  const searchRange = 16 * 2 ** es
  const w = new Writer(1024)
  w.u32(0x00010000)
    .u16(n)
    .u16(searchRange)
    .u16(es)
    .u16(16 * n - searchRange)
  let offset = 12 + 16 * n
  const offsets: number[] = []
  for (const tag of tags) {
    const data = tables.get(tag) as Uint8Array
    for (let i = 0; i < 4; i++) w.u8(tag.charCodeAt(i))
    const padded = new Uint8Array(Math.ceil(data.length / 4) * 4)
    padded.set(data)
    w.u32(checksum(padded)).u32(offset).u32(data.length)
    offsets.push(offset)
    offset += padded.length
  }
  let headOffset = -1
  tags.forEach((tag, i) => {
    if (tag === 'head') headOffset = offsets[i]
    w.bytes(tables.get(tag) as Uint8Array)
    w.pad4()
  })
  const out = w.result()
  if (headOffset >= 0) {
    const adj = (0xb1b0afba - checksum(out) + 0x100000000) % 0x100000000
    new DataView(out.buffer).setUint32(headOffset + 8, adj)
  }
  return out
}

// ---------------------------------------------------------------------------
// TTF reader

const STANDARD_MAC_NAMES =
  '.notdef .null nonmarkingreturn space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Adieresis Aring Ccedilla Eacute Ntilde Odieresis Udieresis aacute agrave acircumflex adieresis atilde aring ccedilla eacute egrave ecircumflex edieresis iacute igrave icircumflex idieresis ntilde oacute ograve ocircumflex odieresis otilde uacute ugrave ucircumflex udieresis dagger degree cent sterling section bullet paragraph germandbls registered copyright trademark acute dieresis notequal AE Oslash infinity plusminus lessequal greaterequal yen mu partialdiff summation product pi integral ordfeminine ordmasculine Omega ae oslash questiondown exclamdown logicalnot radical florin approxequal Delta guillemotleft guillemotright ellipsis nonbreakingspace Agrave Atilde Otilde OE oe endash emdash quotedblleft quotedblright quoteleft quoteright divide lozenge ydieresis Ydieresis fraction currency guilsinglleft guilsinglright fi fl daggerdbl periodcentered quotesinglbase quotedblbase perthousand Acircumflex Ecircumflex Aacute Edieresis Egrave Iacute Icircumflex Idieresis Igrave Oacute Ocircumflex apple Ograve Uacute Ucircumflex Ugrave dotlessi circumflex tilde macron breve dotaccent ring cedilla hungarumlaut ogonek caron Lslash lslash Scaron scaron Zcaron zcaron brokenbar Eth eth Yacute yacute Thorn thorn minus multiply onesuperior twosuperior threesuperior onehalf onequarter threequarters franc Gbreve gbreve Idotaccent Scedilla scedilla Cacute cacute Ccaron ccaron dcroat'.split(
    ' '
  )

const malformed = (msg: string): Error =>
  new Error(`Malformed TrueType font: ${msg}`)

class Reader {
  private dv: DataView
  constructor(
    public readonly data: Uint8Array,
    public readonly base = 0,
    public readonly size = data.length - base
  ) {
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  }

  private at(off: number, n: number): number {
    if (
      off < 0 ||
      off + n > this.size ||
      this.base + off + n > this.data.length
    ) {
      throw malformed('read out of bounds')
    }
    return this.base + off
  }

  u8(off: number): number {
    return this.dv.getUint8(this.at(off, 1))
  }
  i8(off: number): number {
    return this.dv.getInt8(this.at(off, 1))
  }
  u16(off: number): number {
    return this.dv.getUint16(this.at(off, 2))
  }
  i16(off: number): number {
    return this.dv.getInt16(this.at(off, 2))
  }
  u32(off: number): number {
    return this.dv.getUint32(this.at(off, 4))
  }
  bytes(off: number, n: number): Uint8Array {
    const s = this.at(off, n)
    return this.data.subarray(s, s + n)
  }
  tag(off: number): string {
    return String.fromCharCode(...this.bytes(off, 4))
  }
}

type Pt = ContourPoint

/** Lazy `glyf` reader resolving composite glyphs */
class GlyfReader {
  constructor(
    private readonly glyf: Reader,
    private readonly loca: number[]
  ) {}

  contours(gid: number, depth = 0): Pt[][] {
    if (depth > 32) {
      throw malformed('composite glyph nesting too deep')
    }
    if (gid < 0 || gid + 1 >= this.loca.length) {
      throw malformed(`glyph index ${gid} out of range`)
    }
    const start = this.loca[gid]
    const end = this.loca[gid + 1]
    if (end <= start) {
      return []
    }
    if (end > this.glyf.size) {
      throw malformed('loca points beyond glyf')
    }
    const nc = this.glyf.i16(start)
    return nc >= 0 ? this.simple(start, nc) : this.composite(start, depth)
  }

  private simple(off: number, nc: number): Pt[][] {
    const r = this.glyf
    let p = off + 10
    const ends: number[] = []
    for (let i = 0; i < nc; i++) {
      ends.push(r.u16(p))
      p += 2
    }
    const npts = nc > 0 ? ends[nc - 1] + 1 : 0
    const ilen = r.u16(p)
    p += 2 + ilen
    const flags: number[] = []
    while (flags.length < npts) {
      const f = r.u8(p++)
      flags.push(f)
      if (f & 0x08) {
        const rep = r.u8(p++)
        for (let k = 0; k < rep; k++) flags.push(f)
      }
    }
    flags.length = npts
    const xs: number[] = []
    let v = 0
    for (const f of flags) {
      if (f & 0x02) {
        const d = r.u8(p++)
        v += f & 0x10 ? d : -d
      } else if (!(f & 0x10)) {
        v += r.i16(p)
        p += 2
      }
      xs.push(v)
    }
    const ys: number[] = []
    v = 0
    for (const f of flags) {
      if (f & 0x04) {
        const d = r.u8(p++)
        v += f & 0x20 ? d : -d
      } else if (!(f & 0x20)) {
        v += r.i16(p)
        p += 2
      }
      ys.push(v)
    }
    const out: Pt[][] = []
    let s = 0
    for (const e of ends) {
      if (e < s - 1 || e >= npts) {
        throw malformed('bad endPtsOfContours')
      }
      const c: Pt[] = []
      for (let i = s; i <= e; i++) c.push([xs[i], ys[i], (flags[i] & 1) === 1])
      out.push(c)
      s = e + 1
    }
    return out
  }

  private composite(off: number, depth: number): Pt[][] {
    const r = this.glyf
    let p = off + 10
    const result: Pt[][] = []
    for (;;) {
      const flags = r.u16(p)
      const gi = r.u16(p + 2)
      p += 4
      const xy = (flags & 0x0002) !== 0
      let a1: number
      let a2: number
      if (flags & 0x0001) {
        a1 = xy ? r.i16(p) : r.u16(p)
        a2 = xy ? r.i16(p + 2) : r.u16(p + 2)
        p += 4
      } else {
        a1 = xy ? r.i8(p) : r.u8(p)
        a2 = xy ? r.i8(p + 1) : r.u8(p + 1)
        p += 2
      }
      let xx = 1
      let xy2 = 0
      let yx = 0
      let yy = 1
      if (flags & 0x0008) {
        xx = yy = r.i16(p) / 16384
        p += 2
      } else if (flags & 0x0040) {
        xx = r.i16(p) / 16384
        yy = r.i16(p + 2) / 16384
        p += 4
      } else if (flags & 0x0080) {
        xx = r.i16(p) / 16384
        xy2 = r.i16(p + 2) / 16384
        yx = r.i16(p + 4) / 16384
        yy = r.i16(p + 6) / 16384
        p += 8
      }
      const comp = this.contours(gi, depth + 1)
      const tr: Pt[][] = comp.map((c) =>
        c.map(([x, y, on]): Pt => [x * xx + y * yx, x * xy2 + y * yy, on])
      )
      let dx: number
      let dy: number
      if (xy) {
        // offsets are never scaled
        dx = a1
        dy = a2
      } else {
        // point matching
        const parent = result.flat()
        const child = tr.flat()
        if (a1 >= parent.length || a2 >= child.length) {
          throw malformed('bad composite point index')
        }
        dx = parent[a1][0] - child[a2][0]
        dy = parent[a1][1] - child[a2][1]
      }
      for (const c of tr) {
        result.push(c.map(([x, y, on]): Pt => [x + dx, y + dy, on]))
      }
      if (!(flags & 0x0020)) {
        break
      }
    }
    return result
  }
}

const parseCmapSubtable = (
  r: Reader,
  off: number,
  format: number
): Map<number, number> => {
  const m = new Map<number, number>()
  if (format === 0) {
    for (let c = 0; c < 256; c++) {
      const g = r.u8(off + 6 + c)
      if (g) m.set(c, g)
    }
  } else if (format === 6) {
    const first = r.u16(off + 6)
    const count = r.u16(off + 8)
    for (let i = 0; i < count; i++) {
      const g = r.u16(off + 10 + 2 * i)
      if (g) m.set(first + i, g)
    }
  } else if (format === 4) {
    const segX2 = r.u16(off + 6)
    const n = Math.floor(segX2 / 2)
    const endsO = off + 14
    const startsO = off + 16 + segX2
    const deltasO = off + 16 + 2 * segX2
    const roffBase = off + 16 + 3 * segX2
    for (let i = 0; i < n; i++) {
      const s = r.u16(startsO + 2 * i)
      const e = r.u16(endsO + 2 * i)
      const d = r.u16(deltasO + 2 * i)
      const ro = r.u16(roffBase + 2 * i)
      for (let c = s; c <= e; c++) {
        if (c === 0xffff) continue
        let g: number
        if (ro === 0) {
          g = (c + d) & 0xffff
        } else {
          g = r.u16(roffBase + 2 * i + ro + 2 * (c - s))
          if (g) g = (g + d) & 0xffff
        }
        if (g) m.set(c, g)
      }
    }
  } else {
    // 12
    const ngroups = r.u32(off + 12)
    r.bytes(off + 16, 12 * ngroups) // bounds check
    for (let i = 0; i < ngroups; i++) {
      const s = r.u32(off + 16 + 12 * i)
      const e = r.u32(off + 20 + 12 * i)
      const sg = r.u32(off + 24 + 12 * i)
      if (e < s || e > 0x10ffff) {
        throw malformed('bad cmap format 12 group')
      }
      for (let c = s; c <= e; c++) {
        const g = sg + c - s
        if (g) m.set(c, g)
      }
    }
  }
  return m
}

const CMAP_PREFS: [number, number][] = [
  [3, 10],
  [0, 4],
  [0, 6],
  [3, 1],
  [0, 3],
]

const parseCmap = (r: Reader): Map<number, number> => {
  const n = r.u16(2)
  const recs: [number, number, number][] = []
  for (let i = 0; i < n; i++) {
    recs.push([r.u16(4 + 8 * i), r.u16(6 + 8 * i), r.u32(8 + 8 * i)])
  }
  const order: [number, number, number][] = []
  for (const [pid, eid] of CMAP_PREFS) {
    order.push(...recs.filter((x) => x[0] === pid && x[1] === eid))
  }
  order.push(...recs.filter((x) => !order.includes(x)))
  for (const [, , off] of order) {
    const fmt = r.u16(off)
    if (fmt === 0 || fmt === 4 || fmt === 6 || fmt === 12) {
      return parseCmapSubtable(r, off, fmt)
    }
  }
  return new Map()
}

/** Strict UTF-16BE decoding; `null` on odd length or unpaired surrogates */
const decodeUtf16beStrict = (b: Uint8Array): string | null => {
  if (b.length % 2 !== 0) {
    return null
  }
  const s = decodeUtf16be(b)
  return isWellFormed(s) ? s : null
}

const parseName = (r: Reader): Map<number, string> => {
  const count = r.u16(2)
  const soff = r.u16(4)
  const found = new Map<number, [number, string]>()
  let macDecoder: TextDecoder | null = null
  for (let i = 0; i < count; i++) {
    const o = 6 + 12 * i
    const pid = r.u16(o)
    const eid = r.u16(o + 2)
    const lid = r.u16(o + 4)
    const nid = r.u16(o + 6)
    const ln = r.u16(o + 8)
    const off = r.u16(o + 10)
    let prio: number
    let mac = false
    if (pid === 3 && (eid === 0 || eid === 1 || eid === 10)) {
      prio = lid === 0x0409 ? 0 : 1
    } else if (pid === 0) {
      prio = 2
    } else if (pid === 1 && eid === 0) {
      prio = 3
      mac = true
    } else {
      continue
    }
    const raw = r.bytes(soff + off, ln)
    let s: string | null
    if (mac) {
      macDecoder ??= new TextDecoder('macintosh')
      s = macDecoder.decode(raw)
    } else {
      s = decodeUtf16beStrict(raw)
    }
    if (s === null) {
      continue
    }
    const cur = found.get(nid)
    if (cur === undefined || prio < cur[0]) {
      found.set(nid, [prio, s])
    }
  }
  const m = new Map<number, string>()
  for (const [k, [, s]] of found) m.set(k, s)
  return m
}

const latin1 = (b: Uint8Array): string => {
  let s = ''
  for (const c of b) s += String.fromCharCode(c)
  return s
}

/** glyph names by gid (`''` = none), or `null` if the post version has no names */
const parsePost = (r: Reader, numGlyphs: number): string[] | null => {
  const ver = r.u32(0)
  if (ver === 0x00010000) {
    const names = STANDARD_MAC_NAMES.slice(0, numGlyphs)
    while (names.length < numGlyphs) names.push('')
    return names
  }
  if (ver !== 0x00020000) {
    return null
  }
  const n = r.u16(32)
  const idx: number[] = []
  for (let i = 0; i < n; i++) idx.push(r.u16(34 + 2 * i))
  let pos = 34 + 2 * n
  const custom: string[] = []
  while (pos < r.size) {
    const ln = r.u8(pos)
    // a truncated last string is cut at the end of the table
    custom.push(latin1(r.bytes(pos + 1, Math.min(ln, r.size - pos - 1))))
    pos += 1 + ln
  }
  const names: string[] = []
  for (let i = 0; i < Math.min(n, numGlyphs); i++) {
    const k = idx[i]
    names.push(k < 258 ? STANDARD_MAC_NAMES[k] : (custom[k - 258] ?? ''))
  }
  while (names.length < numGlyphs) names.push('')
  return names
}

const present = (v: unknown): string | undefined => {
  if (v === undefined || v === null) {
    return undefined
  }
  const t = String(v)
  return t === '' ? undefined : t
}

/**
 * Largest glyph pixel box (w × h) the reader rasterizes: a corrupt or hostile
 * outline (or BDFP box) could otherwise ask for billions of pixels and exhaust
 * the memory (a fatal, uncatchable error in Node.js).
 */
const MAX_GLYPH_PIXELS = 1 << 24

const checkBox = (w: number, h: number): void => {
  if (Math.max(w, 1) * Math.max(h, 1) > MAX_GLYPH_PIXELS) {
    throw new Error(
      `TrueType glyph too large to rasterize (${w}×${h} pixels): corrupt font or wrong pixelsize`
    )
  }
}

/** 17-slot meta with BBX and hexdata from the rasterized outline */
const rasterMeta = (
  contours: Pt[][],
  ppu: number,
  box: [number, number, number, number] | null
): GlyphMetaInFont => {
  const meta = new Array<unknown>(17).fill(null) as GlyphMetaInFont
  if (box !== null) {
    const [w, h, xo, yo] = box
    meta[2] = w
    meta[3] = h
    meta[4] = xo
    meta[5] = yo
    checkBox(w, h)
    if (w > 0 && h > 0) {
      meta[16] = encodeBitmap(rasterize(contours, ppu, xo, yo, w, h), w)
    } else if (w > 0) {
      meta[16] = []
    } else {
      meta[16] = new Array<string>(Math.max(h, 0)).fill('')
    }
    return meta
  }
  let xmin = Infinity
  let ymin = Infinity
  let xmax = -Infinity
  let ymax = -Infinity
  for (const c of contours) {
    for (const [x, y] of c) {
      if (x < xmin) xmin = x
      if (y < ymin) ymin = y
      if (x > xmax) xmax = x
      if (y > ymax) ymax = y
    }
  }
  if (xmin === Infinity) {
    meta[2] = meta[3] = meta[4] = meta[5] = 0
    meta[16] = []
    return meta
  }
  const x0 = Math.floor(xmin / ppu)
  const y0 = Math.floor(ymin / ppu)
  const w = Math.ceil(xmax / ppu) - x0
  const h = Math.ceil(ymax / ppu) - y0
  checkBox(w, h)
  const bm = w > 0 && h > 0 ? rasterize(contours, ppu, x0, y0, w, h) : []
  const [tw, th, txo, tyo, hex] = trimToHex(bm, x0, y0)
  meta[2] = tw
  meta[3] = th
  meta[4] = txo
  meta[5] = tyo
  meta[16] = hex
  return meta
}

const setprop = (font: Font, key: string, value: string | number): void => {
  const k = key.toLowerCase()
  ;(font.props as Record<string, unknown>)[k] = value
  font._propnames.set(k, key)
}

export type ReadTtfOptions = {
  /** pixel size (em in pixels); required for TTFs without a `BDFP` table */
  pixelsize?: number
}

const isInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v)

/**
 * Reads a TrueType font (SPEC-v3 §8.1), rasterizing every glyph into a bitmap.
 * Fonts written by {@link writeTtf} (with `metadata`) are restored losslessly
 * from their `BDFP` table; other fonts are rasterized at `pixelsize` pixels
 * per em (required then).
 *
 * @param data - TTF bytes
 * @param options.pixelsize - required unless the font has a `BDFP` table
 *
 * @returns a new `Font`
 */
export const readTtf = (
  data: Uint8Array | ArrayBuffer,
  options: ReadTtfOptions = {}
): Font => {
  let bytes: Uint8Array
  if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  } else if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
    // not `instanceof`: also accept ArrayBuffers from other realms
    bytes = new Uint8Array(data)
  } else {
    throw new TypeError('TrueType data must be a Uint8Array or an ArrayBuffer')
  }
  if (bytes.length < 12) {
    throw malformed('file too short')
  }
  const r = new Reader(bytes)
  const tag = r.tag(0)
  if (tag === 'OTTO') {
    throw new Error('CFF-based OpenType is not supported')
  }
  if (tag !== '\x00\x01\x00\x00' && tag !== 'true') {
    throw new Error(`Not a TrueType font (sfnt version ${JSON.stringify(tag)})`)
  }
  const num = r.u16(4)
  if (12 + 16 * num > bytes.length) {
    throw malformed('table directory is truncated')
  }
  const tables = new Map<string, Reader>()
  for (let i = 0; i < num; i++) {
    const o = 12 + 16 * i
    const t = r.tag(o)
    const off = r.u32(o + 8)
    const len = r.u32(o + 12)
    if (off + len > bytes.length) {
      throw malformed(`table '${t}' exceeds the file`)
    }
    tables.set(t, new Reader(bytes, off, len))
  }
  for (const req of ['head', 'maxp', 'hhea', 'hmtx', 'loca', 'glyf']) {
    if (!tables.has(req)) {
      throw malformed(`missing required table '${req}'`)
    }
  }
  const tbl = (t: string): Reader => tables.get(t) as Reader
  const head = tbl('head')
  const upem = head.u16(18)
  const locfmt = head.i16(50)
  const numGlyphs = tbl('maxp').u16(4)
  const hhea = tbl('hhea')
  const asc = hhea.i16(4)
  const desc = hhea.i16(6)
  const nhm = hhea.u16(34)
  if (nhm === 0 || nhm > numGlyphs) {
    throw malformed('bad hhea.numberOfHMetrics')
  }
  const hmtx = tbl('hmtx')
  const advances: number[] = []
  for (let i = 0; i < nhm; i++) advances.push(hmtx.u16(4 * i))
  while (advances.length < numGlyphs) advances.push(advances[nhm - 1])
  const lr = tbl('loca')
  const loca: number[] = []
  if (locfmt === 0) {
    for (let i = 0; i <= numGlyphs; i++) loca.push(lr.u16(2 * i) * 2)
  } else if (locfmt === 1) {
    for (let i = 0; i <= numGlyphs; i++) loca.push(lr.u32(4 * i))
  } else {
    throw malformed('bad head.indexToLocFormat')
  }
  const gr = new GlyfReader(tbl('glyf'), loca)

  const font = new Font()
  font.headers = {} as BdfHeaders
  font.props = {}
  font.glyphs = new Map()
  font.unencoded = []
  font._propnames = new Map()

  const invalidate = (): void => font._invalidate()
  const bdfpT = tables.get('BDFP')
  if (bdfpT !== undefined) {
    readWithBdfp(font, bdfpT.bytes(0, bdfpT.size), gr, advances, numGlyphs)
    invalidate()
    return font
  }

  const pixelsize = options.pixelsize
  if (pixelsize === undefined || pixelsize === null) {
    throw new Error(
      'pixelsize is required to read a TrueType font without BDFP metadata'
    )
  }
  if (!isInt(pixelsize) || pixelsize <= 0) {
    throw new RangeError(
      `pixelsize must be a positive integer, not ${String(pixelsize)}`
    )
  }
  const ppu = upem / pixelsize
  const names = tables.has('name')
    ? parseName(tbl('name'))
    : new Map<number, string>()
  const cmap = tables.has('cmap')
    ? parseCmap(tbl('cmap'))
    : new Map<number, number>()
  const post = tables.has('post') ? parsePost(tbl('post'), numGlyphs) : null
  const cps = new Map<number, number>()
  for (const c of [...cmap.keys()].sort((a, b) => a - b)) {
    const g = cmap.get(c) as number
    if (g > 0 && g < numGlyphs && !cps.has(g)) {
      cps.set(g, c)
    }
  }
  const fontname = present(names.get(6)) ?? present(names.get(4)) ?? 'Untitled'
  const ascent = rnd(asc / ppu)
  const descent = rnd(-desc / ppu)
  font.headers = {
    bdfversion: 2.1,
    fontname,
    pointsize: pixelsize,
    xres: 75,
    yres: 75,
    fbbx: pixelsize,
    fbby: ascent + descent,
    fbbxoff: 0,
    fbbyoff: -descent,
    metricsset: 0,
  }
  setprop(font, 'FAMILY_NAME', present(names.get(1)) ?? fontname)
  const copyright = present(names.get(0))
  if (copyright !== undefined) {
    setprop(font, 'COPYRIGHT', copyright)
  }
  setprop(font, 'PIXEL_SIZE', pixelsize)
  setprop(font, 'FONT_ASCENT', ascent)
  setprop(font, 'FONT_DESCENT', descent)
  setprop(font, 'CHARSET_REGISTRY', 'ISO10646')
  setprop(font, 'CHARSET_ENCODING', '1')

  for (let gid = 1; gid < numGlyphs; gid++) {
    const cp = cps.get(gid)
    const pname = post !== null ? post[gid] : ''
    const name = pname
      ? pname
      : cp !== undefined
        ? defaultglyphname(cp)
        : `glyph${gid}`
    const meta = rasterMeta(gr.contours(gid), ppu, null)
    const dwx = rnd(advances[gid] / ppu)
    meta[0] = name
    meta[1] = cp ?? -1
    meta[8] = dwx
    meta[9] = 0
    meta[6] = font.swidth(dwx)
    meta[7] = 0
    if (cp !== undefined) {
      font.glyphs.set(cp, meta)
    } else {
      font.unencoded.push({ altcode: null, meta })
    }
  }
  updateBbox(font, pixelsize, ascent, descent)
  invalidate()
  return font
}

const updateBbox = (
  font: Font,
  em: number,
  ascent: number,
  descent: number
): void => {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const metas = [...font.glyphs.values(), ...font.unencoded.map((u) => u.meta)]
  for (const m of metas) {
    if (m[2] > 0 && m[3] > 0) {
      x0 = Math.min(x0, m[4])
      y0 = Math.min(y0, m[5])
      x1 = Math.max(x1, m[4] + m[2])
      y1 = Math.max(y1, m[5] + m[3])
    }
  }
  const h = font.headers as BdfHeaders
  if (x0 !== Infinity) {
    h.fbbx = x1 - x0
    h.fbby = y1 - y0
    h.fbbxoff = x0
    h.fbbyoff = y0
  } else {
    h.fbbx = em
    h.fbby = ascent + descent
    h.fbbxoff = 0
    h.fbbyoff = -descent
  }
}

const badBdfp = (msg: string): Error =>
  new Error(`Malformed BDFP table: ${msg}`)

const readWithBdfp = (
  font: Font,
  raw: Uint8Array,
  gr: GlyfReader,
  advances: number[],
  numGlyphs: number
): void => {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
  } catch (e) {
    throw badBdfp(String(e))
  }
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!isObj(obj)) {
    throw badBdfp('bad structure')
  }
  const { ppu, headers, props, propnames, glyphs: entries } = obj
  if (
    ppu === undefined ||
    headers === undefined ||
    props === undefined ||
    propnames === undefined ||
    entries === undefined
  ) {
    throw badBdfp('missing key')
  }
  if (typeof ppu !== 'number' || !(ppu > 0)) {
    throw badBdfp('bad ppu')
  }
  if (!isObj(headers) || !isObj(props) || !Array.isArray(entries)) {
    throw badBdfp('bad structure')
  }
  const H = font.headers as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(headers)) {
    H[k] = k === 'bdfversion' ? parseFloat(String(v)) : v
  }
  for (const [k, v] of Object.entries(props)) {
    ;(font.props as Record<string, unknown>)[k] = v
  }
  for (const [k, v] of Object.entries(isObj(propnames) ? propnames : {})) {
    font._propnames.set(k, String(v))
  }
  for (const e of entries as unknown[]) {
    if (!Array.isArray(e) || (e.length !== 3 && e.length !== 18)) {
      throw badBdfp('bad glyph entry')
    }
    const [gid, cp, name] = e as [unknown, unknown, unknown]
    if (!isInt(gid) || !(gid > 0 && gid < numGlyphs) || !isInt(cp)) {
      throw badBdfp('bad glyph entry')
    }
    const contours = gr.contours(gid)
    let meta: GlyphMetaInFont
    let altcode: number | null = null
    if (e.length === 18) {
      meta = rasterMeta(contours, ppu, [e[3], e[4], e[5], e[6]])
      for (let k = 6; k < 16; k++) {
        meta[k] = e[k + 1] as number | null
      }
      altcode = e[17] as number | null
    } else {
      meta = rasterMeta(contours, ppu, null)
      const dwx = rnd(advances[gid] / ppu)
      meta[8] = dwx
      meta[9] = 0
      meta[6] = font.swidth(dwx)
      meta[7] = 0
    }
    meta[0] = name as string
    meta[1] = cp
    if (cp === -1) {
      font.unencoded.push({ altcode, meta })
    } else {
      font.glyphs.set(cp, meta)
    }
  }
}
