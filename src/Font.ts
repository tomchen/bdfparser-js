import { Bitmap } from './Bitmap'
import {
  DIRE_MAP,
  DIRE_SHORTCUT_MAP,
  EMPTY_GLYPH,
  META_TITLES,
} from './constants'
import {
  CharsetCodec,
  IconvLike,
  _isOneChar,
  canonicalCharset,
  charsetProps,
  detectGL,
  getCodec,
  isUnicodeCharset,
  sanitizeCharset,
} from './encoding'
import { BDFParseError } from './errors'
import {
  Glyph,
  defaultglyphname,
  listToMeta,
  metaToList,
  slotEquals,
} from './Glyph'
import { fmtnum, pyLeadingInt } from './fmt'
import { readPcf, writePcf } from './pcf'
import { copyProps, newProps, propKeys } from './props'
import { readTtf, writeTtf } from './ttf'
import {
  BdfHeaders,
  CodepointRangeType,
  DirectionNumberType,
  DirectionPartType,
  DirectionType,
  GlyphDrawModeType,
  GlyphMeta,
  GlyphMetaInFont,
  OrderType,
  PropValue,
  Props,
  UnencodedGlyph,
} from './types'
import { warn } from './warn'

/** Options of {@link Font.encoding} */
export type EncodingOptions = {
  /** `iconv-lite` (or compatible) instance, for codecs `TextDecoder` does not support */
  iconv?: IconvLike
  /** force a charset name (instead of the one derived from `CHARSET_REGISTRY` / `CHARSET_ENCODING`); `''` or `null` clears it */
  charset?: string | null
  /** customized character → codepoint function */
  char2cp?: (char: string) => number | null | undefined
  /** customized codepoint → character function */
  cp2char?: (cp: number) => string | null | undefined
}

/** Options of {@link Font.create} (SPEC-v3 §2.6) */
export type FontCreateOptions = {
  /** pixel size (em height in pixels), default 16 */
  pixelsize?: number
  /** ascent in pixels, default `pixelsize - descent` */
  ascent?: number
  /** descent in pixels, default `floor(pixelsize / 8)` */
  descent?: number
  /** `FONT` name, default `familyname` */
  fontname?: string
  /** `FAMILY_NAME`, default `'Untitled'` */
  familyname?: string
  /** x resolution, default 75 */
  xres?: number
  /** y resolution, default 75 */
  yres?: number
}

/**
 * A `URL` object, or anything with a string `href` (structural type, so the
 * type declarations need neither the DOM nor the Node.js types)
 */
export type URLLike = { readonly href: string }

/**
 * `fetch` options (`RequestInit`), passed through unchanged (structural type,
 * see {@link URLLike})
 */
export type FetchInit = { [key: string]: unknown }

/** Options of {@link Font.load_bytes} / {@link Font.load_url} */
export type LoadOptions = {
  /** pixel size, required to load TrueType fonts without a `BDFP` table */
  pixelsize?: number
}

/** Options of {@link Font.newglyph} */
export type NewglyphOptions = {
  /** bitmap of the glyph (see `Glyph.setbitmap`) */
  bitmap?: Bitmap | null
  /** placement mode of `bitmap` (see `Glyph.setbitmap`), default 0 */
  mode?: GlyphDrawModeType
  /** glyph name, default `defaultglyphname(cp)` */
  name?: string | null
  /** DWIDTH x, default `bitmap.width()` (or `FONTBOUNDINGBOX` width without bitmap) */
  dwidth?: number | null
}

/** Options of {@link Font.tosvgfont} */
export type SvgFontOptions = {
  /** Offsets (to the right (x) top (y)) to apply to all glyphs' SVG paths, default `{ x: 0, y: 0 }` */
  pathOffsets?: { x?: number; y?: number }
  unicodeAttr?: {
    /**
     * no `unicode` attribute for `<glyph>` of control characters (< U+0020), default `false`
     * - `false` is compatible with FontForge which can't load SVG font with control character `<glyph>` having `unicode` attribute
     * - `true` is compatible with `svg2ttf` JavaScript library which skips control character `<glyph>` without `unicode` attribute
     */
    controlCharNoSkip?: boolean
    /**
     * Format of the `unicode` attribute for `<glyph>`, default `'hexncr'`
     * - `'hexncr'`: hex NCR, e.g. `unicode="&#x4ab;"`
     * - `'decncr'`: decimal NCR, e.g. `unicode="&#1195;"`
     * - `'char'`: character itself (with XML escape for a few characters), e.g. `unicode="a"`, `unicode="&amp;"`, `unicode="的"`
     */
    format?: 'hexncr' | 'decncr' | 'char'
  }
}

type DrawOptions = {
  linelimit?: number | null
  mode?: 0 | 1 | null
  direction?: DirectionType | null
  usecurrentglyphspacing?: boolean | null
  missing?: Glyph | GlyphMeta | null
}

const RE_INT = /^[+-]?[0-9]+$/
const RE_VERSION = /^[0-9]+(?:\.[0-9]+)?$/
const INT32_MIN = -0x80000000
const INT32_MAX = 0x7fffffff
const UINT32_MAX = 0xffffffff

/** BDF whitespace (SPEC-v3 §11.4): ASCII space, \t, \n, \v, \f, \r only */
const RE_WS = /[ \t\n\v\f\r]/
const RE_WS_RUN = /[ \t\n\v\f\r]+/
const RE_TRIM = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g
const RE_VVECTOR_DELIMITER = /[ \t\n\v\f\r,]+/
const wsTrim = (s: string): string => s.replace(RE_TRIM, '')

const REQUIRED_HEADERS = [
  'pointsize',
  'xres',
  'yres',
  'fbbx',
  'fbby',
  'fbbxoff',
  'fbbyoff',
] as const

/** `round(v) = floor(v + 0.5)` (SPEC-v3 rounding rule) */
const rnd = (v: number): number => Math.floor(v + 0.5)

/** BDF version formatting: integral → `"{n}.0"`, else shortest repr */
const fmtver = (v: number): string =>
  Number.isInteger(v) ? `${v}.0` : String(v)

/** Remove one pair of surrounding double quotes */
const stripQuotePair = (s: string): string =>
  s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s

const cloneList = (list: GlyphMetaInFont): GlyphMetaInFont => {
  const l = [...list] as GlyphMetaInFont
  l[16] = [...list[16]]
  return l
}

/** Whether a codepoint passes an `itercps` range filter */
const cpInRange = (cp: number, r: CodepointRangeType | null): boolean => {
  if (r === null) {
    return true
  }
  if (typeof r === 'number') {
    return cp < r
  }
  if (r.length === 2 && typeof r[0] === 'number' && typeof r[1] === 'number') {
    return cp >= r[0] && cp <= (r[1] as number)
  }
  for (const t of r as [number, number][]) {
    if (Array.isArray(t) && cp >= t[0] && cp <= t[1]) {
      return true
    }
  }
  return false
}

/** `Uint8Array` view of bytes (works across realms) */
const toBytes = (
  data: Uint8Array | ArrayBuffer | ArrayBufferView
): Uint8Array => {
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
    return new Uint8Array(data as ArrayBuffer)
  }
  throw new TypeError('Expected a Uint8Array, an ArrayBuffer or a typed array')
}

const isGzip = (b: Uint8Array): boolean =>
  b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b

/**
 * Decompress gzip data with the standard `DecompressionStream` (browsers,
 * Node ≥ 18, Deno, Bun).
 *
 * @internal
 */
export const gunzip = async (data: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'Cannot decompress gzip data: DecompressionStream is not available'
    )
  }
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  const written = writer
    .write(data as Uint8Array<ArrayBuffer>)
    .then(() => writer.close())
  // avoid an unhandled rejection; the error is reported by the reader
  written.catch(() => undefined)
  const reader = ds.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    chunks.push(value)
    total += value.length
  }
  await written
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

/** keyword → index of the first of the two slots in the 17-slot glyph list */
const GLYPH_METRICS: Record<string, number> = {
  SWIDTH: 6,
  DWIDTH: 8,
  SWIDTH1: 10,
  DWIDTH1: 12,
  VVECTOR: 14,
}
const GLOBAL_METRICS: Record<string, [keyof BdfHeaders, keyof BdfHeaders]> = {
  SWIDTH: ['swx0', 'swy0'],
  DWIDTH: ['dwx0', 'dwy0'],
  SWIDTH1: ['swx1', 'swy1'],
  DWIDTH1: ['dwx1', 'dwy1'],
  VVECTOR: ['vvectorx', 'vvectory'],
}
const NO_PROPS_WARNING =
  "It looks like the font does not have property block beginning with 'STARTPROPERTIES' keyword"

