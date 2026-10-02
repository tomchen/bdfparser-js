/**
 * Charsets / encodings (SPEC-v3 §4).
 *
 * Conversions between characters and BDF glyph codepoints (`ENCODING`) for
 * Unicode and legacy (non-Unicode) fonts. Works in every JavaScript runtime:
 * it only relies on the standard `TextDecoder` (WHATWG Encoding) — no
 * `Buffer`, no `iconv`. An `iconv-lite`-compatible object can optionally be
 * passed for codecs `TextDecoder` does not know (or for GB18030 4-byte codes).
 *
 * @module
 */

/**
 * Minimal interface of an `iconv-lite`-like converter (optional; `iconv-lite`
 * itself satisfies it).
 */
export interface IconvLike {
  encode(str: string, encoding: string): Uint8Array
  decode(buf: Uint8Array, encoding: string): string
  encodingExists?(encoding: string): boolean
}

/** Character ⇄ codepoint converter for a charset */
export interface CharsetCodec {
  /** Canonical charset key (see {@link sanitizeCharset}) */
  readonly charset: string
  /** `true` if codepoints are Unicode code points */
  readonly unicode: boolean
  /** `true` for 94×94 double-byte sets (GB 2312, JIS X 0208, KS C 5601) */
  readonly gl94: boolean
  /** `true` if 2-byte codes are in GL form (both bytes in 0x21–0x7E) */
  readonly gl: boolean
  /** `false` if the charset is unknown (treated as Unicode) */
  readonly known: boolean
  /** Codepoint → one-character string, or `null` if not representable */
  cp2char(cp: number): string | null
  /** One-character string → codepoint, or `null` if not representable */
  char2cp(char: string): number | null
}

/**
 * Sanitize a charset name.
 *
 * Trim, remove the first `-` if present, remove everything from (and
 * including) the first `.`, remove all remaining `-`, whitespace, and all `_`
 * characters that are not at the beginning, and convert to lower case.
 *
 * @param charset - Charset name
 *
 * @returns Sanitized charset name
 *
 * @example
 * sanitizeCharsetName('UTF-8') // => 'utf8'
 * sanitizeCharsetName('_utf32') // => '_utf32'
 * sanitizeCharsetName('GB2312.1980') // => 'gb2312'
 */
export const sanitizeCharsetName = (charset: string): string => {
  charset = charset.trim()
  if (charset.startsWith('-')) {
    charset = charset.slice(1)
  }
  const dotIndex = charset.indexOf('.')
  if (dotIndex !== -1) {
    charset = charset.slice(0, dotIndex)
  }
  return charset.replace(/-|\s|(?<!^)_/g, '').toLowerCase()
}

const cleanName = (name: unknown): string => {
  let s = String(name).trim()
  if (s.startsWith('-')) {
    s = s.slice(1)
  }
  const dot = s.indexOf('.')
  if (dot !== -1) {
    s = s.slice(0, dot)
  }
  return s.replace(/[-_\s]/g, '').toLowerCase()
}

const RE_CP125X = /^(?:cp|windows|win|ms)?(125\d)$/

/**
 * Canonical charset key from the `CHARSET_REGISTRY` and `CHARSET_ENCODING`
 * properties (SPEC-v3 §4).
 *
 * Lower-case; `-`, `_`, spaces and anything after a `.` in the registry
 * removed; registry-specific encodings folded in (`ISO8859` + `5` →
 * `iso88595`, `KOI8` + `R` → `koi8r`, `MICROSOFT` + `CP1252` → `cp1252`). A
 * missing registry gives `'iso10646'` (Unicode).
 *
 * @param registry - `CHARSET_REGISTRY` value
 * @param encoding - `CHARSET_ENCODING` value
 *
 * @returns Canonical charset key
 *
 * @example
 * sanitizeCharset('ISO8859', '2') // => 'iso88592'
 * sanitizeCharset('GB2312.1980', '0') // => 'gb2312'
 * sanitizeCharset('microsoft', 'cp1252') // => 'cp1252'
 */
