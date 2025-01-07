import { Bitmap } from './Bitmap'
import {
  DIRE_MAP,
  DIRE_SHORTCUT_MAP,
  EMPTY_GLYPH,
  META_TITLES,
  PATTERN_VVECTOR_DELIMITER,
} from './constants'
import { Glyph } from './Glyph'
import {
  CodepointRangeType,
  DirectionNumberType,
  DirectionPartType,
  DirectionType,
  GlyphMeta,
  GlyphMetaInFont,
  GlyphMetaInFontTemp,
  GlyphMetaTemp,
  BdfHeadersTemp,
  OrderType,
  Props,
  BdfHeaders,
} from './types'
import { setProperty } from './utils'

/**
 * `Font` object
 *
 * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font}
 */
export class Font {
  public headers: BdfHeaders | undefined = undefined
  private __headers: BdfHeadersTemp = {}
  public props: Props = {}
  public glyphs: Map<number, GlyphMetaInFont> = new Map()
  private __glyph_count_to_check: number | null = null
  private __curline_startchar: string | null = null
  private __curline_chars: string | null = null
  private __f?: AsyncIterableIterator<string>

  /**
   * Load the BDF font file (file line async iterator).
   *
   * @param filelines - Asynchronous iterable iterator containing each line in string text from the font file
   *
   * @returns The current `Font` object
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#load_filelines}
   */
  async load_filelines(
    filelines: AsyncIterableIterator<string>
  ): Promise<this> {
    try {
      this.__f = filelines
      await this.__parse_headers()
    } finally {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (typeof Deno !== 'undefined') {
        // Deno needs to run to the end and close the file
        if (this.__f !== undefined) {
          for await (const _ of this.__f) {
          }
        }
      }
    }
    return this
  }