/**
 * Parser states: 0 header, 1 properties, 2 after properties (expect CHARS),
 * 3 between glyphs, 4 in glyph, 5 in BITMAP, 6 after ENDFONT
 */
type ParserState = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * Line-based BDF parser (SPEC-v3 §3), same state machine (and warnings) as
 * the Python implementation. Feed lines (with or without line endings) then
 * call `finish()`.
 */
class BdfParser {
  private lineno = 0
  private state: ParserState = 0
  private chars: number | null = null
  private propcount: number | null = null
  private propseen = 0
  private nglyphs = 0
  private meta: unknown[] = []
  private used = new Set<string>()
  private startline = 0
  private altcode: number | null = null
  private headers: Record<string, unknown>

  constructor(private font: Font) {
    this.headers = font.headers as unknown as Record<string, unknown>
  }

  /** feed a whole text (a final line break does not start a new line) */
  feedText(text: string): void {
    const lines = text.split(/\r\n|\r|\n/)
    if (lines[lines.length - 1] === '') {
      lines.pop()
    }
    for (const l of lines) {
      this.line(l)
    }
  }

  /** feed one line (a chunk containing line breaks is split into lines) */
  feed(chunk: string): void {
    if (chunk.indexOf('\n') === -1 && chunk.indexOf('\r') === -1) {
      this.line(chunk)
    } else {
      this.feedText(chunk)
    }
  }

  /** parse `n` integers (at least `n` tokens required) */
  private ints(
    value: string,
    n: number,
    key: string,
    sep: RegExp = RE_WS_RUN
  ): number[] {
    const v = wsTrim(value)
    const parts = v === '' ? [] : v.split(sep)
    if (parts.length < n) {
      throw new BDFParseError(
        `${key} needs ${n} numbers, got ${JSON.stringify(value)}`,
        this.lineno
      )
    }
    return parts.slice(0, n).map((t) => this.int32(t, key, value))
  }

  /** one integer token of a required numeric field (signed 32-bit) */
  private int32(t: string, key: string, value: string): number {
    if (!RE_INT.test(t)) {
      throw new BDFParseError(
        `malformed number in ${key} ${JSON.stringify(value)}`,
        this.lineno
      )
    }
    const n = parseInt(t, 10)
    if (n < INT32_MIN || n > INT32_MAX) {
      throw new BDFParseError(
        `number ${t} in ${key} is out of the 32-bit range`,
        this.lineno
      )
    }
    return n
  }

  private endHeaders(): void {
    if (!('metricsset' in this.headers)) {
      this.headers.metricsset = 0
    }
  }

  private startGlyph(value: string): void {
    this.meta = [value, ...Array<null>(15).fill(null), []]
    this.used = new Set()
    this.startline = this.lineno
    this.altcode = null
    this.nglyphs++
  }

  private finishGlyph(): void {
    const meta = this.meta as GlyphMetaInFont
    const name = meta[0]
    const font = this.font
    if (!this.used.has('BBX')) {
      throw new BDFParseError(
        `glyph '${name}' (starting at line ${this.startline}) has no BBX`,
        this.lineno
      )
    }
    if (!this.used.has('ENCODING')) {
      warn(
        `line ${this.startline}: glyph '${name}' has no ENCODING, treated as unencoded`
      )
      meta[1] = -1
    }
    if (meta[1] < 0) {
      if (meta[1] !== -1) {
        warn(
          `line ${this.startline}: glyph '${name}' has negative ENCODING ${meta[1]}, treated as unencoded`
        )
        meta[1] = -1
      }
      font.unencoded.push({ altcode: this.altcode, meta })
      return
    }
    const cp = meta[1]
    if (font.glyphs.has(cp)) {
      warn(
        `line ${this.startline}: duplicate codepoint ${cp} (glyph '${name}'), the later one wins`
      )
      font.glyphs.delete(cp)
    }
    font.glyphs.set(cp, meta)
  }

  private missingEndchar(): void {
    warn(
      `line ${this.lineno}: missing ENDCHAR for glyph '${String(this.meta[0])}'`
    )
  }

  private line(raw: string): void {
    this.lineno++
    if (this.state === 6) {
      return
    }
    if (this.lineno === 1 && raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1) // byte order mark at the start of the file
    }
    const line = wsTrim(raw)
    if (line === '') {
      return
    }
    const sp = line.search(RE_WS)
    const key = sp === -1 ? line : line.slice(0, sp)
    const value = sp === -1 ? '' : wsTrim(line.slice(sp))
    const meta = this.meta
    const font = this.font
    const headers = this.headers

    switch (this.state) {
      case 5: // BITMAP rows
        if (key === 'ENDCHAR') {
          this.finishGlyph()
          this.state = 3
        } else if (key === 'STARTCHAR') {
          this.missingEndchar()
          this.finishGlyph()
          this.startGlyph(value)
          this.state = 4
        } else if (key === 'ENDFONT') {
          this.missingEndchar()
          this.finishGlyph()
          this.state = 6
        } else if (key !== 'COMMENT') {
          ;(meta[16] as string[]).push(line)
        }
        return

      case 4: // inside a glyph, before BITMAP
        if (key === 'ENCODING') {
          if (!this.used.has(key)) {
            const parts = value === '' ? [] : value.split(RE_WS_RUN)
            if (parts.length === 0) {
              throw new BDFParseError('ENCODING needs a number', this.lineno)
            }
            const nums = parts.slice(0, 2).map((t) => this.int32(t, key, value))
            meta[1] = nums[0]
            if (nums[0] < 0 && nums.length > 1) {
              this.altcode = nums[1]
            }
            this.used.add(key)
          }
        } else if (key === 'BBX') {
          if (!this.used.has(key)) {
            const bbx = this.ints(value, 4, key)
            if (bbx[0] < 0 || bbx[1] < 0) {
              throw new BDFParseError(
                `glyph '${String(meta[0])}' has a negative BBX size ${bbx[0]} ${bbx[1]}`,
                this.lineno
              )
            }
            meta.splice(2, 4, ...bbx)
            this.used.add(key)
          }
        } else if (key in GLYPH_METRICS) {
          if (!this.used.has(key)) {
            const i = GLYPH_METRICS[key]
            meta.splice(
              i,
              2,
              ...this.ints(
                value,
                2,
                key,
                key === 'VVECTOR' ? RE_VVECTOR_DELIMITER : undefined
              )
            )
            this.used.add(key)
          }
        } else if (key === 'BITMAP') {
          this.state = 5
        } else if (key === 'ENDCHAR') {
          this.finishGlyph()
          this.state = 3
        } else if (key === 'STARTCHAR') {
          this.missingEndchar()
          this.finishGlyph()
          this.startGlyph(value)
        } else if (key === 'ENDFONT') {
          this.missingEndchar()
          this.finishGlyph()
          this.state = 6
        } else {
          warn(
            `line ${this.lineno}: unknown keyword '${key}' in glyph '${String(meta[0])}' ignored`
          )
        }
        return

      case 3: // between glyphs
        if (key === 'STARTCHAR') {
          this.startGlyph(value)
          this.state = 4
        } else if (key === 'ENDFONT') {
          this.state = 6
        } else if (key === 'CHARS' && this.chars === null) {
          this.chars = this.ints(value, 1, key)[0]
        } else {
          warn(`line ${this.lineno}: unexpected line '${line}' ignored`)
        }
        return

      case 1: // properties
        if (key === 'ENDPROPERTIES') {
          if (this.propcount !== null && this.propcount !== this.propseen) {
            warn(
              `The property count next to 'STARTPROPERTIES' keyword is ${this.propcount}, which does not match the actual property count ${this.propseen}`
            )
          }
          this.state = 2
        } else if (key === 'COMMENT' || /^comment$/i.test(key)) {
          if (key !== 'COMMENT') {
            // `comment`, `Comment` ... would collide with the comment list
            // `props.comment` (SPEC-v3 §11.3)
            warn(
              `line ${this.lineno}: property '${key}' treated as a COMMENT line`
            )
          }
          if (!Array.isArray(font.props.comment)) {
            font.props.comment = []
          }
          font.props.comment.push(stripQuotePair(value))
        } else if (
          key === 'CHARS' ||
          key === 'STARTCHAR' ||
          key === 'ENDFONT'
        ) {
          warn(`line ${this.lineno}: missing 'ENDPROPERTIES'`)
          if (key === 'CHARS') {
            this.chars = this.ints(value, 1, key)[0]
            this.state = 3
          } else if (key === 'STARTCHAR') {
            warn("Cannot find 'CHARS' line")
            this.startGlyph(value)
            this.state = 4
          } else {
            warn('This font does not have any glyphs')
            this.state = 6
          }
        } else {
          const k = key.toLowerCase()
          this.propseen++
          font.props[k] = value === '' ? null : this.propvalue(value)
          font._propnames.set(k, key)
        }
        return

      case 2: // after ENDPROPERTIES
        if (key === 'CHARS') {
          this.chars = this.ints(value, 1, key)[0]
          this.state = 3
        } else if (key === 'STARTCHAR') {
          warn("Cannot find 'CHARS' line next to 'ENDPROPERTIES' line")
          this.startGlyph(value)
          this.state = 4
        } else if (key === 'ENDFONT') {
          warn('This font does not have any glyphs')
          this.state = 6
        } else {
          warn(`line ${this.lineno}: unexpected line '${line}' ignored`)
        }
        return
    }