export const sanitizeCharset = (
  registry?: string | number | null,
  encoding?: string | number | null
): string => {
  const reg =
    registry === null || registry === undefined ? '' : cleanName(registry)
  const enc =
    encoding === null || encoding === undefined
      ? ''
      : String(encoding)
          .replace(/[-_\s]/g, '')
          .toLowerCase()
  if (reg === '') {
    return 'iso10646'
  }
  if (reg === 'iso8859') {
    const n = /^\d+$/.test(enc) ? parseInt(enc, 10) : 0
    return 'iso8859' + (n > 0 ? n : 1)
  }
  if (reg === 'koi8') {
    return enc === 'u' ? 'koi8u' : 'koi8r'
  }
  if (reg === 'microsoft' || reg === 'windows' || reg === 'ms') {
    const m = RE_CP125X.exec(enc)
    return m ? 'cp' + m[1] : reg
  }
  const m = RE_CP125X.exec(reg)
  if (m && !/^\d+$/.test(reg)) {
    return 'cp' + m[1]
  }
  if (reg === 'sjis') {
    return 'shiftjis'
  }
  if (reg === 'ksx1001') {
    return 'ksc5601'
  }
  return reg
}

/**
 * Canonicalise a user-supplied charset name such as `'GB2312'`,
 * `'Shift-JIS'`, `'ISO-8859-5'`, `'ISO10646-1'`, `'microsoft-cp1252'`,
 * `'big5-0'`.
 *
 * @param name - Charset name
 *
 * @returns Canonical charset key
 */
export const canonicalCharset = (name: string): string => {
  const key = sanitizeCharset(name)
  if (isKnownKey(key)) {
    return key
  }
  const s = String(name).trim()
  const dash = s.lastIndexOf('-')
  if (dash > 0) {
    const key2 = sanitizeCharset(s.slice(0, dash), s.slice(dash + 1))
    if (isKnownKey(key2)) {
      return key2
    }
  }
  return key
}

const PROPS_TABLE: Record<string, [string, string]> = {
  ascii: ['ISO646.1991', 'IRV'],
  iso646: ['ISO646.1991', 'IRV'],
  koi8r: ['KOI8', 'R'],
  koi8u: ['KOI8', 'U'],
  gb2312: ['GB2312.1980', '0'],
  iso2022cn: ['GB2312.1980', '0'],
  jisx0208: ['JISX0208.1983', '0'],
  jisx0201: ['JISX0201.1976', '0'],
  ksc5601: ['KSC5601.1987', '0'],
  ksx1001: ['KSC5601.1987', '0'],
}

/**
 * `CHARSET_REGISTRY` / `CHARSET_ENCODING` property values for a canonical
 * charset key (used by `Font.charsetconvert`). 94×94 sets use the X11 GL form
 * (encoding `"0"`).
 *
 * @param key - Canonical charset key
 *
 * @returns `[registry, encoding]`
 */
export const charsetProps = (key: string): [string, string] => {
  if (isUnicodeKey(key)) {
    return ['ISO10646', '1']
  }
  const iso = /^iso8859(\d+)$/.exec(key)
  if (iso) {
    return ['ISO8859', String(parseInt(iso[1], 10))]
  }
  if (/^cp125\d$/.test(key)) {
    return ['MICROSOFT', key.toUpperCase()]
  }
  if (key in PROPS_TABLE) {
    return PROPS_TABLE[key]
  }
  return [key.toUpperCase(), '0']
}

/**
 * Whether a canonical charset key is a Unicode charset (identity mapping).
 *
 * @param key - Canonical charset key
 *
 * @returns `true` for `iso10646`, `unicode`, `utf8`, `utf16*`, ...
 */
export const isUnicodeCharset = (key: string): boolean => isUnicodeKey(key)

const isUnicodeKey = (c: string): boolean =>
  c === '' ||
  c === 'iso10646' ||
  c === 'unicode' ||
  c === '_utf32' ||
  c.startsWith('utf') ||
  c.startsWith('ucs') ||
  c.startsWith('unicode11')

/** Aliases from canonical keys to WHATWG `TextDecoder` labels */
const LABEL_ALIASES: Record<string, string> = {
  gb2312: 'gbk',
  euccn: 'gbk',
  iso2022cn: 'gbk',
  hz: 'gbk',
  hzgb: 'gbk',
  hzgb2312: 'gbk',
  cp936: 'gbk',
  jisx0208: 'euc-jp',
  eucjp: 'euc-jp',
  ksc5601: 'euc-kr',
  ksx1001: 'euc-kr',
  euckr: 'euc-kr',
  cp949: 'euc-kr',
  big5hkscs: 'big5',
  cp950: 'big5',
  shiftjis: 'shift_jis',
  sjis: 'shift_jis',
  mskanji: 'shift_jis',
  windows31j: 'shift_jis',
  cp932: 'shift_jis',
  tis620: 'windows-874',
  cp874: 'windows-874',
  macroman: 'macintosh',
  mac: 'macintosh',
  cp866: 'ibm866',
  koi8: 'koi8-r',
  koi8r: 'koi8-r',
  koi8u: 'koi8-u',
  koi8ru: 'koi8-u',
}

