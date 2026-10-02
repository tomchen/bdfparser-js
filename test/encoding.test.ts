import { Font } from '../src/index'
import readlineiter from 'readlineiter'
import iconv from 'iconv-lite'
import {
  canonicalCharset,
  char2cp,
  charsetProps,
  cp2char,
  detectGL,
  getCodec,
  isUnicodeCharset,
  sanitizeCharset,
  sanitizeCharsetName,
} from '../src/encoding'
import { setWarningHandler } from '../src/warn'

const aRenGuangBitmap = [
  '0000000000000001000000000000000100000000',
  '0000000000000001000000000010000100001000',
  '0000000000000001000000000001000100001000',
  '0000000000000001000000000000100100010000',
  '0001100000000001000000000000100100100000',
  '0010010000000001000000000000000100000000',
  '0010010000000010100000001111111111111110',
  '0100001000000010100000000000010001000000',
  '0100001000000100010000000000010001000000',
  '0111111000000100010000000000010001000000',
  '0100001000001000001000000000010001000000',
  '0100001000001000001000000000100001000010',
  '0100001000010000000100000000100001000010',
  '0100001000100000000010000001000001000010',
  '0000000001000000000001000010000000111110',
  '0000000010000000000000101100000000000000',
]

const examples = {
  'UTF-8': {
    char: 'A',
    cp: 0x41,
  },
  Unicode: {
    char: 'A',
    cp: 0x41,
  },
  'UTF-16': {
    char: 'A',
    cp: 0x0041,
  },
  'UTF-32': {
    char: 'A',
    cp: 0x00000041,
  },
  ASCII: {
    char: 'A',
    cp: 0x41,
  },
  'ISO-8859-1': {
    char: 'é',
    cp: 0xe9,
  },
  'Windows-1251': {
    char: 'ё',
    cp: 0xb8,
  },
  'Windows-1250': {
    char: '€',
    cp: 0x80,
  },
  'Shift-JIS': {
    char: 'あ',
    cp: 0x82a0,
  },
  'EUC-KR': {
    char: '가',
    cp: 0xb0a1,
  },
  'ISO-2022-CN': {
    char: '你',
    cp: 0x4463,
  },
  GB2312: {
    char: '你',
    cp: 0xc4e3,
  },
  GBK: {
    char: '你',
    cp: 0xc4e3,
  },
  GB18030: {
    char: '你',
    cp: 0xc4e3,
  },
  Big5: {
    char: '你',
    cp: 0xa741,
  },
  'KOI8-R': {
    char: 'Я',
    cp: 0xf1,
  },
  'ISO-8859-5': {
    char: 'Я',
    cp: 0xcf,
  },
  'ISO-8859-2': {
    char: 'č',
    cp: 0xe8,
  },
  'TIS-620': {
    char: 'ะ',
    cp: 0xd0,
  },
  MacRoman: {
    char: 'é',
    cp: 0x8e,
  },
}

// font file suffix -> resolved charset (the "iso2022cn" font is a GB2312 font
// in GL form: v3 reports its charset as 'gb2312')
const cjks: Record<string, string> = {
  utf8: 'utf8',
  unicode: 'unicode',
  iso10646: 'iso10646',
  gb2312: 'gb2312',
  iso2022cn: 'gb2312',
  big5: 'big5',
  shiftjis: 'shiftjis',
  euckr: 'euckr',
}

