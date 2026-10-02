import { bitmapContours } from './outline'
import { DirectionNumberType, TodataFuncRetType } from './types'
import { warn } from './warn'

/**
 * Minimal subset of `CanvasRenderingContext2D` used by `draw2canvas` (works
 * with HTML canvas, `OffscreenCanvas`, node-canvas, skia-canvas, ...)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CanvasContext = { fillStyle: any; fillRect: any }

/** Colors for the pixel values `'0'`, `'1'` and `'2'` (`null` = not drawn) */
export type PixelColors = Partial<Record<'0' | '1' | '2', string | null>>

/** Options of {@link Bitmap.draw2canvas} */
export type Draw2CanvasOptions = {
  /** x (canvas units) of the bitmap's top-left corner, default `0` */
  x?: number
  /** y (canvas units) of the bitmap's top-left corner, default `0` */
  y?: number
  /** size (canvas units) of one pixel, default `1` */
  pixelsize?: number
  /** colors, default `{'0': null, '1': 'black', '2': 'red'}` */
  pixelcolors?: PixelColors | null
}

/** SVG output format of {@link Bitmap.tosvg} */
export type SvgFormat = 'path' | 'pathOnly' | 'rect'

/** Pixel (dot) shape */
export type SvgShape = 'square' | 'circle'

const DEFAULT_PIXELCOLORS: PixelColors = { '0': null, '1': 'black', '2': 'red' }

const FROMSTRING_MAP: Record<string, string> = {
  '#': '1',
  '.': '0',
  '&': '2',
  '0': '0',
  '1': '1',
  '2': '2',
}

/**
 * Format a number for text output (SPEC-v3): the integer string if `n` is
 * integral, otherwise the shortest round-trip representation.
 *
 * @param n - Number
 *
 * @returns Formatted number
 */
export const fmtnum = (n: number): string => String(n)

const ORed = (a: string, b: string | undefined): string =>
  b !== undefined && b !== '0' ? b : a

// Module-level helpers instead of static class members: esbuild renames a
// class whose body references its own name (`Bitmap.name` would become
// '_Bitmap' without `keepNames`, which defeats tree-shaking), so the class
// body must not mention `Bitmap` at runtime.

const cropString = (s: string, start: number, length: number): string => {
  let stemp = s
  const l = s.length
  let left = 0
  if (start < 0) {
    left = 0 - start
    stemp = stemp.padStart(left + l, '0')
  }
  if (start + length > l) {
    stemp = stemp.padEnd(start + length - l + stemp.length, '0')
  }
  const newstart = start + left
  return stemp.slice(newstart, newstart + length)
}

const stringOffsetConcat = (
  s1: string,
  s2: string,
  offset?: number | null
): string => {
  const _offset = offset ?? 0
  if (_offset === 0) {
    return s1 + s2
  }
  const len1 = s1.length
  const len2 = s2.length
  const s2start = len1 + _offset
  const s2end = s2start + len2
  const finalstart = Math.min(0, s2start)
  const finalend = Math.max(len1, s2end)
  const news1 = cropString(s1, finalstart, finalend - finalstart)
  const news2 = cropString(s2, finalstart - s2start, finalend - finalstart)
  let ret = ''
  for (let i = 0; i < news1.length; i++) {
    ret += ORed(news1[i], news2[i])
  }
  return ret
}

const listofstrOffsetConcat = (
  list1: string[],
  list2: string[],
  offset?: number | null
): string[] => {
  const _offset = offset ?? 0
  let s1: string, s2: string
  if (_offset === 0) {
    return list1.concat(list2)
  }
  const width = list1.length > 0 ? list1[0].length : (list2[0]?.length ?? 0)
  const len1 = list1.length
  const len2 = list2.length
  const s2start = len1 + _offset
  const s2end = s2start + len2
  const finalstart = Math.min(0, s2start)
  const finalend = Math.max(len1, s2end)
  const retlist: string[] = []
  for (let i = finalstart; i < finalend; i++) {
    if (i < 0 || i >= len1) {
      s1 = '0'.repeat(width)
    } else {
      s1 = list1[i]
    }
    if (i < s2start || i >= s2end) {
      s2 = '0'.repeat(width)
    } else {
      s2 = list2[i - s2start]
    }
    let row = ''
    for (let j = 0; j < s1.length; j++) {
      row += ORed(s1[j], s2[j])
    }
    retlist.push(row)
  }
  return retlist
}

