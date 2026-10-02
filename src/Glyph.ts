import { Bitmap } from './Bitmap'
import { META_TITLES } from './constants'
import type { Font } from './Font'
import { GlyphDrawModeType, GlyphMeta, GlyphMetaInFont } from './types'
import { warn } from './warn'

/**
 * Default glyph name for a codepoint: `uniXXXX` (cp ≤ 0xFFFF) / `uXXXXX` /
 * `uXXXXXX` (Unicode) or `char{cp}` (other charsets).
 *
 * @param cp - Codepoint
 * @param charsetIsUnicode - Whether the font's charset is Unicode, default `true`
 *
 * @returns Glyph name
 */
export const defaultglyphname = (
  cp: number,
  charsetIsUnicode = true
): string => {
  if (!charsetIsUnicode) {
    return `char${cp}`
  }
  const hex = cp.toString(16).toUpperCase()
  return cp <= 0xffff
    ? `uni${hex.padStart(4, '0')}`
    : `u${hex.padStart(5, '0')}`
}

/** Options of {@link Glyph.setbitmap} */
export type SetbitmapOptions = {
  /** placement mode (see {@link Glyph.setbitmap}), default 0 */
  mode?: GlyphDrawModeType
  /** `[w, h, xoff, yoff]`, required for mode -1 (only xoff/yoff are used) */
  bb?: [number, number, number, number] | null
  /** remove empty rows/columns on all four sides, default `true` */
  trim?: boolean
}

const HEX2BIN: Record<string, string> = {}
for (let i = 0; i < 16; i++) {
  const b = i.toString(2).padStart(4, '0')
  HEX2BIN[i.toString(16)] = b
  HEX2BIN[i.toString(16).toUpperCase()] = b
}

/** hex row → binary string (4 bits per digit; invalid digits give `0000`) */
const hex2bin = (h: string): string => {
  let s = ''
  for (const c of h) {
    s += HEX2BIN[c] ?? '0000'
  }
  return s
}

/** binary row → upper-case hex of `ndigits` digits (bits left-aligned) */
const bin2hex = (row: string, ndigits: number): string => {
  const bits = row.padEnd(ndigits * 4, '0')
  let s = ''
  for (let i = 0; i < ndigits * 4; i += 4) {
    s += parseInt(bits.slice(i, i + 4), 2)
      .toString(16)
      .toUpperCase()
  }
  return s
}

/** copy of a 17-slot list (and of its hexdata array) */
export const snapshot = (list: GlyphMetaInFont): GlyphMetaInFont => {
  const l = [...list] as GlyphMetaInFont
  if (Array.isArray(l[16])) {
    l[16] = [...l[16]]
  }
  return l
}

/** equality of two slot values (hexdata arrays compared row by row) */
export const slotEquals = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i])
  }
  return a === b
}

/** hexdata arrays already warned about (missing rows), to warn once per glyph */
const warnedRows = new WeakSet<string[]>()

/** meta object → 17-slot list */
export const metaToList = (meta: GlyphMeta): GlyphMetaInFont =>
  META_TITLES.map((k) => meta[k]) as GlyphMetaInFont

/** 17-slot list → meta object */
export const listToMeta = (list: GlyphMetaInFont): GlyphMeta => {
  const d: Record<string, unknown> = {}
  META_TITLES.forEach((k, i) => {
    d[k] = list[i]
  })
  return d as GlyphMeta
}

/**
 * `Glyph` object
 *
 * A glyph obtained from a font (`glyphbycp`, `glyph`, `iterglyphs`,
 * `newglyph`, or passed to `addglyph`) is *attached*: every editing method
 * (`setbitmap`, `setmeta`, `shift`, `transform`) writes the updated meta back
 * into the font immediately. A glyph constructed directly with `new Glyph()`
 * is detached until passed to `font.addglyph()`.
 *
 * @see online docs: {@link https://font.tomchen.org/bdfparser_js/glyph}
 */
export class Glyph {
  public meta: GlyphMeta
  public font: Font
  private __attached = false
  private __store: GlyphMetaInFont | null = null
  /** copy of the store as last seen by this object (see `Font._writeback`) */
  private __synced: GlyphMetaInFont | null = null

  /**
   * `Glyph` object constructor
   *
   * @param meta_obj - Meta information (copied)
   * @param font - The font the glyph belongs to
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/glyph}
   */
  constructor(meta_obj: GlyphMeta, font: Font) {
    this.meta = { ...meta_obj }
    this.font = font
  }

