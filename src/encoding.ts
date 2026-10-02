import iconvlite from 'iconv-lite'

export const NODEJS_NATIVE_ENCODINGS = new Set([
  'utf8',
  'cesu8',
  'ucs2',
  'utf16le',
  'ascii',
  'binary',
  'base64',
  'hex',
])

export const UNICODE_ENCODINGS = new Set([
  'utf8',
  'unicode',
  'iso10646', // In terms of character <-> code point conversion, we can treat ISO/IEC 10646 as UTF-8
  'utf7',
  'utf7imap',
  'utf16le',
  'utf16be',
  'utf16', // with BOM
  'utf32le',
  'utf32be',
  'utf32', // with BOM
  'ucs2',
  'ucs4le',
  'ucs4be',
  'ucs4', // with BOM
  'unicode11utf7',
  'unicode11utf8',
  '_utf32',
])

export const ISO2022CN_ENCODINGS = new Set([
  'iso2022cn',
  'hz',
  'hzgb',
  'hzgb2312',
])

/**
 * Convert EUC-CN (common form of GB2312) to ISO-2022-CN (older, less common form of GB2312)
 *
 * @param eucCn - EUC-CN encoded codepoint (1-byte or 2-byte. e.g., 0xCDE2 or 0x41)
 *
 * @returns ISO-2022-CN encoded codepoint (e.g., 0x4D62 or 0x41)
 */
const eucCnToIso2022 = (eucCn: number) => {
  if (eucCn <= 0x7f) {
    return eucCn
  }

  const high = (eucCn >> 8) & 0xff
  const low = eucCn & 0xff

  const iso2022High = high - 0x80
  const iso2022Low = low - 0x80

  return (iso2022High << 8) | iso2022Low
}

/**
 * Convert ISO-2022-CN (older, less common form of GB2312) to EUC-CN (common form of GB2312)
 *
 * @param iso2022 - ISO-2022-CN encoded codepoint (1-byte or 2-byte. e.g., 0x4D62 or 0x41)
 *
 * @returns EUC-CN encoded codepoint (e.g., 0xCDE2 or 0x41)
 */
const iso2022ToEucCn = (iso2022: number) => {
  if (iso2022 <= 0x7f) {
    return iso2022
  }

  const high = (iso2022 >> 8) & 0xff
  const low = iso2022 & 0xff

  const eucCnHigh = high + 0x80
  const eucCnLow = low + 0x80

  return (eucCnHigh << 8) | eucCnLow
}

/**
 * Sanitize charset name
 *
 * Trim the `CHARSET_REGISTRY` string in the BDF font file, remove the first '-' if present, remove everything from (and including) the first '.', remove all remaining '-', and all '_' characters that are not at the beginning, and convert to lowercase
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
  return charset.replace(/-|(?<!^)_/g, '').toLowerCase()
}

/**
 * Convert a character to codepoint
 *
 * @param char - Character
 * @param encoding - Encoding
 * @param iconv - iconv-lite instance
 *
 * @returns Codepoint
 *
 * @throws Error if the character cannot be converted to codepoint
 *
 * @see online docs: {@link https://font.tomchen.org/bdfparser_js/} TODO: link to online docs
 */
export const char2cp = (
  char: string,
  encoding = 'utf8',
  iconv?: typeof iconvlite
): number | undefined => {
  if (char.length !== 1) {
    throw new Error('Input must be a single character')
  }

  try {
    encoding = sanitizeCharsetName(encoding)
    let _encoding = encoding

    if (UNICODE_ENCODINGS.has(_encoding)) {
      return char.codePointAt(0)
    }
    if (_encoding === 'iso8859') {
      _encoding = 'iso88591'
    }
    if (NODEJS_NATIVE_ENCODINGS.has(_encoding)) {
      if (_encoding === 'hex' || _encoding === 'base64') {
        throw new Error(
          `${encoding} encoding is not supported for character conversion`
        )
      }
      return char.codePointAt(0)
    }

    if (iconv === undefined) {
      throw new Error('iconv-lite object is not passed in')
    }

    let isIso2022cn = false
    if (ISO2022CN_ENCODINGS.has(_encoding)) {
      isIso2022cn = true
      _encoding = 'gb2312'
    }

    const buf = iconv.encode(char, _encoding)
    let result = 0
    for (let i = 0; i < buf.length; i++) {
      result = (result << 8) | buf[i]
    }

    if (isIso2022cn === true) {
      result = eucCnToIso2022(result)
    }

    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    throw new Error(
      `Failed to convert character '${char}' to codepoint in ${encoding}: ${msg}`
    )
  }
}

/**
 * Convert a codepoint to character
 *
 * @param cp - Codepoint
 * @param encoding - Encoding
 * @param iconv - iconv-lite instance
 *
 * @returns Character
 *
 * @throws Error if the codepoint cannot be converted to character
 *
 * @see online docs: {@link https://font.tomchen.org/bdfparser_js/} TODO: link to online docs
 */
export const cp2char = (
  cp: number,
  encoding = 'utf8',
  iconv?: typeof iconvlite
): string => {
  try {
    encoding = sanitizeCharsetName(encoding)
    let _encoding = encoding

    if (UNICODE_ENCODINGS.has(_encoding)) {
      return String.fromCodePoint(cp)
    }
    if (_encoding === 'iso8859') {
      _encoding = 'iso88591'
    }
    if (NODEJS_NATIVE_ENCODINGS.has(_encoding)) {
      if (_encoding === 'hex' || _encoding === 'base64') {
        throw new Error(
          `${encoding} encoding is not supported for character conversion`
        )
      }
      const buf = Buffer.from([cp])
      return buf.toString(_encoding as BufferEncoding)
    }

    if (iconv === undefined) {
      throw new Error('iconv-lite object is not passed in')
    }

    if (ISO2022CN_ENCODINGS.has(_encoding)) {
      cp = iso2022ToEucCn(cp)
      _encoding = 'gb2312'
    }

    const buf = Buffer.alloc(4)
    let bytesWritten

    if (cp <= 0xff) {
      buf[0] = cp
      bytesWritten = 1
    } else if (cp <= 0xffff) {
      buf[0] = (cp >> 8) & 0xff
      buf[1] = cp & 0xff
      bytesWritten = 2
    } else {
      buf[0] = (cp >> 24) & 0xff
      buf[1] = (cp >> 16) & 0xff
      buf[2] = (cp >> 8) & 0xff
      buf[3] = cp & 0xff
      bytesWritten = 4
    }

    return iconv.decode(
      Uint8Array.prototype.slice.call(buf, 0, bytesWritten) as Buffer,
      _encoding
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    throw new Error(
      `Failed to convert codepoint ${cp} to character in ${encoding}: ${msg}`
    )
  }
}