    // state 0: header
    if (key === 'STARTFONT') {
      if (!RE_VERSION.test(value)) {
        throw new BDFParseError(
          `malformed version number in STARTFONT ${JSON.stringify(value)}`,
          this.lineno
        )
      }
      headers.bdfversion = Number(value)
    } else if (key === 'FONT') {
      headers.fontname = value
    } else if (key === 'SIZE') {
      ;[headers.pointsize, headers.xres, headers.yres] = this.ints(
        value,
        3,
        key
      )
    } else if (key === 'FONTBOUNDINGBOX') {
      const fbb = this.ints(value, 4, key)
      if (fbb[0] < 0 || fbb[1] < 0) {
        throw new BDFParseError(
          `negative FONTBOUNDINGBOX size ${fbb[0]} ${fbb[1]}`,
          this.lineno
        )
      }
      ;[headers.fbbx, headers.fbby, headers.fbbxoff, headers.fbbyoff] = fbb
    } else if (key === 'COMMENT') {
      if (!Array.isArray(headers.comment)) {
        headers.comment = []
      }
      ;(headers.comment as string[]).push(stripQuotePair(value))
    } else if (key === 'METRICSSET' || key === 'CONTENTVERSION') {
      headers[key.toLowerCase()] = this.ints(value, 1, key)[0]
    } else if (key in GLOBAL_METRICS) {
      const [k0, k1] = GLOBAL_METRICS[key]
      ;[headers[k0], headers[k1]] = this.ints(
        value,
        2,
        key,
        key === 'VVECTOR' ? RE_VVECTOR_DELIMITER : undefined
      )
    } else if (key === 'STARTPROPERTIES') {
      this.endHeaders()
      const first = value.split(RE_WS_RUN)[0]
      if (value === '') {
        this.propcount = null
      } else if (RE_INT.test(first)) {
        this.propcount = parseInt(first, 10)
      } else {
        warn(
          `line ${this.lineno}: malformed property count ${JSON.stringify(value)}`
        )
      }
      this.state = 1
    } else if (key === 'CHARS') {
      warn(NO_PROPS_WARNING)
      this.endHeaders()
      this.chars = this.ints(value, 1, key)[0]
      this.state = 3
    } else if (key === 'STARTCHAR') {
      warn(NO_PROPS_WARNING)
      warn("Cannot find 'CHARS' line")
      this.endHeaders()
      this.startGlyph(value)
      this.state = 4
    } else if (key === 'ENDFONT') {
      warn(NO_PROPS_WARNING)
      warn('This font does not have any glyphs')
      this.endHeaders()
      this.state = 6
    } else {
      warn(`line ${this.lineno}: unknown header keyword '${key}' ignored`)
    }
  }

  private propvalue(value: string): string | number {
    if (value[0] === '"') {
      let out = ''
      let i = 1
      const n = value.length
      while (i < n) {
        const c = value[i]
        if (c === '"') {
          if (i + 1 < n && value[i + 1] === '"') {
            out += '"'
            i += 2
            continue
          }
          return out
        }
        out += c
        i++
      }
      warn(`line ${this.lineno}: property value has no closing quote`)
      return out
    }
    if (RE_INT.test(value)) {
      // integers only in the 32-bit range (signed or unsigned), else raw text
      const n = parseInt(value, 10)
      if (n >= INT32_MIN && n <= UINT32_MAX) {
        return n
      }
    }
    return value
  }

  finish(): void {
    if (this.state <= 1) {
      throw new BDFParseError(
        'Unexpected end of file before the end of the headers',
        this.lineno + 1
      )
    }
    if (this.state === 4 || this.state === 5) {
      warn(
        `Unexpected end of file: missing ENDCHAR for glyph '${String(this.meta[0])}'`
      )
      this.finishGlyph()
    }
    if (this.state !== 6) {
      warn("This font does not have 'ENDFONT' keyword")
    }
    if (this.state >= 3 && (this.chars !== null || this.nglyphs > 0)) {
      if (this.chars === null) {
        warn("The glyph count next to 'CHARS' keyword does not exist")
      } else if (this.chars !== this.nglyphs) {
        warn(
          `The glyph count next to 'CHARS' keyword is ${this.chars}, which does not match the actual glyph count ${this.nglyphs}`
        )
      }
    }
  }
}

/**
 * `Font` object
 *
 * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font}
 */
export class Font {
  /** Global headers (`bdfversion`, `fontname`, `pointsize`, ...), `{}` before loading */
  public headers: BdfHeaders = {} as BdfHeaders
  /** Properties, keys in lower case; values `number`, `string` or `null`; `comment` → `string[]` */
  public props: Props = newProps()
  /** codepoint → 17-slot glyph list, file order */
  public glyphs: Map<number, GlyphMetaInFont> = new Map()
  /** Glyphs with `ENCODING -1`, file order */
  public unencoded: UnencodedGlyph[] = []
  /** @internal lower-case property name → original spelling */
  public _propnames: Map<string, string> = new Map()
  private __iconv?: IconvLike
  private __charset: string | null = null
  private __char2cp: EncodingOptions['char2cp'] | null = null
  private __cp2char: EncodingOptions['cp2char'] | null = null
  private __codec: CharsetCodec | null = null
  private __warnedCharsets = new Set<string>()

  // -------------------------------------------------------------------------
  // Loading

  private __reset(): void {
    this.headers = {} as BdfHeaders
    this.props = newProps()
    this.glyphs = new Map()
    this.unencoded = []
    this._propnames = new Map()
    this.__codec = null
  }

  /**
   * Load a BDF font from lines (async or sync iterable of strings, e.g. from
   * `readlineiter` / `fetchline` or an array of lines).
   *
   * @param filelines - Iterable of lines (line endings are tolerated)
   *
   * @returns The current `Font` object
   *
   * @throws BDFParseError on fatal parse errors
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#load_filelines}
   */
  async load_filelines(
    filelines: AsyncIterable<string> | Iterable<string>
  ): Promise<this> {
    this.__reset()
    const parser = new BdfParser(this)
    for await (const line of filelines) {
      parser.feed(line)
    }
    parser.finish()
    return this
  }

  /**
   * Load a BDF font from its text.
   *
   * @param text - BDF file content (LF, CRLF or CR line endings)
   *
   * @returns The current `Font` object
   *
   * @throws BDFParseError on fatal parse errors
   */
  load_string(text: string): this {
    this.__reset()
    const parser = new BdfParser(this)
    parser.feedText(text)
    parser.finish()
    return this
  }

  /**
   * Load a font from bytes, auto-detecting the format: PCF (`\x01fcp`),
   * TrueType (`00 01 00 00` / `true`), else BDF text (UTF-8). Gzip-compressed
   * data must be decompressed first (or loaded with `load_url()` / `$Font()`
   * which do it asynchronously).
   *
   * @param data - File content
   * @param options.pixelsize - pixel size for TrueType fonts without a `BDFP` table
   *
   * @returns The current `Font` object
   */
  load_bytes(
    data: Uint8Array | ArrayBuffer | ArrayBufferView,
    options: LoadOptions = {}
  ): this {
    const b = toBytes(data)
    const magic = String.fromCharCode(...b.subarray(0, 4))
    if (magic === '\x01fcp') {
      return this.__adopt(readPcf(b))
    }
    if (isGzip(b)) {
      throw new Error(
        'gzip-compressed data cannot be loaded synchronously: decompress it first, or use load_url() / $Font()'
      )
    }
    if (magic === '\x00\x01\x00\x00' || magic === 'true') {
      return this.__adopt(readTtf(b, { pixelsize: options.pixelsize }))
    }
    if (magic === 'OTTO') {
      throw new Error('CFF-based OpenType is not supported')
    }
    return this.load_string(
      new TextDecoder('utf-8', { ignoreBOM: true }).decode(b)
    )
  }