const GL94_KEYS = new Set([
  'gb2312',
  'iso2022cn',
  'hz',
  'hzgb',
  'hzgb2312',
  'jisx0208',
  'ksc5601',
  'ksx1001',
])
const FORCED_GL_KEYS = new Set(['iso2022cn', 'hz', 'hzgb', 'hzgb2312'])
const DBCS_ENCODINGS = new Set([
  'gbk',
  'gb18030',
  'big5',
  'shift_jis',
  'euc-jp',
  'euc-kr',
])

const decoderCache = new Map<string, TextDecoder | null>()
/** fatal `TextDecoder` for a label, or `null` if the label is unknown */
const getDecoder = (label: string): TextDecoder | null => {
  let d = decoderCache.get(label)
  if (d === undefined) {
    try {
      d = new TextDecoder(label, { fatal: true })
    } catch {
      d = null
    }
    decoderCache.set(label, d)
  }
  return d
}

const reverseTableCache = new Map<string, Map<string, number>>()
/**
 * Reverse (char → bytes-as-number) table built by decoding the whole code
 * space: all single bytes, plus lead 0x81–0xFE × trail 0x40–0xFE for DBCS.
 */
const getReverseTable = (
  decoder: TextDecoder,
  dbcs: boolean
): Map<string, number> => {
  const key = decoder.encoding + (dbcs ? ':dbcs' : '')
  let table = reverseTableCache.get(key)
  if (table === undefined) {
    table = new Map()
    const one = new Uint8Array(1)
    for (let b = 0; b < 0x100; b++) {
      one[0] = b
      const s = tryDecode(decoder, one)
      if (s !== null && !table.has(s)) {
        table.set(s, b)
      }
    }
    if (dbcs) {
      const two = new Uint8Array(2)
      for (let lead = 0x81; lead <= 0xfe; lead++) {
        two[0] = lead
        for (let trail = 0x40; trail <= 0xfe; trail++) {
          two[1] = trail
          const s = tryDecode(decoder, two)
          if (s !== null && !table.has(s)) {
            table.set(s, (lead << 8) | trail)
          }
        }
      }
    }
    reverseTableCache.set(key, table)
  }
  return table
}

const tryDecode = (decoder: TextDecoder, bytes: Uint8Array): string | null => {
  try {
    const s = decoder.decode(bytes)
    return isOneChar(s) ? s : null
  } catch {
    return null
  }
}

/** `true` if the string is exactly one Unicode code point */
const isOneChar = (s: string): boolean => {
  if (s.length === 1) {
    return true
  }
  if (s.length === 2) {
    const c = s.charCodeAt(0)
    return c >= 0xd800 && c <= 0xdbff
  }
  return false
}

/**
 * Decode bytes that must form one unit: no output before the last byte (so
 * e.g. 0x06FE in a single-byte charset, two characters, gives `null`). The
 * unit may decode to several characters (e.g. Big5-HKSCS 0x8862).
 */
const decodeUnit = (decoder: TextDecoder, bytes: Uint8Array): string | null => {
  try {
    for (let i = 0; i < bytes.length - 1; i++) {
      if (decoder.decode(bytes.subarray(i, i + 1), { stream: true }) !== '') {
        decoder.decode() // reset the decoder state
        return null
      }
    }
    const s = decoder.decode(bytes.subarray(bytes.length - 1))
    return s === '' ? null : s
  } catch {
    try {
      decoder.decode() // reset the decoder state
    } catch {
      // ignore
    }
    return null
  }
}

const assertOneChar = (char: string): void => {
  if (typeof char !== 'string' || !isOneChar(char)) {
    throw new TypeError(
      `Expected a single character, got ${JSON.stringify(char)}`
    )
  }
}

/** codepoint → big-endian minimal-length bytes (1, 2 or 4) */
const cpToBytes = (cp: number): Uint8Array => {
  if (cp < 0x100) {
    return Uint8Array.of(cp)
  }
  if (cp < 0x10000) {
    return Uint8Array.of(cp >> 8, cp & 0xff)
  }
  return Uint8Array.of(
    (cp >>> 24) & 0xff,
    (cp >> 16) & 0xff,
    (cp >> 8) & 0xff,
    cp & 0xff
  )
}

