export type Headers = {
  bdfversion: number
  fontname: string
  pointsize: number
  xres: number
  yres: number
  fbbx: number
  fbby: number
  fbbxoff: number
  fbbyoff: number
  swx0?: number
  swy0?: number
  dwx0?: number
  dwy0?: number
  swx1?: number
  swy1?: number
  dwx1?: number
  dwy1?: number
  vvectorx?: number
  vvectory?: number
  metricsset?: number
  contentversion?: number
  comment?: string[]
}
type HeadersTemp = Partial<Headers>

export type Props = Record<string, string | null> & { comment?: string[] }

export type GlyphMetaInFont = [
  string, // glyphname
  number, // codepoint
  number, // bbw
  number, // bbh
  number, // bbxoff
  number, // bbyoff
  number | null, // swx0
  number | null, // swy0
  number | null, // dwx0
  number | null, // dwy0
  number | null, // swx1
  number | null, // swy1
  number | null, // dwx1
  number | null, // dwy1
  number | null, // vvectorx
  number | null, // vvectory
  string[] // hexdata
]

type GlyphMetaInFontTemp = [
  string | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  string[] | null
]

export type GlyphMeta = {
  glyphname: GlyphMetaInFont[0]
  codepoint: GlyphMetaInFont[1]
  bbw: GlyphMetaInFont[2]
  bbh: GlyphMetaInFont[3]
  bbxoff: GlyphMetaInFont[4]
  bbyoff: GlyphMetaInFont[5]
  swx0: GlyphMetaInFont[6]
  swy0: GlyphMetaInFont[7]
  dwx0: GlyphMetaInFont[8]
  dwy0: GlyphMetaInFont[9]
  swx1: GlyphMetaInFont[10]
  swy1: GlyphMetaInFont[11]
  dwx1: GlyphMetaInFont[12]
  dwy1: GlyphMetaInFont[13]
  vvectorx: GlyphMetaInFont[14]
  vvectory: GlyphMetaInFont[15]
  hexdata: GlyphMetaInFont[16]
}
type GlyphMetaTemp = Partial<GlyphMeta>

export type TodataFuncRetType<T> = T extends undefined
  ? string[]
  : T extends 0
  ? string
  : T extends 1
  ? string[]
  : T extends 2
  ? number[][]
  : T extends 3
  ? number[]
  : T extends 4
  ? string[]
  : T extends 5
  ? number[]
  : never

export type CodepointRangeType = number | [number, number] | [number, number][]
export type OrderType = -1 | 0 | 1 | 2
export type GlyphDrawModeType = -1 | 0 | 1 | 2

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CanvasContext = { fillStyle: any; fillRect: any } // Can't use CanvasRenderingContext2D in Deno for now

const setProperty = <O extends Record<PropertyKey, unknown>, K extends keyof O>(
  obj: O,
  key: K,
  value: O[K]
): void => {
  obj[key] = value
}

const PATTERN_VVECTOR_DELIMITER = '[\\s]+'

const EMPTY_GLYPH: GlyphMeta = {
  glyphname: 'empty',
  codepoint: 8203,
  bbw: 0,
  bbh: 0,
  bbxoff: 0,
  bbyoff: 0,
  swx0: 0,
  swy0: 0,
  dwx0: 0,
  dwy0: 0,
  swx1: 0,
  swy1: 0,
  dwx1: 0,
  dwy1: 0,
  vvectorx: 0,
  vvectory: 0,
  hexdata: [] as string[],
} as const

const META_TITLES = [
  'glyphname',
  'codepoint',
  'bbw',
  'bbh',
  'bbxoff',
  'bbyoff',
  'swx0',
  'swy0',
  'dwx0',
  'dwy0',
  'swx1',
  'swy1',
  'dwx1',
  'dwy1',
  'vvectorx',
  'vvectory',
  'hexdata',
] as const

