/**
 * Charsets / encodings (SPEC-v3 §4, §11.1).
 *
 * Conversions between characters and BDF glyph codepoints (`ENCODING`) for
 * Unicode and legacy (non-Unicode) fonts. Python's codecs are the reference:
 * the canonical charset table and the exact decode tables are generated from
 * the Python bdfparser (`tools/gen_charsets.py`). Single-byte charsets are
 * built in; the multi-byte (CJK) tables are in the optional sub-module
 * `bdfparser/cjk` (`import 'bdfparser/cjk'`, or `bdfparser-cjk.global.js`
 * in browsers). Without it, multi-byte charsets fall back to the runtime's
 * `TextDecoder` (WHATWG Encoding) restricted to the charset's byte ranges,
 * with one warning per charset; results may then differ from Python's (and
 * between runtimes). No `Buffer`, no `iconv`.
 *
 * Codes are big-endian byte sequences: 1 byte (`cp < 0x100`), 2 bytes
 * (`cp < 0x10000`) or 4 bytes (GB18030 only). `cp2char` returns exactly one
 * character (code point) or `null`; `char2cp` returns a code only if its byte
 * length is allowed for the charset (1 for single-byte charsets, 1–2 for
 * double-byte charsets, 1, 2 or 4 for GB18030) and it converts back to the
 * same character.
 *
 * @module
 */

import {
  CharsetKind,
  forwardTable,
  gb18030Decode4,
  gb18030Encode4,
  hasTable,
  reverseTable,
} from './charsets/registry'
import {
  ALIASES,
  CHARSETS,
  MBCS_RANGES,
  UNICODE_KEYS,
  UNICODE_PREFIXES,
} from './charsets/table'
import { warn } from './warn'

export {
  registerCharsetTables,
  type CharsetTables,
  type TableSpec,
  type CharsetKind,
} from './charsets/registry'

/**
 * Minimal interface of an `iconv-lite`-like converter (optional; `iconv-lite`
 * itself satisfies it). Only used for multi-byte charsets whose exact tables
 * (`bdfparser/cjk`) are not loaded, instead of `TextDecoder`.
 */
export interface IconvLike {
  encode(str: string, encoding: string): Uint8Array
  decode(buf: Uint8Array, encoding: string): string
  encodingExists?(encoding: string): boolean
}

/** Character ⇄ codepoint converter for a charset */
export interface CharsetCodec {
  /** Canonical charset key (see {@link canonicalCharset}) */
  readonly charset: string
  /** `true` if codepoints are Unicode code points (Unicode and unknown charsets) */
  readonly unicode: boolean
  /** `true` for 94×94 double-byte sets that may be in GL form (GB 2312, JIS X 0208, KS C 5601, ISO-2022-CN) */
  readonly gl94: boolean
  /** `true` if 2-byte codes are in GL form (both bytes in 0x21–0x7E) */
  readonly gl: boolean
  /** `false` if the charset is unknown (treated as Unicode) */
  readonly known: boolean
  /** `'unicode'`, `'sbcs'` (1-byte codes), `'dbcs'` (1–2 bytes) or `'gb18030'` (1, 2 or 4 bytes) */
  readonly kind: 'unicode' | CharsetKind
  /** `true` if the conversions use the exact tables (always, except for multi-byte charsets without `bdfparser/cjk`) */
  readonly exact: boolean
  /** Codepoint → one-character string, or `null` if not representable */
  cp2char(cp: number): string | null
  /** One-character string → codepoint, or `null` if not representable */
  char2cp(char: string): number | null
}

// ---------------------------------------------------------------------------
// canonicalisation (port of the Python bdfparser's encoding.py)

const RE_TRIM_WS = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g
const RE_STRIP = /[-_ \t\n\v\f\r]/g
const RE_ISO8859 = /^iso8859([0-9]+)$/
const RE_CP = /^(?:cp|windows|win|ms|ibm)?([0-9]+)$/
const RE_CPKEY = /^cp[0-9]+$/
const RE_DIGITS = /^[0-9]+$/
const CP_REGISTRIES = ['microsoft', 'windows', 'ms', 'ibm']

const hasOwn = (o: object, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k)