const bytesToCp = (bytes: ArrayLike<number>): number => {
  let r = 0
  for (let i = 0; i < bytes.length; i++) {
    r = r * 256 + bytes[i]
  }
  return r
}

const isGLPair = (cp: number): boolean => {
  const hi = cp >> 8
  const lo = cp & 0xff
  return hi >= 0x21 && hi <= 0x7e && lo >= 0x21 && lo <= 0x7e
}

const isValidCp = (cp: number): boolean =>
  Number.isInteger(cp) && cp >= 0 && cp <= 0xffffffff

type CodecKind =
  | { kind: 'unicode' }
  | { kind: 'latin1' }
  | { kind: 'ascii' }
  | { kind: 'jisx0201' }
  | { kind: 'decoder'; decoder: TextDecoder; dbcs: boolean }
  | { kind: 'iconv'; name: string; dbcs: boolean }
  | { kind: 'unknown' }

const resolveKind = (c: string, iconv?: IconvLike): CodecKind => {
  if (isUnicodeKey(c)) {
    return { kind: 'unicode' }
  }
  if (
    c === 'iso88591' ||
    c === 'iso8859' ||
    c === 'latin1' ||
    c === 'l1' ||
    c === 'binary'
  ) {
    return { kind: 'latin1' }
  }
  if (c === 'ascii' || c === 'usascii' || c === 'iso646' || c === 'ansix34') {
    return { kind: 'ascii' }
  }
  if (c === 'jisx0201') {
    return { kind: 'jisx0201' }
  }
  let label = LABEL_ALIASES[c]
  if (label === undefined) {
    const iso = /^iso8859(\d+)$/.exec(c)
    const win = /^(?:cp|windows|win)(\d{3,4})$/.exec(c)
    if (iso) {
      label = `iso-8859-${iso[1]}`
    } else if (win) {
      label = `windows-${win[1]}`
    } else {
      label = c
    }
  }
  const decoder = getDecoder(label)
  if (iconv !== undefined) {
    const exists = iconv.encodingExists?.bind(iconv)
    const candidates = FORCED_GL_KEYS.has(c) ? ['gb2312'] : [c, label]
    const name =
      exists === undefined
        ? candidates[0]
        : candidates.find((n) => {
            try {
              return exists(n)
            } catch {
              return false
            }
          })
    if (name !== undefined) {
      return {
        kind: 'iconv',
        name,
        dbcs: decoder !== null && DBCS_ENCODINGS.has(decoder.encoding),
      }
    }
  }
  if (decoder !== null) {
    if (decoder.encoding.startsWith('utf-')) {
      return { kind: 'unicode' }
    }
    return {
      kind: 'decoder',
      decoder,
      dbcs: DBCS_ENCODINGS.has(decoder.encoding),
    }
  }
  return { kind: 'unknown' }
}

const isKnownKey = (c: string): boolean => resolveKind(c).kind !== 'unknown'

/**
 * Create a character ⇄ codepoint converter.
 *
 * @param charset - Charset name or canonical key (canonicalised with {@link canonicalCharset})
 * @param options.iconv - optional `iconv-lite`-compatible converter
 * @param options.gl - for 94×94 sets: `true` if the font uses GL codes (0x2121–0x7E7E); ignored otherwise
 *
 * @returns Converter
 */