  /**
   * @internal Attach the glyph to the 17-slot list stored in its font.
   */
  _attach(store: GlyphMetaInFont): void {
    this.__attached = true
    this.__store = store
    this.__synced = snapshot(store)
  }

  /**
   * @internal Copy of the font's 17-slot list as last seen by this object
   * (`null` if detached), to detect changes made to the font meanwhile.
   */
  get _synced(): GlyphMetaInFont | null {
    return this.__attached ? this.__synced : null
  }

  /** @internal Record the font's current 17-slot list as seen. */
  _setsynced(store: GlyphMetaInFont): void {
    this.__synced = snapshot(store)
  }

  /**
   * @internal Detach the glyph from its font.
   */
  _detach(): void {
    this.__attached = false
    this.__store = null
  }

  /**
   * @internal The 17-slot list stored in the font (`null` if detached).
   */
  get _store(): GlyphMetaInFont | null {
    return this.__attached ? this.__store : null
  }

  private __sync(): void {
    if (this.__attached) {
      this.font._writeback(this)
    }
  }

  /**
   * Gets a human-readable (multi-line) `string` representation of the `Glyph` object.
   *
   * @returns String representation
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/glyph#tostring}
   */
  toString(): string {
    return this.draw().toString()
  }

  /**
   * Gets a programmer-readable `string` representation of the `Glyph` object.
   *
   * @returns String representation
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/glyph#repr}
   */
  repr(): string {
    return (
      'Glyph(' +
      JSON.stringify(this.meta, null, 2) +
      ', ' +
      'Font(<' +
      String(this.font.headers?.fontname) +
      '>' +
      ')'
    )
  }

  /**
   * Get the codepoint of the glyph.
   *
   * @returns Codepoint of the glyph
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/glyph#cp}
   */
  cp(): number {
    return this.meta['codepoint']
  }

  /**
   * Get the character of the glyph (converted with the font's charset).
   *
   * @returns Character (one character string) of the glyph, or `null` if the codepoint is not representable (e.g. unencoded glyphs)
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/glyph#chr}
   */
  chr(): string | null {
    return this.font.cp2char(this.cp())
  }

  /**
   * Draw the glyph to a `Bitmap` object.
   *
   * - `mode=0`: in the font's bounding box (FONTBOUNDINGBOX);
   * - `mode=1`: in the glyph's own bounding box (BBX);
   * - `mode=2`: the original hex data, including the padding bits;
   * - `mode=-1`: in the user specified bounding box `bb` (`[w, h, xoff, yoff]`).
   *
   * @param mode - Mode
   * @param bb - Bounding box
   *
   * @returns `Bitmap` object
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/glyph#draw}
   */
  draw(
    mode?: GlyphDrawModeType | null,
    bb?: [number, number, number, number] | null
  ): Bitmap {
    const _mode = mode ?? 0
    switch (_mode) {
      case 0:
        return this.__draw_fbb()
      case 1:
        return this.__draw_bb()
      case 2:
        return this.__draw_original()
      case -1:
        if (bb === null || bb === undefined) {
          throw new Error(
            'Parameter bb in draw() method must be set when mode=-1'
          )
        }
        return this.__draw_user_specified(bb)
      default:
        throw new Error(`Unknown draw mode ${String(_mode)}`)
    }
  }

  private __draw_user_specified(fbb: [number, number, number, number]): Bitmap {
    const bbxoff = this.meta['bbxoff'] || 0
    const bbyoff = this.meta['bbyoff'] || 0
    const [fbbx, fbby, fbbxoff, fbbyoff] = fbb
    const bitmap = this.__draw_bb()
    return bitmap.crop(fbbx, fbby, -bbxoff + fbbxoff, -bbyoff + fbbyoff)
  }

  private __draw_original(): Bitmap {
    return new Bitmap((this.meta['hexdata'] ?? []).map(hex2bin))
  }

  private __draw_bb(): Bitmap {
    const bbw = this.meta['bbw'] || 0
    const bbh = this.meta['bbh'] || 0
    const hexdata = this.meta['hexdata'] ?? []
    let bindata = this.__draw_original().bindata
    const n = bindata.length
    if (n < bbh) {
      if (!warnedRows.has(hexdata)) {
        warnedRows.add(hexdata)
        warn(
          `Glyph "${String(this.meta['glyphname'])}" (codepoint ${String(
            this.meta['codepoint']
          )}) has ${n} bitmap rows but its BBX height is ${bbh}; padded with empty rows`
        )
      }
      bindata = bindata.concat(Array<string>(bbh - n).fill(''))
    }
    return new Bitmap(
      bindata.slice(0, bbh).map((b) => b.slice(0, bbw).padEnd(bbw, '0'))
    )
  }