/** strip ASCII whitespace (SPEC-v3 §11.4) */
const stripWs = (s: string): string => s.replace(RE_TRIM_WS, '')

/** decimal digits → canonical integer string (no leading zeros, exact) */
const intStr = (digits: string): string => BigInt(digits).toString()

const cleanName = (name: unknown): string => {
  let s = stripWs(String(name))
  if (s.startsWith('-')) {
    s = s.slice(1)
  }
  const dot = s.indexOf('.')
  if (dot !== -1) {
    s = s.slice(0, dot)
  }
  return s.replace(RE_STRIP, '').toLowerCase()
}

/** `cp1252`, `windows1252`, `win1252`, `ms932`, `ibm437` ... → `cpN` if in the table */
const cpKey = (s: string): string | null => {
  const m = RE_CP.exec(s)
  if (m === null) {
    return null
  }
  const key = 'cp' + intStr(m[1])
  return hasOwn(CHARSETS, key) ? key : null
}

const resolveAlias = (key: string): string =>
  hasOwn(ALIASES, key) ? ALIASES[key] : key

/**
 * Sanitize a charset name (v2 helper, kept for compatibility).
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

/**
 * Canonical charset key from the `CHARSET_REGISTRY` and `CHARSET_ENCODING`
 * properties (SPEC-v3 §4, §11.1; same function as the Python library's
 * `sanitize_charset`).
 *
 * Lower-case; `-`, `_`, spaces and anything after a `.` in the registry
 * removed; registry-specific encodings folded in (`ISO8859` + `5` →
 * `iso88595`, `KOI8` + `R` → `koi8r`, `MICROSOFT` + `CP1252` → `cp1252`,
 * `IBM` + `CP437` → `cp437`); aliases resolved (`sjis` → `shiftjis`,
 * `ksx1001` → `ksc5601`, `windows1252` → `cp1252`). A missing registry gives
 * `'iso10646'` (Unicode).
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
      : String(encoding).replace(RE_STRIP, '').toLowerCase()
  if (reg === '') {
    return 'iso10646'
  }
  if (reg === 'iso8859') {
    const n = RE_DIGITS.test(enc) ? intStr(enc) : '0'
    return 'iso8859' + (n !== '0' ? n : '1')
  }
  if (reg === 'koi8') {
    if (enc === '' || enc === 'r') {
      return 'koi8r'
    }
    return enc === 'u' ? 'koi8u' : 'koi8' + enc
  }
  if (CP_REGISTRIES.includes(reg)) {
    return cpKey(enc) ?? reg
  }
  if (!RE_DIGITS.test(reg)) {
    const key = cpKey(reg)
    if (key !== null) {
      return key
    }
  }
  return resolveAlias(reg)
}

const isUnicodeKey = (key: string): boolean =>
  key === '' ||
  UNICODE_KEYS.includes(key) ||
  UNICODE_PREFIXES.some((p) => key.startsWith(p))

const isKnownKey = (key: string): boolean =>
  isUnicodeKey(key) || hasOwn(CHARSETS, key)

/**
 * Whether a canonical charset key is a Unicode charset (identity mapping).
 *
 * @param key - Canonical charset key
 *
 * @returns `true` for `iso10646`, `unicode`, `utf8`, `utf16*`, ...
 */
export const isUnicodeCharset = (key: string): boolean => isUnicodeKey(key)

/**
 * Canonicalise a user-supplied charset name such as `'GB2312'`,
 * `'Shift-JIS'`, `'ISO-8859-5'`, `'ISO8859-01'`, `'ISO10646-1'`,
 * `'microsoft-cp1252'`, `'big5-0'`: `sanitizeCharset(name)` if that is a
 * known key, else `sanitizeCharset(registry, encoding)` with the name split
 * at its last `-` if that is known, else `sanitizeCharset(name)` (unknown).
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
  const s = stripWs(String(name))
  if (s.slice(1).includes('-')) {
    const dash = s.lastIndexOf('-')
    const key2 = sanitizeCharset(s.slice(0, dash), s.slice(dash + 1))
    if (isKnownKey(key2)) {
      return key2
    }
  }
  return key
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
  key = resolveAlias(key)
  if (isUnicodeKey(key)) {
    return ['ISO10646', '1']
  }
  const iso = RE_ISO8859.exec(key)
  if (iso) {
    return ['ISO8859', intStr(iso[1])]
  }
  if (hasOwn(CHARSETS, key)) {
    return [CHARSETS[key][3], CHARSETS[key][4]]
  }
  if (RE_CPKEY.test(key)) {
    return ['MICROSOFT', key.toUpperCase()]
  }
  return [key.toUpperCase(), '0']
}

/**
 * Every known (canonical) charset key: the Unicode keys and the keys of the
 * charset table.
 *
 * @returns Keys
 */