export const getCodec = (
  charset: string,
  options: { iconv?: IconvLike; gl?: boolean } = {}
): CharsetCodec => {
  const c = canonicalCharset(charset)
  const kind = resolveKind(c, options.iconv)
  const gl94 = GL94_KEYS.has(c)
  const gl = gl94 && (FORCED_GL_KEYS.has(c) || options.gl === true)
  const known = kind.kind !== 'unknown'
  const unicode = kind.kind === 'unicode' || kind.kind === 'unknown'

  let rawCp2char: (cp: number) => string | null
  let rawChar2cp: (char: string) => number | null
  switch (kind.kind) {
    case 'unicode':
    case 'unknown':
      rawCp2char = (cp) => (cp <= 0x10ffff ? String.fromCodePoint(cp) : null)
      rawChar2cp = (char) => char.codePointAt(0) as number
      break
    case 'latin1':
      rawCp2char = (cp) => (cp < 0x100 ? String.fromCharCode(cp) : null)
      rawChar2cp = (char) => {
        const n = char.codePointAt(0) as number
        return n < 0x100 ? n : null
      }
      break
    case 'ascii':
      rawCp2char = (cp) => (cp < 0x80 ? String.fromCharCode(cp) : null)
      rawChar2cp = (char) => {
        const n = char.codePointAt(0) as number
        return n < 0x80 ? n : null
      }
      break
    case 'jisx0201':
      rawCp2char = (cp) =>
        cp < 0x80
          ? String.fromCharCode(cp)
          : cp >= 0xa1 && cp <= 0xdf
            ? String.fromCharCode(0xff61 + cp - 0xa1)
            : null
      rawChar2cp = (char) => {
        const n = char.codePointAt(0) as number
        if (n < 0x80) {
          return n
        }
        return n >= 0xff61 && n <= 0xff9f ? n - 0xff61 + 0xa1 : null
      }
      break
    case 'decoder': {
      const { decoder, dbcs } = kind
      rawCp2char = (cp) => decodeUnit(decoder, cpToBytes(cp))
      rawChar2cp = (char) => getReverseTable(decoder, dbcs).get(char) ?? null
      break
    }
    case 'iconv': {
      const { name } = kind
      const iconv = options.iconv as IconvLike
      rawCp2char = (cp) => {
        try {
          const s = iconv.decode(cpToBytes(cp), name)
          return isOneChar(s) && s !== '�' ? s : null
        } catch {
          return null
        }
      }
      rawChar2cp = (char) => {
        try {
          const bytes = iconv.encode(char, name)
          if (bytes.length === 0 || bytes.length > 4) {
            return null
          }
          const n = bytesToCp(bytes)
          // iconv-lite substitutes unencodable characters with '?'
          if (n === 0x3f && char !== '?') {
            return null
          }
          return n
        } catch {
          return null
        }
      }
      break
    }
  }

  return {
    charset: c,
    unicode,
    gl94,
    gl,
    known,
    cp2char(cp: number): string | null {
      if (!isValidCp(cp)) {
        return null
      }
      if (gl && cp >= 0x100) {
        if (cp > 0xffff || !isGLPair(cp)) {
          return null
        }
        cp += 0x8080
      }
      return rawCp2char(cp)
    },
    char2cp(char: string): number | null {
      assertOneChar(char)
      const cp = rawChar2cp(char)
      if (cp === null) {
        return null
      }
      if (gl && cp >= 0x100) {
        if (cp > 0xffff || !isGLPair(cp - 0x8080)) {
          return null
        }
        return cp - 0x8080
      }
      return cp
    },
  }
}

/**
 * GL form detection for 94×94 double-byte sets (SPEC-v3 §4): the font is in
 * GL form if `CHARSET_ENCODING == "0"` or the first codepoint (ascending) in
 * 0x100–0xFFFF has both bytes in 0x21–0x7E.
 *
 * @param charsetEncoding - `CHARSET_ENCODING` property value
 * @param cps - Glyph codepoints of the font (any order)
 *
 * @returns `true` if GL form
 */
export const detectGL = (
  charsetEncoding: string | number | null | undefined,
  cps: Iterable<number>
): boolean => {
  if (
    charsetEncoding !== null &&
    charsetEncoding !== undefined &&
    String(charsetEncoding).trim() === '0'
  ) {
    return true
  }
  let first = Infinity
  for (const cp of cps) {
    if (cp >= 0x100 && cp <= 0xffff && cp < first) {
      first = cp
    }
  }
  return first !== Infinity && isGLPair(first)
}

/**
 * Convert a character to a codepoint in a charset.
 *
 * @param char - Character (exactly one code point)
 * @param charset - Charset name
 * @param iconv - optional `iconv-lite`-compatible converter
 *
 * @returns Codepoint, or `null` if the character is not representable
 */
export const char2cp = (
  char: string,
  charset = 'utf8',
  iconv?: IconvLike
): number | null => getCodec(charset, { iconv }).char2cp(char)

/**
 * Convert a codepoint in a charset to a character.
 *
 * @param cp - Codepoint
 * @param charset - Charset name
 * @param iconv - optional `iconv-lite`-compatible converter
 *
 * @returns Character, or `null` if the codepoint is not valid in the charset
 */
export const cp2char = (
  cp: number,
  charset = 'utf8',
  iconv?: IconvLike
): string | null => getCodec(charset, { iconv }).cp2char(cp)
