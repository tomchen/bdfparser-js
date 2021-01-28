import * as fs from 'fs'
import * as readline from 'readline'

// import { BufReader, readLines } from 'https://deno.land/std@0.84.0/io/bufio.ts'

// const fileLineIter = (filepath) => {
//   const file = await Deno.open(filepath)
//   const bufReader = new BufReader(file)
//   return readLines(bufReader)
// }

export const fileLineIter = (filepath) => {
  const fileStream = fs.createReadStream(filepath)
  const rl = readline.createInterface({
    input: fileStream,
  })
  return rl[Symbol.asyncIterator]()
}

const in_es6 = function (left, right) {
  if (right instanceof Array || typeof right === 'string') {
    return right.indexOf(left) > -1
  } else {
    if (
      right instanceof Map ||
      right instanceof Set ||
      right instanceof WeakMap ||
      right instanceof WeakSet
    ) {
      return right.has(left)
    } else {
      return left in right
    }
  }
}

const range = (start, stop, step = 1) =>
  Array(Math.ceil((stop - start) / step))
    .fill(start)
    .map((x, y) => x + y * step)

export class Font {
  /*
    `Font` Object

    https://font.tomchen.org/bdfparser_py/font
    */

  private __PATTERN_VVECTOR_DELIMITER: string
  private __META_TITLES: string[]
  private __EMPTY_GLYPH: any
  public headers: any
  public props: any
  public glyphs: any
  private __glyph_count_to_check: any
  private __curline_startchar: any
  private __curline_chars: any
  private __f: any