  private __draw_fbb(): Bitmap {
    const fh = this.font.headers
    return this.__draw_user_specified([
      fh.fbbx ?? 0,
      fh.fbby ?? 0,
      fh.fbbxoff ?? 0,
      fh.fbbyoff ?? 0,
    ])
  }

  /**
   * Get the relative position (displacement) of the origin from the left bottom corner of the bitmap drawn by the method `.draw()`, or vice versa.
   *
   * @param options.mode - Mode
   * @param options.fromorigin - From or to the origin
   * @param options.xoff - X offset
   * @param options.yoff - Y offset
   *
   * @returns The relative position (displacement) represented by `[x, y]` array / tuple (where right and top directions are positive)
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/glyph#origin}
   */
  origin(
    options: {
      mode?: GlyphDrawModeType | null
      fromorigin?: boolean | null
      xoff?: number | null
      yoff?: number | null
    } = {}
  ): [number, number] {
    const _mode = options.mode ?? 0
    const _fromorigin = options.fromorigin ?? false
    const _xoff = options.xoff ?? null
    const _yoff = options.yoff ?? null
    let ret: [number, number]
    const bbxoff = this.meta['bbxoff']
    const bbyoff = this.meta['bbyoff']
    switch (_mode) {
      case 0: {
        const fh = this.font.headers
        ret = [fh['fbbxoff'], fh['fbbyoff']]
        break
      }
      case 1:
      case 2:
        ret = [bbxoff, bbyoff]
        break
      case -1:
        if (_xoff !== null && _yoff !== null) {
          ret = [_xoff, _yoff]
        } else {
          throw new Error(
            'Parameter xoff and yoff in origin() method must be all set when mode=-1'
          )
        }
        break
      default:
        throw new Error(`Unknown origin mode ${String(_mode)}`)
    }
    return _fromorigin ? ret : [0 - ret[0], 0 - ret[1]]
  }

  /**
   * Set the glyph's bitmap (inverse of `draw()`).
   *
   * The bitmap's bottom-left corner is placed, relative to the glyph origin,
   * at: mode 0 → the font's `(fbbxoff, fbbyoff)`; mode 1 or 2 → the glyph's
   * current `(bbxoff, bbyoff)`; mode -1 → `(bb[2], bb[3])`. With `trim`
   * (default), empty rows and columns are removed on all four sides
   * (adjusting the offsets; a bitmap without ink gives an empty glyph). Any
   * non-`'0'` pixel is ink. `hexdata` rows are upper-case hex, bits
   * left-aligned. DWIDTH / SWIDTH are not changed.
   *
   * @param bitmap - `Bitmap` (or bindata array)
   * @param mode - Placement mode (0, 1, 2 or -1), default 0, or an options object `{mode, bb, trim}`
   * @param bb - `[w, h, xoff, yoff]`, required for mode -1
   * @param trim - Remove empty rows/columns, default `true`
   *
   * @returns The `Glyph` object itself
   *
   * @example
   * glyph.setbitmap(Bitmap.fromstring('.#.\n###\n.#.'), 1)
   */
  setbitmap(
    bitmap: Bitmap | string[],
    mode?: GlyphDrawModeType | SetbitmapOptions | null,
    bb?: [number, number, number, number] | null,
    trim?: boolean | null
  ): this {
    let _mode: GlyphDrawModeType
    let _bb: [number, number, number, number] | null
    let _trim: boolean
    if (mode !== null && typeof mode === 'object') {
      _mode = mode.mode ?? 0
      _bb = mode.bb ?? null
      _trim = mode.trim ?? true
    } else {
      _mode = mode ?? 0
      _bb = bb ?? null
      _trim = trim ?? true
    }
    const bindata = Array.isArray(bitmap) ? [...bitmap] : bitmap.bindata
    let xoff: number, yoff: number
    switch (_mode) {
      case 0: {
        const fh = this.font.headers
        xoff = fh.fbbxoff ?? 0
        yoff = fh.fbbyoff ?? 0
        break
      }
      case 1:
      case 2:
        xoff = this.meta.bbxoff || 0
        yoff = this.meta.bbyoff || 0
        break
      case -1:
        if (_bb === null) {
          throw new Error(
            'Parameter bb in setbitmap() method must be set when mode=-1'
          )
        }
        xoff = _bb[2]
        yoff = _bb[3]
        break
      default:
        throw new Error(`Unknown setbitmap mode ${String(_mode)}`)
    }

    let rows = bindata.map((row) => row.replace(/[^0]/g, '1'))
    const h = rows.length
    let w = h > 0 ? rows[0].length : 0
    if (rows.some((r) => r.length !== w)) {
      throw new Error('Bitmap rows have different lengths')
    }
    if (_trim) {
      const ink: number[] = []
      rows.forEach((r, i) => {
        if (r.includes('1')) {
          ink.push(i)
        }
      })
      if (ink.length === 0) {
        rows = []
        w = 0
        xoff = 0
        yoff = 0
      } else {
        const top = ink[0]
        const bottom = ink[ink.length - 1]
        const kept = rows.slice(top, bottom + 1)
        let left = Infinity
        let right = -Infinity
        for (const r of kept) {
          if (r.includes('1')) {
            left = Math.min(left, r.indexOf('1'))
            right = Math.max(right, r.lastIndexOf('1') + 1)
          }
        }
        rows = kept.map((r) => r.slice(left, right))
        xoff += left
        yoff += h - 1 - bottom
        w = right - left
      }
    }
    const ndigits = Math.ceil(w / 8) * 2
    this.meta.bbw = w
    this.meta.bbh = rows.length
    this.meta.bbxoff = xoff
    this.meta.bbyoff = yoff
    this.meta.hexdata = w > 0 ? rows.map((r) => bin2hex(r, ndigits)) : []
    this.__sync()
    return this
  }