const cropBitmap = (
  bitmap: string[],
  w: number,
  h: number,
  xoff: number,
  yoff: number
): string[] => {
  let bn
  const retlist = []
  const l = bitmap.length
  for (let n = 0; n < h; n++) {
    bn = l - yoff - h + n
    if (bn < 0 || bn >= l) {
      retlist.push('0'.repeat(w))
    } else {
      retlist.push(cropString(bitmap[bn], xoff, w))
    }
  }
  return retlist
}

const enlargeBindata = (
  bindata: string[],
  x?: number | null,
  y?: number | null
): string[] => {
  const _x = x ?? 1
  const _y = y ?? 1
  let ret = [...bindata]

  if (_x > 1) {
    ret = ret.map((v) =>
      v
        .split('')
        .map((c) => c.repeat(_x))
        .join('')
    )
  }
  if (_y > 1) {
    ret = ret.flatMap((row) => Array<string>(_y).fill(row))
  }
  return ret
}

/**
 * `Bitmap` object
 *
 * `bindata` is an `array` of equal-length `string`s of `'0'`, `'1'` (and
 * `'2'`), row 0 at the top.
 *
 * Two coordinate conventions are used:
 *
 * - pixel addressing (`getpixel`, `setpixel`, `paste`): `(x, y)` with the
 *   origin at the top-left, y grows downward (`bindata[y][x]`, the canvas /
 *   image convention);
 * - movement / cropping (`crop`, `shadow`, `shift`, `bbox`): x grows right, y
 *   grows upward, offsets are measured from the bottom-left (font convention).
 *
 * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap}
 */
export class Bitmap {
  public bindata: string[]

  /**
   * Initialize a `Bitmap` object. Load binary bitmap data (`array` of `string`s).
   *
   * @param bin_bitmap_list - Binary bitmap data
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap}
   */
  constructor(bin_bitmap_list: string[]) {
    this.bindata = bin_bitmap_list
  }

  /**
   * Create a `Bitmap` from its `toString()` representation (`#` = 1, `.` = 0,
   * `&` = 2; the digits `0`, `1`, `2` are also accepted). Rows are separated by
   * newlines (`\r` is ignored); blank lines at the start and the end are
   * ignored.
   *
   * @param text - Text representation
   *
   * @returns New `Bitmap` object
   *
   * @throws Error on an invalid character or rows of different lengths
   *
   * @example
   * Bitmap.fromstring('.#.\n###\n.#.')
   */
  static fromstring(text: string): Bitmap {
    const lines = text.replace(/\r/g, '').split('\n')
    while (lines.length > 0 && lines[0].trim() === '') {
      lines.shift()
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop()
    }
    const rows = lines.map((line, i) => {
      let row = ''
      for (const c of line) {
        const v = FROMSTRING_MAP[c]
        if (v === undefined) {
          throw new Error(
            `Invalid character ${JSON.stringify(c)} in bitmap row ${i}`
          )
        }
        row += v
      }
      return row
    })
    if (rows.some((r) => r.length !== rows[0].length)) {
      throw new Error('Bitmap rows have different lengths')
    }
    return newBitmap(rows)
  }

  /**
   * Create an empty (all `'0'`) bitmap.
   *
   * @param w - Width
   * @param h - Height
   *
   * @returns New `Bitmap` object
   */
  static blank(w: number, h: number): Bitmap {
    if (w < 0 || h < 0) {
      throw new RangeError('Bitmap size must not be negative')
    }
    return newBitmap(Array.from({ length: h }, () => '0'.repeat(w)))
  }

  /**
   * Gets a human-readable (multi-line) `string` representation of the `Bitmap` object.
   *
   * @returns String representation
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#tostring}
   */
  toString(): string {
    return this.bindata
      .join('\n')
      .replace(/0/g, '.')
      .replace(/1/g, '#')
      .replace(/2/g, '&')
  }

  /**
   * Gets a programmer-readable (multi-line) `string` representation of the `Bitmap` object.
   *
   * @returns String representation
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#repr}
   */
  repr(): string {
    return `Bitmap(${JSON.stringify(this.bindata, null, 2)})`
  }

  /**
   * Whether two bitmaps have the same `bindata`.
   *
   * @param other - Other bitmap
   *
   * @returns `true` if equal
   */
  equals(other: Bitmap): boolean {
    const a = this.bindata
    const b = other.bindata
    return a.length === b.length && a.every((row, i) => row === b[i])
  }

  /**
   * Get the width of the bitmap (`0` for an empty bitmap).
   *
   * @returns Width of the bitmap
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#width}
   */
  width(): number {
    return this.bindata.length > 0 ? this.bindata[0].length : 0
  }

  /**
   * Get the height of the bitmap.
   *
   * @returns Height of the bitmap
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#height}
   */
  height(): number {
    return this.bindata.length
  }