  constructor() {
    /*
        Initialize a `Font` Object. Load the BDF font file if a file path string or a file Object is present.

        https://font.tomchen.org/bdfparser_py/font#font
        */
    this.__PATTERN_VVECTOR_DELIMITER = '[\\s]+'
    this.__META_TITLES = [
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
    this.__EMPTY_GLYPH = {
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
      hexdata: [],
    }
    this.headers = {}
    this.props = {}
    this.glyphs = new Map()
    this.__glyph_count_to_check = null
    this.__curline_startchar = null
    this.__curline_chars = null
    // const l = argv.length
    // if (l === 1) {
    //   arg = argv[0]
    //   if (typeof arg === 'string' || typeof arg === 'string') {
    //     await this.load_file_path(arg)
    //   } else {
    //     if (typeof arg === 'object' && typeof arg.next === 'function') {
    //       await this.load_file_line_iter(arg)
    //     }
    //   }
    // }
  }
  async load_file_path(file_path) {
    /*
        Load the BDF font file in the file path.

        https://font.tomchen.org/bdfparser_py/font#load_file_path
        */
    const file_line_iter = fileLineIter(file_path)
    await this.load_file_line_iter(file_line_iter)
    return this
  }
  async load_file_line_iter(file_line_iter) {
    /*
        Load the BDF font file line async iterator.
        */
    this.__f = file_line_iter
    await this.__parse_headers()
    return this
  }
  async __parse_headers() {
    let comment, key, kvlist, l, line, nlist, value
    while (1) {
      line = (await this.__f.next())?.value
      kvlist = line.split(/ (.+)/, 2)
      l = kvlist.length
      if (l === 2) {
        key = kvlist[0]
        value = kvlist[1].trim()
        switch (key) {
          case 'STARTFONT':
            this.headers['bdfversion'] = Number.parseFloat(value)
            break
          case 'FONT':
            this.headers['fontname'] = value
            break
          case 'SIZE':
            nlist = value.split(' ')
            this.headers['pointsize'] = Number.parseInt(nlist[0])
            this.headers['xres'] = Number.parseInt(nlist[1])
            this.headers['yres'] = Number.parseInt(nlist[2])
            break
          case 'FONTBOUNDINGBOX':
            nlist = value.split(' ')
            this.headers['fbbx'] = Number.parseInt(nlist[0])
            this.headers['fbby'] = Number.parseInt(nlist[1])
            this.headers['fbbxoff'] = Number.parseInt(nlist[2])
            this.headers['fbbyoff'] = Number.parseInt(nlist[3])
            break
          case 'STARTPROPERTIES':
            this.__parse_headers_after()
            await this.__parse_props()
            return
          case 'COMMENT':
            comment = 'comment'
            if (!in_es6(comment, this.headers)) {
              this.headers[comment] = []
            }
            this.headers[comment].push(
              value.replace(/^[\s"'\t\r\n]+|[\s"'\t\r\n]+$/g, '')
            )
            break
          case 'SWIDTH':
            nlist = value.split(' ')
            this.headers['swx0'] = Number.parseInt(nlist[0])
            this.headers['swy0'] = Number.parseInt(nlist[1])
            break
          case 'DWIDTH':
            nlist = value.split(' ')
            this.headers['dwx0'] = Number.parseInt(nlist[0])
            this.headers['dwy0'] = Number.parseInt(nlist[1])
            break
          case 'SWIDTH1':
            nlist = value.split(' ')
            this.headers['swx1'] = Number.parseInt(nlist[0])
            this.headers['swy1'] = Number.parseInt(nlist[1])
            break
          case 'DWIDTH1':
            nlist = value.split(' ')
            this.headers['dwx1'] = Number.parseInt(nlist[0])
            this.headers['dwy1'] = Number.parseInt(nlist[1])
            break
          case 'VVECTOR':
            nlist = this.__PATTERN_VVECTOR_DELIMITER.split(value)
            this.headers['vvectorx'] = Number.parseInt(nlist[0])
            this.headers['vvectory'] = Number.parseInt(nlist[1])
            break
          case 'METRICSSET':
          case 'CONTENTVERSION':
            this.headers[key.toLowerCase()] = Number.parseInt(value)
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
          default:
            break
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
  __parse_headers_after() {
    if (!in_es6('metricsset', this.headers)) {
      this.headers['metricsset'] = 0
    }
  }
  async __parse_props() {
    let comment, key, kvlist, l, line, value
    while (1) {
      line = (await this.__f.next())?.value
      kvlist = line.split(/ (.+)/, 2)
      l = kvlist.length
      if (l === 2) {
        key = kvlist[0]
        value = kvlist[1].replace(/^[\s"'\t\r\n]+|[\s"'\t\r\n]+$/g, '')
        if (key === 'COMMENT') {
          comment = 'comment'
          if (!in_es6(comment, this.props)) {
            this.props[comment] = []
          }
          this.props[comment].push(
            value.replace(/^[\s"'\t\r\n]+|[\s"'\t\r\n]+$/g, '')
          )
        } else {
          this.props[key.toLowerCase()] = value
        }
      } else {
        if (l === 1) {
          key = kvlist[0].trim()
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
  async __parse_glyph_count() {
    let line
    if (this.__curline_chars === null) {
      line = (await this.__f.next())?.value
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
      this.__glyph_count_to_check = Number.parseInt(kvlist[1].trim())
    } else {
      this.__curline_startchar = line
      console.warn("Cannot find 'CHARS' line next to 'ENDPROPERTIES' line")
    }
    await this.__prepare_glyphs()
  }
  async __prepare_glyphs() {
    let glyph_bitmap,
      glyph_bitmap_is_on,
      glyph_codepoint,
      glyph_end,
      glyph_meta,
      key,
      kvlist,
      l,
      line,
      nlist,
      value
    glyph_meta = []
    glyph_bitmap = []
    glyph_bitmap_is_on = false
    glyph_end = false
    while (1) {
      if (this.__curline_startchar === null) {
        line = (await this.__f.next())?.value // default null ????
      } else {
        line = this.__curline_startchar
        this.__curline_startchar = null
      }
      if (line === null) {
        console.warn("This font does not have 'ENDFONT' keyword")
        this.__prepare_glyphs_after()
        return
      }
      kvlist = line.split(/ (.+)/, 2)
      l = kvlist.length
      if (l === 2) {
        key = kvlist[0]
        value = kvlist[1].trim()
        switch (key) {
          case 'STARTCHAR':
            glyph_meta = Array(17).fill(null)
            glyph_meta[0] = value
            glyph_end = false
            break
          case 'ENCODING':
            glyph_codepoint = Number.parseInt(value)
            glyph_meta[1] = glyph_codepoint
            break
          case 'BBX':
            nlist = value.split(' ')
            glyph_meta[2] = Number.parseInt(nlist[0])
            glyph_meta[3] = Number.parseInt(nlist[1])
            glyph_meta[4] = Number.parseInt(nlist[2])
            glyph_meta[5] = Number.parseInt(nlist[3])
            break
          case 'SWIDTH':
            nlist = value.split(' ')
            glyph_meta[6] = Number.parseInt(nlist[0])
            glyph_meta[7] = Number.parseInt(nlist[1])
            break
          case 'DWIDTH':
            nlist = value.split(' ')
            glyph_meta[8] = Number.parseInt(nlist[0])
            glyph_meta[9] = Number.parseInt(nlist[1])
            break
          case 'SWIDTH1':
            nlist = value.split(' ')
            glyph_meta[10] = Number.parseInt(nlist[0])
            glyph_meta[11] = Number.parseInt(nlist[1])
            break
          case 'DWIDTH1':
            nlist = value.split(' ')
            glyph_meta[12] = Number.parseInt(nlist[0])
            glyph_meta[13] = Number.parseInt(nlist[1])
            break
          case 'VVECTOR':
            nlist = this.__PATTERN_VVECTOR_DELIMITER.split(value)
            glyph_meta[14] = Number.parseInt(nlist[0])
            glyph_meta[15] = Number.parseInt(nlist[1])
            break
          default:
            break
        }
      } else {
        if (l === 1) {
          key = kvlist[0].trim()
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
  __prepare_glyphs_after() {
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
  get length() {
    /*
        Same as `.length()`
        Returns how many glyphs actually exist in the font.

        https://font.tomchen.org/bdfparser_py/font#length
        */
    return this.glyphs.size
  }
  itercps(order?, r?) {
    /*
        Almost identical to `.iterglyphs()`, except it returns an `iterator` of glyph codepoints instead of an `iterator` of `Glyph` Objects.

        https://font.tomchen.org/bdfparser_py/font#itercps
        */
    order = order ?? 1
    r = r ?? null
    let retiterator
    const ks = this.glyphs.keys()
    console.log(order)
    switch (order) {
      case 1:
        retiterator = Array.from(ks).sort(
          (a: number, b: number): number => a - b
        )
        break
      case 0:
        retiterator = Array.from(ks)
        break
      case 2:
        retiterator = Array.from(ks).sort(
          (a: number, b: number): number => b - a
        )
        break
      case -1:
        retiterator = Array.from(ks).reverse()
        break
      default:
        break
    }
    if (r !== null) {
      const f = (cp) => {
        if (typeof r === 'number') {
          return cp < r
        } else {
          if (
            Array.isArray(r) &&
            r.length === 2 &&
            typeof r[0] === 'number' &&
            typeof r[1] === 'number'
          ) {
            return cp <= r[1] && cp >= r[0]
          } else {
            if (Array.isArray(r) && Array.isArray(r[0])) {
              for (const t of r) {
                if (cp <= t[1] && cp >= t[0]) {
                  return true
                }
              }
              return false
            }
          }
        }
      }
      retiterator = retiterator.filter(f)
    }
    return retiterator
  }
  // *iterglyphs(order = 1, r = null) {
  //   /*
  //       Returns an iterator of all the glyphs (as `Glyph` Objects) in the font (default) or in the specified codepoint range in the font, sorted by the specified order (or by the ascending codepoint order by default).

  //       https://font.tomchen.org/bdfparser_py/font#iterglyphs
  //       */
  //   for (
  //     let cp, _pj_c = 0, _pj_a = this.itercps(order, r), _pj_b = _pj_a.length;
  //     _pj_c < _pj_b;
  //     _pj_c ++
  //   ) {
  //     cp = _pj_a[_pj_c]
  //     yield this.glyphbycp(cp)
  //   }
  // }
  glyphbycp(codepoint) {
    /*
        Get a glyph (as Glyph Object) by its codepoint.

        https://font.tomchen.org/bdfparser_py/font#glyphbycp
        */
    if (!this.glyphs.has(codepoint)) {
      console.warn(
        `Glyph "${String.fromCodePoint(
          codepoint
        )}" (codepoint ${codepoint.toString()}) does not exist in the font`
      )
      return null
    }
    const d = {}
    const a = this.__META_TITLES
    const b = this.glyphs.get(codepoint)
    a.forEach((el, i) => {
      d[el] = b[i]
    })
    return new Glyph(d, this)
  }
  glyph(character) {
    /*
        Get a glyph (as `Glyph` Object) by its character.

        https://font.tomchen.org/bdfparser_py/font#glyph
        */
    return this.glyphbycp(character.codePointAt(0))
  }
  lacksglyphs(str) {
    /*
        Check if there is any missing glyph and gets these glyphs' character.

        https://font.tomchen.org/bdfparser_py/font#lacksglyphs
        */
    let cp
    const l = []
    const len = str.length
    for (let c, i = 0; i < len; i++) {
      c = str[i]
      cp = c.codePointAt(0)
      if (!this.glyphs.has(cp)) {
        l.push(c)
      }
    }
    return l.length !== 0 ? l : null
  }
  // draw(
  //   string,
  //   linelimit = 512,
  //   mode = 1,
  //   direction = 'lrtb',
  //   usecurrentglyphspacing = false,
  //   missing = null
  // ) {
  //   /*
  //       Draw (render) the glyphs of the specified words / setences / paragraphs (as a `str`), to a `Bitmap` Object.

  //       https://font.tomchen.org/bdfparser_py/font#draw
  //       */
  //   return this.drawcps(
  //     function () {
  //       const _pj_a = [],
  //         _pj_b = string
  //       for (let _pj_c = 0, _pj_d = _pj_b.length; _pj_c < _pj_d; _pj_c ++) {
  //         const c = _pj_b[_pj_c]
  //         _pj_a.push(c.codePointAt(0))
  //       }
  //       return _pj_a
  //     }.call(this),
  //     linelimit,
  //     mode,
  //     direction,
  //     usecurrentglyphspacing,
  //     missing
  //   )
  // }
  // drawall(
  //   order = 1,
  //   r = null,
  //   linelimit = 512,
  //   mode = 0,
  //   direction = 'lrtb',
  //   usecurrentglyphspacing = false
  // ) {
  //   /*
  //       Draw all the glyphs in the font (default) or in the specified codepoint range in the font, sorted by the specified order (or by the ascending codepoint order by default), to a `Bitmap` Object.

  //       https://font.tomchen.org/bdfparser_py/font#drawall
  //       */
  //   return this.drawcps(
  //     this.itercps(order, r),
  //     linelimit,
  //     mode,
  //     direction,
  //     usecurrentglyphspacing
  //   )
  // }
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
  // toString() {
  //   /*
  //       Gets a human-readable (multi-line) `str` representation of the `Glyph` Object.

  //       https://font.tomchen.org/bdfparser_py/glyph#str-and-print
  //       */
  //   return this.draw().toString()
  // }
  // __repr__() {
  //   /*
  //       Gets a programmer-readable `str` representation of the `Glyph` Object.

  //       https://font.tomchen.org/bdfparser_py/glyph#repr
  //       */
  //   return 'Glyph(' + this.meta.toString() + ', ' + this.font.toString() + ')'
  // }
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
  // draw(mode = 0, bb = null) {
  //   /*
  //       Draw the glyph to a `Bitmap` Object.

  //       https://font.tomchen.org/bdfparser_py/glyph#draw
  //       */
  //   let retbitmap
  //   if (mode === 0) {
  //     retbitmap = this.__draw_fbb()
  //   } else {
  //     if (mode === 1) {
  //       retbitmap = this.__draw_bb()
  //     } else {
  //       if (mode === 2) {
  //         retbitmap = this.__draw_original()
  //       } else {
  //         if (mode === -1 && bb !== null) {
  //           retbitmap = this.__draw_user_specified(bb)
  //         } else {
  //           if (mode === -1 && bb === null) {
  //             throw new Error(
  //               'Parameter bb in draw() method must be set when mode=-1'
  //             )
  //           }
  //         }
  //       }
  //     }
  //   }
  //   return retbitmap
  // }
  // __draw_user_specified(fbb) {
  //   const bbxoff = this.meta.get('bbxoff')
  //   const bbyoff = this.meta.get('bbyoff')
  //   const [fbbx, fbby, fbbxoff, fbbyoff] = fbb
  //   const bitmap = this.__draw_bb()
  //   return bitmap.crop(fbbx, fbby, -bbxoff + fbbxoff, -bbyoff + fbbyoff)
  // }
  // __draw_original() {
  //   return new Bitmap(
  //     function () {
  //       const _pj_a = [],
  //         _pj_b = this.meta.get('hexdata')
  //       for (let _pj_c = 0, _pj_d = _pj_b.length; _pj_c < _pj_d; _pj_c ++) {
  //         const h = _pj_b[_pj_c]
  //         _pj_a.push(
  //           h
  //             ? bin(Number.parseInt(h, 16))
  //                 .slice(2)
  //                 .zfill(h.length * 4)
  //             : ''
  //         )
  //       }
  //       return _pj_a
  //     }.call(this)
  //   )
  // }
  // __draw_bb() {
  //   const bbw = this.meta.get('bbw')
  //   const bbh = this.meta.get('bbh')
  //   const bitmap = this.__draw_original()
  //   const bindata = bitmap.bindata
  //   const l = bindata.length
  //   if (l !== bbh) {
  //     console.warn(
  //       `Glyph "${this.meta
  //         .get('glyphname')
  //         .toString()}" (codepoint ${this.meta
  //         .get('codepoint')
  //         .toString()})'s bbh, ${bbh.toString()}, does not match its hexdata line count, ${l.toString()}`
  //     )
  //   }
  //   bitmap.bindata = function () {
  //     const _pj_a = [],
  //       _pj_b = bindata
  //     for (let _pj_c = 0, _pj_d = _pj_b.length; _pj_c < _pj_d; _pj_c ++) {
  //       const b = _pj_b[_pj_c]
  //       _pj_a.push(b.slice(0, bbw))
  //     }
  //     return _pj_a
  //   }.call(this)
  //   return bitmap
  // }
  // __draw_fbb() {
  //   const fh = this.font.headers
  //   return this.__draw_user_specified([
  //     fh['fbbx'],
  //     fh['fbby'],
  //     fh['fbbxoff'],
  //     fh['fbbyoff'],
  //   ])
  // }
  // origin(mode = 0, fromorigin = false, xoff = null, yoff = null) {
  //   /*
  //       Get the relative position (displacement) of the origin from the left bottom corner of the bitmap drawn by the method `.draw()`, or vice versa.

  //       https://font.tomchen.org/bdfparser_py/glyph#origin
  //       */
  //   let fh, ret
  //   const bbxoff = this.meta.get('bbxoff')
  //   const bbyoff = this.meta.get('bbyoff')
  //   if (mode === 0) {
  //     fh = this.font.headers
  //     ret = [fh['fbbxoff'], fh['fbbyoff']]
  //   } else {
  //     if (mode === 1) {
  //       ret = [bbxoff, bbyoff]
  //     } else {
  //       if (mode === 2) {
  //         ret = [bbxoff, bbyoff]
  //       } else {
  //         if (mode === -1 && xoff !== null && yoff !== null) {
  //           ret = [xoff, yoff]
  //         } else {
  //           if (mode === -1 && (xoff === null || yoff === null)) {
  //             throw new Error(
  //               'Parameter xoff and yoff in origin() method must be all set when mode=-1'
  //             )
  //           }
  //         }
  //       }
  //     }
  //   }
  //   return fromorigin ? ret : [0 - ret[0], 0 - ret[1]]
  // }
}

// export class Bitmap {
//   /*
//     `Bitmap` Object

//     https://font.tomchen.org/bdfparser_py/bitmap
//     */
//   public bindata: string[]
//   constructor(bin_bitmap_list) {
//     /*
//         Initialize a `Bitmap` Object. Load binary bitmap data (`list` of `str`s).

//         https://font.tomchen.org/bdfparser_py/bitmap#bitmap
//         */
//     this.bindata = bin_bitmap_list
//   }
//   toString() {
//     /*
//         Gets a human-readable (multi-line) `str` representation of the `Bitmap` Object.

//         https://font.tomchen.org/bdfparser_py/bitmap#str-and-print
//         */
//     return this.bindata
//       .join('\n')
//       .replace('0', '.')
//       .replace('1', '#')
//       .replace('2', '&')
//   }
//   __repr__() {
//     /*
//         Gets a programmer-readable (multi-line) `str` representation of the `Bitmap` Object.

//         https://font.tomchen.org/bdfparser_py/bitmap#repr
//         */
//     return this.bindata.join("Bitmap(['" + "',\n        '") + "'])"
//   }
//   width() {
//     /*
//         Get the width of the bitmap.

//         https://font.tomchen.org/bdfparser_py/bitmap#width
//         */
//     return this.bindata[0].length
//   }
//   height() {
//     /*
//         Get the height of the bitmap.

//         https://font.tomchen.org/bdfparser_py/bitmap#height
//         */
//     return this.bindata.length
//   }
//   clone() {
//     /*
//         Get a deep copy / clone of the `Bitmap` Object.

//         https://font.tomchen.org/bdfparser_py/bitmap#clone
//         */
//     const bindata = function () {
//       const _pj_a = [],
//         _pj_b = this.bindata
//       for (let _pj_c = 0, _pj_d = _pj_b.length; _pj_c < _pj_d; _pj_c ++) {
//         let l = _pj_b[_pj_c]
//         _pj_a.push(l.slice(0))
//       }
//       return _pj_a
//     }.call(this)
//     return new Bitmap(bindata)
//   }
//   static __crop_string(s, start, length) {
//     let left, stemp
//     stemp = s
//     const l = s.length
//     left = 0
//     if (start < 0) {
//       left = 0 - start
//       stemp = stemp.zfill(left + l)
//     }
//     if (start + length > l) {
//       stemp = stemp.ljust(start + length - l + stemp.length, '0')
//     }
//     const newstart = start + left
//     return stemp.slice(newstart, newstart + length)
//   }
//   static __string_offset_concat(s1, s2, offset = 0) {
//     let c1, c2
//     if (offset === 0) {
//       return s1 + s2
//     }
//     const len1 = s1.length
//     const len2 = s2.length
//     const s2start = len1 + offset
//     const s2end = s2start + len2
//     const finalstart = Math.min(0, s2start)
//     const finalend = Math.max(len1, s2end)
//     const news1 = this.__crop_string(s1, finalstart, finalend - finalstart)
//     const news2 = this.__crop_string(
//       s2,
//       finalstart - s2start,
//       finalend - finalstart
//     )
//     const r = []
//     for (let i = 0, _pj_a = news1.length; i < _pj_a; i++) {
//       c1 = news1[i]
//       c2 = news2[i]
//       r.push((Number.parseInt(c2) || Number.parseInt(c1)).toString())
//     }
//     return r.join('')
//   }
//   static __listofstr_offset_concat(list1, list2, offset = 0) {
//     let c1, c2, r, s1, s2
//     if (offset === 0) {
//       return list1 + list2
//     }
//     const width = list1[0].length
//     const len1 = list1.length
//     const len2 = list2.length
//     const s2start = len1 + offset
//     const s2end = s2start + len2
//     const finalstart = Math.min(0, s2start)
//     const finalend = Math.max(len1, s2end)
//     const retlist = []
//     for (let i = finalstart, _pj_a = finalend; i < _pj_a; i++) {
//       if (i < 0 || i >= len1) {
//         s1 = '0'.repeat(width)
//       } else {
//         s1 = list1[i]
//       }
//       if (i < s2start || i >= s2end) {
//         s2 = '0'.repeat(width)
//       } else {
//         s2 = list2[i - s2start]
//       }
//       r = []
//       for (let i = 0, _pj_b = s1.length; i < _pj_b; i++) {
//         c1 = s1[i]
//         c2 = s2[i]
//         r.push((Number.parseInt(c2) || Number.parseInt(c1)).toString())
//       }
//       retlist.push(r.join(''))
//     }
//     return retlist
//   }
//   static __crop_bitmap(bitmap, w, h, xoff, yoff) {
//     let bn
//     const retlist = []
//     const l = bitmap.length
//     for (let n = 0, _pj_a = h; n < _pj_a; n ++) {
//       bn = l - yoff - h + n
//       if (bn < 0 || bn >= l) {
//         retlist.push('0'.repeat(w))
//       } else {
//         retlist.push(this.__crop_string(bitmap[bn], xoff, w))
//       }
//     }
//     return retlist
//   }
//   crop(w, h, xoff = 0, yoff = 0) {
//     /*
//         Crop and/or extend the bitmap.

//         https://font.tomchen.org/bdfparser_py/bitmap#crop
//         */
//     this.bindata = this.__crop_bitmap(this.bindata, w, h, xoff, yoff)
//     return this
//   }
//   overlay(bitmap) {
//     /*
//         Overlay another bitmap over the current one.

//         https://font.tomchen.org/bdfparser_py/bitmap#overlay
//         */
//     let c1, c2, la, lb, r
//     const bindata_a = this.bindata
//     const bindata_b = bitmap.bindata
//     if (bindata_a.length !== bindata_b.length) {
//       console.warn('the bitmaps to overlay have different height')
//     }
//     if (bindata_a[0].length !== bindata_b[0].length) {
//       console.warn('the bitmaps to overlay have different width')
//     }
//     const rl = []
//     for (let li = 0, _pj_a = bindata_a.length; li < _pj_a; li++) {
//       la = bindata_a[li]
//       lb = bindata_b[li]
//       r = []
//       for (let i = 0, _pj_b = la.length; i < _pj_b; i++) {
//         c1 = la[i]
//         c2 = lb[i]
//         r.push((Number.parseInt(c2) || Number.parseInt(c1)).toString())
//       }
//       rl.push(r.join(''))
//     }
//     this.bindata = rl
//     return this
//   }
//   static concatall(bitmaplist, direction = 1, align = 1, offsetlist = null) {
//     /*
//         Concatenate all `Bitmap` Objects in a `list`.

//         https://font.tomchen.org/bdfparser_py/bitmap#bitmapconcatall
//         */
//     let bd, ireal, maxsize, offset, ret, w, xoff
//     if (direction > 0) {
//       maxsize = Math.max(
//         ...function () {
//           const _pj_a = [],
//             _pj_b = bitmaplist
//           for (let _pj_c = 0, _pj_d = _pj_b.length; _pj_c < _pj_d; _pj_c ++) {
//             const bitmap = _pj_b[_pj_c]
//             _pj_a.push(bitmap.height())
//           }
//           return _pj_a
//         }.call(this)
//       )
//       ret = Array(maxsize).fill('')
//       const stroffconcat = (s1, s2, offset) => {
//         if (direction === 1) {
//           return this.__string_offset_concat(s1, s2, offset)
//         } else {
//           if (direction === 2) {
//             return this.__string_offset_concat(s2, s1, offset)
//           }
//         }
//       }
//       for (let i = 0, _pj_a = maxsize; i < _pj_a; i++) {
//         if (align) {
//           ireal = -i - 1
//         } else {
//           ireal = i
//         }
//         offset = 0
//         for (let bi = 0, _pj_b = bitmaplist.length; bi < _pj_b; bi++) {
//           const bitmap = bitmaplist[bi]
//           if (offsetlist && bi !== 0) {
//             offset = offsetlist[bi - 1]
//           }
//           if (i < bitmap.height()) {
//             ret[ireal] = stroffconcat(ret[ireal], bitmap.bindata[ireal], offset)
//           } else {
//             ret[ireal] = stroffconcat(
//               ret[ireal],
//               '0'.repeat(bitmap.width()),
//               offset
//             )
//           }
//         }
//       }
//     } else {
//       maxsize = Math.max(
//         ...function () {
//           const _pj_a = [],
//             _pj_b = bitmaplist
//           for (let _pj_c = 0, _pj_d = _pj_b.length; _pj_c < _pj_d; _pj_c ++) {
//             const bitmap = _pj_b[_pj_c]
//             _pj_a.push(bitmap.width())
//           }
//           return _pj_a
//         }.call(this)
//       )
//       ret = []
//       offset = 0
//       for (let bi = 0, _pj_a = bitmaplist.length; bi < _pj_a; bi++) {
//         const bitmap = bitmaplist[bi]
//         if (offsetlist && bi !== 0) {
//           offset = offsetlist[bi - 1]
//         }
//         bd = bitmap.bindata
//         w = bitmap.width()
//         if (w !== maxsize) {
//           if (align) {
//             xoff = 0
//           } else {
//             xoff = w - maxsize
//           }
//           bd = this.__crop_bitmap(bd, maxsize, bitmap.height(), xoff, 0)
//         }
//         if (direction === 0) {
//           ret = this.__listofstr_offset_concat(ret, bd, offset)
//         } else {
//           ret = this.__listofstr_offset_concat(bd, ret, offset)
//         }
//       }
//     }
//     return this(ret)
//   }
//   __add__(bitmap) {
//     /*
//         `+` is a shortcut of `Bitmap.concatall()`. Use `+` to concatenate two `Bitmap` Objects and get a new `Bitmap` Objects.

//         https://font.tomchen.org/bdfparser_py/bitmap#-concat
//         */
//     return Bitmap.concatall([this, bitmap])
//   }
//   concat(bitmap, direction = 1, align = 1, offsetlist = null) {
//     /*
//         Concatenate another `Bitmap` Objects to the current one.

//         https://font.tomchen.org/bdfparser_py/bitmap#concat
//         */
//     this.bindata = Bitmap.concatall(
//       [this, bitmap],
//       direction,
//       align,
//       offsetlist
//     ).bindata
//     return this
//   }
//   static __enlarge_bindata(bindata, x = 1, y = 1) {
//     let ret
//     const bindata_temp = function () {
//       const _pj_a = [],
//         _pj_b = bindata
//       for (let _pj_c = 0, _pj_d = _pj_b.length; _pj_c < _pj_d; _pj_c ++) {
//         const l = _pj_b[_pj_c]
//         _pj_a.push(l.slice(0))
//       }
//       return _pj_a
//     }.call(this)
//     if (x > 1) {
//       for (let i = 0, _pj_a = bindata_temp.length; i < _pj_a; i++) {
//         const l = bindata_temp[i]
//         bindata_temp[i] = function () {
//           const _pj_b = [],
//             _pj_c = l
//           for (let _pj_d = 0, _pj_e = _pj_c.length; _pj_d < _pj_e; _pj_d ++) {
//             const p = _pj_c[_pj_d]
//             _pj_b.push(p * x)
//           }
//           return _pj_b
//         }
//           .call(this)
//           .join('')
//       }
//     }
//     if (y > 1) {
//       ret = []
//       for (let i = 0, _pj_a = bindata_temp.length; i < _pj_a; i++) {
//         const l = bindata_temp[i]
//         for (let _ = 0, _pj_b = y; _ < _pj_b; _ ++) {
//           ret.push(l)
//         }
//       }
//     }
//     return ret
//   }
//   enlarge(x = 1, y = 1) {
//     /*
//         Enlarge a `Bitmap` Object, by multiplying every pixel in x (right) direction and in y (top) direction.

//         https://font.tomchen.org/bdfparser_py/bitmap#enlarge
//         */
//     this.bindata = Bitmap.__enlarge_bindata(this.bindata, x, y)
//     return this
//   }
//   __mul__(mul) {
//     /*
//         `*` is a shortcut of `.enlarge()`.

//         https://font.tomchen.org/bdfparser_py/bitmap#-enlarge
//         */
//     let x, y
//     if (typeof mul === 'number') {
//       x = y = mul
//     } else {
//       ;[x, y] = mul
//     }
//     return new Bitmap(Bitmap.__enlarge_bindata(this.bindata, x, y))
//   }
//   replace(substr, newsubstr) {
//     /*
//         Replace a string by another in the bitmap.

//         https://font.tomchen.org/bdfparser_py/bitmap#replace
//         */
//     if (typeof substr === 'number') {
//       substr = substr.toString()
//     }
//     if (typeof newsubstr === 'number') {
//       newsubstr = newsubstr.toString()
//     }
//     this.bindata = function () {
//       const _pj_a = [],
//         _pj_b = this.bindata
//       for (let _pj_c = 0, _pj_d = _pj_b.length; _pj_c < _pj_d; _pj_c ++) {
//         let l = _pj_b[_pj_c]
//         _pj_a.push(l.replace(substr, newsubstr))
//       }
//       return _pj_a
//     }.call(this)
//     return this
//   }
//   shadow(xoff = 1, yoff = -1) {
//     /*
//         Add shadow to the shape in the bitmap.

//         The shadow will be filled by `'2'`s.

//         https://font.tomchen.org/bdfparser_py/bitmap#shadow
//         */
//     let h, resized_xoff, resized_yoff, shadow_xoff, shadow_yoff, w
//     const bitmap_shadow = this.clone()
//     w = this.width()
//     h = this.height()
//     w += Math.abs(xoff)
//     h += Math.abs(yoff)
//     bitmap_shadow.bindata = function () {
//       const _pj_a = [],
//         _pj_b = bitmap_shadow.bindata
//       for (let _pj_c = 0, _pj_d = _pj_b.length; _pj_c < _pj_d; _pj_c ++) {
//         const l = _pj_b[_pj_c]
//         _pj_a.push(l.replace('1', '2'))
//       }
//       return _pj_a
//     }.call(this)
//     if (xoff > 0) {
//       resized_xoff = 0
//       shadow_xoff = -xoff
//     } else {
//       resized_xoff = xoff
//       shadow_xoff = 0
//     }
//     if (yoff > 0) {
//       resized_yoff = 0
//       shadow_yoff = -yoff
//     } else {
//       resized_yoff = yoff
//       shadow_yoff = 0
//     }
//     this.crop(w, h, resized_xoff, resized_yoff)
//     bitmap_shadow.crop(w, h, shadow_xoff, shadow_yoff)
//     bitmap_shadow.overlay(this)
//     this.bindata = bitmap_shadow.bindata
//     return this
//   }
//   glow() {
//     /*
//         Add glow effect to the shape in the bitmap.

//         The glowing area is one pixel up, right, bottom and left to the original pixels, and will be filled by `'2'`s.

//         https://font.tomchen.org/bdfparser_py/bitmap#glow
//         */
//     let h, line, pixel, w
//     w = this.width()
//     h = this.height()
//     w += 2
//     h += 2
//     this.crop(w, h, -1, -1)
//     const b = this.todata(2)
//     for (let i_line = 0, _pj_a = b.length; i_line < _pj_a; i_line ++) {
//       line = b[i_line]
//       for (
//         let i_pixel = 0, _pj_b = line.length;
//         i_pixel < _pj_b;
//         i_pixel ++
//       ) {
//         pixel = line[i_pixel]
//         if (pixel === 1) {
//           b[i_line][i_pixel - 1] = b[i_line][i_pixel - 1] || 2
//           b[i_line][i_pixel + 1] = b[i_line][i_pixel + 1] || 2
//           b[i_line - 1][i_pixel] = b[i_line - 1][i_pixel] || 2
//           b[i_line + 1][i_pixel] = b[i_line + 1][i_pixel] || 2
//         }
//       }
//     }
//     this.bindata = function () {
//       const _pj_a = [],
//         _pj_b = b
//       for (let _pj_c = 0, _pj_d = _pj_b.length; _pj_c < _pj_d; _pj_c ++) {
//         const l = _pj_b[_pj_c]
//         _pj_a.push(
//           function () {
//             const _pj_e = [],
//               _pj_f = l
//             for (
//               let _pj_g = 0, _pj_h = _pj_f.length;
//               _pj_g < _pj_h;
//               _pj_g ++
//             ) {
//               const p = _pj_f[_pj_g]
//               _pj_e.push(p.toString())
//             }
//             return _pj_e
//           }
//             .call(this)
//             .join('')
//         )
//       }
//       return _pj_a
//     }.call(this)
//     return this
//   }
//   bytepad(bits = 8) {
//     /*
//         Pad each line (row) to multiple of 8 (or other numbers) bits/pixels, with `'0'`s.

//         Do this before using the bitmap for a glyph in a BDF font.

//         https://font.tomchen.org/bdfparser_py/bitmap#bytepad
//         */
//     const w = this.width()
//     const h = this.height()
//     const mod = w % bits
//     if (mod === 0) {
//       return this
//     }
//     return this.crop(w + bits - mod, h)
//   }
//   tobytes(mode = 'RGB', bytesdict = null) {
//     /*
//         Get the bitmap's data as `bytes` to be used with Pillow library's `Image.frombytes(mode, size, data)`.

//         https://font.tomchen.org/bdfparser_py/bitmap#tobytes
//         */
//     let bitcount, bits, mod, octets, padcount, w
//     if (mode === '1') {
//       if (bytesdict === null) {
//         bytesdict = { [0]: 1, [1]: 0, [2]: 0 }
//       }
//       bits = []
//       w = this.width()
//       bitcount = 8
//       mod = w % bitcount
//       padcount = bitcount - mod
//       for (
//         let l, _pj_c = 0, _pj_a = this.bindata, _pj_b = _pj_a.length;
//         _pj_c < _pj_b;
//         _pj_c ++
//       ) {
//         l = _pj_a[_pj_c]
//         for (
//           let p, _pj_f = 0, _pj_d = l, _pj_e = _pj_d.length;
//           _pj_f < _pj_e;
//           _pj_f ++
//         ) {
//           p = _pj_d[_pj_f]
//           bits.push(Number.parseInt(p))
//         }
//         if (mod !== 0) {
//           bits.extend(
//             function () {
//               const _pj_d = [],
//                 _pj_e = range(0, padcount)
//               for (
//                 let _pj_f = 0, _pj_g = _pj_e.length;
//                 _pj_f < _pj_g;
//                 _pj_f ++
//               ) {
//                 let _ = _pj_e[_pj_f]
//                 _pj_d.push(0)
//               }
//               return _pj_d
//             }.call(this)
//           )
//         }
//       }
//       octets = function () {
//         const _pj_a = [],
//           _pj_b = range(0, bits.length, 8)
//         for (let _pj_c = 0, _pj_d = _pj_b.length; _pj_c < _pj_d; _pj_c ++) {
//           const i = _pj_b[_pj_c]
//           _pj_a.push(bits.slice(i, i + 8))
//         }
//         return _pj_a
//       }.call(this)
//       const bits2byte = (octet) => {
//         let res
//         res = 0
//         for (
//           let bit, _pj_c = 0, _pj_a = octet, _pj_b = _pj_a.length;
//           _pj_c < _pj_b;
//           _pj_c ++
//         ) {
//           bit = _pj_a[_pj_c]
//           res <<= 1
//           res |= bytesdict[bit]
//         }
//         return res
//       }
//       return bytes(
//         function () {
//           const _pj_a = [],
//             _pj_b = octets
//           for (let _pj_c = 0, _pj_d = _pj_b.length; _pj_c < _pj_d; _pj_c ++) {
//             const octet = _pj_b[_pj_c]
//             _pj_a.push(bits2byte(octet))
//           }
//           return _pj_a
//         }.call(this)
//       )
//     } else {
//       for (
//         let l, _pj_c = 0, _pj_a = this.bindata, _pj_b = _pj_a.length;
//         _pj_c < _pj_b;
//         _pj_c ++
//       ) {
//         l = _pj_a[_pj_c]
//         for (
//           let p, _pj_f = 0, _pj_d = l, _pj_e = _pj_d.length;
//           _pj_f < _pj_e;
//           _pj_f ++
//         ) {
//           p = _pj_d[_pj_f]
//           retbytes += bytesdict[Number.parseInt(p)]
//         }
//       }
//       return retbytes
//     }
//   }
// }