  /**
   * Set any of the 17 meta keys, e.g. `glyph.setmeta({ dwx0: 8, glyphname: 'A' })`.
   * Changing the codepoint of an attached glyph moves it in the font
   * (overwriting a glyph already at the destination); codepoint `-1` moves it
   * to `font.unencoded`.
   *
   * @param obj - Keys and values to set
   *
   * @returns The `Glyph` object itself
   *
   * @throws Error on an unknown key
   */
  setmeta(obj: Partial<GlyphMeta>): this {
    for (const k of Object.keys(obj)) {
      if (!(META_TITLES as readonly string[]).includes(k)) {
        throw new Error(`Unknown glyph meta key "${k}"`)
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      ;(this.meta as Record<string, unknown>)[k] =
        k === 'hexdata' && Array.isArray(v) ? [...(v as string[])] : v
    }
    this.__sync()
    return this
  }

  /**
   * Move the glyph's bitmap relative to the origin: `bbxoff += dx`,
   * `bbyoff += dy` (y up).
   *
   * @param dx - Pixels to the right
   * @param dy - Pixels up
   *
   * @returns The `Glyph` object itself
   */
  shift(dx = 0, dy = 0): this {
    this.meta.bbxoff = (this.meta.bbxoff || 0) + dx
    this.meta.bbyoff = (this.meta.bbyoff || 0) + dy
    this.__sync()
    return this
  }

  /**
   * Draw the glyph (`draw(mode)`), pass the bitmap to `fn` and set the result
   * (or the bitmap itself if `fn` returns nothing, i.e. mutated it in place)
   * back with `setbitmap(..., mode)`.
   *
   * @param fn - Bitmap transformation, e.g. `(b) => b.bold()`
   * @param mode - Draw / placement mode, default 0
   *
   * @returns The `Glyph` object itself
   *
   * @example
   * font.glyph('A')?.transform((b) => b.italic())
   */
  transform(
    fn: (bitmap: Bitmap) => Bitmap | null | undefined | void,
    mode: GlyphDrawModeType = 0
  ): this {
    const bm = this.draw(mode)
    const res = fn(bm)
    return this.setbitmap(
      res !== null && typeof res === 'object' && Array.isArray(res.bindata)
        ? res
        : bm,
      mode
    )
  }

  /**
   * Get a deep copy of the glyph (same font, detached).
   *
   * @returns New `Glyph` object
   */
  clone(): Glyph {
    const meta = { ...this.meta }
    if (Array.isArray(meta.hexdata)) {
      meta.hexdata = [...meta.hexdata]
    }
    return newGlyph(meta, this.font)
  }

  /**
   * Change the bitmap of the glyph (keeping its offsets, no trimming).
   *
   * @deprecated Use {@link Glyph.setbitmap} (`setbitmap(bitmap, 1, null, false)`).
   *
   * @param bitmap - Bitmap object to change to
   *
   * @returns The `Glyph` object itself
   */
  changebitmap(bitmap: Bitmap): this {
    return this.setbitmap(bitmap, 1, null, false)
  }
}

/**
 * `new Glyph(meta, font)` outside the class body: esbuild renames a class whose
 * body references its own name (`Glyph.name` would become `'_Glyph'`).
 */
const newGlyph = (meta: GlyphMeta, font: Font): Glyph => new Glyph(meta, font)