  private async __parse_headers(): Promise<void> {
    while (1) {
      let line: string = (await this.__f?.next())?.value.trim()
      while (line.length === 0) {
        line = (await this.__f?.next())?.value.trim()
      }
      const kvlist = line.split(/ (.+)/, 2)
      const l = kvlist.length
      let nlist: string[]
      if (l === 2) {
        const key = kvlist[0]
        const value = kvlist[1].trim()
        switch (key) {
          case 'STARTFONT':
            this.__headers['bdfversion'] = parseFloat(value)
            break
          case 'FONT':
            this.__headers['fontname'] = value
            break
          case 'SIZE':
            nlist = value.split(' ')
            this.__headers['pointsize'] = parseInt(nlist[0], 10)
            this.__headers['xres'] = parseInt(nlist[1], 10)
            this.__headers['yres'] = parseInt(nlist[2], 10)
            break
          case 'FONTBOUNDINGBOX':
            nlist = value.split(' ')
            this.__headers['fbbx'] = parseInt(nlist[0], 10)
            this.__headers['fbby'] = parseInt(nlist[1], 10)
            this.__headers['fbbxoff'] = parseInt(nlist[2], 10)
            this.__headers['fbbyoff'] = parseInt(nlist[3], 10)
            break
          case 'STARTPROPERTIES':
            this.__parse_headers_after()
            await this.__parse_props()
            return
          case 'COMMENT':
            if (
              !('comment' in this.__headers) ||
              !Array.isArray(this.__headers.comment)
            ) {
              this.__headers.comment = []
            }
            this.__headers.comment.push(
              value.replace(/^[\s"'\t\r\n]+|[\s"'\t\r\n]+$/g, '')
            )
            break
          case 'SWIDTH':
            nlist = value.split(' ')
            this.__headers['swx0'] = parseInt(nlist[0], 10)
            this.__headers['swy0'] = parseInt(nlist[1], 10)
            break
          case 'DWIDTH':
            nlist = value.split(' ')
            this.__headers['dwx0'] = parseInt(nlist[0], 10)
            this.__headers['dwy0'] = parseInt(nlist[1], 10)
            break
          case 'SWIDTH1':
            nlist = value.split(' ')
            this.__headers['swx1'] = parseInt(nlist[0], 10)
            this.__headers['swy1'] = parseInt(nlist[1], 10)
            break
          case 'DWIDTH1':
            nlist = value.split(' ')
            this.__headers['dwx1'] = parseInt(nlist[0], 10)
            this.__headers['dwy1'] = parseInt(nlist[1], 10)
            break
          case 'VVECTOR':
            nlist = PATTERN_VVECTOR_DELIMITER.split(value)
            this.__headers['vvectorx'] = parseInt(nlist[0], 10)
            this.__headers['vvectory'] = parseInt(nlist[1], 10)
            break
          case 'METRICSSET':
          case 'CONTENTVERSION':
            this.__headers[<'metricsset' | 'contentversion'>key.toLowerCase()] =
              parseInt(value, 10)
            break
          case 'CHARS':
            console.warn(
              "It looks like the font does not have property block beginning with 'STARTPROPERTIES' keyword"
            )
            this.__parse_headers_after()
            this.__curline_chars = line
            await this.__parse_glyph_count()
            return
          case 'STARTCHAR':
            console.warn(
              "It looks like the font does not have property block beginning with 'STARTPROPERTIES' keyword"
            )
            console.warn("Cannot find 'CHARS' line")
            this.__parse_headers_after()
            this.__curline_startchar = line
            await this.__prepare_glyphs()
            return
        }
      }
      if (l === 1 && kvlist[0].trim() === 'ENDFONT') {
        console.warn(
          "It looks like the font does not have property block beginning with 'STARTPROPERTIES' keyword"
        )
        console.warn('This font does not have any glyphs')
        return
      }
    }
  }

  private __parse_headers_after(): void {
    if (!('metricsset' in this.__headers)) {
      this.__headers['metricsset'] = 0
    }
    this.headers = this.__headers as BdfHeaders
  }

  private async __parse_props(): Promise<void> {
    while (1) {
      let line: string = (await this.__f?.next())?.value.trim()
      while (line.length === 0) {
        line = (await this.__f?.next())?.value.trim()
      }
      const kvlist = line.split(/ (.+)/, 2)
      const l = kvlist.length
      if (l === 2) {
        const key = kvlist[0]
        const value = kvlist[1].replace(/^[\s"'\t\r\n]+|[\s"'\t\r\n]+$/g, '')
        if (key === 'COMMENT') {
          if (
            !('comment' in this.props) ||
            !Array.isArray(this.props.comment)
          ) {
            this.props.comment = []
          }
          this.props.comment.push(
            value.replace(/^[\s"'\t\r\n]+|[\s"'\t\r\n]+$/g, '')
          )
        } else {
          this.props[key.toLowerCase()] = value
        }
      } else {
        if (l === 1) {
          const key = kvlist[0].trim()
          if (key === 'ENDPROPERTIES') {
            await this.__parse_glyph_count()
            return
          }
          if (key === 'ENDFONT') {
            console.warn('This font does not have any glyphs')
            return
          } else {
            this.props[key] = null
          }
        }
      }
    }
  }

  private async __parse_glyph_count(): Promise<void> {
    let line: string
    if (this.__curline_chars === null) {
      line = (await this.__f?.next())?.value.trim()
      while (line.length === 0) {
        line = (await this.__f?.next())?.value.trim()
      }
    } else {
      line = this.__curline_chars
      this.__curline_chars = null
    }
    if (line.trim() === 'ENDFONT') {
      console.warn('This font does not have any glyphs')
      return
    }
    const kvlist = line.split(/ (.+)/, 2)
    if (kvlist[0] === 'CHARS') {
      this.__glyph_count_to_check = parseInt(kvlist[1].trim(), 10)
    } else {
      this.__curline_startchar = line
      console.warn("Cannot find 'CHARS' line next to 'ENDPROPERTIES' line")
    }
    await this.__prepare_glyphs()
  }

  private async __prepare_glyphs(): Promise<void> {
    let glyph_codepoint = 0
    // Array(17).fill(null) 's tuple representation
    // prettier-ignore
    let glyph_meta: GlyphMetaInFontTemp = [
      null, null, null, null, null, null, null, null, null, null,
      null, null, null, null, null, null, null,
    ] // TODO: remove initial value
    let glyph_bitmap: string[] = [] // TODO: remove initial value
    let glyph_bitmap_is_on = false
    let glyph_end = false
    while (1) {
      let line: string
      if (this.__curline_startchar === null) {
        line = (await this.__f?.next())?.value
      } else {
        line = this.__curline_startchar
        this.__curline_startchar = null
      }
      if (line === undefined || line === null) {
        console.warn("This font does not have 'ENDFONT' keyword")
        this.__prepare_glyphs_after()
        return
      }
      const kvlist = line.split(/ (.+)/, 2)
      const l = kvlist.length
      if (l === 2) {
        const key = kvlist[0]
        const value = kvlist[1].trim()
        let nlist: string[]
        switch (key) {
          case 'STARTCHAR':
            // Array(17).fill(null) 's tuple representation
            // prettier-ignore
            glyph_meta = [
              null, null, null, null, null, null, null, null, null, null,
              null, null, null, null, null, null, null,
            ]
            glyph_meta[0] = value
            glyph_end = false
            break
          case 'ENCODING':
            glyph_codepoint = parseInt(value, 10)
            glyph_meta[1] = glyph_codepoint
            break
          case 'BBX':
            nlist = value.split(' ')
            glyph_meta[2] = parseInt(nlist[0], 10)
            glyph_meta[3] = parseInt(nlist[1], 10)
            glyph_meta[4] = parseInt(nlist[2], 10)
            glyph_meta[5] = parseInt(nlist[3], 10)
            break
          case 'SWIDTH':
            nlist = value.split(' ')
            glyph_meta[6] = parseInt(nlist[0], 10)
            glyph_meta[7] = parseInt(nlist[1], 10)
            break
          case 'DWIDTH':
            nlist = value.split(' ')
            glyph_meta[8] = parseInt(nlist[0], 10)
            glyph_meta[9] = parseInt(nlist[1], 10)
            break
          case 'SWIDTH1':
            nlist = value.split(' ')
            glyph_meta[10] = parseInt(nlist[0], 10)
            glyph_meta[11] = parseInt(nlist[1], 10)
            break
          case 'DWIDTH1':
            nlist = value.split(' ')
            glyph_meta[12] = parseInt(nlist[0], 10)
            glyph_meta[13] = parseInt(nlist[1], 10)
            break
          case 'VVECTOR':
            nlist = PATTERN_VVECTOR_DELIMITER.split(value)
            glyph_meta[14] = parseInt(nlist[0], 10)
            glyph_meta[15] = parseInt(nlist[1], 10)
            break
        }
      } else {
        if (l === 1) {
          const key = kvlist[0].trim()
          switch (key) {
            case 'BITMAP':
              glyph_bitmap = []
              glyph_bitmap_is_on = true
              break
            case 'ENDCHAR':
              glyph_bitmap_is_on = false
              glyph_meta[16] = glyph_bitmap
              this.glyphs.set(glyph_codepoint, glyph_meta as GlyphMetaInFont)
              glyph_end = true
              break
            case 'ENDFONT':
              if (glyph_end) {
                this.__prepare_glyphs_after()
                return
              }
            default:
              if (glyph_bitmap_is_on) {
                glyph_bitmap.push(key)
              }
              break
          }
        }
      }
    }
  }

  private __prepare_glyphs_after(): void {
    const l = this.glyphs.size
    if (this.__glyph_count_to_check !== l) {
      if (this.__glyph_count_to_check === null) {
        console.warn("The glyph count next to 'CHARS' keyword does not exist")
      } else {
        console.warn(
          `The glyph count next to 'CHARS' keyword is ${this.__glyph_count_to_check.toString()}, which does not match the actual glyph count ${l.toString()}`
        )
      }
    }
  }

  /**
   * Same as `.length()`
   * Returns how many glyphs actually exist in the font.
   *
   * @returns Actual glyph count in the font
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#length}
   */
  get length(): number {
    return this.glyphs.size
  }

  /**
   * Similar to `.iterglyphs()`, except it returns an `array` of glyph codepoints instead of an `iterator` of `Glyph` objects.
   *
   * @param order  - Order
   * @param r  - Codepoint range
   *
   * @returns An iterator of the codepoints of glyphs
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#itercps}
   */
  itercps(
    order?: OrderType | null,
    r?: number | [number, number] | [number, number][] | null
  ): number[] {
    const _order = order ?? 1
    const _r = r ?? null
    let ret: number[]
    const ks = [...this.glyphs.keys()]
    switch (_order) {
      case 1:
        ret = ks.sort((a: number, b: number): number => a - b)
        break
      case 0:
        ret = ks
        break
      case 2:
        ret = ks.sort((a: number, b: number): number => b - a)
        break
      case -1:
        ret = ks.reverse()
        break
    }
    if (_r !== null) {
      const f = (cp: number): boolean => {
        if (typeof _r === 'number') {
          return cp < _r
        } else if (
          Array.isArray(_r) &&
          _r.length === 2 &&
          typeof _r[0] === 'number' &&
          typeof _r[1] === 'number'
        ) {
          return cp <= _r[1] && cp >= _r[0]
        } else {
          if (Array.isArray(_r) && Array.isArray(_r[0])) {
            for (const t of _r) {
              const [t0, t1] = t as [number, number]
              if (cp <= t1 && cp >= t0) {
                return true
              }
            }
          }
          return false
        }
      }
      ret = ret.filter(f)
    }
    return ret
  }

  /**
   * Returns an iterator of all the glyphs (as `Glyph` objects) in the font (default) or in the specified codepoint range in the font, sorted by the specified order (or by the ascending codepoint order by default).
   *
   * @param order  - Order
   * @param r  - Codepoint range
   *
   * @returns An iterator of glyphs as `Glyph` objects. Missing glyphs are replaced by `null`
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#iterglyphs}
   */
  *iterglyphs(
    order?: OrderType | null,
    r?: CodepointRangeType | null
  ): IterableIterator<Glyph | null> {
    for (const cp of this.itercps(order, r)) {
      yield this.glyphbycp(cp)
    }
  }

  /**
   * Get a glyph (as Glyph Object) by its codepoint.
   *
   * @param codepoint - Codepoint
   *
   * @returns `Glyph` object, or `null` if the glyph does not exist in the font
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#glyphbycp}
   */
  glyphbycp(codepoint: number): Glyph | null {
    const b = this.glyphs.get(codepoint)

    if (b === undefined || b === null) {
      console.warn(
        `Glyph "${String.fromCodePoint(
          codepoint
        )}" (codepoint ${codepoint.toString()}) does not exist in the font. Will return 'null'`
      )
      return null
    } else {
      const d: GlyphMetaTemp = {}
      META_TITLES.forEach((val, i) => {
        setProperty(d, val, b[i])
      })
      return new Glyph(d as GlyphMeta, this)
    }
  }

  /**
   * Get a glyph (as `Glyph` object) by its character.
   *
   * @param character - Character
   *
   * @returns `Glyph` object, or `null` if the glyph does not exist in the font
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#glyph}
   */
  glyph(character: string): Glyph | null {
    const ret = character.codePointAt(0)
    return ret === undefined ? null : this.glyphbycp(ret)
  }

  /**
   * Check if there is any missing glyph and gets these glyphs' character.
   *
   * @param str - string to check
   *
   * @returns List of missing glyph(s)' characters, or `null` if all the glyphs in your string exist in the font
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#lacksglyphs}
   */
  lacksglyphs(str: string): null | string[] {
    const l: string[] = []
    const len = str.length
    for (let c, i = 0; i < len; i++) {
      c = str[i]
      const cp = c.codePointAt(0)
      if (cp === undefined || !this.glyphs.has(cp)) {
        l.push(c)
      }
    }
    return l.length !== 0 ? l : null
  }

  /**
   * Draw the glyphs of the specified codepoints, to a `Bitmap` object.
   *
   * @param cps - Array of codepoints to draw
   * @param options.linelimit - Maximum pixels per line
   * @param options.mode - Mode
   * @param options.direction - Writing direction
   * @param options.usecurrentglyphspacing - Use current glyph spacing
   * @param options.missing - Missing glyph replacement
   *
   * @returns `Bitmap` object
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#drawcps}
   */
  drawcps(
    cps: number[],
    options: {
      linelimit?: number | null
      mode?: 0 | 1 | null
      direction?: DirectionType | null
      usecurrentglyphspacing?: boolean | null
      missing?: Glyph | GlyphMeta | null
    } = {}
  ): Bitmap {
    const _linelimit = options.linelimit ?? 512
    const _mode = options.mode ?? 1
    const _direction = options.direction ?? 'lrtb'
    const _usecurrentglyphspacing = options.usecurrentglyphspacing ?? false
    const _missing = options.missing ?? null
    if (this.headers === undefined) {
      throw new Error('Font is not loaded')
    }
    let align_glyph: 0 | 1,
      align_line: 0 | 1 | undefined = undefined,
      bitmap: Bitmap | undefined = undefined,
      bitmaplist: Bitmap[],
      cp: number | undefined = undefined,
      dire_glyph: DirectionNumberType,
      dire_line: DirectionNumberType,
      fbbsize: number | undefined = undefined,
      glyph: Glyph | undefined = undefined,
      interglyph: number | undefined | null,
      interglyph_global: number | undefined | null,
      interglyph_str: 'dwx0' | 'dwx1' | undefined = undefined,
      interglyph_str2: 'dwy0' | 'dwy1' | undefined = undefined,
      offset: number | undefined = undefined,
      offsetlist: number[],
      size: number,
      skip: boolean,
      w: number | undefined = undefined
    const dire = DIRE_SHORTCUT_MAP[_direction] ?? _direction
    const dire_glyph_str = dire.slice(0, 2) as DirectionPartType
    const dire_line_str = dire.slice(2, 4) as DirectionPartType
    if (dire_glyph_str in DIRE_MAP && dire_line_str in DIRE_MAP) {
      dire_glyph = DIRE_MAP[dire_glyph_str]
      dire_line = DIRE_MAP[dire_line_str]
    } else {
      dire_glyph = 1
      dire_line = 0
    }
    if (dire_line === 0 || dire_line === 2) {
      align_glyph = 1
    } else {
      if (dire_line === 1 || dire_line === -1) {
        align_glyph = 0
      }
    }
    if (dire_glyph === 1 || dire_glyph === -1) {
      align_line = 1
    } else {
      if (dire_glyph === 2 || dire_glyph === 0) {
        align_line = 0
      }
    }
    if (_mode === 1) {
      fbbsize = dire_glyph > 0 ? this.headers['fbbx'] : this.headers['fbby']
      if (dire_glyph > 0) {
        interglyph_str = 'dwx0'
        interglyph_str2 = 'dwy0'
      } else {
        interglyph_str = 'dwx1'
        interglyph_str2 = 'dwy1'
      }
      if (interglyph_str in this.headers) {
        interglyph_global = this.headers[interglyph_str]
      } else {
        if (interglyph_str2 in this.headers) {
          interglyph_global = this.headers[interglyph_str2]
        } else {
          interglyph_global = null
        }
      }
    }
    const list_of_bitmaplist: Bitmap[][] = []
    bitmaplist = []
    const list_of_offsetlist: number[][] = []
    offsetlist = []
    size = 0
    const append_bitmaplist_and_offsetlist = () => {
      list_of_bitmaplist.push(bitmaplist)
      if (_usecurrentglyphspacing) {
        offsetlist.shift()
      } else {
        offsetlist.pop()
      }
      list_of_offsetlist.push(offsetlist)
    }
    const cpsiter = cps[Symbol.iterator]()
    skip = false
    while (1) {
      if (skip) {
        skip = false
      } else {
        cp = cpsiter.next()?.value
        if (cp === undefined) {
          break
        }
        const glyphTemp = this.glyphbycp(cp)
        if (glyphTemp !== null) {
          glyph = glyphTemp
        } else {
          if (_missing) {
            if (_missing instanceof Glyph) {
              glyph = _missing
            } else {
              glyph = new Glyph(_missing, this)
            }
          } else {
            glyph = new Glyph(EMPTY_GLYPH, this)
          }
        }
        bitmap = glyph.draw()
        w = bitmap.width()
        offset = 0
        if (
          _mode === 1 &&
          interglyph_str !== undefined &&
          interglyph_str2 !== undefined
        ) {
          interglyph = glyph.meta[interglyph_str] || glyph.meta[interglyph_str2]
          if (interglyph === undefined || interglyph === null) {
            interglyph = interglyph_global
          }
          if (
            interglyph !== undefined &&
            interglyph !== null &&
            fbbsize !== undefined
          ) {
            offset = interglyph - fbbsize
          }
        }
      }
      if (
        w !== undefined &&
        offset !== undefined &&
        bitmap !== undefined &&
        glyph !== undefined &&
        cp !== undefined
      ) {
        size += w + offset
        if (size <= _linelimit) {
          bitmaplist.push(bitmap)
          offsetlist.push(offset)
        } else {
          if (bitmaplist.length === 0) {
            throw new Error(
              `\`_linelimit\` (${_linelimit}) is too small the line can't even contain one glyph: "${glyph.chr()}" (codepoint ${cp}, width: ${w})`
            )
          }
          append_bitmaplist_and_offsetlist()
          size = 0
          bitmaplist = []
          offsetlist = []
          skip = true
        }
      }
    }
    if (bitmaplist.length !== 0) {
      append_bitmaplist_and_offsetlist()
    }

    const list_of_bitmap_line_lists = list_of_bitmaplist.map((bitmaplist, i) =>
      Bitmap.concatall(bitmaplist, {
        direction: dire_glyph,
        align: align_glyph,
        offsetlist: list_of_offsetlist[i],
      })
    )

    return Bitmap.concatall(list_of_bitmap_line_lists, {
      direction: dire_line,
      align: align_line,
    })
  }

  /**
   * Draw (render) the glyphs of the specified words / setences / paragraphs (as a `string`), to a `Bitmap` object.
   *
   * @param str - String to draw
   * @param options.linelimit - Maximum pixels per line
   * @param options.mode - Mode
   * @param options.direction - Writing direction
   * @param options.usecurrentglyphspacing - Use current glyph spacing
   * @param options.missing - Missing glyph replacement
   *
   * @returns `Bitmap` object
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#draw}
   */
  draw(
    str: string,
    options: {
      linelimit?: number | null
      mode?: 0 | 1 | null
      direction?: DirectionType | null
      usecurrentglyphspacing?: boolean | null
      missing?: Glyph | GlyphMeta | null
    } = {}
  ): Bitmap {
    const { linelimit, mode, direction, usecurrentglyphspacing, missing } =
      options
    return this.drawcps(
      str.split('').map((c) => {
        const cp = c.codePointAt(0)
        if (cp === undefined) {
          return 8203
        } else {
          return cp
        }
      }),
      {
        linelimit,
        mode,
        direction,
        usecurrentglyphspacing,
        missing,
      }
    )
  }

  /**
   * Draw all the glyphs in the font (default) or in the specified codepoint range in the font, sorted by the specified order (or by the ascending codepoint order by default), to a `Bitmap` object.
   *
   * @param options.order - Order
   * @param options.r - Codepoint range
   * @param options.linelimit - Maximum pixels per line
   * @param options.mode - Mode
   * @param options.direction - Writing direction
   * @param options.usecurrentglyphspacing - Use current glyph spacing
   *
   * @returns `Bitmap` object
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#drawall}
   */
  drawall(
    options: {
      order?: OrderType
      r?: CodepointRangeType
      linelimit?: number | null
      mode?: 0 | 1 | null
      direction?: DirectionType | null
      usecurrentglyphspacing?: boolean | null
    } = {}
  ): Bitmap {
    const { order, r, linelimit, mode, direction, usecurrentglyphspacing } =
      options
    const _mode = mode ?? 0
    return this.drawcps(this.itercps(order, r), {
      linelimit,
      mode: _mode,
      direction,
      usecurrentglyphspacing,
    })
  }
}