describe('Encoding', () => {
  describe('font loading and encoding-related properties', () => {
    test('normal', async () => {
      const font = new Font()
      ;(
        await font.load_filelines(
          readlineiter('./test/fonts/unifont-13.0.04-enctest-utf8.bdf')
        )
      ).encoding({ iconv })
      expect(font).toBeInstanceOf(Font)
      expect(font.props.charset_registry).toEqual('UTF-8')
      expect(font.charset).toEqual('utf8')
      expect(font.draw('A人光').bindata).toEqual(aRenGuangBitmap)
    })
    test('charset forced by .encoding() before loading persists (v3)', async () => {
      const font = new Font()
      await font
        .encoding({ charset: 'gbk' })
        .load_filelines(
          readlineiter('./test/fonts/unifont-13.0.04-enctest-utf8.bdf')
        )
      expect(font.props.charset_registry).toEqual('UTF-8')
      expect(font.charset).toEqual('gbk')
      expect(font.draw('A人光').bindata).not.toEqual(aRenGuangBitmap)
      font.encoding({ charset: 'utf8' })
      expect(font.draw('A人光').bindata).toEqual(aRenGuangBitmap)
    })
    test('charset overwritten by .encoding()', async () => {
      const font = new Font()
      ;(
        await font
          .encoding({ charset: 'gbk' })
          .load_filelines(
            readlineiter('./test/fonts/unifont-13.0.04-enctest-utf8.bdf')
          )
      ).encoding({ iconv, charset: 'gb2312' })
      expect(font.props.charset_registry).toEqual('UTF-8')
      expect(font.charset).toEqual('gb2312')
      expect(font.draw('A人光').bindata).not.toEqual(aRenGuangBitmap)
    })
    test('.char2cp() unicode', async () => {
      const font = new Font()
      ;(
        await font.load_filelines(
          readlineiter('./test/fonts/unifont-13.0.04-enctest-utf8.bdf')
        )
      ).encoding({ iconv })
      expect(font.char2cp('人')).toEqual(20154)
    })
    test('.cp2char() unicode', async () => {
      const font = new Font()
      ;(
        await font.load_filelines(
          readlineiter('./test/fonts/unifont-13.0.04-enctest-utf8.bdf')
        )
      ).encoding({ iconv })
      expect(font.cp2char(20154)).toEqual('人')
    })
    test('.char2cp() gb2312', async () => {
      const font = new Font()
      ;(
        await font.load_filelines(
          readlineiter('./test/fonts/unifont-13.0.04-enctest-utf8.bdf')
        )
      ).encoding({ iconv, charset: 'gb2312' })
      expect(font.char2cp('人')).toEqual(51403)
    })
    test('.cp2char() gb2312', async () => {
      const font = new Font()
      ;(
        await font.load_filelines(
          readlineiter('./test/fonts/unifont-13.0.04-enctest-utf8.bdf')
        )
      ).encoding({ iconv, charset: 'gb2312' })
      expect(font.cp2char(51403)).toEqual('人')
    })
    test('.char2cp() overwritten', async () => {
      const font = new Font()
      ;(
        await font.load_filelines(
          readlineiter('./test/fonts/unifont-13.0.04-enctest-utf8.bdf')
        )
      ).encoding({
        iconv,
        charset: 'gb2312',
        char2cp: (_char) => 0,
        cp2char: (_cp) => '一',
      })
      expect(font.char2cp('人')).toEqual(0)
    })
    test('.cp2char() overwritten', async () => {
      const font = new Font()
      ;(
        await font.load_filelines(
          readlineiter('./test/fonts/unifont-13.0.04-enctest-utf8.bdf')
        )
      ).encoding({
        iconv,
        charset: 'gb2312',
        char2cp: (_char) => 0,
        cp2char: (_cp) => '一',
      })
      expect(font.cp2char(51403)).toEqual('一')
    })
  })

  describe('various encodings', () => {
    for (const [encoding, { char, cp }] of Object.entries(examples)) {
      test(`"${char}" in ${encoding}`, async () => {
        const font = new Font()
        ;(
          await font.load_filelines(
            readlineiter(`./test/fonts/unifont-13.0.04-enctest-utf8.bdf`)
          )
        ).encoding({ iconv, charset: encoding })
        expect(font.char2cp(char)).toEqual(cp)
        expect(font.cp2char(cp)).toEqual(char)
      })
    }
    for (const [encoding, charset] of Object.entries(cjks)) {
      test(`"A人光" bitmap in ${encoding} font`, async () => {
        const font = new Font()
        ;(
          await font.load_filelines(
            readlineiter(`./test/fonts/unifont-13.0.04-enctest-${encoding}.bdf`)
          )
        ).encoding({ iconv })
        expect(font.charset).toEqual(charset)
        expect(font.draw('A人光').bindata).toEqual(aRenGuangBitmap)
      })
    }
    test(`"Aœ" bitmap in cp1252 font`, async () => {
      const font = new Font()
      ;(
        await font.load_filelines(
          readlineiter(`./test/fonts/unifont-13.0.04-enctest-cp1252.bdf`)
        )
      ).encoding({ iconv })
      expect(font.draw('Aœ').bindata).toEqual([
        '000000000000000000000000',
        '000000000000000000000000',
        '000000000000000000000000',
        '000000000000000000000000',
        '000110000000000000000000',
        '001001000000000000000000',
        '001001000011011000000000',
        '010000100100100100000000',
        '010000100100100100000000',
        '011111100100111100000000',
        '010000100100100000000000',
        '010000100100100000000000',
        '010000100100100100000000',
        '010000100011011000000000',
        '000000000000000000000000',
        '000000000000000000000000',
      ])
    })
    test(`"AЭ" bitmap in cp1251 font`, async () => {
      const font = new Font()
      ;(
        await font.load_filelines(
          readlineiter(`./test/fonts/unifont-13.0.04-enctest-cp1251.bdf`)
        )
      ).encoding({ iconv })
      expect(font.draw('AЭ').bindata).toEqual([
        '000000000000000000000000',
        '000000000000000000000000',
        '000000000000000000000000',
        '000000000000000000000000',
        '000110000011100000000000',
        '001001000100010000000000',
        '001001000000001000000000',
        '010000100000001000000000',
        '010000100011111000000000',
        '011111100000001000000000',
        '010000100000001000000000',
        '010000100000001000000000',
        '010000100100010000000000',
        '010000100011100000000000',
        '000000000000000000000000',
        '000000000000000000000000',
      ])
    })
    test(`"Ať" bitmap in cp1250 font`, async () => {
      const font = new Font()
      ;(
        await font.load_filelines(
          readlineiter(`./test/fonts/unifont-13.0.04-enctest-cp1250.bdf`)
        )
      ).encoding({ iconv })
      expect(font.draw('Ať').bindata).toEqual([
        '000000000010010000000000',
        '000000000001100000000000',
        '000000000000000000000000',
        '000000000000000000000000',
        '000110000001000000000000',
        '001001000001000000000000',
        '001001000001000000000000',
        '010000100111110000000000',
        '010000100001000000000000',
        '011111100001000000000000',
        '010000100001000000000000',
        '010000100001000000000000',
        '010000100001000000000000',
        '010000100000110000000000',
        '000000000000000000000000',
        '000000000000000000000000',
      ])
    })
  })

  describe('encoding utils', () => {
    for (const [encoding, { char, cp }] of Object.entries(examples)) {
      test(`char2cp() cp2char() for "${char}" in ${encoding}`, () => {
        expect(char2cp(char, encoding, iconv)).toEqual(cp)
        expect(cp2char(cp, encoding, iconv)).toEqual(char)
      })
    }
    test('sanitizeCharsetName()', () => {
      expect(sanitizeCharsetName('utf8')).toEqual('utf8')
      expect(sanitizeCharsetName('UTF-8')).toEqual('utf8')
      expect(sanitizeCharsetName('_utf32')).toEqual('_utf32')
      expect(sanitizeCharsetName('-_utf32-')).toEqual('_utf32')
      expect(sanitizeCharsetName('GB2312.1980')).toEqual('gb2312')
    })
  })
})