  /**
   * Get a deep copy / clone of the `Bitmap` object.
   *
   * @returns A deep copy of the original `Bitmap` object
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#clone}
   */
  clone(): Bitmap {
    return newBitmap([...this.bindata])
  }

  /**
   * Crop and/or extend the bitmap.
   *
   * @param w - Width
   * @param h - Height
   * @param xoff - X offset (from the left)
   * @param yoff - Y offset (from the bottom, y up)
   *
   * @returns The `Bitmap` object itself, which now has only the specified area as its `.bindata`
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#crop}
   */
  crop(w: number, h: number, xoff?: number | null, yoff?: number | null): this {
    const _xoff = xoff ?? 0
    const _yoff = yoff ?? 0
    this.bindata = cropBitmap(this.bindata, w, h, _xoff, _yoff)
    return this
  }

  /**
   * Overlay another bitmap over the current one.
   *
   * @param bitmap - The incoming bitmap to overlay over the current one
   *
   * @returns The `Bitmap` object itself, which now has the combined bitmap as its `.bindata`
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#overlay}
   */
  overlay(bitmap: Bitmap): this {
    const bindata_a = this.bindata
    const bindata_b = bitmap.bindata
    if (bindata_a.length !== bindata_b.length) {
      warn('the bitmaps to overlay have different height')
    }
    if (this.width() !== bitmap.width()) {
      warn('the bitmaps to overlay have different width')
    }
    this.bindata = bindata_a.map((la, li) => {
      const lb = bindata_b[li] ?? ''
      let row = ''
      for (let i = 0; i < la.length; i++) {
        row += ORed(la[i], lb[i])
      }
      return row
    })
    return this
  }

  /**
   * Concatenate all `Bitmap` objects in an `array`.
   *
   * @param bitmaplist - List of bitmaps to concatenate
   * @param options.direction - Direction
   * @param options.align - Align
   * @param options.offsetlist - List of spacing offsets between every two bitmaps
   *
   * @returns `Bitmap` object
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#bitmapconcatall}
   */
  static concatall(
    bitmaplist: Bitmap[],
    options: {
      direction?: DirectionNumberType | null
      align?: 0 | 1 | null
      offsetlist?: number[] | null
    } = {}
  ): Bitmap {
    const _direction = options.direction ?? 1
    const _align = options.align ?? 1
    const _offsetlist = options.offsetlist ?? null
    if (bitmaplist.length === 0) {
      return newBitmap([])
    }
    let bd, ireal, maxsize, offset, ret: string[], w, xoff
    if (_direction > 0) {
      maxsize = Math.max(...bitmaplist.map((val) => val.height()))
      ret = Array(maxsize).fill('')
      const stroffconcat = (s1: string, s2: string, offset: number): string => {
        if (_direction === 1) {
          return stringOffsetConcat(s1, s2, offset)
        } else {
          // if (_direction === 2)
          return stringOffsetConcat(s2, s1, offset)
        }
      }
      for (let i = 0; i < maxsize; i++) {
        if (_align) {
          ireal = -i - 1
        } else {
          ireal = i
        }
        offset = 0
        const bl = bitmaplist.length
        for (let bi = 0; bi < bl; bi++) {
          const bitmap = bitmaplist[bi]
          if (_offsetlist && bi !== 0) {
            offset = _offsetlist[bi - 1]
          }
          if (i < bitmap.height()) {
            if (ireal >= 0) {
              ret[ireal] = stroffconcat(
                ret[ireal],
                bitmap.bindata[ireal],
                offset
              )
            } else {
              ret[maxsize + ireal] = stroffconcat(
                ret[maxsize + ireal],
                bitmap.bindata[bitmap.height() + ireal],
                offset
              )
            }
          } else {
            if (ireal >= 0) {
              ret[ireal] = stroffconcat(
                ret[ireal],
                '0'.repeat(bitmap.width()),
                offset
              )
            } else {
              ret[maxsize + ireal] = stroffconcat(
                ret[maxsize + ireal],
                '0'.repeat(bitmap.width()),
                offset
              )
            }
          }
        }
      }
    } else {
      maxsize = Math.max(...bitmaplist.map((val) => val.width()))
      ret = []
      offset = 0
      const bl = bitmaplist.length
      for (let bi = 0; bi < bl; bi++) {
        const bitmap = bitmaplist[bi]
        if (_offsetlist && bi !== 0) {
          offset = _offsetlist[bi - 1]
        }
        bd = bitmap.bindata
        w = bitmap.width()
        if (w !== maxsize) {
          if (_align) {
            xoff = 0
          } else {
            xoff = w - maxsize
          }
          bd = cropBitmap(bd, maxsize, bitmap.height(), xoff, 0)
        }
        if (_direction === 0) {
          ret = listofstrOffsetConcat(ret, bd, offset)
        } else {
          // if (_direction === -1)
          ret = listofstrOffsetConcat(bd, ret, offset)
        }
      }
    }
    return new this(ret)
  }

