import { DirectionNumberType, TodataFuncRetType } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CanvasContext = { fillStyle: any; fillRect: any } // Can't use CanvasRenderingContext2D in Deno for now

/**
 * `Bitmap` object
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
   * Get the width of the bitmap.
   *
   * @returns Width of the bitmap
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#width}
   */
  width(): number {
    return this.bindata[0].length
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
    return new Bitmap([...this.bindata])
  }

  private static __crop_string(
    s: string,
    start: number,
    length: number
  ): string {
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

  private static __string_offset_concat(
    s1: string,
    s2: string,
    offset?: number | null
  ): string {
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
    const news1 = Bitmap.__crop_string(s1, finalstart, finalend - finalstart)
    const news2 = Bitmap.__crop_string(
      s2,
      finalstart - s2start,
      finalend - finalstart
    )
    return news1
      .split('')
      .map((val, i) => (parseInt(news2[i], 10) || parseInt(val, 10)).toString())
      .join('')
  }

  private static __listofstr_offset_concat(
    list1: string[],
    list2: string[],
    offset?: number | null
  ): string[] {
    const _offset = offset ?? 0
    let s1: string, s2: string
    if (_offset === 0) {
      return list1.concat(list2)
    }
    const width = list1[0].length
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
      retlist.push(
        s1
          .split('')
          .map((val, i) =>
            (parseInt(s2[i], 10) || parseInt(val, 10)).toString()
          )
          .join('')
      )
    }
    return retlist
  }

  private static __crop_bitmap(
    bitmap: string[],
    w: number,
    h: number,
    xoff: number,
    yoff: number
  ): string[] {
    let bn
    const retlist = []
    const l = bitmap.length
    for (let n = 0; n < h; n++) {
      bn = l - yoff - h + n
      if (bn < 0 || bn >= l) {
        retlist.push('0'.repeat(w))
      } else {
        retlist.push(Bitmap.__crop_string(bitmap[bn], xoff, w))
      }
    }
    return retlist
  }

  /**
   * Crop and/or extend the bitmap.
   *
   * @param w - Width
   * @param h - Height
   * @param xoff - X offset
   * @param yoff - Y offset
   *
   * @returns The `Bitmap` object itself, which now has only the specified area as its `.bindata`
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#crop}
   */
  crop(w: number, h: number, xoff?: number | null, yoff?: number | null): this {
    const _xoff = xoff ?? 0
    const _yoff = yoff ?? 0
    this.bindata = Bitmap.__crop_bitmap(this.bindata, w, h, _xoff, _yoff)
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
      console.warn('the bitmaps to overlay have different height')
    }
    if (bindata_a[0].length !== bindata_b[0].length) {
      console.warn('the bitmaps to overlay have different width')
    }
    this.bindata = bindata_a.map((val, li) => {
      const la = val
      const lb = bindata_b[li]
      return la
        .split('')
        .map((val, i) => (parseInt(lb[i], 10) || parseInt(val, 10)).toString())
        .join('')
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
    let bd, ireal, maxsize, offset, ret: string[], w, xoff
    if (_direction > 0) {
      maxsize = Math.max(...bitmaplist.map((val) => val.height()))
      ret = Array(maxsize).fill('')
      const stroffconcat = (s1: string, s2: string, offset: number): string => {
        if (_direction === 1) {
          return Bitmap.__string_offset_concat(s1, s2, offset)
        } else {
          // if (_direction === 2)
          return Bitmap.__string_offset_concat(s2, s1, offset)
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
          bd = this.__crop_bitmap(bd, maxsize, bitmap.height(), xoff, 0)
        }
        if (_direction === 0) {
          ret = Bitmap.__listofstr_offset_concat(ret, bd, offset)
        } else {
          // if (_direction === -1)
          ret = Bitmap.__listofstr_offset_concat(bd, ret, offset)
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
    this.bindata = Bitmap.concatall([this, bitmap], {
      direction,
      align,
      offsetlist: [_offset],
    }).bindata
    return this
  }

  private static __enlarge_bindata(
    bindata: string[],
    x?: number | null,
    y?: number | null
  ): string[] {
    const _x = x ?? 1
    const _y = y ?? 1
    let ret = [...bindata]

    if (_x > 1) {
      ret = ret.map((v) =>
        v
          .split('')
          .reduce((acc: string[], cur: string): string[] => {
            return acc.concat(Array(_x).fill(cur))
          }, [])
          .join('')
      )
    }
    if (_y > 1) {
      ret = ret.reduce((acc: string[], cur: string): string[] => {
        return acc.concat(Array(_y).fill(cur))
      }, [])
    }
    return ret
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
    this.bindata = Bitmap.__enlarge_bindata(this.bindata, x, y)
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
    const _substr = typeof substr === 'number' ? substr.toString() : substr
    const _newsubstr =
      typeof newsubstr === 'number' ? newsubstr.toString() : newsubstr

    const replaceAll = (
      str: string,
      substr: string,
      newsubstr: string
    ): string => {
      if ('replaceAll' in String.prototype) {
        return (
          str as string & {
            replaceAll: (...args: string[]) => string
          }
        ).replaceAll(substr, newsubstr)
      } else {
        const escapeRegExp = (s: string): string =>
          s.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&')
        return str.replace(new RegExp(escapeRegExp(substr), 'g'), newsubstr)
      }
    }
    this.bindata = this.bindata.map((val) =>
      replaceAll(val, _substr, _newsubstr)
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
    let h, resized_xoff, resized_yoff, shadow_xoff, shadow_yoff, w
    const bitmap_shadow = this.clone()
    w = this.width()
    h = this.height()
    w += Math.abs(_xoff)
    h += Math.abs(_yoff)
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
    let line, pixel, w, h
    w = this.width()
    h = this.height()
    w += 2
    h += 2
    this.crop(w, h, -1, -1)
    const b = this.todata(2)
    const bl = b.length
    for (let i_line = 0; i_line < bl; i_line++) {
      line = b[i_line]
      const ll = line.length
      for (let i_pixel = 0; i_pixel < ll; i_pixel++) {
        pixel = line[i_pixel]
        if (pixel === 1) {
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
    this.bindata = b.map((l) => l.map((val) => val.toString()).join(''))
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
      case 4:
        // if there are '2's, it will throw error
        ret = this.bindata.map((s) => {
          if (!/^[01]+$/.test(s)) {
            throw new Error(`Invalid binary string: ${s}`)
          }
          return parseInt(s, 2)
            .toString(16)
            .padStart(Math.floor((-1 * this.width()) / 4) * -1, '0')
        })
        break
      case 5:
        // if there are '2's, it will throw error
        ret = this.bindata.map((s) => {
          if (!/^[01]+$/.test(s)) {
            throw new Error(`Invalid binary string: ${s}`)
          }
          return parseInt(s, 2)
        })
        break
    }
    return ret as TodataFuncRetType<T>
  }

  /**
   * Draw the bitmap to HTML canvas
   *
   * @param context - Canvas 2D context (`canvas.getContext("2d")`)
   * @param pixelcolors - Object mapping `'0'`/`'1'`/`'2'` in the bitmap data to color
   * @param xoff - X position of top left corner of bitmap, default is 0
   * @param yoff - Y position of top left corner of bitmap, default is 0
   * @param
   *
   * @returns The `Bitmap` object itself
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#draw2canvas}
   */
  draw2canvas(
    context: CanvasContext,
    pixelcolors?: Record<'0' | '1' | '2', string | null> | null,
    xoff = 0,
    yoff = 0
  ): this {
    const _pixelcolors = pixelcolors ?? {
      '0': null,
      '1': 'black',
      '2': 'red',
    }
    const _x = xoff ?? 0
    const _y = yoff ?? 0
    this.todata(2).forEach((line, y) => {
      line.forEach((pixel, x) => {
        const s = pixel.toString()
        if (s === '0' || s === '1' || s === '2') {
          const color = _pixelcolors[s]
          if (color !== null && color !== undefined) {
            context.fillStyle = color
            context.fillRect(_x + x, _y + y, 1, 1)
          }
        }
      })
    })
    return this
  }

  /**
   * Convert bitmap to SVG string
   *
   * Converts bitmap to an SVG string without smoothing the path, vectorizing it while maintaining a pixelated effect
   *
   * @param pixelSize - Nominal pixel size in the SVG, default to 1
   * @param format - Format of the SVG string, could be:
   * - 'rect' (SVG is made of `<rect>` elements),
   * - 'path' (SVG is made of a single `<path>` element),
   * - 'pathOnly' (only return the path data)
   * @param inverted - Invert the SVG (upside down) (needed in SVG font), default to false
   * @param offsets - Offsets (to the right (x) top (y)) to apply to SVG paths, default to `{ x: 0, y: 0 }`
   *
   * @returns SVG string (or path data, depending on `format`)
   */
  tosvg = (
    pixelSize = 1,
    format: 'rect' | 'path' | 'pathOnly' = 'path',
    inverted = false,
    offsets: { x?: number; y?: number } = { x: 0, y: 0 }
  ): string => {
    const bitmap = this.bindata
    if (!bitmap || bitmap.length === 0 || bitmap[0].length === 0) {
      return ''
    }

    const xOffset = offsets.x ?? 0
    const yOffset = offsets.y ?? 0

    const height = bitmap.length
    const width = bitmap[0].length
    const rects = []

    const visited = Array(height)
      .fill(null)
      .map(() => Array(width).fill(false))

    const colorMap: { [key: string]: string } = {
      '1': '#000000',
      '0': '#FFFFFF',
    }

    const svgWidth = width * pixelSize
    const svgHeight = height * pixelSize

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!visited[y][x]) {
          const currentColor = colorMap[bitmap[y][x]]

          let maxWidth = 1
          while (
            x + maxWidth < width &&
            bitmap[y][x + maxWidth] === bitmap[y][x] &&
            !visited[y][x + maxWidth]
          ) {
            maxWidth++
          }

          let maxHeight = 1
          outer: while (y + maxHeight < height) {
            for (let dx = 0; dx < maxWidth; dx++) {
              if (
                bitmap[y + maxHeight][x + dx] !== bitmap[y][x] ||
                visited[y + maxHeight][x + dx]
              ) {
                break outer
              }
            }
            maxHeight++
          }

          for (let dy = 0; dy < maxHeight; dy++) {
            for (let dx = 0; dx < maxWidth; dx++) {
              visited[y + dy][x + dx] = true
            }
          }

          if (currentColor !== '#FFFFFF') {
            rects.push({
              x: x * pixelSize + xOffset,
              y:
                (inverted
                  ? svgHeight - y * pixelSize - maxHeight * pixelSize
                  : y * pixelSize) + yOffset,
              width: maxWidth * pixelSize,
              height: maxHeight * pixelSize,
              color: currentColor,
            })
          }
        }
      }
    }

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">`

    if (format === 'rect') {
      svg += rects
        .map((rect) => {
          return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${rect.color}" />`
        })
        .join('')
    } else {
      const path = rects
        .map((rect) => {
          return `M${rect.x},${rect.y} L${rect.x + rect.width},${rect.y} L${
            rect.x + rect.width
          },${rect.y + rect.height} L${rect.x},${rect.y + rect.height} Z`
        })
        .join(' ')
      if (format === 'pathOnly') {
        return path
      } else {
        svg += `<path d="${path}" fill="${colorMap[1]}" />`
      }
    }
    svg += `</svg>`
    return svg
  }
}
