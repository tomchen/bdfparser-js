import { Bitmap } from './Bitmap'
import { Font } from './Font'
import { GlyphDrawModeType, GlyphMeta } from './types'

/**
 * Default glyph name for a codepoint: `uniXXXX` / `uXXXXX` (Unicode) or `char{cp}`.
 */
export const defaultglyphname = (
  cp: number,
  charsetIsUnicode = true
): string => {
  if (!charsetIsUnicode) {
    return `char${cp}`
  }
  const hex = cp.toString(16).toUpperCase()
  return cp <= 0xffff ? `uni${hex.padStart(4, '0')}` : `u${hex.padStart(5, '0')}`
}

/**
 * `Glyph` object
 *
 * @see online docs: {@link https://font.tomchen.org/bdfparser_js/glyph}
 */
export class Glyph {
  public meta: GlyphMeta
  public font: Font

  /**
   * `Glyph` object constructor
   *
   * @param meta_obj - Meta information
   * @param font - The font the glyph belongs to
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/glyph}
   */
  constructor(meta_obj: GlyphMeta, font: Font) {
    this.meta = meta_obj
    this.font = font
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
      this.font.headers?.fontname +
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
   * Get the character of the glyph.
   *
   * @returns Character (one character string) of the glyph
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/glyph#chr}
   */
  chr(): string {
    return this.font.cp2char(this.cp())
  }

  /**
   * Draw the glyph to a `Bitmap` object.
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
    const _bb = bb ?? null
    let retbitmap
    switch (_mode) {
      case 0:
        retbitmap = this.__draw_fbb()
        break
      case 1:
        retbitmap = this.__draw_bb()
        break
      case 2:
        retbitmap = this.__draw_original()
        break
      case -1:
        if (_bb !== null) {
          retbitmap = this.__draw_user_specified(_bb)
        } else {
          throw new Error(
            'Parameter bb in draw() method must be set when mode=-1'
          )
        }
        break
    }
    return retbitmap
  }

  private __draw_user_specified(fbb: [number, number, number, number]): Bitmap {
    const bbxoff = this.meta['bbxoff']
    const bbyoff = this.meta['bbyoff']
    const [fbbx, fbby, fbbxoff, fbbyoff] = fbb
    const bitmap = this.__draw_bb()
    return bitmap.crop(fbbx, fbby, -bbxoff + fbbxoff, -bbyoff + fbbyoff)
  }

  private __draw_original(): Bitmap {
    return new Bitmap(
      this.meta['hexdata'].map((val) =>
        val
          ? parseInt(val, 16)
              .toString(2)
              .padStart(val.length * 4, '0')
          : ''
      )
    )
  }

  private __draw_bb(): Bitmap {
    const bbw = this.meta['bbw']
    const bbh = this.meta['bbh']
    const bitmap = this.__draw_original()
    const bindata = bitmap.bindata
    const l = bindata.length
    if (l !== bbh) {
      console.warn(
        `Glyph "${this.meta['glyphname'].toString()}" (codepoint ${this.meta[
          'codepoint'
        ].toString()})'s bbh, ${bbh.toString()}, does not match its hexdata line count, ${l.toString()}`
      )
    }
    bitmap.bindata = bindata.map((val) => val.slice(0, bbw))
    return bitmap
  }

  private __draw_fbb(): Bitmap {
    const fh = this.font.headers
    if (fh === undefined) {
      throw new Error('Font is not loaded')
    }
    return this.__draw_user_specified([
      fh['fbbx'],
      fh['fbby'],
      fh['fbbxoff'],
      fh['fbbyoff'],
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
      case 0:
        const fh = this.font.headers
        if (fh === undefined) {
          throw new Error('Font is not loaded')
        }
        ret = [fh['fbbxoff'], fh['fbbyoff']]
        break
      case 1:
        ret = [bbxoff, bbyoff]
        break
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
    }
    return _fromorigin ? ret : [0 - ret[0], 0 - ret[1]]
  }

  /**
   * Change bitmap of the glyph
   *
   * @param bitmap - Bitmap object to change to
   *
   * @returns The `Glyph` object itself
   */
  changebitmap(bitmap: Bitmap): Glyph {
    this.meta['hexdata'] = bitmap.todata(4)
    return this
  }
}