const DIRE_SHORTCUT_MAP = {
  lr: 'lrtb',
  rl: 'rltb',
  tb: 'tbrl',
  bt: 'btrl',
  lrtb: undefined,
  lrbt: undefined,
  rltb: undefined,
  rlbt: undefined,
  tbrl: undefined,
  tblr: undefined,
  btrl: undefined,
  btlr: undefined,
} as const

const DIRE_MAP = { lr: 1, rl: 2, tb: 0, bt: -1 } as const

export type DirectionType = keyof typeof DIRE_SHORTCUT_MAP
type DirectionPartType = keyof typeof DIRE_MAP
export type DirectionNumberType = typeof DIRE_MAP[keyof typeof DIRE_MAP]

/**
 * `Font` object
 *
 * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font}
 */
export class Font {
  public headers: Headers | undefined = undefined
  private __headers: HeadersTemp = {}
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
      const line: string = (await this.__f?.next())?.value
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
            this.__headers[
              <'metricsset' | 'contentversion'>key.toLowerCase()
            ] = parseInt(value, 10)
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
    this.headers = this.__headers as Headers
  }

  private async __parse_props(): Promise<void> {
    while (1) {
      const line: string = (await this.__f?.next())?.value
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
      line = (await this.__f?.next())?.value
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
    const {
      linelimit,
      mode,
      direction,
      usecurrentglyphspacing,
      missing,
    } = options
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
    const {
      order,
      r,
      linelimit,
      mode,
      direction,
      usecurrentglyphspacing,
    } = options
    const _mode = mode ?? 0
    return this.drawcps(this.itercps(order, r), {
      linelimit,
      mode: _mode,
      direction,
      usecurrentglyphspacing,
    })
  }
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
    return String.fromCodePoint(this.cp())
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
}

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
   * @param options.offsetlist - List of spacing offsets between every two glyphs
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
   * @param options.offset - Spacing offset between the glyphs
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
        return (str as string & {
          replaceAll: (...args: string[]) => string
        }).replaceAll(substr, newsubstr)
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
   *
   * @returns The `Bitmap` object itself
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/bitmap#draw2canvas}
   */
  draw2canvas(
    context: CanvasContext,
    pixelcolors?: Record<'0' | '1' | '2', string | null> | null
  ): this {
    const _pixelcolors = pixelcolors ?? {
      '0': null,
      '1': 'black',
      '2': 'red',
    }
    this.todata(2).forEach((line, y) => {
      line.forEach((pixel, x) => {
        const s = pixel.toString()
        if (s === '0' || s === '1' || s === '2') {
          const color = _pixelcolors[s]
          if (color !== null && color !== undefined) {
            context.fillStyle = color
            context.fillRect(x, y, 1, 1)
          }
        }
      })
    })
    return this
  }
}

/**
 * Shortcut for `new Font().load_filelines(filelines)` so you don't need to write `new` and `.load_filelines`
 *
 * @param filelines - Asynchronous iterator containing each line in string text from the font file
 *
 * @returns The newly instantiated `Font` object that's loaded the font file
 */
export const $Font = async (
  filelines: AsyncIterableIterator<string>
): Promise<Font> => {
  return await new Font().load_filelines(filelines)
}

/**
 * Shortcut for `new Glyph(meta_obj, font)` so you don't need to write `new`
 *
 * @param meta_obj - Meta information
 * @param font - The font the glyph belongs to
 *
 * @returns The newly instantiated `Glyph` object
 */
export const $Glyph = (meta_obj: GlyphMeta, font: Font): Glyph => {
  return new Glyph(meta_obj, font)
}

/**
 * Shortcut for `new Bitmap(bin_bitmap_list)` so you don't need to write `new`
 *
 * @param bin_bitmap_list - Binary bitmap data
 *
 * @returns The newly instantiated `Bitmap` object
 */
export const $Bitmap = (bin_bitmap_list: string[]): Bitmap => {
  return new Bitmap(bin_bitmap_list)
}