  /**
   * Fetch and load a font (BDF, PCF, gzip-compressed PCF/BDF or TrueType)
   * with the global `fetch` (browsers, Node ≥ 18, Deno, Bun).
   *
   * @param url - URL of the font file
   * @param init - `fetch` options
   * @param options.pixelsize - pixel size for TrueType fonts without a `BDFP` table
   *
   * @returns Promise of the current `Font` object
   */
  async load_url(
    url: string | URLLike,
    init?: FetchInit,
    options: LoadOptions = {}
  ): Promise<this> {
    const href = typeof url === 'string' ? url : url.href
    const res = await fetch(href, init as RequestInit | undefined)
    if (!res.ok) {
      throw new Error(
        `Failed to fetch ${href}: ${res.status} ${res.statusText}`
      )
    }
    return this.load_bytes_async(
      new Uint8Array(await res.arrayBuffer()),
      options
    )
  }

  /**
   * Same as {@link Font.load_bytes} but also accepts gzip-compressed data
   * (decompressed with `DecompressionStream`).
   *
   * @param data - File content
   * @param options.pixelsize - pixel size for TrueType fonts without a `BDFP` table
   *
   * @returns Promise of the current `Font` object
   */
  async load_bytes_async(
    data: Uint8Array | ArrayBuffer | ArrayBufferView,
    options: LoadOptions = {}
  ): Promise<this> {
    let b = toBytes(data)
    if (isGzip(b)) {
      b = await gunzip(b)
    }
    return this.load_bytes(b, options)
  }

  private __adopt(other: Font): this {
    this.headers = other.headers
    this.props = other.props
    this._propnames = other._propnames
    this.glyphs = other.glyphs
    this.unencoded = other.unencoded
    this.__codec = null
    return this
  }

  /**
   * Create a new, empty font (SPEC-v3 §2.6).
   *
   * @param options - see {@link FontCreateOptions}
   *
   * @returns New `Font` object
   *
   * @example
   * const font = Font.create({ pixelsize: 8, familyname: 'Tiny' })
   * font.newglyph(0x41, Bitmap.fromstring('.##.\n#..#\n####\n#..#'))
   */
  static create(options: FontCreateOptions = {}): Font {
    const pixelsize = options.pixelsize ?? 16
    const descent = options.descent ?? Math.floor(pixelsize / 8)
    const ascent = options.ascent ?? pixelsize - descent
    const familyname = options.familyname ?? 'Untitled'
    const fontname = options.fontname ?? familyname
    const font = newFont()
    font.headers = {
      bdfversion: 2.1,
      fontname,
      pointsize: pixelsize,
      xres: options.xres ?? 75,
      yres: options.yres ?? 75,
      fbbx: pixelsize,
      fbby: ascent + descent,
      fbbxoff: 0,
      fbbyoff: -descent,
      metricsset: 0,
    }
    font
      .setprop('FAMILY_NAME', familyname)
      .setprop('PIXEL_SIZE', pixelsize)
      .setprop('FONT_ASCENT', ascent)
      .setprop('FONT_DESCENT', descent)
      .setprop('CHARSET_REGISTRY', 'ISO10646')
      .setprop('CHARSET_ENCODING', '1')
    return font
  }

  // -------------------------------------------------------------------------
  // Encoding

  /**
   * Set encoding options: force a charset, pass an `iconv-lite` instance, or
   * define customized character ⇄ codepoint conversion functions.
   *
   * @param options - see {@link EncodingOptions}
   *
   * @returns The current `Font` object
   */
  encoding(options: EncodingOptions = {}): this {
    if (options.iconv !== undefined) {
      this.__iconv = options.iconv
    }
    if (options.charset !== undefined) {
      this.__charset = options.charset
        ? canonicalCharset(options.charset)
        : null
    }
    if (options.char2cp !== undefined) {
      this.__char2cp = options.char2cp
    }
    if (options.cp2char !== undefined) {
      this.__cp2char = options.cp2char
    }
    this.__codec = null
    return this
  }

  /**
   * Resolved charset (canonical key, SPEC-v3 §4): the one forced by
   * `encoding({ charset })` if any, else derived from the `CHARSET_REGISTRY` /
   * `CHARSET_ENCODING` properties (`'iso10646'` if missing).
   */
  get charset(): string {
    return (
      this.__charset ??
      sanitizeCharset(
        this.props.charset_registry as string | number | null | undefined,
        this.props.charset_encoding as string | number | null | undefined
      )
    )
  }

  /** Same as `encoding({ charset })` */
  set charset(value: string) {
    this.encoding({ charset: value })
  }

  private __getcodec(): CharsetCodec {
    if (this.__codec === null) {
      const cs = this.charset
      let codec = getCodec(cs, { iconv: this.__iconv })
      if (
        codec.gl94 &&
        !codec.gl &&
        detectGL(
          this.props.charset_encoding as string | number | null | undefined,
          this.glyphs.keys()
        )
      ) {
        codec = getCodec(cs, { iconv: this.__iconv, gl: true })
      }
      if (!codec.known && !this.__warnedCharsets.has(cs)) {
        this.__warnedCharsets.add(cs)
        warn(
          `Unknown charset '${cs}', characters are mapped to codepoints as Unicode`
        )
      }
      this.__codec = codec
    }
    return this.__codec
  }

  /** @internal invalidate the cached charset converter */
  _invalidate(): void {
    this.__codec = null
  }

  /**
   * Convert a character to a codepoint of this font's charset.
   *
   * @param char - Character (one code point)
   *
   * @returns Codepoint, or `null` if the character is not representable
   */
  char2cp(char: string): number | null {
    if (this.__char2cp) {
      return this.__char2cp(char) ?? null
    }
    return this.__getcodec().char2cp(char)
  }

  /**
   * Convert a codepoint of this font's charset to a character.
   *
   * @param cp - Codepoint
   *
   * @returns Character, or `null` if the codepoint is not representable
   */
  cp2char(cp: number): string | null {
    if (this.__cp2char) {
      return this.__cp2char(cp) ?? null
    }
    return this.__getcodec().cp2char(cp)
  }

  // -------------------------------------------------------------------------
  // Properties

  /**
   * Get a property (case-insensitive key).
   *
   * @param key - Property name
   *
   * @returns Value, or `null` if missing
   */
  getprop(key: string): PropValue | string[] {
    const k = key.toLowerCase()
    const v = Object.prototype.hasOwnProperty.call(this.props, k)
      ? this.props[k]
      : undefined
    return v === undefined ? null : v
  }

  /**
   * Set a property (case-insensitive key). Remembers the given spelling of a
   * new key (used when writing).
   *
   * @param key - Property name
   * @param value - `number`, `string` or `null`
   *
   * @returns The current `Font` object
   */
  setprop(key: string, value: string | number | null): this {
    const k = key.toLowerCase()
    if (!this._propnames.has(k) && k !== 'comment') {
      this._propnames.set(k, key)
    }
    this.props[k] = value
    this.__codec = null
    return this
  }

  /**
   * Delete a property (case-insensitive key), if present.
   *
   * @param key - Property name
   *
   * @returns The current `Font` object
   */
  delprop(key: string): this {
    const k = key.toLowerCase()
    delete this.props[k]
    this._propnames.delete(k)
    this.__codec = null
    return this
  }

  /**
   * Compute SWIDTH (scalable width, 1/1000 em) from DWIDTH (pixels):
   * `round(dwx * 72000 / (pointsize * xres))`, or `round(dwx * 1000 / fbbx)`
   * if `pointsize` or `xres` is missing.
   *
   * @param dwx - DWIDTH x in pixels
   *
   * @returns SWIDTH x
   */
  swidth(dwx: number): number {
    const pointsize = this.headers?.pointsize
    const xres = this.headers?.xres
    if (pointsize && xres) {
      return rnd((dwx * 72000) / (pointsize * xres))
    }
    return rnd((dwx * 1000) / Math.max(this.headers?.fbbx || 1, 1))
  }

  // -------------------------------------------------------------------------
  // Querying

  /**
   * How many (encoded) glyphs actually exist in the font.
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#length}
   */
  get length(): number {
    return this.glyphs.size
  }