  /**
   * Concatenate another `Bitmap` objects to the current one.
   *
   * @param bitmap - Bitmap to concatenate
   * @param options.direction - Direction
   * @param options.align - Align
   * @param options.offset - Spacing offset between the bitmaps
   *
   * @returns The `Bitmap` object itself, which now has the combined bitmap as its `.bindata`
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#concat}
   */
  concat(
    bitmap: Bitmap,
    options: {
      direction?: DirectionNumberType | null
      align?: 0 | 1 | null
      offset?: number | null
    } = {}
  ): this {
    const { direction, align, offset } = options
    const _offset = offset ?? 0
    this.bindata = concatallBitmaps([this, bitmap], {
      direction,
      align,
      offsetlist: [_offset],
    }).bindata
    return this
  }

  /**
   * Enlarge a `Bitmap` object, by multiplying every pixel in x (right) direction and in y (top) direction.
   *
   * @param x - Multiplier in x (right) direction
   * @param y - Multiplier in y (top) direction
   *
   * @returns The `Bitmap` object itself, which now has the enlarged bitmap as its `.bindata`
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#enlarge}
   */
  enlarge(x?: number, y?: number): this {
    this.bindata = enlargeBindata(this.bindata, x, y)
    return this
  }

  /**
   * Replace a string by another in the bitmap.
   *
   * @param substr - Substring to be replaced
   * @param newsubstr - New substring as the replacement
   *
   * @returns The `Bitmap` object itself, which now has the altered bitmap as its `.bindata`
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#replace}
   */
  replace(substr: string | number, newsubstr: string | number): this {
    const _substr = String(substr)
    const _newsubstr = String(newsubstr)
    this.bindata = this.bindata.map((val) =>
      val.split(_substr).join(_newsubstr)
    )
    return this
  }

  /**
   * Add shadow to the shape in the bitmap.
   *
   * The shadow will be filled by `'2'`s.
   *
   * @param xoff - Shadow's offset in x (right) direction
   * @param yoff - Shadow's offset in y (top) direction
   *
   * @returns The `Bitmap` object itself, which now has a bitmap of the original shape with its shadow as the `Bitmap` object's `.bindata`
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#shadow}
   */
  shadow(xoff?: number | null, yoff?: number | null): this {
    const _xoff = xoff ?? 1
    const _yoff = yoff ?? -1
    let resized_xoff, resized_yoff, shadow_xoff, shadow_yoff
    const bitmap_shadow = this.clone()
    const w = this.width() + Math.abs(_xoff)
    const h = this.height() + Math.abs(_yoff)
    bitmap_shadow.bindata = bitmap_shadow.bindata.map((val) =>
      val.replace(/1/g, '2')
    )
    if (_xoff > 0) {
      resized_xoff = 0
      shadow_xoff = -_xoff
    } else {
      resized_xoff = _xoff
      shadow_xoff = 0
    }
    if (_yoff > 0) {
      resized_yoff = 0
      shadow_yoff = -_yoff
    } else {
      resized_yoff = _yoff
      shadow_yoff = 0
    }
    this.crop(w, h, resized_xoff, resized_yoff)
    bitmap_shadow.crop(w, h, shadow_xoff, shadow_yoff)
    bitmap_shadow.overlay(this)
    this.bindata = bitmap_shadow.bindata
    return this
  }

  /**
   * Add glow effect to the shape in the bitmap.
   *
   * The glowing area is one pixel up, right, bottom and left to the original pixels (corners will not be filled in default mode 0 but will in mode 1), and will be filled by `'2'`s.
   *
   * @param mode - Mode
   *
   * @returns The `Bitmap` object itself, which now has a bitmap of the original shape with glow effect as the `Bitmap` object's `.bindata`
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#glow}
   */
  glow(mode?: 0 | 1 | null): this {
    const _mode = mode ?? 0
    this.crop(this.width() + 2, this.height() + 2, -1, -1)
    const b = this.todata(2)
    const bl = b.length
    for (let i_line = 0; i_line < bl; i_line++) {
      const line = b[i_line]
      const ll = line.length
      for (let i_pixel = 0; i_pixel < ll; i_pixel++) {
        if (line[i_pixel] === 1) {
          b[i_line][i_pixel - 1] ||= 2
          b[i_line][i_pixel + 1] ||= 2
          b[i_line - 1][i_pixel] ||= 2
          b[i_line + 1][i_pixel] ||= 2
          if (_mode === 1) {
            b[i_line - 1][i_pixel - 1] ||= 2
            b[i_line - 1][i_pixel + 1] ||= 2
            b[i_line + 1][i_pixel - 1] ||= 2
            b[i_line + 1][i_pixel + 1] ||= 2
          }
        }
      }
    }
    this.bindata = b.map((l) => l.join(''))
    return this
  }