export const charsetKeys = (): string[] => [
  ...UNICODE_KEYS,
  ...Object.keys(CHARSETS),
]

// ---------------------------------------------------------------------------
// conversions

/** `true` if the string is exactly one Unicode code point */
const isOneChar = (s: unknown): s is string => {
  if (typeof s !== 'string') {
    return false
  }
  if (s.length === 1) {
    return true
  }
  if (s.length === 2) {
    const c = s.charCodeAt(0)
    const d = s.charCodeAt(1)
    return c >= 0xd800 && c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff
  }
  return false
}

const assertOneChar = (char: string): void => {
  if (!isOneChar(char)) {
    throw new TypeError(
      `char2cp() expected a single character, got ${JSON.stringify(char)}`
    )
  }
}

const isValidCp = (cp: number): boolean =>
  typeof cp === 'number' && Number.isInteger(cp) && cp >= 0

/** codepoint → big-endian bytes (1, 2 or 4) */
const cpToBytes = (cp: number): Uint8Array =>
  cp < 0x100
    ? Uint8Array.of(cp)
    : cp < 0x10000
      ? Uint8Array.of(cp >> 8, cp & 0xff)
      : Uint8Array.of(
          Math.floor(cp / 0x1000000) & 0xff,
          (cp >> 16) & 0xff,
          (cp >> 8) & 0xff,
          cp & 0xff
        )

const bytesToCp = (bytes: ArrayLike<number>): number => {
  let r = 0
  for (let i = 0; i < bytes.length; i++) {
    r = r * 256 + bytes[i]
  }
  return r
}

const inRanges = (v: number, ranges: readonly number[]): boolean => {
  for (let i = 0; i < ranges.length; i += 2) {
    if (v >= ranges[i] && v <= ranges[i + 1]) {
      return true
    }
  }
  return false
}

const decoderCache = new Map<string, TextDecoder | null>()
/** fatal `TextDecoder` for a label, or `null` if the label is unknown */
const getDecoder = (label: string): TextDecoder | null => {
  let d = decoderCache.get(label)
  if (d === undefined) {
    try {
      d = label === '' ? null : new TextDecoder(label, { fatal: true })
    } catch {
      d = null
    }
    decoderCache.set(label, d)
  }
  return d
}

/** raw (non-GL) code ⇄ code point functions of one codec */
type RawCodec = {
  exact: boolean
  /** code → code point, -1 if not mapped */
  decode(code: number): number
  /** code point → code (Python's encoder choice), -1 if none */
  encode(u: number): number
}

const tableCodec = (codec: string, kind: CharsetKind): RawCodec | null => {
  const fwd = forwardTable(codec)
  if (fwd === null || (kind === 'gb18030' && gb18030Decode4(0) === null)) {
    return null
  }
  return {
    exact: true,
    decode: (code) =>
      code < fwd.length
        ? fwd[code]
        : kind === 'gb18030' && code >= 0x1000000 && code <= 0xffffffff
          ? (gb18030Decode4(code) as number)
          : -1,
    encode: (u) => {
      const code = (reverseTable(codec) as Map<number, number>).get(u)
      if (code !== undefined) {
        return code
      }
      return kind === 'gb18030' ? (gb18030Encode4(u) as number) : -1
    },
  }
}

const fallbackWarned = new Set<string>()

/**
 * Multi-byte codec without its exact table: the runtime's `TextDecoder` (or
 * an `iconv-lite`-like object) restricted to the charset's strict byte
 * ranges.
 */