  /**
   * Similar to `.iterglyphs()`, except it returns an `array` of glyph codepoints instead of an `iterator` of `Glyph` objects.
   *
   * @param order - Order: 1 ascending codepoints (default), 0 file order, 2 descending, -1 reverse file order
   * @param r - Codepoint range: `n` (cp < n), `[a, b]` or `[[a, b], ...]`
   *
   * @returns An array of the codepoints of glyphs
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#itercps}
   */
  itercps(order?: OrderType | null, r?: CodepointRangeType | null): number[] {
    const _order = order ?? 1
    const _r = r ?? null
    let ret: number[]
    const ks = [...this.glyphs.keys()]
    switch (_order) {
      case 1:
        ret = ks.sort((a, b) => a - b)
        break
      case 0:
        ret = ks
        break
      case 2:
        ret = ks.sort((a, b) => b - a)
        break
      case -1:
        ret = ks.reverse()
        break
      default:
        throw new Error(`Unknown order ${String(_order)}`)
    }
    return _r === null ? ret : ret.filter((cp) => cpInRange(cp, _r))
  }

  /**
   * Returns an iterator of all the glyphs (as attached `Glyph` objects) in the font (default) or in the specified codepoint range in the font, sorted by the specified order (or by the ascending codepoint order by default).
   *
   * @param order - Order
   * @param r - Codepoint range
   *
   * @returns An iterator of glyphs as `Glyph` objects
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#iterglyphs}
   */
  *iterglyphs(
    order?: OrderType | null,
    r?: CodepointRangeType | null
  ): IterableIterator<Glyph> {
    for (const cp of this.itercps(order, r)) {
      yield this.glyphbycp(cp) as Glyph
    }
  }

  private __glyphfromlist(list: GlyphMetaInFont): Glyph {
    const g = new Glyph(listToMeta(list), this)
    g._attach(list)
    return g
  }

  /**
   * Get a glyph (as attached `Glyph` object) by its codepoint.
   *
   * @param codepoint - Codepoint
   *
   * @returns `Glyph` object, or `null` if the glyph does not exist in the font
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#glyphbycp}
   */
  glyphbycp(codepoint: number): Glyph | null {
    const list = this.glyphs.get(codepoint)
    return list === undefined ? null : this.__glyphfromlist(list)
  }