describe('v3 charsets', () => {
  let warnings: string[] = []
  beforeEach(() => {
    warnings = []
    setWarningHandler((m) => warnings.push(m))
  })
  afterAll(() => {
    setWarningHandler(undefined)
  })

  const fontWith = (registry: string, encoding: string, cps: number[]) =>
    new Font().load_string(
      `STARTFONT 2.1
FONT x
SIZE 16 75 75
FONTBOUNDINGBOX 2 2 0 0
STARTPROPERTIES 2
CHARSET_REGISTRY "${registry}"
CHARSET_ENCODING "${encoding}"
ENDPROPERTIES
CHARS ${cps.length}
${cps
  .map(
    (cp) =>
      `STARTCHAR g${cp}\nENCODING ${cp}\nBBX 1 1 0 0\nBITMAP\n80\nENDCHAR\n`
  )
  .join('')}ENDFONT
`
    )

  test('issue tomchen/bdfparser#4: GB2312.1980-0 font in GL form', () => {
    const font = fontWith('GB2312.1980', '0', [0x41, 12321])
    expect(font.charset).toBe('gb2312')
    expect(font.cp2char(12321)).toBe('啊')
    expect(font.char2cp('啊')).toBe(0x3021)
    expect(font.glyph('啊')?.cp()).toBe(12321)
    expect(font.glyph('啊')?.chr()).toBe('啊')
    expect(font.lacksglyphs('A啊吖')).toEqual(['吖'])
    expect(font.draw('A啊').width()).toBe(4)
    // GL detected from the codepoints even when CHARSET_ENCODING is "1"
    const f2 = fontWith('GB2312.1980', '1', [0x41, 12321])
    expect(f2.cp2char(12321)).toBe('啊')
    // EUC form
    const f3 = fontWith('GB2312.1980', '1', [0xb0a1])
    expect(f3.cp2char(0xb0a1)).toBe('啊')
    expect(f3.char2cp('啊')).toBe(0xb0a1)
    expect(f3.cp2char(0x3021)).toBeNull()
  })

  test('JIS X 0208, KS C 5601 (GL), JIS X 0201', () => {
    const jis = fontWith('JISX0208.1983', '0', [0x2422])
    expect(jis.cp2char(0x2422)).toBe('あ')
    expect(jis.char2cp('あ')).toBe(0x2422)
    expect(jis.char2cp('A')).toBe(0x41)
    expect(jis.char2cp('丂')).toBeNull()
    const ks = fontWith('KSC5601.1987', '0', [0x3021])
    expect(ks.charset).toBe('ksc5601')
    expect(ks.cp2char(0x3021)).toBe('가')
    const kx = fontWith('KSX1001', '0', [0x3021])
    expect(kx.charset).toBe('ksc5601')
    const k = fontWith('JISX0201.1976', '0', [0x41, 0xb1])
    expect(k.cp2char(0xb1)).toBe('ｱ')
    expect(k.cp2char(0x41)).toBe('A')
    expect(k.cp2char(0x90)).toBeNull()
    expect(k.char2cp('ｱ')).toBe(0xb1)
    expect(k.char2cp('A')).toBe(0x41)
    expect(k.char2cp('あ')).toBeNull()
  })

  test('multi-byte charsets: 0x00-0x7F is ASCII in every runtime', () => {
    // Node's ICU Shift_JIS decoder maps 0x1A -> U+001C, 0x1C -> U+007F and
    // 0x7F -> U+001A (WHATWG, Bun, Deno and Python: identity)
    for (const cs of [
      'shiftjis',
      'eucjp',
      'jisx0208',
      'euckr',
      'ksc5601',
      'gb2312',
      'gbk',
      'big5',
    ]) {
      const c = getCodec(cs)
      for (let cp = 0; cp < 0x80; cp++) {
        const ch = String.fromCharCode(cp)
        expect(c.cp2char(cp), `${cs} ${cp}`).toBe(ch)
        expect(c.char2cp(ch), `${cs} ${cp}`).toBe(cp)
      }
    }
    expect(getCodec('shiftjis').cp2char(0xb1)).toBe('ｱ')
    expect(getCodec('shiftjis').char2cp('ｱ')).toBe(0xb1)
  })

  test('single-byte charsets do not depend on the runtime TextDecoder', async () => {
    // e.g. Node.js 20's TextDecoder('windows-1252') decodes as ISO 8859-1:
    // the tables are generated from Python's codecs (SPEC-v3 §11.1)
    const Real = globalThis.TextDecoder
    class Broken extends Real {
      constructor(label?: string, options?: TextDecoderOptions) {
        super(label === 'utf-8' ? label : 'iso-8859-2', options)
      }
    }
    vi.resetModules()
    globalThis.TextDecoder = Broken as typeof TextDecoder
    try {
      const enc = await import('../src/encoding')
      const c = enc.getCodec('cp1252')
      expect(c.cp2char(0x80)).toBe('€')
      expect(c.cp2char(0x9f)).toBe('Ÿ')
      expect(c.cp2char(0x81)).toBeNull() // undefined in Python's cp1252
      expect(c.cp2char(0xe9)).toBe('é')
      expect(c.cp2char(0x41)).toBe('A')
      expect(c.cp2char(0x100)).toBeNull()
      expect(c.char2cp('€')).toBe(0x80)
      expect(c.char2cp('Ÿ')).toBe(0x9f)
      expect(c.char2cp('é')).toBe(0xe9)
      expect(c.char2cp('\x80')).toBeNull()
      expect(c.char2cp('\x81')).toBeNull()
      expect(c.char2cp('Ā')).toBeNull()
      // every mapped byte round-trips
      for (const cs of ['cp1252', 'koi8r', 'iso885911', 'cp437', 'macroman']) {
        const k = enc.getCodec(cs)
        expect(k.exact).toBe(true)
        for (let b = 0; b < 0x100; b++) {
          const ch = k.cp2char(b)
          if (ch !== null) {
            expect(k.char2cp(ch), `${cs} ${b}`).toBe(b)
          }
        }
      }
    } finally {
      globalThis.TextDecoder = Real
      vi.resetModules()
    }
  })

  test('single-byte charsets', () => {
    const l1 = fontWith('ISO8859', '1', [0xe9])
    expect(l1.charset).toBe('iso88591')
    expect(l1.cp2char(0x80)).toBe('\x80') // identity, not windows-1252
    expect(l1.cp2char(0x06fe)).toBeNull()
    expect(l1.char2cp('€')).toBeNull()
    expect(fontWith('ISO8859', '0', []).charset).toBe('iso88591')
    expect(fontWith('ISO8859', '5', []).cp2char(0xcf)).toBe('Я')
    expect(fontWith('KOI8', 'R', []).cp2char(0xf1)).toBe('Я')
    expect(fontWith('KOI8', 'U', []).charset).toBe('koi8u')
    expect(fontWith('microsoft', 'cp1252', []).cp2char(0x80)).toBe('€')
    expect(fontWith('microsoft', 'symbol', []).charset).toBe('microsoft')
    expect(fontWith('windows-1251', '0', []).charset).toBe('cp1251')
    const a = fontWith('ISO646.1991', 'IRV', [])
    expect(a.charset).toBe('iso646')
    expect(a.cp2char(0x41)).toBe('A')
    expect(a.cp2char(0x80)).toBeNull()
    expect(a.char2cp('é')).toBeNull()
    expect(a.char2cp('A')).toBe(0x41)
    const cp = fontWith('CP1252', '0', [])
    expect(cp.cp2char(0x06fe)).toBeNull()
    expect(cp.char2cp('€')).toBe(0x80)
    expect(cp.char2cp('中')).toBeNull()
  })

  test('unknown charset: Unicode identity, warned once per font', () => {
    const f = fontWith('FontSpecific', '0', [0x41])
    expect(f.charset).toBe('fontspecific')
    expect(f.cp2char(0x41)).toBe('A')
    expect(f.char2cp('A')).toBe(0x41)
    f.glyph('A')
    expect(warnings).toEqual([
      "Unknown charset 'fontspecific', characters are mapped to codepoints as Unicode",
    ])
    expect(f.newglyph(0x42).meta.glyphname).toBe('char66')
  })

  test('Unicode font: astral characters, invalid input', () => {
    const f = fontWith('ISO10646', '1', [0x1f600])
    expect(f.glyph('😀')?.cp()).toBe(0x1f600)
    expect(f.lacksglyphs('😀😁')).toEqual(['😁'])
    expect(f.cp2char(0x110000)).toBeNull()
    expect(f.cp2char(-1)).toBeNull()
    expect(f.cp2char(1.5)).toBeNull()
    expect(() => f.char2cp('ab')).toThrow(TypeError)
    expect(() => f.char2cp('')).toThrow(TypeError)
    expect(f.draw('😀').width()).toBe(2)
  })

  test('encoding(): charset override, clearing, setter, custom functions', () => {
    const f = fontWith('ISO10646', '1', [0x41])
    f.encoding({ charset: 'Big5-0' })
    expect(f.charset).toBe('big5')
    f.encoding({ charset: '' })
    expect(f.charset).toBe('iso10646')
    f.charset = 'microsoft-cp1252'
    expect(f.charset).toBe('cp1252')
    f.encoding({ charset: null })
    f.encoding({ char2cp: () => undefined, cp2char: () => undefined })
    expect(f.char2cp('A')).toBeNull()
    expect(f.cp2char(65)).toBeNull()
    expect(f.glyph('A')).toBeNull()
    expect(f.draw('A').width()).toBe(2) // drawn as missing glyph
  })

  test('canonical names, props, codecs', () => {
    expect(sanitizeCharset()).toBe('iso10646')
    expect(sanitizeCharset('ISO8859', 2)).toBe('iso88592')
    expect(sanitizeCharset('ISO8859', 'x')).toBe('iso88591')
    expect(sanitizeCharset('SJIS')).toBe('shiftjis')
    expect(sanitizeCharset('win1250')).toBe('cp1250')
    expect(sanitizeCharset('1252')).toBe('1252')
    expect(canonicalCharset('ISO10646-1')).toBe('iso10646')
    expect(canonicalCharset('big5-0')).toBe('big5')
    expect(canonicalCharset('microsoft-cp1252')).toBe('cp1252')
    expect(canonicalCharset('ISO-8859-5')).toBe('iso88595')
    expect(canonicalCharset('nonsense-1')).toBe('nonsense1')
    expect(canonicalCharset('nonsense')).toBe('nonsense')
    expect(charsetProps('utf8')).toEqual(['ISO10646', '1'])
    expect(charsetProps('iso88592')).toEqual(['ISO8859', '2'])
    expect(charsetProps('cp1250')).toEqual(['MICROSOFT', 'CP1250'])
    expect(charsetProps('gb2312')).toEqual(['GB2312.1980', '0'])
    expect(charsetProps('big5')).toEqual(['BIG5', '0'])
    expect(isUnicodeCharset('utf16le')).toBe(true)
    expect(isUnicodeCharset('big5')).toBe(false)
    expect(getCodec('nonsense').known).toBe(false)
    expect(getCodec('gb2312').gl94).toBe(true)
    expect(getCodec('gb2312').gl).toBe(false)
    expect(getCodec('iso2022cn').gl).toBe(true)
    expect(getCodec('utf-16le').unicode).toBe(true)
    expect(getCodec('iso-8859-2').cp2char(0xe8)).toBe('č')
    expect(getCodec('iso88593').cp2char(0xa1)).toBe('Ħ')
    // not a key of the canonical table (Python): unknown, Unicode identity
    expect(getCodec('latin2').known).toBe(false)
    expect(getCodec('latin2').cp2char(0xe8)).toBe('è')
    expect(detectGL('0', [])).toBe(true)
    expect(detectGL(0, [])).toBe(true)
    expect(detectGL(' 0\t', [])).toBe(true)
    expect(detectGL('\u00a00', [])).toBe(false) // ASCII whitespace only
    expect(detectGL(null, [0x41, 0xb0a1, 0x3021])).toBe(true)
    expect(detectGL(undefined, [0x41, 0xb0a1])).toBe(false)
    expect(detectGL('1', [0x41])).toBe(false)
  })

  test('multi-byte charsets without bdfparser/cjk: restricted TextDecoder, one warning', () => {
    // this test file does not import bdfparser/cjk
    const c = getCodec('cp936')
    expect(c.exact).toBe(false)
    expect(warnings).toEqual([
      "The exact tables of the charset 'cp936' are not loaded: using the runtime's TextDecoder, results may differ from the Python bdfparser and between runtimes (import 'bdfparser/cjk' or load bdfparser-cjk.global.js for exact conversions)",
    ])
    getCodec('cp936')
    expect(warnings.length).toBe(1) // once per charset
    expect(c.cp2char(0xc4e3)).toBe('你')
    expect(c.char2cp('你')).toBe(0xc4e3)
    expect(cp2char(0x4141, 'gbk')).toBeNull()
    expect(cp2char(0x81, 'gbk')).toBeNull()
    expect(cp2char(0x41, 'gbk')).toBe('A')
    expect(cp2char(0x8130, 'gbk')).toBeNull() // trail byte out of range
    expect(cp2char(0x81308130, 'gbk')).toBeNull()
    expect(cp2char(0x81308130, 'gb18030')).toBe('\x80')
    expect(char2cp('𠀀', 'gb18030')).toBeNull() // no 4-byte encoder
    // big5hkscs 0x8862 is two code points (WHATWG); Node's ICU maps it to a
    // PUA character: runtime-dependent without the exact tables
    expect([null, '\uf325']).toContain(cp2char(0x8862, 'big5hkscs'))
    // no TextDecoder for Johab: ASCII only
    expect(cp2char(0x41, 'johab')).toBe('A')
    expect(cp2char(0x8861, 'johab')).toBeNull()
    expect(char2cp('가', 'johab')).toBeNull()
  })

  test('multi-byte charsets without bdfparser/cjk: iconv-lite instead of TextDecoder', () => {
    expect(char2cp('𠀀', 'gb18030', iconv)).toBe(0x95328236)
    expect(cp2char(0x95328236, 'gb18030', iconv)).toBe('𠀀')
    expect(cp2char(0x4141, 'gbk', iconv)).toBeNull()
    expect(cp2char(0x81, 'gbk', iconv)).toBeNull()
    expect(char2cp('a', 'gbk', iconv)).toBe(0x61)
    expect(char2cp('你', 'big5', iconv)).toBe(0xa741)
    expect(char2cp('€', 'gbk', iconv)).toBeNull() // '?' substitution
    // single-byte charsets always use the tables
    expect(char2cp('中', 'cp1252', iconv)).toBeNull()
    expect(char2cp('?', 'cp1252', iconv)).toBe(0x3f)
    expect(char2cp('a', 'cp437', iconv)).toBe(0x61)
    expect(char2cp('a', 'cp437')).toBe(0x61) // cp437 is in the table now
    const throwing = {
      encode: () => {
        throw new Error('x')
      },
      decode: () => {
        throw new Error('x')
      },
      encodingExists: () => {
        throw new Error('x')
      },
    }
    // encodingExists throws: TextDecoder
    expect(char2cp('你', 'big5hkscs', throwing)).toBe(0xa741)
    const noExists = { encode: throwing.encode, decode: throwing.decode }
    expect(char2cp('a', 'euckr', noExists)).toBe(0x61) // ASCII
    expect(char2cp('가', 'euckr', noExists)).toBeNull()
    expect(cp2char(0xb0a1, 'euckr', noExists)).toBeNull()
    const longEnc = {
      encode: () => new Uint8Array(3),
      decode: () => 'ab',
    }
    expect(char2cp('가', 'cp949', longEnc)).toBeNull()
    expect(cp2char(0xb0a1, 'cp949', longEnc)).toBeNull()
  })
})
