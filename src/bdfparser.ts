type Headers = {
  bdfversion?: number
  fontname?: string
  pointsize?: number
  xres?: number
  yres?: number
  fbbx?: number
  fbby?: number
  fbbxoff?: number
  fbbyoff?: number
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
type Props = Record<string, string | null> & { comment?: string[] }

type GlyphMeta = {
  glyphname?: string | null
  codepoint?: number
  bbw?: number | null
  bbh?: number | null
  bbxoff?: number | null
  bbyoff?: number | null
  swx0?: number | null
  swy0?: number | null
  dwx0?: number | null
  dwy0?: number | null
  swx1?: number | null
  swy1?: number | null
  dwx1?: number | null
  dwy1?: number | null
  vvectorx?: number | null
  vvectory?: number | null
  hexdata?: string[]
}

type GlyphMetaInFont =
  | [
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
  | null

const __PATTERN_VVECTOR_DELIMITER = '[\\s]+'
// prettier-ignore
const __META_TITLES: [
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
  ] = [
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
  ]
const __EMPTY_GLYPH = {
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
}

export class Font {
  /*
    `Font` Object

    https://font.tomchen.org/bdfparser_py/font
    */
  public headers: Headers = {}
  public props: Props = {}
  public glyphs: Map<number, GlyphMetaInFont> = new Map()
  private __glyph_count_to_check: number | null = null
  private __curline_startchar: string | null = null
  private __curline_chars: string | null = null
  private __f?: AsyncIterator<string>

  async load_filelines(filelines: AsyncIterator<string>): Promise<this> {
    /*
        Load the BDF font file line async iterator.
        */
    this.__f = filelines
    await this.__parse_headers()
    return this
  }

  async __parse_headers(): Promise<void> {
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
            this.headers['bdfversion'] = parseFloat(value)
            break
          case 'FONT':
            this.headers['fontname'] = value
            break
          case 'SIZE':
            nlist = value.split(' ')
            this.headers['pointsize'] = parseInt(nlist[0], 10)
            this.headers['xres'] = parseInt(nlist[1], 10)
            this.headers['yres'] = parseInt(nlist[2], 10)
            break
          case 'FONTBOUNDINGBOX':
            nlist = value.split(' ')
            this.headers['fbbx'] = parseInt(nlist[0], 10)
            this.headers['fbby'] = parseInt(nlist[1], 10)
            this.headers['fbbxoff'] = parseInt(nlist[2], 10)
            this.headers['fbbyoff'] = parseInt(nlist[3], 10)
            break
          case 'STARTPROPERTIES':
            this.__parse_headers_after()
            await this.__parse_props()
            return
          case 'COMMENT':
            if (
              !('comment' in this.headers) ||
              !Array.isArray(this.headers.comment)
            ) {
              this.headers.comment = []
            }
            this.headers.comment.push(
              value.replace(/^[\s"'\t\r\n]+|[\s"'\t\r\n]+$/g, '')
            )
            break
          case 'SWIDTH':
            nlist = value.split(' ')
            this.headers['swx0'] = parseInt(nlist[0], 10)
            this.headers['swy0'] = parseInt(nlist[1], 10)
            break
          case 'DWIDTH':
            nlist = value.split(' ')
            this.headers['dwx0'] = parseInt(nlist[0], 10)
            this.headers['dwy0'] = parseInt(nlist[1], 10)
            break
          case 'SWIDTH1':
            nlist = value.split(' ')
            this.headers['swx1'] = parseInt(nlist[0], 10)
            this.headers['swy1'] = parseInt(nlist[1], 10)
            break
          case 'DWIDTH1':
            nlist = value.split(' ')
            this.headers['dwx1'] = parseInt(nlist[0], 10)
            this.headers['dwy1'] = parseInt(nlist[1], 10)
            break
          case 'VVECTOR':
            nlist = __PATTERN_VVECTOR_DELIMITER.split(value)
            this.headers['vvectorx'] = parseInt(nlist[0], 10)
            this.headers['vvectory'] = parseInt(nlist[1], 10)
            break
          case 'METRICSSET':
          case 'CONTENTVERSION':
            this.headers[
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

  __parse_headers_after(): void {
    if (!('metricsset' in this.headers)) {
      this.headers['metricsset'] = 0
    }
  }

  async __parse_props(): Promise<void> {
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

  async __parse_glyph_count(): Promise<void> {
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

  async __prepare_glyphs(): Promise<void> {
    let glyph_codepoint = 0
    // Array(17).fill(null) 's tuple representation
    // prettier-ignore
    let glyph_meta: GlyphMetaInFont = [
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
            nlist = __PATTERN_VVECTOR_DELIMITER.split(value)
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
              this.glyphs.set(glyph_codepoint, glyph_meta)
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

  __prepare_glyphs_after(): void {
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

  get length(): number {
    /*
        Same as `.length()`
        Returns how many glyphs actually exist in the font.

        https://font.tomchen.org/bdfparser_py/font#length
        */
    return this.glyphs.size
  }

  itercps(
    order?: -1 | 0 | 1 | 2 | null,
    r?: number | [number, number] | [number, number][] | null
  ): number[] {
    /*
        Almost identical to `.iterglyphs()`, except it returns an `iterator` of glyph codepoints instead of an `iterator` of `Glyph` Objects.

        https://font.tomchen.org/bdfparser_py/font#itercps
        */
    order = order ?? 1
    r = r ?? null
    let ret: number[]
    const ks = [...this.glyphs.keys()]
    switch (order) {
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
    if (r !== null) {
      const f = (cp: number): boolean => {
        if (typeof r === 'number') {
          return cp < r
        } else if (
          Array.isArray(r) &&
          r.length === 2 &&
          typeof r[0] === 'number' &&
          typeof r[1] === 'number'
        ) {
          return cp <= r[1] && cp >= r[0]
        } else {
          if (Array.isArray(r) && Array.isArray(r[0])) {
            for (const t of r) {
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

  *iterglyphs(
    order?: -1 | 0 | 1 | 2 | null,
    r?: number | [number, number] | [number, number][] | null
  ): Iterator<Glyph | null> {
    /*
        Returns an iterator of all the glyphs (as `Glyph` Objects) in the font (default) or in the specified codepoint range in the font, sorted by the specified order (or by the ascending codepoint order by default).

        https://font.tomchen.org/bdfparser_py/font#iterglyphs
        */
    // order = order ?? 1
    // r = r ?? null
    for (const cp of this.itercps(order, r)) {
      yield this.glyphbycp(cp)
    }
  }

  glyphbycp(codepoint: number): Glyph | null {
    /*
        Get a glyph (as Glyph Object) by its codepoint.

        https://font.tomchen.org/bdfparser_py/font#glyphbycp
        */
    const b = this.glyphs.get(codepoint)

    if (b === undefined || b === null) {
      console.warn(
        `Glyph "${String.fromCodePoint(
          codepoint
        )}" (codepoint ${codepoint.toString()}) does not exist in the font. Will return 'null'`
      )
      return null
    } else {
      const d: GlyphMeta = {}
      const a = __META_TITLES
      a.forEach((val, i) => {
        const aa = b[i]
        d[val] = aa
      })
      return new Glyph(d, this)
    }
  }

  glyph(character: string): Glyph | null {
    /*
        Get a glyph (as `Glyph` Object) by its character.

        https://font.tomchen.org/bdfparser_py/font#glyph
        */
    const ret = character.codePointAt(0)
    return ret === undefined ? null : this.glyphbycp(ret)
  }

  lacksglyphs(str: string): null | string[] {
    /*
        Check if there is any missing glyph and gets these glyphs' character.

        https://font.tomchen.org/bdfparser_py/font#lacksglyphs
        */
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

  drawcps(
    cps: number[] | null,
    linelimit?: number | null,
    mode?: number | null,
    direction?: string | null,
    usecurrentglyphspacing?: boolean | null,
    missing?: Glyph | GlyphMeta | null
  ): Bitmap {
    /*
    Draw the glyphs of the specified codepoints, to a `Bitmap` object.

    https://font.tomchen.org/bdfparser_py/font#drawcps
    */

    linelimit = linelimit ?? 512
    mode = mode ?? 1
    direction = direction ?? 'lrtb'
    usecurrentglyphspacing = usecurrentglyphspacing ?? false
    missing = missing ?? null
    let align_glyph,
      align_line,
      bitmap,
      bitmaplist,
      cp,
      dire_glyph,
      dire_line,
      fbbsize,
      glyph,
      interglyph,
      interglyph_global,
      interglyph_str,
      interglyph_str2,
      offset,
      offsetlist,
      size,
      skip,
      w
    const dire_shortcut_dict = {
      lr: 'lrtb',
      rl: 'rltb',
      tb: 'tbrl',
      bt: 'btrl',
    }
    const dire = dire_shortcut_dict[direction] ?? direction
    const dire_dict = { lr: 1, rl: 2, tb: 0, bt: -1 }
    const dire_glyph_str = dire.slice(0, 2)
    const dire_line_str = dire.slice(2, 4)
    if (dire_glyph_str in dire_dict && dire_line_str in dire_dict) {
      dire_glyph = dire_dict[dire_glyph_str]
      dire_line = dire_dict[dire_line_str]
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
    if (mode === 1) {
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
    const list_of_bitmaplist = []
    bitmaplist = []
    const list_of_offsetlist = []
    offsetlist = []
    size = 0
    const append_bitmaplist_and_offsetlist = () => {
      list_of_bitmaplist.push(bitmaplist)
      if (usecurrentglyphspacing) {
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
        if (this.glyphs.has(cp)) {
          glyph = this.glyphbycp(cp)
        } else {
          if (missing) {
            if (missing instanceof Glyph) {
              glyph = missing
            } else {
              glyph = new Glyph(missing, this)
            }
          } else {
            glyph = new Glyph(__EMPTY_GLYPH, this)
          }
        }
        bitmap = glyph.draw()
        w = bitmap.width()
        offset = 0
        if (mode === 1) {
          interglyph = glyph.meta[interglyph_str] || glyph.meta[interglyph_str2]
          if (interglyph === undefined || interglyph === null) {
            interglyph = interglyph_global
          }
          if (interglyph !== undefined && interglyph !== null) {
            offset = interglyph - fbbsize
          }
        }
      }
      size += w + offset
      if (size <= linelimit) {
        bitmaplist.push(bitmap)
        offsetlist.push(offset)
      } else {
        if (bitmaplist.length === 0) {
          console.warn(
            `\`linelimit\` (${linelimit}) is too small the line can't even contain one glyph: "${glyph.chr()}" (codepoint ${cp}, width: ${w})`
          )
        }
        append_bitmaplist_and_offsetlist()
        size = 0
        bitmaplist = []
        offsetlist = []
        skip = true
      }
    }
    if (bitmaplist.length !== 0) {
      append_bitmaplist_and_offsetlist()
    }

    const list_of_bitmap_line_lists = list_of_bitmaplist.map((bitmaplist, i) =>
      Bitmap.concatall(
        bitmaplist,
        dire_glyph,
        align_glyph,
        list_of_offsetlist[i]
      )
    )

    return Bitmap.concatall(list_of_bitmap_line_lists, dire_line, align_line)
  }

  draw(str, linelimit?, mode?, direction?, usecurrentglyphspacing?, missing?) {
    /*
        Draw (render) the glyphs of the specified words / setences / paragraphs (as a `str`), to a `Bitmap` Object.

        https://font.tomchen.org/bdfparser_py/font#draw
        */
    return this.drawcps(
      str.split('').map((c) => c.codePointAt(0)),
      linelimit,
      mode,
      direction,
      usecurrentglyphspacing,
      missing
    )
  }

  drawall(order?, r?, linelimit?, mode?, direction?, usecurrentglyphspacing?) {
    /*
        Draw all the glyphs in the font (default) or in the specified codepoint range in the font, sorted by the specified order (or by the ascending codepoint order by default), to a `Bitmap` Object.

        https://font.tomchen.org/bdfparser_py/font#drawall
        */
    mode = mode ?? 0
    return this.drawcps(
      this.itercps(order, r),
      linelimit,
      mode,
      direction,
      usecurrentglyphspacing
    )
  }
}

export class Glyph {
  /*
    `Glyph` Object

    https://font.tomchen.org/bdfparser_py/glyph
    */
  public meta: any
  public font: any

  constructor(meta_dict, font) {
    /*
        Initialize a `Glyph` Object. Load a `dict` of meta information and the font the glyph belongs.

        https://font.tomchen.org/bdfparser_py/glyph#glyph
        */
    this.meta = meta_dict
    this.font = font
  }

  toString() {
    /*
        Gets a human-readable (multi-line) `str` representation of the `Glyph` Object.

        https://font.tomchen.org/bdfparser_py/glyph#str-and-print
        */
    return this.draw().toString()
  }

  repr() {
    /*
        Gets a programmer-readable `str` representation of the `Glyph` Object.

        https://font.tomchen.org/bdfparser_py/glyph#repr
        */
    return (
      'Glyph(' +
      JSON.stringify(this.meta, null, 2) +
      ', ' +
      JSON.stringify(this.font, null, 2) +
      ')'
    )
  }

  cp() {
    /*
        Get the codepoint of the glyph.

        https://font.tomchen.org/bdfparser_py/glyph#cp
        */
    return this.meta['codepoint']
  }

  chr() {
    /*
        Get the character of the glyph.

        https://font.tomchen.org/bdfparser_py/glyph#chr
        */
    return String.fromCodePoint(this.cp())
  }

  draw(mode?, bb?) {
    /*
        Draw the glyph to a `Bitmap` Object.

        https://font.tomchen.org/bdfparser_py/glyph#draw
        */
    mode = mode ?? 0
    bb = bb ?? null
    let retbitmap
    switch (mode) {
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
        if (bb !== null) {
          retbitmap = this.__draw_user_specified(bb)
        } else {
          throw new Error(
            'Parameter bb in draw() method must be set when mode=-1'
          )
        }
        break
    }
    return retbitmap
  }

  __draw_user_specified(fbb) {
    const bbxoff = this.meta['bbxoff']
    const bbyoff = this.meta['bbyoff']
    const [fbbx, fbby, fbbxoff, fbbyoff] = fbb
    const bitmap = this.__draw_bb()
    return bitmap.crop(fbbx, fbby, -bbxoff + fbbxoff, -bbyoff + fbbyoff)
  }

  __draw_original() {
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

  __draw_bb() {
    const bbw = this.meta['bbw']
    const bbh = this.meta['bbh']
    const bitmap = this.__draw_original()
    const bindata = bitmap.bindata
    const l = bindata.length
    if (l !== bbh) {
      console.warn(
        `Glyph "${this.meta
          .get('glyphname')
          .toString()}" (codepoint ${this.meta
          .get('codepoint')
          .toString()})'s bbh, ${bbh.toString()}, does not match its hexdata line count, ${l.toString()}`
      )
    }
    bitmap.bindata = bindata.map((val) => val.slice(0, bbw))
    return bitmap
  }

  __draw_fbb() {
    const fh = this.font.headers
    return this.__draw_user_specified([
      fh['fbbx'],
      fh['fbby'],
      fh['fbbxoff'],
      fh['fbbyoff'],
    ])
  }

  origin(mode?, fromorigin?, xoff?, yoff?) {
    /*
        Get the relative position (displacement) of the origin from the left bottom corner of the bitmap drawn by the method `.draw()`, or vice versa.

        https://font.tomchen.org/bdfparser_py/glyph#origin
        */
    mode = mode ?? 0
    fromorigin = fromorigin ?? false
    xoff = xoff ?? null
    yoff = yoff ?? null
    let fh, ret
    const bbxoff = this.meta['bbxoff']
    const bbyoff = this.meta['bbyoff']
    switch (mode) {
      case 0:
        fh = this.font.headers
        ret = [fh['fbbxoff'], fh['fbbyoff']]
        break
      case 1:
        ret = [bbxoff, bbyoff]
        break
      case 2:
        ret = [bbxoff, bbyoff]
        break
      case -1:
        if (xoff !== null && yoff !== null) {
          ret = [xoff, yoff]
        } else {
          throw new Error(
            'Parameter xoff and yoff in origin() method must be all set when mode=-1'
          )
        }
        break
    }
    return fromorigin ? ret : [0 - ret[0], 0 - ret[1]]
  }
}

export class Bitmap {
  /*
    `Bitmap` Object

    https://font.tomchen.org/bdfparser_py/bitmap
    */
  public bindata: string[]

  constructor(bin_bitmap_list) {
    /*
        Initialize a `Bitmap` Object. Load binary bitmap data (`list` of `str`s).

        https://font.tomchen.org/bdfparser_py/bitmap#bitmap
        */
    this.bindata = bin_bitmap_list
  }

  toString() {
    /*
        Gets a human-readable (multi-line) `str` representation of the `Bitmap` Object.

        https://font.tomchen.org/bdfparser_py/bitmap#str-and-print
        */
    return this.bindata
      .join('\n')
      .replace(/0/g, '.')
      .replace(/1/g, '#')
      .replace(/2/g, '&')
  }

  repr() {
    /*
        Gets a programmer-readable (multi-line) `str` representation of the `Bitmap` Object.

        https://font.tomchen.org/bdfparser_py/bitmap#repr
        */
    return `Bitmap(${JSON.stringify(this.bindata, null, 2)})`
  }

  width() {
    /*
        Get the width of the bitmap.

        https://font.tomchen.org/bdfparser_py/bitmap#width
        */
    return this.bindata[0].length
  }

  height() {
    /*
        Get the height of the bitmap.

        https://font.tomchen.org/bdfparser_py/bitmap#height
        */
    return this.bindata.length
  }

  clone() {
    /*
        Get a deep copy / clone of the `Bitmap` Object.

        https://font.tomchen.org/bdfparser_py/bitmap#clone
        */
    return new Bitmap([...this.bindata])
  }

  static __crop_string(s, start, length) {
    let left, stemp
    stemp = s
    const l = s.length
    left = 0
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

  static __string_offset_concat(s1, s2, offset?) {
    offset = offset ?? 0
    if (offset === 0) {
      return s1 + s2
    }
    const len1 = s1.length
    const len2 = s2.length
    const s2start = len1 + offset
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

  static __listofstr_offset_concat(list1, list2, offset?) {
    offset = offset ?? 0
    let s1, s2
    if (offset === 0) {
      return list1.concat(list2)
    }
    const width = list1[0].length
    const len1 = list1.length
    const len2 = list2.length
    const s2start = len1 + offset
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

  static __crop_bitmap(bitmap, w, h, xoff, yoff) {
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

  crop(w, h, xoff?, yoff?) {
    /*
        Crop and/or extend the bitmap.

        https://font.tomchen.org/bdfparser_py/bitmap#crop
        */
    xoff = xoff ?? 0
    yoff = yoff ?? 0
    this.bindata = Bitmap.__crop_bitmap(this.bindata, w, h, xoff, yoff)
    return this
  }

  overlay(bitmap) {
    /*
        Overlay another bitmap over the current one.

        https://font.tomchen.org/bdfparser_py/bitmap#overlay
        */
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

  static concatall(bitmaplist, direction?, align?, offsetlist?) {
    /*
        Concatenate all `Bitmap` Objects in a `list`.

        https://font.tomchen.org/bdfparser_py/bitmap#bitmapconcatall
        */
    direction = direction ?? 1
    align = align ?? 1
    offsetlist = offsetlist ?? null
    let bd, ireal, maxsize, offset, ret: string[], w, xoff
    if (direction > 0) {
      maxsize = Math.max(...bitmaplist.map((val) => val.height()))
      ret = Array(maxsize).fill('')
      const stroffconcat = (s1, s2, offset) => {
        if (direction === 1) {
          return Bitmap.__string_offset_concat(s1, s2, offset)
        } else {
          if (direction === 2) {
            return Bitmap.__string_offset_concat(s2, s1, offset)
          }
        }
      }
      for (let i = 0; i < maxsize; i++) {
        if (align) {
          ireal = -i - 1
        } else {
          ireal = i
        }
        offset = 0
        const bl = bitmaplist.length
        for (let bi = 0; bi < bl; bi++) {
          const bitmap = bitmaplist[bi]
          if (offsetlist && bi !== 0) {
            offset = offsetlist[bi - 1]
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
        if (offsetlist && bi !== 0) {
          offset = offsetlist[bi - 1]
        }
        bd = bitmap.bindata
        w = bitmap.width()
        if (w !== maxsize) {
          if (align) {
            xoff = 0
          } else {
            xoff = w - maxsize
          }
          bd = this.__crop_bitmap(bd, maxsize, bitmap.height(), xoff, 0)
        }
        if (direction === 0) {
          ret = Bitmap.__listofstr_offset_concat(ret, bd, offset)
        } else {
          ret = Bitmap.__listofstr_offset_concat(bd, ret, offset)
        }
      }
    }
    return new this(ret)
  }

  concat(bitmap, direction?, align?, offsetlist?) {
    /*
        Concatenate another `Bitmap` Objects to the current one.

        https://font.tomchen.org/bdfparser_py/bitmap#concat
        */
    this.bindata = Bitmap.concatall(
      [this, bitmap],
      direction,
      align,
      offsetlist
    ).bindata
    return this
  }

  static __enlarge_bindata(bindata, x?, y?) {
    x = x ?? 1
    y = y ?? 1
    let ret = [...bindata]

    if (x > 1) {
      ret = ret.map((v) =>
        v
          .split('')
          .reduce(function (acc, cur) {
            return acc.concat(Array(x).fill(cur))
          }, [])
          .join('')
      )
    }
    if (y > 1) {
      ret = ret.reduce(function (acc, cur) {
        return acc.concat(Array(y).fill(cur))
      }, [])
    }
    return ret
  }

  enlarge(x?, y?) {
    /*
        Enlarge a `Bitmap` Object, by multiplying every pixel in x (right) direction and in y (top) direction.

        https://font.tomchen.org/bdfparser_py/bitmap#enlarge
        */
    this.bindata = Bitmap.__enlarge_bindata(this.bindata, x, y)
    return this
  }

  replace(substr, newsubstr) {
    /*
        Replace a string by another in the bitmap.

        https://font.tomchen.org/bdfparser_py/bitmap#replace
        */
    if (typeof substr === 'number') {
      substr = substr.toString()
    }
    if (typeof newsubstr === 'number') {
      newsubstr = newsubstr.toString()
    }
    const replaceAll = (str, substr, newsubstr) => {
      if ('replaceAll' in String.prototype) {
        return str.replaceAll(substr, newsubstr)
      } else {
        const escapeRegExp = (string) =>
          string.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&')
        return str.replace(new RegExp(escapeRegExp(substr), 'g'), newsubstr)
      }
    }
    this.bindata = this.bindata.map((val) => replaceAll(val, substr, newsubstr))
    return this
  }

  shadow(xoff?, yoff?) {
    /*
        Add shadow to the shape in the bitmap.

        The shadow will be filled by `'2'`s.

        https://font.tomchen.org/bdfparser_py/bitmap#shadow
        */
    xoff = xoff ?? 1
    yoff = yoff ?? -1
    let h, resized_xoff, resized_yoff, shadow_xoff, shadow_yoff, w
    const bitmap_shadow = this.clone()
    w = this.width()
    h = this.height()
    w += Math.abs(xoff)
    h += Math.abs(yoff)
    bitmap_shadow.bindata = bitmap_shadow.bindata.map((val) =>
      val.replace(/1/g, '2')
    )
    if (xoff > 0) {
      resized_xoff = 0
      shadow_xoff = -xoff
    } else {
      resized_xoff = xoff
      shadow_xoff = 0
    }
    if (yoff > 0) {
      resized_yoff = 0
      shadow_yoff = -yoff
    } else {
      resized_yoff = yoff
      shadow_yoff = 0
    }
    this.crop(w, h, resized_xoff, resized_yoff)
    bitmap_shadow.crop(w, h, shadow_xoff, shadow_yoff)
    bitmap_shadow.overlay(this)
    this.bindata = bitmap_shadow.bindata
    return this
  }

  glow() {
    /*
        Add glow effect to the shape in the bitmap.

        The glowing area is one pixel up, right, bottom and left to the original pixels, and will be filled by `'2'`s.

        https://font.tomchen.org/bdfparser_py/bitmap#glow
        */
    let h, line, pixel, w
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
          b[i_line][i_pixel - 1] = b[i_line][i_pixel - 1] || 2
          b[i_line][i_pixel + 1] = b[i_line][i_pixel + 1] || 2
          b[i_line - 1][i_pixel] = b[i_line - 1][i_pixel] || 2
          b[i_line + 1][i_pixel] = b[i_line + 1][i_pixel] || 2
        }
      }
    }
    this.bindata = b.map((l) => l.map((val) => val.toString()).join(''))
    return this
  }

  bytepad(bits?) {
    /*
        Pad each line (row) to multiple of 8 (or other numbers) bits/pixels, with `'0'`s.

        Do this before using the bitmap for a glyph in a BDF font.

        https://font.tomchen.org/bdfparser_py/bitmap#bytepad
        */
    bits = bits ?? 8
    const w = this.width()
    const h = this.height()
    const mod = w % bits
    if (mod === 0) {
      return this
    }
    return this.crop(w + bits - mod, h)
  }

  todata(datatype?) {
    /*
      Get the bitmap's data in the specified type and format.

      https://font.tomchen.org/bdfparser_py/bitmap#todata
      */
    datatype = datatype ?? 1
    switch (datatype) {
      case 0:
        return this.bindata.join('\n')
      case 1:
        return this.bindata
      case 2:
        return this.bindata.map((l) => l.split('').map((s) => parseInt(s, 10)))
      case 3:
        return this.todata(2).flat()
      case 4:
        // if there are '2's, it will throw error
        return this.bindata.map((s) => {
          if (!/^[01]+$/.test(s)) {
            throw new Error(`Invalid binary string: ${s}`)
          }
          return parseInt(s, 2)
            .toString(16)
            .padStart(Math.floor((-1 * this.width()) / 4) * -1, '0')
        })
      case 5:
        // if there are '2's, it will throw error
        return this.bindata.map((s) => {
          if (!/^[01]+$/.test(s)) {
            throw new Error(`Invalid binary string: ${s}`)
          }
          return parseInt(s, 2)
        })
    }
  }
}