const fallbackCodec = (
  key: string,
  codec: string,
  kind: CharsetKind,
  iconv?: IconvLike
): RawCodec => {
  const [label, single, leads, trails] = MBCS_RANGES[codec]
  let decodeBytes: (b: Uint8Array) => string | null
  const useIconv = iconv !== undefined && iconvKnows(iconv, codec)
  if (useIconv) {
    decodeBytes = (b) => {
      try {
        const s = iconv.decode(b, codec)
        return s.includes('�') ? null : s
      } catch {
        return null
      }
    }
  } else {
    if (!fallbackWarned.has(key)) {
      fallbackWarned.add(key)
      warn(
        `The exact tables of the charset '${key}' are not loaded: using the runtime's TextDecoder, results may differ from the Python bdfparser and between runtimes (import 'bdfparser/cjk' or load bdfparser-cjk.global.js for exact conversions)`
      )
    }
    const decoder = getDecoder(label)
    decodeBytes = (b) => {
      if (decoder === null) {
        return null
      }
      try {
        return decoder.decode(b)
      } catch {
        return null
      }
    }
  }
  const decode = (code: number): number => {
    let ok: boolean
    if (code < 0x100) {
      if (code < 0x80) {
        // ASCII in every runtime (Node's ICU Shift_JIS swaps 0x1A/0x1C/0x7F)
        return inRanges(code, single) ? code : -1
      }
      ok = inRanges(code, single)
    } else if (code < 0x10000) {
      ok = inRanges(code >> 8, leads) && inRanges(code & 0xff, trails)
    } else {
      ok =
        kind === 'gb18030' &&
        code <= 0xffffffff &&
        /^[\x81-\xfe][0-9][\x81-\xfe][0-9]$/.test(
          String.fromCharCode(...cpToBytes(code))
        )
    }
    if (!ok) {
      return -1
    }
    const s = decodeBytes(cpToBytes(code))
    return s !== null && isOneChar(s) ? (s.codePointAt(0) as number) : -1
  }
  let rev: Map<number, number> | null = null
  const encode = (u: number): number => {
    if (u < 0x80) {
      return inRanges(u, single) ? u : -1
    }
    if (useIconv) {
      try {
        const b = iconv.encode(String.fromCodePoint(u), codec)
        const n = bytesToCp(b)
        // iconv-lite substitutes unencodable characters with '?'
        return (b.length === 1 || b.length === 2 || b.length === 4) &&
          n !== 0x3f
          ? n
          : -1
      } catch {
        return -1
      }
    }
    if (rev === null) {
      rev = new Map()
      for (let code = 0; code < 0x10000; code++) {
        const v = decode(code)
        if (v >= 0 && !rev.has(v)) {
          rev.set(v, code)
        }
      }
    }
    return rev.get(u) ?? -1
  }
  return { exact: false, decode, encode }
}

const iconvKnows = (iconv: IconvLike, name: string): boolean => {
  if (iconv.encodingExists === undefined) {
    return true
  }
  try {
    return iconv.encodingExists(name)
  } catch {
    return false
  }
}

/** JIS X 0201: bytes < 0x80 ASCII, 0xA1–0xDF half-width katakana */
const JISX0201: RawCodec = {
  exact: true,
  decode: (code) =>
    code < 0x80
      ? code
      : code >= 0xa1 && code <= 0xdf
        ? 0xff61 + code - 0xa1
        : -1,
  encode: (u) =>
    u < 0x80 ? u : u >= 0xff61 && u <= 0xff9f ? u - 0xff61 + 0xa1 : -1,
}

/**
 * Create a character ⇄ codepoint converter (the Python library's
 * `charset_codec(canonical_charset(charset), gl)`).
 *
 * @param charset - Charset name or canonical key (canonicalised with {@link canonicalCharset})
 * @param options.gl - for GL-capable 94×94 sets: `true` if the font uses GL codes (0x2121–0x7E7E); ignored otherwise (ISO-2022-CN is always GL)
 * @param options.iconv - optional `iconv-lite`-compatible converter, used instead of `TextDecoder` for multi-byte charsets whose exact tables are not loaded
 *
 * @returns Converter
 */