  /**
   * Pad each line (row) to multiple of 8 (or other numbers) bits/pixels, with `'0'`s.
   *
   * Do this before using the bitmap for a glyph in a BDF font.
   *
   * @param bits - Each line should be padded to multiple of how many bits/pixels
   *
   * @returns The `Bitmap` object itself, which now has the altered bitmap as its `.bindata`
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#bytepad}
   */
  bytepad(bits?: number | null): this {
    const _bits = bits ?? 8
    const w = this.width()
    const h = this.height()
    const mod = w % _bits
    if (mod === 0) {
      return this
    }
    return this.crop(w + _bits - mod, h)
  }

  /**
   * Get the bitmap's data in the specified type and format.
   *
   * @param datatype - Output data type
   *
   * @returns Bitmap data in the specified type (list or string) and format
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#todata}
   */
  todata<T extends 0 | 1 | 2 | 3 | 4 | 5 | null>(
    datatype?: T
  ): TodataFuncRetType<T> {
    const _datatype = datatype ?? 1
    let ret: unknown
    const checkBinary = (s: string): void => {
      if (!/^[01]*$/.test(s)) {
        throw new Error(`Invalid binary string: ${s}`)
      }
    }
    switch (_datatype) {
      case 0:
        ret = this.bindata.join('\n')
        break
      case 1:
        ret = this.bindata
        break
      case 2:
        ret = this.bindata.map((l) => l.split('').map((s) => parseInt(s, 10)))
        break
      case 3:
        ret = ([] as number[]).concat(...this.todata(2))
        break
      case 4: {
        // if there are '2's, it will throw error
        const ndigits = Math.ceil(this.width() / 4)
        ret = this.bindata.map((s) => {
          checkBinary(s)
          return s === ''
            ? ''
            : BigInt('0b' + s)
                .toString(16)
                .padStart(ndigits, '0')
        })
        break
      }
      case 5:
        // if there are '2's, it will throw error
        ret = this.bindata.map((s) => {
          checkBinary(s)
          return s === '' ? 0 : parseInt(s, 2)
        })
        break
    }
    return ret as TodataFuncRetType<T>
  }