  /**
   * Get a glyph (as attached `Glyph` object) by its character (converted
   * with the font's charset, see `char2cp`).
   *
   * @param character - Character
   *
   * @returns `Glyph` object, or `null` if the glyph does not exist in the font
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#glyph}
   */
  glyph(character: string): Glyph | null {
    const cp = this.char2cp(character)
    return cp === null ? null : this.glyphbycp(cp)
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
    for (const c of str) {
      const cp = this.char2cp(c)
      if (cp === null || !this.glyphs.has(cp)) {
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
  drawcps(cps: number[], options: DrawOptions = {}): Bitmap {
    const _linelimit = options.linelimit ?? 512
    const _mode = options.mode ?? 1
    const _direction = options.direction ?? 'lrtb'
    const _usecurrentglyphspacing = options.usecurrentglyphspacing ?? false
    const _missing = options.missing ?? null
    if (this.headers.fbbx === undefined) {
      throw new Error('Font is not loaded')
    }
    let interglyph_global: number | null = null
    let interglyph_str: 'dwx0' | 'dwx1' = 'dwx0'
    let interglyph_str2: 'dwy0' | 'dwy1' = 'dwy0'
    let fbbsize = 0
    const dire = DIRE_SHORTCUT_MAP[_direction] ?? _direction
    const dire_glyph_str = dire.slice(0, 2) as DirectionPartType
    const dire_line_str = dire.slice(2, 4) as DirectionPartType
    let dire_glyph: DirectionNumberType
    let dire_line: DirectionNumberType
    if (dire_glyph_str in DIRE_MAP && dire_line_str in DIRE_MAP) {
      dire_glyph = DIRE_MAP[dire_glyph_str]
      dire_line = DIRE_MAP[dire_line_str]
    } else {
      dire_glyph = 1
      dire_line = 0
    }
    const align_glyph: 0 | 1 = dire_line === 0 || dire_line === 2 ? 1 : 0
    const align_line: 0 | 1 = dire_glyph === 1 || dire_glyph === -1 ? 1 : 0
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
        interglyph_global = this.headers[interglyph_str] ?? null
      } else if (interglyph_str2 in this.headers) {
        interglyph_global = this.headers[interglyph_str2] ?? null
      }
    }
    const list_of_bitmaplist: Bitmap[][] = []
    let bitmaplist: Bitmap[] = []
    const list_of_offsetlist: number[][] = []
    let offsetlist: number[] = []
    let size = 0
    const append_bitmaplist_and_offsetlist = (): void => {
      list_of_bitmaplist.push(bitmaplist)
      if (_usecurrentglyphspacing) {
        offsetlist.shift()
      } else {
        offsetlist.pop()
      }
      list_of_offsetlist.push(offsetlist)
    }
    for (let i = 0; i < cps.length;) {
      const cp = cps[i]
      let glyph = this.glyphbycp(cp)
      if (glyph === null) {
        if (_missing) {
          glyph =
            _missing instanceof Glyph ? _missing : new Glyph(_missing, this)
        } else {
          glyph = new Glyph(EMPTY_GLYPH, this)
        }
      }
      const bitmap = glyph.draw()
      const w = bitmap.width()
      let offset = 0
      if (_mode === 1) {
        let interglyph: number | null =
          glyph.meta[interglyph_str] || glyph.meta[interglyph_str2]
        if (interglyph === undefined || interglyph === null) {
          interglyph = interglyph_global
        }
        if (interglyph !== null) {
          offset = interglyph - fbbsize
        }
      }
      size += w + offset
      if (size <= _linelimit) {
        bitmaplist.push(bitmap)
        offsetlist.push(offset)
        i++
      } else {
        if (bitmaplist.length === 0) {
          throw new Error(
            `\`linelimit\` (${_linelimit}) is too small the line can't even contain one glyph: "${String(glyph.chr())}" (codepoint ${cp}, width: ${w})`
          )
        }
        append_bitmaplist_and_offsetlist()
        size = 0
        bitmaplist = []
        offsetlist = []
      }
    }
    if (bitmaplist.length !== 0) {
      append_bitmaplist_and_offsetlist()
    }

    const list_of_bitmap_line_lists = list_of_bitmaplist.map((bl, i) =>
      Bitmap.concatall(bl, {
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
  draw(str: string, options: DrawOptions = {}): Bitmap {
    // characters that are not representable map to -1 (never a key of
    // `glyphs`), so they are drawn as missing glyphs
    return this.drawcps(
      Array.from(str, (c) => this.char2cp(c) ?? -1),
      options
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
    return this.drawcps(this.itercps(order, r), {
      linelimit,
      mode: mode ?? 0,
      direction,
      usecurrentglyphspacing,
    })
  }

  // -------------------------------------------------------------------------
  // Editing

  /**
   * @internal Write an attached glyph's meta back into the font (moving it if
   * its codepoint changed). Detaches the glyph if its slot no longer exists.
   */
  _writeback(glyph: Glyph): void {
    const store = glyph._store
    if (store === null) {
      return
    }
    const oldcp = store[1]
    let uidx = -1
    if (oldcp < 0) {
      uidx = this.unencoded.findIndex((e) => e.meta === store)
      if (uidx === -1) {
        glyph._detach()
        return
      }
    } else if (this.glyphs.get(oldcp) !== store) {
      glyph._detach()
      return
    }
    const values = metaToList(glyph.meta) as unknown[]
    const synced = glyph._synced
    if (synced !== null) {
      // slots this Glyph object did not change but that were changed in the
      // font meanwhile (by another Glyph object on the same glyph, or by
      // `charsetconvert`) keep the font's value instead of being reverted
      for (let i = 0; i < 17; i++) {
        if (
          slotEquals(values[i], synced[i]) &&
          !slotEquals(store[i], synced[i])
        ) {
          values[i] = store[i]
        }
      }
    }
    values[16] = Array.isArray(values[16]) ? [...values[16]] : []
    if (values[1] === null || values[1] === undefined) {
      values[1] = -1
    } else if (!Number.isInteger(values[1])) {
      throw new TypeError(
        `Glyph codepoint must be an integer, not ${String(values[1])}`
      )
    } else if ((values[1] as number) < 0) {
      values[1] = -1
    }
    for (let i = 0; i < 17; i++) {
      ;(store as unknown[])[i] = values[i]
    }
    const newcp = store[1]
    Object.assign(glyph.meta, listToMeta(store), { hexdata: [...store[16]] })
    glyph._setsynced(store)
    if (oldcp >= 0 ? newcp !== oldcp : newcp >= 0) {
      if (oldcp < 0) {
        this.unencoded.splice(uidx, 1)
      } else {
        this.glyphs.delete(oldcp)
      }
      if (newcp < 0) {
        this.unencoded.push({ altcode: null, meta: store })
      } else {
        this.glyphs.set(newcp, store)
      }
    }
    this.__codec = null
  }

  private __defaultname(cp: number): string {
    return cp >= 0
      ? defaultglyphname(cp, isUnicodeCharset(this.charset))
      : `char${cp}`
  }

  /**
   * Add a glyph to the font (and attach it: the `Glyph` object now writes its
   * edits back to this font).
   *
   * If its codepoint already exists, the existing glyph is replaced (in
   * place) when `replace` is `true` (default), else kept (with a warning).
   * Codepoint `-1` appends the glyph to `unencoded`.
   *
   * @param glyph - `Glyph` object or meta object
   * @param replace - Replace an existing glyph with the same codepoint, default `true`
   *
   * @returns The current `Font` object
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#addglyph}
   */
  addglyph(
    glyph: Glyph | Partial<GlyphMeta>,
    replace: boolean | { replace?: boolean } = true
  ): this {
    const _replace =
      typeof replace === 'object' ? (replace.replace ?? true) : replace
    const isGlyph = glyph instanceof Glyph
    const meta: Partial<GlyphMeta> = isGlyph ? glyph.meta : glyph
    for (const k of Object.keys(meta)) {
      if (!(META_TITLES as readonly string[]).includes(k)) {
        throw new Error(`Unknown glyph meta key "${k}"`)
      }
    }
    const cp = meta.codepoint
    if (typeof cp !== 'number' || !Number.isInteger(cp)) {
      throw new Error('The glyph has no codepoint')
    }
    const list = metaToList({
      glyphname: meta.glyphname ?? this.__defaultname(cp),
      codepoint: cp < 0 ? -1 : cp,
      bbw: meta.bbw ?? 0,
      bbh: meta.bbh ?? 0,
      bbxoff: meta.bbxoff ?? 0,
      bbyoff: meta.bbyoff ?? 0,
      swx0: meta.swx0 ?? null,
      swy0: meta.swy0 ?? null,
      dwx0: meta.dwx0 ?? null,
      dwy0: meta.dwy0 ?? null,
      swx1: meta.swx1 ?? null,
      swy1: meta.swy1 ?? null,
      dwx1: meta.dwx1 ?? null,
      dwy1: meta.dwy1 ?? null,
      vvectorx: meta.vvectorx ?? null,
      vvectory: meta.vvectory ?? null,
      hexdata: [...(meta.hexdata ?? [])],
    })
    if (cp < 0) {
      this.unencoded.push({ altcode: null, meta: list })
    } else {
      if (this.glyphs.has(cp) && !_replace) {
        warn(`Glyph with codepoint ${cp} already exists, not replaced`)
        return this
      }
      this.glyphs.set(cp, list)
    }
    if (isGlyph) {
      glyph.font = this
      glyph.meta = listToMeta(list)
      glyph._attach(list)
    }
    this.__codec = null
    return this
  }

  /**
   * Remove a glyph from the font (no-op if missing). A `Glyph` object attached
   * to this font is removed from its slot (works for unencoded glyphs too)
   * and detached.
   *
   * @param cpOrGlyph - Codepoint or `Glyph` object of the glyph to remove
   *
   * @returns The current `Font` object
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#removeglyph}
   */
  removeglyph(cpOrGlyph: number | Glyph): this {
    if (typeof cpOrGlyph === 'number') {
      this.glyphs.delete(cpOrGlyph)
    } else {
      // a glyph that was attached removes exactly its own slot: no-op if it
      // was already removed or replaced (never the glyph that now has its
      // codepoint)
      const store = cpOrGlyph._slot
      if (store !== null && cpOrGlyph.font === this) {
        if (store[1] < 0) {
          const i = this.unencoded.findIndex((e) => e.meta === store)
          if (i !== -1) {
            this.unencoded.splice(i, 1)
          }
        } else if (this.glyphs.get(store[1]) === store) {
          this.glyphs.delete(store[1])
        }
      } else if (cpOrGlyph.cp() >= 0) {
        this.glyphs.delete(cpOrGlyph.cp())
      }
      cpOrGlyph._detach()
    }
    this.__codec = null
    return this
  }

  /**
   * Create a new glyph in the font (replacing any existing glyph with the same
   * codepoint) and return it (attached).
   *
   * Without bitmap: empty glyph (`BBX 0 0 0 0`) with `DWIDTH` = `dwidth` or
   * the font bounding box width. With bitmap: `DWIDTH` = `dwidth` or the
   * bitmap width, then `setbitmap(bitmap, mode)`. `SWIDTH` is computed with
   * `swidth()`.
   *
   * @param cp - Codepoint (`-1` for an unencoded glyph)
   * @param bitmap - Bitmap, or an options object `{bitmap, mode, name, dwidth}`
   * @param options - see {@link NewglyphOptions}
   *
   * @returns The new `Glyph` object
   *
   * @example
   * font.newglyph(0x41, Bitmap.fromstring('.#.\n#.#\n###\n#.#'), { mode: 1, dwidth: 4 })
   */
  newglyph(
    cp: number,
    bitmap?: Bitmap | NewglyphOptions | null,
    options: NewglyphOptions = {}
  ): Glyph {
    let opts: NewglyphOptions
    if (bitmap instanceof Bitmap || bitmap === null || bitmap === undefined) {
      opts = { ...options, bitmap: bitmap ?? options.bitmap ?? null }
    } else {
      opts = { ...bitmap, ...options }
    }
    const bm = opts.bitmap ?? null
    const name = opts.name ?? this.__defaultname(cp)
    const dwx0 =
      opts.dwidth ?? (bm !== null ? bm.width() : (this.headers.fbbx ?? 0))
    const meta: GlyphMeta = {
      glyphname: name,
      codepoint: cp < 0 ? -1 : cp,
      bbw: 0,
      bbh: 0,
      bbxoff: 0,
      bbyoff: 0,
      swx0: this.swidth(dwx0),
      swy0: 0,
      dwx0,
      dwy0: 0,
      swx1: null,
      swy1: null,
      dwx1: null,
      dwy1: null,
      vvectorx: null,
      vvectory: null,
      hexdata: [],
    }
    const g = new Glyph(meta, this)
    this.addglyph(g)
    if (bm !== null) {
      g.setbitmap(bm, opts.mode ?? 0)
    }
    return g
  }

  /**
   * Recompute FONTBOUNDINGBOX as the union of all glyph boxes (encoded and
   * unencoded glyphs with `bbw > 0` and `bbh > 0`). Unchanged if there are
   * none.
   *
   * @returns The current `Font` object
   */
  updatebbox(): this {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    const lists = [
      ...this.glyphs.values(),
      ...this.unencoded.map((u) => u.meta),
    ]
    for (const l of lists) {
      const [bbw, bbh, bbxoff, bbyoff] = [l[2], l[3], l[4], l[5]]
      if (bbw > 0 && bbh > 0) {
        x0 = Math.min(x0, bbxoff)
        y0 = Math.min(y0, bbyoff)
        x1 = Math.max(x1, bbxoff + bbw)
        y1 = Math.max(y1, bbyoff + bbh)
      }
    }
    if (x0 !== Infinity) {
      this.headers.fbbx = x1 - x0
      this.headers.fbby = y1 - y0
      this.headers.fbbxoff = x0
      this.headers.fbbyoff = y0
    }
    return this
  }

  private __copyinto(font: Font, withGlyphs: boolean): Font {
    const headers = { ...this.headers }
    if (Array.isArray(headers.comment)) {
      headers.comment = [...headers.comment]
    }
    font.headers = headers
    font.props = copyProps(this.props)
    font._propnames = new Map(this._propnames)
    font.__iconv = this.__iconv
    font.__charset = this.__charset
    font.__char2cp = this.__char2cp
    font.__cp2char = this.__cp2char
    if (withGlyphs) {
      for (const [cp, list] of this.glyphs) {
        font.glyphs.set(cp, cloneList(list))
      }
      font.unencoded = this.unencoded.map((u) => ({
        altcode: u.altcode,
        meta: cloneList(u.meta),
      }))
    }
    return font
  }

  /**
   * Deep copy of the font (headers, properties, glyphs, unencoded glyphs,
   * encoding options).
   *
   * @returns New `Font` object
   */
  clone(): Font {
    return this.__copyinto(newFont(), true)
  }

  /**
   * New font (deep copy) keeping only the glyphs whose codepoint passes the
   * range filter `r` (same as `itercps`); unencoded glyphs are dropped.
   *
   * @param r - Codepoint range: `n` (cp < n), `[a, b]` or `[[a, b], ...]`
   *
   * @returns New `Font` object
   *
   * @example
   * const ascii = font.subset([0x20, 0x7e])
   */
  subset(r: CodepointRangeType | null): Font {
    const font = this.__copyinto(newFont(), false)
    for (const [cp, list] of this.glyphs) {
      if (cpInRange(cp, r)) {
        font.glyphs.set(cp, cloneList(list))
      }
    }
    return font
  }

  /**
   * Copy (deep) the (encoded) glyphs of another font into this one; existing
   * codepoints are kept unless `replace`.
   *
   * @param other - Other font
   * @param replace - Replace existing glyphs, default `false`
   *
   * @returns The current `Font` object
   */
  merge(other: Font, replace = false): this {
    for (const [cp, list] of other.glyphs) {
      if (replace || !this.glyphs.has(cp)) {
        this.glyphs.set(cp, cloneList(list))
      }
    }
    this.__codec = null
    return this
  }

  /**
   * Transform glyph bitmaps: `glyph.transform(fn, mode)` for every glyph
   * passing the range filter `r` (all glyphs, including unencoded ones, if
   * `r` is not given).
   *
   * @param fn - Bitmap transformation, e.g. `(b) => b.bold()`
   * @param r - Codepoint range
   * @param mode - Draw / placement mode, default 0
   *
   * @returns The current `Font` object
   *
   * @example
   * font.transform((b) => b.italic(), [0x41, 0x5a])
   */
  transform(
    fn: (bitmap: Bitmap) => Bitmap | null | undefined | void,
    r: CodepointRangeType | null = null,
    mode: GlyphDrawModeType = 0
  ): this {
    for (const cp of this.itercps(0, r)) {
      this.__glyphfromlist(this.glyphs.get(cp) as GlyphMetaInFont).transform(
        fn,
        mode
      )
    }
    if (r === null) {
      for (const u of [...this.unencoded]) {
        this.__glyphfromlist(u.meta).transform(fn, mode)
      }
    }
    return this
  }

  /**
   * Re-encode every glyph codepoint from the current charset to `newcharset`
   * (glyphs not representable in the new charset are dropped, with one
   * summary warning), set the `CHARSET_REGISTRY` / `CHARSET_ENCODING`
   * properties accordingly (94×94 sets use the X11 GL form, encoding `"0"`)
   * and clear any `encoding()` override (except `iconv`).
   *
   * @param newcharset - New charset name, e.g. `'gb2312'`, `'iso8859-2'`, `'big5'`, `'iso10646'`
   *
   * @returns The current `Font` object
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#charsetconvert}
   */
  charsetconvert(newcharset: string): this {
    const key = canonicalCharset(newcharset)
    const [registry, enc] = charsetProps(key)
    const codec = getCodec(key, { iconv: this.__iconv, gl: true })
    if (!codec.known) {
      warn(
        `Unknown charset '${key}', characters are mapped to codepoints as Unicode`
      )
    }
    const newGlyphs: Map<number, GlyphMetaInFont> = new Map()
    let dropped = 0
    for (const [cp, list] of this.glyphs) {
      const ch = this.cp2char(cp)
      const ncp = _isOneChar(ch) ? codec.char2cp(ch) : null
      if (ncp === null) {
        dropped++
        continue
      }
      if (newGlyphs.has(ncp)) {
        // two glyphs map to the same codepoint: the later one wins
        dropped++
        newGlyphs.delete(ncp)
      }
      list[1] = ncp
      newGlyphs.set(ncp, list)
    }
    if (dropped > 0) {
      warn(
        `${dropped} glyph(s) could not be converted to the charset '${key}' and were dropped`
      )
    }
    this.glyphs = newGlyphs
    this.__charset = null
    this.__char2cp = null
    this.__cp2char = null
    this.setprop('CHARSET_REGISTRY', registry)
    this.setprop('CHARSET_ENCODING', enc)
    return this
  }

  // -------------------------------------------------------------------------
  // Output

  /**
   * Convert the font to BDF text (SPEC-v3 §5). Reproduces FontForge-written
   * files byte for byte.
   *
   * @returns BDF string (ends with `ENDFONT\n`)
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#tobdf}
   **/
  tobdf(): string {
    const h = this.headers
    const missing = REQUIRED_HEADERS.filter(
      (k) => h[k] === undefined || h[k] === null
    )
    if (missing.length > 0) {
      throw new Error(
        `Cannot write BDF: missing header(s) ${missing.join(', ')} (font not loaded?)`
      )
    }
    const lines: string[] = []
    const both = (kw: string, a: unknown, b: unknown): void => {
      if (a !== null && a !== undefined && b !== null && b !== undefined) {
        lines.push(`${kw} ${String(a)} ${String(b)}`)
      }
    }
    lines.push(`STARTFONT ${fmtver(h.bdfversion ?? 2.1)}`)
    lines.push(`FONT ${h.fontname ?? ''}`)
    lines.push(`SIZE ${h.pointsize} ${h.xres} ${h.yres}`)
    lines.push(`FONTBOUNDINGBOX ${h.fbbx} ${h.fbby} ${h.fbbxoff} ${h.fbbyoff}`)
    if (
      h.metricsset !== undefined &&
      h.metricsset !== null &&
      h.metricsset !== 0
    ) {
      lines.push(`METRICSSET ${h.metricsset}`)
    }
    if (h.contentversion !== undefined && h.contentversion !== null) {
      lines.push(`CONTENTVERSION ${h.contentversion}`)
    }
    both('SWIDTH', h.swx0, h.swy0)
    both('DWIDTH', h.dwx0, h.dwy0)
    both('SWIDTH1', h.swx1, h.swy1)
    both('DWIDTH1', h.dwx1, h.dwy1)
    both('VVECTOR', h.vvectorx, h.vvectory)
    for (const c of h.comment || []) {
      lines.push(`COMMENT "${c}"`)
    }

    const propkeys = propKeys(this.props, this._propnames)
    // `props.comment` is the list of COMMENT lines; like the Python library,
    // any other falsy value is no comment and a string is iterated (a value
    // that is not iterable throws)
    const pc = this.props.comment as unknown
    const propcomments: string[] = pc ? [...(pc as Iterable<string>)] : []
    if (propkeys.length > 0 || propcomments.length > 0) {
      lines.push(`STARTPROPERTIES ${propkeys.length}`)
      for (const c of propcomments) {
        lines.push(`COMMENT "${c}"`)
      }
      for (const k of propkeys) {
        const name = this._propnames.get(k) ?? k.toUpperCase()
        const v = this.props[k]
        if (v === null || v === undefined) {
          lines.push(name)
        } else if (typeof v === 'number') {
          lines.push(`${name} ${fmtnum(v)}`)
        } else {
          lines.push(`${name} "${String(v).replace(/"/g, '""')}"`)
        }
      }
      lines.push('ENDPROPERTIES')
    }

    lines.push(`CHARS ${this.glyphs.size + this.unencoded.length}`)
    const glyph = (g: GlyphMetaInFont, encoding: string): void => {
      lines.push(`STARTCHAR ${g[0]}`)
      lines.push(`ENCODING ${encoding}`)
      both('SWIDTH', g[6], g[7])
      both('DWIDTH', g[8], g[9])
      both('SWIDTH1', g[10], g[11])
      both('DWIDTH1', g[12], g[13])
      both('VVECTOR', g[14], g[15])
      lines.push(`BBX ${g[2]} ${g[3]} ${g[4]} ${g[5]}`)
      lines.push('BITMAP')
      for (const row of g[16]) {
        lines.push(row)
      }
      lines.push('ENDCHAR')
    }
    for (const [cp, g] of this.glyphs) {
      glyph(g, String(cp))
    }
    for (const u of this.unencoded) {
      glyph(u.meta, u.altcode === null ? '-1' : `-1 ${u.altcode}`)
    }
    lines.push('ENDFONT')
    return lines.join('\n') + '\n'
  }

  /**
   * Convert the font to PCF (SPEC-v3 §6), byte-identical to `bdftopcf` with
   * default options.
   *
   * @param options - PCF writer options (`byteorder`, `bitorder`, `glyphpad`, `scanunit`)
   *
   * @returns PCF file content
   */
  topcf(options?: Parameters<typeof writePcf>[1]): Uint8Array {
    return writePcf(this, options)
  }

  /**
   * Convert the font to a pixel TrueType font (SPEC-v3 §8), with square or
   * round dots.
   *
   * @param options - TTF writer options (`shape`, `dotsize`, `ppu`, `metadata`, `timestamp`)
   *
   * @returns TTF file content
   */
  tottf(options?: Parameters<typeof writeTtf>[1]): Uint8Array {
    return writeTtf(this, options)
  }

  /**
   * Convert the BDF font to SVG font string
   *
   * @param options - see {@link SvgFontOptions}
   *
   * @returns SVG font string
   *
   * @see online docs: {@link https://font.tomchen.org/bdfparser_js/font#tosvgfont}
   */
  tosvgfont(options: SvgFontOptions = {}): string {
    const xPathOffset = options.pathOffsets?.x ?? 0
    const yPathOffset = options.pathOffsets?.y ?? 0
    const unicodeAttrControlCharNoSkip =
      options.unicodeAttr?.controlCharNoSkip ?? false
    const unicodeAttrFormat = options.unicodeAttr?.format ?? 'hexncr'
    const XML_ESC: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;',
    }
    const toXmlValue = (value: string | number | bigint): string =>
      (typeof value === 'string' ? value : fmtnum(value)).replace(
        /[<>&"']/g,
        (char) => XML_ESC[char]
      )
    // `parseInt(String(v), 10) || 0` with exact integers (like Python's int())
    const intprop = (v: unknown): number | bigint => {
      if (v === null || v === undefined) {
        return 0
      }
      if (typeof v === 'number' && Number.isInteger(v)) {
        return v
      }
      const m = pyLeadingInt(String(v))
      if (m === null) {
        return 0
      }
      const n = BigInt(m)
      return n >= Number.MIN_SAFE_INTEGER && n <= Number.MAX_SAFE_INTEGER
        ? Number(n)
        : n
    }
    const half = (v: number | bigint): number => Number(v) * 0.5
    const props = this.props
    const headers = this.headers

    const unitsPerEm = Math.max(headers.fbbx ?? 0, headers.fbby ?? 0) || 100
    const fontAscent = intprop(props.font_ascent) || unitsPerEm * 0.8
    const fontDescent = intprop(props.font_descent) || -unitsPerEm * 0.2

    let svg = '<svg xmlns="http://www.w3.org/2000/svg" version="1.1">\n'

    const metadataLines: string[] = []
    if (props.family_name || props.family) {
      metadataLines.push(`Title: ${String(props.family_name || props.family)}`)
    }
    if (props.weight_name) {
      metadataLines.push(`Weight: ${String(props.weight_name)}`)
    }
    if (props.font_version) {
      metadataLines.push(`Version: ${String(props.font_version)}`)
    }
    if (props.foundry) {
      metadataLines.push(`Foundry: ${String(props.foundry)}`)
    }
    if (props.copyright) {
      metadataLines.push(`Copyright: ${String(props.copyright)}`)
    }
    if (props.notice) {
      metadataLines.push(`Notice: ${String(props.notice)}`)
    }
    if (metadataLines.length > 0) {
      svg +=
        '<metadata>\n  ' +
        toXmlValue(metadataLines.join('\n  ')) +
        '\n</metadata>\n'
    }

    // Unicode value of a glyph (SPEC-v3 §11.5): `cp2char`, one code point,
    // not a surrogate; `null` if the glyph has no Unicode mapping
    const unicodeOf = (cp: number): number | null => {
      const ch = this.cp2char(cp)
      if (typeof ch !== 'string') {
        return null
      }
      const u = ch.codePointAt(0)
      if (
        u === undefined ||
        ch.length !== (u > 0xffff ? 2 : 1) ||
        (u >= 0xd800 && u <= 0xdfff)
      ) {
        return null
      }
      return u
    }

    // unicode range from all glyphs
    const hex4 = (n: number): string =>
      n.toString(16).toUpperCase().padStart(4, '0')
    const unis = new Set<number>()
    for (const cp of this.glyphs.keys()) {
      const u = unicodeOf(cp)
      if (u !== null) {
        unis.add(u)
      }
    }
    const cps = [...unis].sort((a, b) => a - b)
    const ranges: string[] = []
    if (cps.length > 0) {
      let rangeStart = cps[0]
      let prev = rangeStart
      for (let i = 1; i <= cps.length; i++) {
        const current = cps[i]
        if (current !== prev + 1) {
          ranges.push(
            rangeStart === prev
              ? `U+${hex4(rangeStart)}`
              : `U+${hex4(rangeStart)}-${hex4(prev)}`
          )
          rangeStart = current
        }
        prev = current
      }
    }

    const defaultAdv = headers.dwx0 || unitsPerEm
    svg += `<defs>
  <font id="${toXmlValue(
    (headers.fontname || '').replace(/^-/, '').toLowerCase()
  )}" horiz-adv-x="${defaultAdv}">`

    const fontFaceAttributes: Record<string, string | number | bigint> = {
      'font-family': String(
        props.family_name || props.family || headers.fontname || ''
      ),
      'font-weight': String(props.weight_name || 'normal'),
      'font-style': String(props.slant || 'normal'),
      'units-per-em': unitsPerEm,
      'cap-height': intprop(props.cap_height) || fontAscent,
      'x-height': intprop(props.x_height) || half(fontAscent),
      ascent: fontAscent,
      descent: fontDescent,
      bbox: `${headers.fbbxoff || 0} ${headers.fbbyoff || 0} ${
        headers.fbbx || unitsPerEm
      } ${headers.fbby || unitsPerEm}`,
      'underline-thickness':
        intprop(props.underline_thickness) || rnd(unitsPerEm * 0.05),
      'underline-position':
        intprop(props.underline_position) || rnd(-unitsPerEm * 0.075),
      'unicode-range': ranges.join(', '),
    }

    svg += '\n<font-face\n'
    for (const [key, value] of Object.entries(fontFaceAttributes)) {
      svg += `  ${key}="${toXmlValue(value)}"\n`
    }
    svg += '></font-face>\n'

    const notdef = `M0,0h${unitsPerEm}v${unitsPerEm}h-${unitsPerEm}z`
    svg += `<missing-glyph horiz-adv-x="${defaultAdv}" d="${notdef}" />\n<glyph glyph-name=".notdef" horiz-adv-x="${defaultAdv}" d="${notdef}" />\n`

    for (const glyph of this.iterglyphs()) {
      const glyphPath = glyph.draw().tosvg(1, 'pathOnly', true, {
        x: xPathOffset,
        y: yPathOffset,
      })
      if (!glyphPath) {
        continue
      }
      const u = unicodeOf(glyph.meta.codepoint)
      const glyphAttributes: Record<string, string | number> = {
        'glyph-name': glyph.meta.glyphname,
      }
      if (u !== null && (unicodeAttrControlCharNoSkip || u >= 32)) {
        glyphAttributes.unicode =
          unicodeAttrFormat === 'decncr'
            ? `&#${u};`
            : unicodeAttrFormat === 'char'
              ? toXmlValue(String.fromCodePoint(u))
              : `&#x${u.toString(16)};`
      }
      glyphAttributes['horiz-adv-x'] = glyph.meta.dwx0 || defaultAdv
      glyphAttributes.d = glyphPath
      if (glyph.meta.swy0) {
        glyphAttributes['vert-adv-y'] = glyph.meta.swy0
      }
      if (glyph.meta.vvectorx) {
        glyphAttributes['vert-origin-x'] = glyph.meta.vvectorx
      }
      if (glyph.meta.vvectory) {
        glyphAttributes['vert-origin-y'] = glyph.meta.vvectory
      }

      svg += '<glyph\n'
      for (const [key, value] of Object.entries(glyphAttributes)) {
        svg += `  ${key}="${key === 'unicode' ? value : toXmlValue(value)}"\n`
      }
      svg += '></glyph>\n'
    }

    svg += '</font>\n</defs>\n</svg>'

    return svg
  }
}

/**
 * `new Font()` outside the class body: esbuild renames a class whose body
 * references its own name (`Font.name` would become `'_Font'`).
 */
const newFont = (): Font => new Font()