export const getCodec = (
  charset: string,
  options: { iconv?: IconvLike; gl?: boolean | null } = {}
): CharsetCodec => {
  const key = resolveAlias(canonicalCharset(charset))
  const entry = hasOwn(CHARSETS, key) ? CHARSETS[key] : undefined
  if (isUnicodeKey(key) || entry === undefined) {
    const known = isUnicodeKey(key)
    return {
      charset: key,
      unicode: true,
      gl94: false,
      gl: false,
      known,
      kind: 'unicode',
      exact: true,
      cp2char: (cp) =>
        isValidCp(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : null,
      char2cp: (char) => {
        assertOneChar(char)
        return char.codePointAt(0) as number
      },
    }
  }
  const [codec, kind, glType] = entry
  const gl =
    (options.gl === null || options.gl === undefined
      ? glType === 2
      : options.gl) && glType !== 0
  const raw: RawCodec =
    key === 'jisx0201'
      ? JISX0201
      : (tableCodec(codec, kind) ??
        fallbackCodec(key, codec, kind, options.iconv))

  const cp2char = (cp: number): string | null => {
    if (!isValidCp(cp)) {
      return null
    }
    if (cp >= 0x100) {
      if (cp < 0x10000) {
        if (kind === 'sbcs') {
          return null
        }
        if (gl) {
          const hi = cp >> 8
          const lo = cp & 0xff
          if (hi < 0x21 || hi > 0x7e || lo < 0x21 || lo > 0x7e) {
            return null
          }
          cp += 0x8080
        }
      } else if (kind !== 'gb18030' || cp > 0xffffffff) {
        return null
      }
    }
    const u = raw.decode(cp)
    return u < 0 ? null : String.fromCodePoint(u)
  }

  return {
    charset: key,
    unicode: false,
    gl94: glType !== 0,
    gl,
    known: true,
    kind,
    exact: raw.exact,
    cp2char,
    char2cp(char: string): number | null {
      assertOneChar(char)
      let code = raw.encode(char.codePointAt(0) as number)
      if (code < 0) {
        return null
      }
      if (gl && code >= 0x100 && code < 0x10000) {
        code -= 0x8080
      }
      // the code must convert back to the same character
      return cp2char(code) === char ? code : null
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
    stripWs(String(charsetEncoding)) === '0'
  ) {
    return true
  }
  let first = Infinity
  for (const cp of cps) {
    if (cp >= 0x100 && cp <= 0xffff && cp < first) {
      first = cp
    }
  }
  if (first === Infinity) {
    return false
  }
  const hi = first >> 8
  const lo = first & 0xff
  return hi >= 0x21 && hi <= 0x7e && lo >= 0x21 && lo <= 0x7e
}

const unknownWarned = new Set<string>()

const moduleCodec = (charset: string, iconv?: IconvLike): CharsetCodec => {
  const codec = getCodec(charset, { iconv })
  if (!codec.known && !unknownWarned.has(codec.charset)) {
    unknownWarned.add(codec.charset)
    warn(
      `Unknown charset '${codec.charset}', characters are mapped to codepoints as Unicode`
    )
  }
  return codec
}

/**
 * Convert a character to a codepoint in a charset. An unknown charset maps
 * as Unicode (one warning per charset name).
 *
 * @param char - Character (exactly one code point)
 * @param charset - Charset name
 * @param iconv - optional `iconv-lite`-compatible converter (see {@link getCodec})
 *
 * @returns Codepoint, or `null` if the character is not representable
 */
export const char2cp = (
  char: string,
  charset = 'iso10646',
  iconv?: IconvLike
): number | null => moduleCodec(charset, iconv).char2cp(char)

/**
 * Convert a codepoint in a charset to a character. An unknown charset maps
 * as Unicode (one warning per charset name).
 *
 * @param cp - Codepoint
 * @param charset - Charset name
 * @param iconv - optional `iconv-lite`-compatible converter (see {@link getCodec})
 *
 * @returns Character, or `null` if the codepoint is not valid in the charset
 */
export const cp2char = (
  cp: number,
  charset = 'iso10646',
  iconv?: IconvLike
): string | null => moduleCodec(charset, iconv).cp2char(cp)

/** @internal whether a value is exactly one code point */
export const _isOneChar = isOneChar

/** @internal whether the exact table of the codec of a charset key is loaded */
export const _hasExactTable = (key: string): boolean => {
  const k = resolveAlias(key)
  return hasOwn(CHARSETS, k) && hasTable(CHARSETS[k][0])
}