  private __checkxy(x: number, y: number): void {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      y < 0 ||
      y >= this.height() ||
      x < 0 ||
      x >= this.width()
    ) {
      throw new RangeError(
        `Pixel (${x}, ${y}) is out of range of the ${this.width()}x${this.height()} bitmap`
      )
    }
  }

  /**
   * Get the value (0, 1 or 2) of the pixel at `(x, y)` (top-left origin, y down).
   *
   * @param x - Column (0 = left)
   * @param y - Row (0 = top)
   *
   * @returns Pixel value
   *
   * @throws RangeError if out of range
   */
  getpixel(x: number, y: number): number {
    this.__checkxy(x, y)
    return parseInt(this.bindata[y][x], 10)
  }

  /**
   * Set the pixel at `(x, y)` (top-left origin, y down).
   *
   * @param x - Column (0 = left)
   * @param y - Row (0 = top)
   * @param value - 0, 1 (default) or 2
   *
   * @returns The `Bitmap` object itself
   *
   * @throws RangeError if out of range or `value` is not 0, 1 or 2
   */
  setpixel(x: number, y: number, value: 0 | 1 | 2 = 1): this {
    if (value !== 0 && value !== 1 && value !== 2) {
      throw new RangeError(
        `Pixel value must be 0, 1 or 2, not ${String(value)}`
      )
    }
    this.__checkxy(x, y)
    const row = this.bindata[y]
    this.bindata = [...this.bindata]
    this.bindata[y] = row.slice(0, x) + String(value) + row.slice(x + 1)
    return this
  }

  /**
   * Mirror the bitmap left ↔ right.
   *
   * @returns The `Bitmap` object itself
   */
  fliph(): this {
    this.bindata = this.bindata.map((row) => row.split('').reverse().join(''))
    return this
  }

  /**
   * Mirror the bitmap top ↔ bottom.
   *
   * @returns The `Bitmap` object itself
   */
  flipv(): this {
    this.bindata = [...this.bindata].reverse()
    return this
  }

  /**
   * Rotate the bitmap clockwise.
   *
   * @param angle - Angle in degrees, a multiple of 90 (negative = counter-clockwise), default 90
   *
   * @returns The `Bitmap` object itself
   *
   * @throws Error if `angle` is not a multiple of 90
   */
  rotate(angle = 90): this {
    if (!Number.isInteger(angle) || angle % 90 !== 0) {
      throw new Error(
        `Rotation angle must be a multiple of 90, not ${String(angle)}`
      )
    }
    const turns = (((angle / 90) % 4) + 4) % 4
    for (let t = 0; t < turns; t++) {
      const src = this.bindata
      const h = src.length
      const w = this.width()
      const out: string[] = []
      for (let c = 0; c < w; c++) {
        let row = ''
        for (let r = h - 1; r >= 0; r--) {
          row += src[r][c]
        }
        out.push(row)
      }
      this.bindata = out
    }
    return this
  }

  /**
   * Invert the bitmap: `'0'` becomes `'1'`, every other pixel becomes `'0'`.
   *
   * @returns The `Bitmap` object itself
   */
  invert(): this {
    this.bindata = this.bindata.map((row) =>
      row.replace(/./g, (p) => (p === '0' ? '1' : '0'))
    )
    return this
  }

  /**
   * Move the content by `dx` pixels to the right and `dy` pixels up, keeping
   * the size; vacated pixels become `'0'`.
   *
   * @param dx - Pixels to the right
   * @param dy - Pixels up
   *
   * @returns The `Bitmap` object itself
   */
  shift(dx = 0, dy = 0): this {
    return this.crop(this.width(), this.height(), -dx, -dy)
  }

  /**
   * Ink bounding box `[w, h, xoff, yoff]` in `crop()` convention (offsets from
   * the bottom-left), so `bitmap.crop(...bitmap.bbox())` trims the bitmap.
   * `[0, 0, 0, 0]` if there is no ink.
   *
   * @returns Bounding box
   */
  bbox(): [number, number, number, number] {
    const rows: number[] = []
    this.bindata.forEach((row, i) => {
      if (/[^0]/.test(row)) {
        rows.push(i)
      }
    })
    if (rows.length === 0) {
      return [0, 0, 0, 0]
    }
    let left = Infinity
    let right = -Infinity
    for (const i of rows) {
      const row = this.bindata[i]
      left = Math.min(left, row.search(/[^0]/))
      right = Math.max(right, row.replace(/0+$/, '').length)
    }
    const top = rows[0]
    const bottom = rows[rows.length - 1]
    return [right - left, bottom - top + 1, left, this.height() - 1 - bottom]
  }

  /**
   * Remove empty rows and columns on all four sides (`crop(...bbox())`). A
   * bitmap without ink becomes empty (`bindata` is `[]`).
   *
   * @returns The `Bitmap` object itself
   */
  trim(): this {
    const bb = this.bbox()
    if (bb[0] === 0) {
      this.bindata = []
      return this
    }
    return this.crop(...bb)
  }

  /**
   * Embolden: the width grows by `n` and the result is the overlay of the
   * bitmap shifted right by 0 … `n` pixels.
   *
   * @param n - Pixels, default 1
   *
   * @returns The `Bitmap` object itself
   */
  bold(n = 1): this {
    if (n < 0) {
      throw new RangeError('n must not be negative')
    }
    this.bindata = this.bindata.map((row) => {
      const cur = (row + '0'.repeat(n)).split('')
      for (let k = 1; k <= n; k++) {
        for (let x = k; x < cur.length; x++) {
          const b = x - k < row.length ? row[x - k] : '0'
          if (b !== '0') {
            cur[x] = b
          }
        }
      }
      return cur.join('')
    })
    return this
  }

  /**
   * Slant the bitmap: the row at index `r` counted from the bottom (0 = bottom
   * row) is shifted right by `floor((r - base) / step)` pixels; the bitmap is
   * widened as needed.
   *
   * @param step - Rows per one pixel of shift (positive), default 2
   * @param base - Row (from the bottom) that is not shifted, default 0
   *
   * @returns The `Bitmap` object itself
   */
  italic(step = 2, base = 0): this {
    if (!(step > 0)) {
      throw new RangeError('step must be a positive integer')
    }
    const h = this.height()
    if (h === 0) {
      return this
    }
    const w = this.width()
    const shifts = Array.from({ length: h }, (_, r) =>
      Math.floor((r - base) / step)
    )
    const lo = Math.min(...shifts)
    const hi = Math.max(...shifts)
    const nw = w + hi - lo
    this.bindata = this.bindata.map((row, i) => {
      const s = shifts[h - 1 - i] - lo
      return '0'.repeat(s) + row + '0'.repeat(nw - s - w)
    })
    return this
  }

  /**
   * Draw `bitmap` over this one with its top-left corner at `(x, y)` (top-left
   * origin, y down). Pixels outside are clipped; non-`'0'` source pixels win.
   * The size is unchanged.
   *
   * @param bitmap - Bitmap to paste
   * @param x - Column of its top-left corner
   * @param y - Row of its top-left corner
   *
   * @returns The `Bitmap` object itself
   */
  paste(bitmap: Bitmap, x = 0, y = 0): this {
    const w = this.width()
    const out = [...this.bindata]
    bitmap.bindata.forEach((srow, j) => {
      const ty = y + j
      if (ty < 0 || ty >= out.length) {
        return
      }
      const row = out[ty].split('')
      for (let i = 0; i < srow.length; i++) {
        const tx = x + i
        if (tx >= 0 && tx < w && srow[i] !== '0') {
          row[tx] = srow[i]
        }
      }
      out[ty] = row.join('')
    })
    this.bindata = out
    return this
  }

  /**
   * Draw the bitmap to an HTML canvas (or any object with `fillStyle` and
   * `fillRect`), one `fillRect(x + col * pixelsize, y + row * pixelsize,
   * pixelsize, pixelsize)` per non-transparent pixel.
   *
   * @param context - Canvas 2D context (`canvas.getContext('2d')`)
   * @param options.x - x of the bitmap's top-left corner, default 0
   * @param options.y - y of the bitmap's top-left corner, default 0
   * @param options.pixelsize - size of one pixel, default 1
   * @param options.pixelcolors - `{'0': color | null, '1': ..., '2': ...}`, default `{'0': null, '1': 'black', '2': 'red'}`
   *
   * Backward compatible with the v2 signature
   * `draw2canvas(context, pixelcolors?, xoff?, yoff?)`: if the 2nd argument
   * has any of the keys `'0'`, `'1'`, `'2'`, it is treated as `pixelcolors`.
   *
   * @returns The `Bitmap` object itself
   *
   * @example
   * bitmap.draw2canvas(ctx, { x: 10, y: 20, pixelsize: 4, pixelcolors: { '1': '#f00' } })
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#draw2canvas}
   */
  draw2canvas(
    context: CanvasContext,
    options?: Draw2CanvasOptions | PixelColors | null,
    xoff?: number,
    yoff?: number
  ): this {
    let opts: Draw2CanvasOptions
    if (
      options !== null &&
      options !== undefined &&
      ('0' in options || '1' in options || '2' in options)
    ) {
      opts = { pixelcolors: options as PixelColors, x: xoff, y: yoff }
    } else {
      opts = (options as Draw2CanvasOptions | null | undefined) ?? {
        x: xoff,
        y: yoff,
      }
    }
    const colors = opts.pixelcolors ?? DEFAULT_PIXELCOLORS
    const x0 = opts.x ?? 0
    const y0 = opts.y ?? 0
    const ps = opts.pixelsize ?? 1
    let current: unknown = undefined
    this.bindata.forEach((line, row) => {
      for (let col = 0; col < line.length; col++) {
        const s = line[col]
        if (s === '0' || s === '1' || s === '2') {
          const color = colors[s]
          if (color !== null && color !== undefined) {
            if (color !== current) {
              context.fillStyle = color
              current = color
            }
            context.fillRect(x0 + col * ps, y0 + row * ps, ps, ps)
          }
        }
      }
    })
    return this
  }

  /**
   * Convert the bitmap to SVG.
   *
   * - `'path'`: a complete `<svg>` with one `<path>` (all square pixels merged
   *   into one outline, holes included);
   * - `'pathOnly'`: only the path data (`d` attribute);
   * - `'rect'`: a complete `<svg>` with one `<rect>` per greedy rectangle
   *   (square only).
   *
   * @param pixelsize - Nominal pixel size in the SVG, default 1
   * @param format - `'path'` (default), `'pathOnly'` or `'rect'`
   * @param inverted - y-up coordinates (for SVG fonts), default `false`
   * @param offsets - Offsets `{x, y}` added to every coordinate, default `{x: 0, y: 0}`
   * @param shape - `'square'` (default) or `'circle'` (round dots)
   *
   * @returns SVG string (or path data, depending on `format`)
   */
  tosvg(
    pixelsize = 1,
    format: SvgFormat = 'path',
    inverted = false,
    offsets: { x?: number; y?: number } = {},
    shape: SvgShape = 'square'
  ): string {
    if (format !== 'path' && format !== 'pathOnly' && format !== 'rect') {
      throw new Error(`Unknown SVG format ${JSON.stringify(format)}`)
    }
    if (shape !== 'square' && shape !== 'circle') {
      throw new Error(`Unknown shape ${JSON.stringify(shape)}`)
    }
    const xoff = offsets.x ?? 0
    const yoff = offsets.y ?? 0
    const bindata = this.bindata
    const h = this.height()
    const w = this.width()
    const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${fmtnum(
      w * pixelsize
    )}" height="${fmtnum(h * pixelsize)}">`

    if (format === 'rect') {
      if (shape !== 'square') {
        throw new Error("format 'rect' only supports shape 'square'")
      }
      return head + this.__svgrects(pixelsize, inverted, xoff, yoff) + '</svg>'
    }

    const parts: string[] = []
    if (shape === 'circle') {
      const r = pixelsize / 2
      const arc = `a${fmtnum(r)} ${fmtnum(r)} 0 1 0 `
      for (let rb = 0; rb < h; rb++) {
        const row = bindata[h - 1 - rb]
        for (let c = 0; c < w; c++) {
          if (row[c] === '0') {
            continue
          }
          const cx = (c + 0.5) * pixelsize + xoff
          const cy = (inverted ? rb + 0.5 : h - rb - 0.5) * pixelsize + yoff
          parts.push(
            `M${fmtnum(cx - r)} ${fmtnum(cy)}${arc}${fmtnum(
              2 * r
            )} 0${arc}${fmtnum(-2 * r)} 0Z`
          )
        }
      }
    } else if (h > 0 && w > 0) {
      for (const contour of bitmapContours(bindata, {
        shape: 'square',
        dotsize: 1,
        ppu: 1,
      })) {
        const pts = contour.map(([x, y]) => [
          x * pixelsize + xoff,
          (inverted ? y : h - y) * pixelsize + yoff,
        ])
        let seg = `M${fmtnum(pts[0][0])} ${fmtnum(pts[0][1])}`
        let prevY = pts[0][1]
        for (let i = 1; i < pts.length; i++) {
          const [px, py] = pts[i]
          seg += py === prevY ? `H${fmtnum(px)}` : `V${fmtnum(py)}`
          prevY = py
        }
        parts.push(seg + 'Z')
      }
    }
    const d = parts.join('')
    if (format === 'pathOnly') {
      return d
    }
    if (d === '') {
      return head + '</svg>'
    }
    return `${head}<path d="${d}" fill="#000000" /></svg>`
  }

  private __svgrects(
    pixelsize: number,
    inverted: boolean,
    xoff: number,
    yoff: number
  ): string {
    const bitmap = this.bindata
    const height = this.height()
    const width = this.width()
    const visited = Array.from({ length: height }, () =>
      Array<boolean>(width).fill(false)
    )
    const svgHeight = height * pixelsize
    let out = ''
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (visited[y][x]) {
          continue
        }
        const v = bitmap[y][x]
        let mw = 1
        while (
          x + mw < width &&
          bitmap[y][x + mw] === v &&
          !visited[y][x + mw]
        ) {
          mw++
        }
        let mh = 1
        outer: while (y + mh < height) {
          for (let dx = 0; dx < mw; dx++) {
            if (bitmap[y + mh][x + dx] !== v || visited[y + mh][x + dx]) {
              break outer
            }
          }
          mh++
        }
        for (let dy = 0; dy < mh; dy++) {
          for (let dx = 0; dx < mw; dx++) {
            visited[y + dy][x + dx] = true
          }
        }
        if (v !== '0') {
          const rx = x * pixelsize + xoff
          const ry =
            (inverted
              ? svgHeight - y * pixelsize - mh * pixelsize
              : y * pixelsize) + yoff
          out += `<rect x="${fmtnum(rx)}" y="${fmtnum(ry)}" width="${fmtnum(
            mw * pixelsize
          )}" height="${fmtnum(mh * pixelsize)}" fill="#000000" />`
        }
      }
    }
    return out
  }
}

/** `new Bitmap(bindata)` (outside the class body, see the helpers above) */
const newBitmap = (bindata: string[]): Bitmap => new Bitmap(bindata)

/** `Bitmap.concatall` (outside the class body, see the helpers above) */
const concatallBitmaps: typeof Bitmap.concatall = (bitmaplist, options) =>
  Bitmap.concatall(bitmaplist, options)
