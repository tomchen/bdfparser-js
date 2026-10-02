import { readFileSync } from 'fs'
import { gzipSync } from 'zlib'
import readlineiter from 'readlineiter'
import {
  $Font,
  BDFParseError,
  Font,
  defaultWarningHandler,
  setWarningHandler,
} from '../src/index'
import { gunzip } from '../src/Font'
import { warn } from '../src/warn'

const minimal = (
  body: string,
  props = 'STARTPROPERTIES 1\nFOO 1\nENDPROPERTIES\n'
) =>
  `STARTFONT 2.1\nFONT test\nSIZE 8 75 75\nFONTBOUNDINGBOX 8 8 0 -1\n${props}${body}`

const glyphA = `STARTCHAR A
ENCODING 65
SWIDTH 500 0
DWIDTH 8 0
BBX 4 2 1 0
BITMAP
F0
90
ENDCHAR
`

let warnings: string[] = []
beforeEach(() => {
  warnings = []
  setWarningHandler((m) => warnings.push(m))
})
afterAll(() => {
  setWarningHandler(undefined)
})

describe('warning handler', () => {
  test('setWarningHandler returns previous; null silences; undefined restores', () => {
    const prev = setWarningHandler(null)
    expect(typeof prev).toBe('function')
    warn('silenced')
    expect(warnings).toEqual([])
    const p2 = setWarningHandler(undefined)
    expect(p2).toBeNull()
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    warn('hello')
    expect(spy).toHaveBeenCalledWith('[bdfparser] hello')
    defaultWarningHandler('x')
    expect(spy).toHaveBeenCalledWith('[bdfparser] x')
    spy.mockRestore()
    setWarningHandler(prev)
  })
})

describe('line endings and whitespace', () => {
  const text = minimal(`CHARS 1\n${glyphA}ENDFONT\n`)
  const ref = new Font().load_string(text)

  test.each([
    ['LF', text],
    ['CRLF', text.replace(/\n/g, '\r\n')],
    ['CR', text.replace(/\n/g, '\r')],
    ['blank lines', text.replace(/\n/g, '\n\n  \n')],
    ['tabs & spaces', text.replace(/ /g, ' \t  ').replace(/\n/g, '  \n\t')],
    ['BOM', '﻿' + text],
  ])('%s', (_name, t) => {
    const f = new Font().load_string(t)
    expect(f.headers).toEqual(ref.headers)
    expect(f.props).toEqual(ref.props)
    expect([...f.glyphs]).toEqual([...ref.glyphs])
    expect(warnings).toEqual([])
  })

  test('load_filelines accepts sync iterables and multi-line chunks', async () => {
    const f1 = await new Font().load_filelines(text.split('\n'))
    const cut = text.indexOf('\n', 60) + 1
    const f2 = await new Font().load_filelines([
      text.slice(0, cut),
      text.slice(cut).replace(/\n/g, '\r\n'),
    ])
    expect(f1.tobdf()).toEqual(ref.tobdf())
    // chunks containing several lines are split on line breaks
    expect(f2.tobdf()).toEqual(ref.tobdf())
  })

  test('load_filelines with readlineiter', async () => {
    const f = await new Font().load_filelines(
      readlineiter('./test/fonts/spec_example_fixed.bdf')
    )
    expect(f.glyphs.size).toBe(2)
  })
})

describe('headers', () => {
  test('all header keywords', () => {
    const f = new Font().load_string(`STARTFONT 2.2
COMMENT "quoted"
COMMENT  plain  comment
COMMENT
COMMENT "unbalanced
FONT  My Font Name
SIZE 10 72 96
FONTBOUNDINGBOX 9 11 -1 -2
METRICSSET 2
CONTENTVERSION 7
SWIDTH 500 0
DWIDTH 8 0
SWIDTH1 0 1000
DWIDTH1 0 16
VVECTOR 4,14
CHARS 0
ENDFONT
`)
    expect(f.headers).toEqual({
      bdfversion: 2.2,
      comment: ['quoted', 'plain  comment', '', '"unbalanced'],
      fontname: 'My Font Name',
      pointsize: 10,
      xres: 72,
      yres: 96,
      fbbx: 9,
      fbby: 11,
      fbbxoff: -1,
      fbbyoff: -2,
      metricsset: 2,
      contentversion: 7,
      swx0: 500,
      swy0: 0,
      dwx0: 8,
      dwy0: 0,
      swx1: 0,
      swy1: 1000,
      dwx1: 0,
      dwy1: 16,
      vvectorx: 4,
      vvectory: 14,
    })
    expect(f.props).toEqual({})
    expect(warnings).toEqual([
      "It looks like the font does not have property block beginning with 'STARTPROPERTIES' keyword",
    ])
  })

  test('VVECTOR delimiter: comma and/or whitespace (v3-rc bug fix)', () => {
    for (const v of ['3 4', '3,4', '3, 4', '3 ,  4']) {
      const f = new Font().load_string(
        minimal(
          `CHARS 1\nSTARTCHAR a\nENCODING 97\nVVECTOR ${v}\nBBX 0 0 0 0\nBITMAP\nENDCHAR\nENDFONT\n`,
          `VVECTOR ${v}\nSTARTPROPERTIES 0\nENDPROPERTIES\n`
        )
      )
      expect([f.headers.vvectorx, f.headers.vvectory]).toEqual([3, 4])
      expect(f.glyphs.get(97)?.slice(14, 16)).toEqual([3, 4])
    }
  })

  test('unknown header keywords are ignored with a warning', () => {
    const f = new Font().load_string(
      minimal('CHARS 0\nENDFONT\n').replace('FONT test', 'FONT test\nFOO bar')
    )
    expect(f.headers.fontname).toBe('test')
    expect(warnings).toEqual(["line 3: unknown header keyword 'FOO' ignored"])
  })

  test('the v2 "empty lines" test font', () => {
    const f = new Font().load_string(
      readFileSync(
        './test/fonts/unifont-13.0.04-for-test-emptylines.bdf',
        'utf8'
      )
    )
    expect(f.glyphs.size).toBe(3)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.every((w) => w.includes('ignored'))).toBe(true)
  })

  test('metricsset defaults to 0', () => {
    const f = new Font().load_string(minimal('CHARS 0\nENDFONT\n'))
    expect(f.headers.metricsset).toBe(0)
  })
})

describe('properties', () => {
  const f = () =>
    new Font().load_string(
      minimal(
        'CHARS 0\nENDFONT\n',
        `STARTPROPERTIES 9
COMMENT "prop comment"
FAMILY_NAME "A ""quoted"" name"
MinSpace 4
NEG -12
PLUS +3
_XFREE86_GLYPH_RANGES 0-100 200-300
RAW_TOKEN abc
EMPTY ""
KEY_ONLY
TRAILING "abc" ignored text
ENDPROPERTIES
`
      )
    )

  test('typed values', () => {
    expect(f().props).toEqual({
      comment: ['prop comment'],
      family_name: 'A "quoted" name',
      minspace: 4,
      neg: -12,
      plus: 3,
      _xfree86_glyph_ranges: '0-100 200-300',
      raw_token: 'abc',
      empty: '',
      key_only: null,
      trailing: 'abc',
    })
  })

  test('original names kept', () => {
    const font = f()
    expect(font._propnames.get('minspace')).toBe('MinSpace')
    expect(font.getprop('MINSPACE')).toBe(4)
    expect(font.getprop('nope')).toBeNull()
  })

  test('count mismatch warns', () => {
    f()
    expect(warnings).toEqual([])
    new Font().load_string(
      minimal('CHARS 0\nENDFONT\n', 'STARTPROPERTIES 2\nA 1\nENDPROPERTIES\n')
    )
    expect(warnings).toEqual([
      "The property count next to 'STARTPROPERTIES' keyword is 2, which does not match the actual property count 1",
    ])
  })

  test('missing closing quote', () => {
    const font = new Font().load_string(
      minimal(
        'CHARS 0\nENDFONT\n',
        'STARTPROPERTIES 1\nFOO "abc "" def\nENDPROPERTIES\n'
      )
    )
    expect(font.props.foo).toBe('abc " def')
    expect(warnings).toEqual(['line 6: property value has no closing quote'])
  })

  test('malformed STARTPROPERTIES count', () => {
    new Font().load_string(
      minimal('CHARS 0\nENDFONT\n', 'STARTPROPERTIES x\nENDPROPERTIES\n')
    )
    expect(warnings).toEqual(['line 5: malformed property count "x"'])
    warnings = []
    new Font().load_string(
      minimal('CHARS 0\nENDFONT\n', 'STARTPROPERTIES\nENDPROPERTIES\n')
    )
    expect(warnings).toEqual([])
  })

  test.each([
    [
      'CHARS 1\n' + glyphA + 'ENDFONT\n',
      1,
      ["line 7: missing 'ENDPROPERTIES'"],
    ],
    [
      glyphA + 'ENDFONT\n',
      1,
      [
        "line 7: missing 'ENDPROPERTIES'",
        "Cannot find 'CHARS' line",
        "The glyph count next to 'CHARS' keyword does not exist",
      ],
    ],
    [
      'ENDFONT\n',
      0,
      ["line 7: missing 'ENDPROPERTIES'", 'This font does not have any glyphs'],
    ],
  ])('missing ENDPROPERTIES before %#', (body, n, expected) => {
    const font = new Font().load_string(
      minimal(body, 'STARTPROPERTIES 1\nFOO 1\n')
    )
    expect(font.glyphs.size).toBe(n)
    expect(warnings).toEqual(expected)
  })
})

describe('glyph section', () => {
  test('after ENDPROPERTIES: STARTCHAR without CHARS, ENDFONT, junk', () => {
    const font = new Font().load_string(minimal(glyphA + 'ENDFONT\n'))
    expect(font.glyphs.size).toBe(1)
    expect(warnings).toEqual([
      "Cannot find 'CHARS' line next to 'ENDPROPERTIES' line",
      "The glyph count next to 'CHARS' keyword does not exist",
    ])
    warnings = []
    new Font().load_string(minimal('junk\nENDFONT\n'))
    expect(warnings).toEqual([
      "line 8: unexpected line 'junk' ignored",
      'This font does not have any glyphs',
    ])
  })

  test('no STARTPROPERTIES, STARTCHAR directly / ENDFONT directly', () => {
    let font = new Font().load_string(minimal(glyphA + 'ENDFONT\n', ''))
    expect(font.glyphs.size).toBe(1)
    expect(warnings).toEqual([
      "It looks like the font does not have property block beginning with 'STARTPROPERTIES' keyword",
      "Cannot find 'CHARS' line",
      "The glyph count next to 'CHARS' keyword does not exist",
    ])
    warnings = []
    font = new Font().load_string(minimal('ENDFONT\n', ''))
    expect(font.glyphs.size).toBe(0)
    expect(font.headers.metricsset).toBe(0)
    expect(warnings).toEqual([
      "It looks like the font does not have property block beginning with 'STARTPROPERTIES' keyword",
      'This font does not have any glyphs',
    ])
  })

  test('ENCODING -1 [altcode], unencoded glyphs', () => {
    const font = new Font().load_string(
      minimal(`CHARS 3
STARTCHAR .notdef
ENCODING -1
BBX 1 1 0 0
BITMAP
80
ENDCHAR
STARTCHAR alt
ENCODING -1 123
BBX 0 0 0 0
BITMAP
ENDCHAR
${glyphA}ENDFONT
`)
    )
    expect(font.glyphs.size).toBe(1)
    expect(font.unencoded).toEqual([
      {
        altcode: null,
        meta: [
          '.notdef',
          -1,
          1,
          1,
          0,
          0,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          ['80'],
        ],
      },
      {
        altcode: 123,
        meta: [
          'alt',
          -1,
          0,
          0,
          0,
          0,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          [],
        ],
      },
    ])
    expect(warnings).toEqual([])
    // altcode of an encoded glyph is ignored
    const f2 = new Font().load_string(
      minimal(
        `CHARS 1\n${glyphA.replace('ENCODING 65', 'ENCODING 65 9')}ENDFONT\n`
      )
    )
    expect(f2.glyphs.has(65)).toBe(true)
  })

  test('negative ENCODING other than -1, missing ENCODING', () => {
    const font = new Font().load_string(
      minimal(`CHARS 2
STARTCHAR neg
ENCODING -5
BBX 0 0 0 0
BITMAP
ENDCHAR
STARTCHAR noenc
BBX 0 0 0 0
BITMAP
ENDCHAR
ENDFONT
`)
    )
    expect(font.unencoded.map((u) => u.meta[1])).toEqual([-1, -1])
    expect(warnings).toEqual([
      "line 9: glyph 'neg' has negative ENCODING -5, treated as unencoded",
      "line 14: glyph 'noenc' has no ENCODING, treated as unencoded",
    ])
  })

  test('glyph name with spaces; repeated keywords: first wins; unknown keyword', () => {
    const font = new Font().load_string(
      minimal(`CHARS 1
STARTCHAR my  glyph name
ENCODING 66
ENCODING 67
BBX 1 1 0 0
BBX 2 2 0 0
DWIDTH 3 0
DWIDTH 4 0
ATTRIBUTES 0000
BITMAP
80
ENDCHAR
ENDFONT
`)
    )
    expect(font.glyphs.get(66)?.slice(0, 10)).toEqual([
      'my  glyph name',
      66,
      1,
      1,
      0,
      0,
      null,
      null,
      3,
      0,
    ])
    expect(warnings).toEqual([
      "line 16: unknown keyword 'ATTRIBUTES' in glyph 'my  glyph name' ignored",
    ])
  })

  test('duplicate codepoint: later wins (moved to the end)', () => {
    const font = new Font().load_string(
      minimal(
        `CHARS 3\n${glyphA}${glyphA.replace('ENCODING 65', 'ENCODING 66')}${glyphA.replace('STARTCHAR A', 'STARTCHAR A2')}ENDFONT\n`
      )
    )
    expect([...font.glyphs.keys()]).toEqual([66, 65])
    expect(font.glyphs.get(65)?.[0]).toBe('A2')
    expect(warnings).toEqual([
      "line 27: duplicate codepoint 65 (glyph 'A2'), the later one wins",
    ])
  })

  test('missing ENDCHAR (before STARTCHAR / ENDFONT, in BITMAP or not)', () => {
    const noEnd = glyphA.replace('ENDCHAR\n', '')
    const noBitmapEnd = 'STARTCHAR B\nENCODING 66\nBBX 0 0 0 0\n'
    for (const body of [
      `CHARS 3\n${noEnd}${noBitmapEnd}STARTCHAR C\nENCODING 67\nBBX 0 0 0 0\nBITMAP\nENDCHAR\nENDFONT\n`,
      `CHARS 2\n${noBitmapEnd}${noEnd}ENDFONT\n`,
      `CHARS 2\n${noEnd}${noBitmapEnd}ENDFONT\n`,
    ]) {
      warnings = []
      const font = new Font().load_string(minimal(body))
      expect(font.glyphs.size).toBe(body.startsWith('CHARS 3') ? 3 : 2)
      expect(
        warnings.filter((w) => w.includes('missing ENDCHAR'))
      ).toHaveLength(2)
    }
    expect(
      new Font()
        .load_string(minimal(`CHARS 1\n${glyphA}ENDFONT\n`))
        .glyphs.get(65)?.[16]
    ).toEqual(['F0', '90'])
  })

  test('end of file inside a glyph, missing ENDFONT, CHARS mismatch', () => {
    const font = new Font().load_string(
      minimal(
        `CHARS 5\n${glyphA}STARTCHAR B\nENCODING 66\nBBX 1 1 0 0\nBITMAP\n80\n`
      )
    )
    expect(font.glyphs.get(66)?.[16]).toEqual(['80'])
    expect(warnings).toEqual([
      "Unexpected end of file: missing ENDCHAR for glyph 'B'",
      "This font does not have 'ENDFONT' keyword",
      "The glyph count next to 'CHARS' keyword is 5, which does not match the actual glyph count 2",
    ])
  })

  test('lines after ENDFONT are ignored; second CHARS warns', () => {
    const font = new Font().load_string(
      minimal(`CHARS 1\nCHARS 2\n${glyphA}ENDFONT\ngarbage\nSTARTCHAR x\n`)
    )
    expect(font.glyphs.size).toBe(1)
    expect(warnings).toEqual(["line 9: unexpected line 'CHARS 2' ignored"])
  })

  test('fewer hex rows than BBX height: padded when drawing, warned once', () => {
    const font = new Font().load_string(
      readFileSync('./test/fonts/spec_example_bad.bdf', 'utf8')
    )
    const g = font.glyph("'")!
    expect(g.draw(1).bindata).toEqual([
      '0111',
      '0111',
      '0110',
      '1110',
      '1100',
      '0000',
    ])
    g.draw()
    font.glyph("'")!.draw()
    expect(warnings).toEqual([
      'Glyph "quoteright" (codepoint 39) has 5 bitmap rows but its BBX height is 6; padded with empty rows',
    ])
    // more rows than bbh: extra rows ignored; short rows padded
    const f2 = new Font().load_string(
      minimal(
        'CHARS 1\nSTARTCHAR x\nENCODING 120\nBBX 12 1 0 0\nBITMAP\nF\nFF\nENDCHAR\nENDFONT\n'
      )
    )
    expect(f2.glyph('x')!.draw(1).bindata).toEqual(['111100000000'])
    expect(f2.glyph('x')!.draw(2).bindata).toEqual(['1111', '11111111'])
  })
})

describe('BDFParseError', () => {
  const cases: [string, string, number | null][] = [
    ['', 'Unexpected end of file before the end of the headers', 1],
    [
      'STARTFONT 2.1\nFONT x\n',
      'Unexpected end of file before the end of the headers',
      3,
    ],
    [
      minimal('', 'STARTPROPERTIES 1\nFOO 1\n'),
      'Unexpected end of file before the end of the headers',
      7,
    ],
    ['STARTFONT abc\n', 'malformed version number in STARTFONT "abc"', 1],
    ['STARTFONT\n', 'malformed version number in STARTFONT ""', 1],
    ['STARTFONT 2.1\nSIZE 8 75\n', 'SIZE needs 3 numbers, got "8 75"', 2],
    [
      'STARTFONT 2.1\nFONTBOUNDINGBOX 8 8 0 x\n',
      'malformed number in FONTBOUNDINGBOX "8 8 0 x"',
      2,
    ],
    ['STARTFONT 2.1\nMETRICSSET a\n', 'malformed number in METRICSSET "a"', 2],
    ['STARTFONT 2.1\nDWIDTH 8\n', 'DWIDTH needs 2 numbers, got "8"', 2],
    [minimal('CHARS x\n'), 'malformed number in CHARS "x"', 8],
    [
      minimal('CHARS 1\nSTARTCHAR a\nENCODING\n'),
      'ENCODING needs a number',
      10,
    ],
    [
      minimal('CHARS 1\nSTARTCHAR a\nENCODING 6.5\n'),
      'malformed number in ENCODING "6.5"',
      10,
    ],
    [
      minimal('CHARS 1\nSTARTCHAR a\nENCODING 65\nBBX 1 1 0\n'),
      'BBX needs 4 numbers, got "1 1 0"',
      11,
    ],
    [
      minimal('CHARS 1\nSTARTCHAR a\nENCODING 65\nBITMAP\nENDCHAR\n'),
      "glyph 'a' (starting at line 9) has no BBX",
      12,
    ],
    [
      minimal('CHARS 1\nSTARTCHAR a\nENCODING 65\nSWIDTH x 0\n'),
      'malformed number in SWIDTH "x 0"',
      11,
    ],
  ]
  test.each(cases)('%#', (text, msg, lineno) => {
    let err: unknown
    try {
      new Font().load_string(text)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(BDFParseError)
    expect(err).toBeInstanceOf(Error)
    const e = err as BDFParseError
    expect(e.name).toBe('BDFParseError')
    expect(e.msg).toBe(msg)
    expect(e.lineno).toBe(lineno)
    expect(e.message).toBe(`line ${lineno}: ${msg}`)
  })

  test('without line number', () => {
    const e = new BDFParseError('oops')
    expect(e.message).toBe('oops')
    expect(e.lineno).toBeNull()
  })
})

describe('load_bytes / load_bytes_async / $Font', () => {
  const bdf = readFileSync('./test/fonts/spec_example_fixed.bdf')
  const ref = new Font().load_string(bdf.toString('utf8'))

  test('BDF bytes (Uint8Array, ArrayBuffer, DataView)', () => {
    const u8 = new Uint8Array(bdf)
    expect(new Font().load_bytes(u8).tobdf()).toBe(ref.tobdf())
    expect(new Font().load_bytes(u8.buffer.slice(0)).tobdf()).toBe(ref.tobdf())
    expect(
      new Font()
        .load_bytes(new DataView(u8.buffer, u8.byteOffset, u8.length))
        .tobdf()
    ).toBe(ref.tobdf())
    expect(() => new Font().load_bytes('x' as never)).toThrow(TypeError)
  })

  test('invalid UTF-8 is replaced', () => {
    const t = new TextEncoder().encode(
      minimal(
        'CHARS 0\nENDFONT\n',
        'STARTPROPERTIES 1\nCOPYRIGHT "©"\nENDPROPERTIES\n'
      )
    )
    const bad = Uint8Array.from([...t].map((b) => (b === 0xc2 ? 0xff : b)))
    const f = new Font().load_bytes(bad)
    expect(f.props.copyright).toBe('��')
  })

  test('PCF and TTF detection', () => {
    const pcf = ref.topcf()
    expect(String.fromCharCode(...pcf.subarray(0, 4))).toBe('\x01fcp')
    const fromPcf = new Font().load_bytes(pcf)
    expect([...fromPcf.glyphs.keys()].sort((a, b) => a - b)).toEqual([39, 106])
    const ttf = ref.tottf()
    const fromTtf = new Font().load_bytes(ttf)
    expect(fromTtf.tobdf()).toBe(ref.tobdf())
    const t2 = new Uint8Array(ttf)
    t2.set([0x74, 0x72, 0x75, 0x65]) // 'true'
    expect(new Font().load_bytes(t2).glyphs.size).toBe(2)
  })

  test('OTTO and gzip errors', () => {
    expect(() =>
      new Font().load_bytes(new TextEncoder().encode('OTTO....'))
    ).toThrow('CFF-based OpenType is not supported')
    expect(() => new Font().load_bytes(gzipSync(bdf))).toThrow(/gzip/)
  })

  test('load_bytes_async decompresses gzip (BDF and PCF)', async () => {
    const f = await new Font().load_bytes_async(gzipSync(bdf))
    expect(f.tobdf()).toBe(ref.tobdf())
    const p = await new Font().load_bytes_async(gzipSync(ref.topcf()))
    expect(p.glyphs.size).toBe(2)
    const plain = await new Font().load_bytes_async(bdf)
    expect(plain.glyphs.size).toBe(2)
  })

  test('gunzip errors', async () => {
    await expect(gunzip(Uint8Array.of(0x1f, 0x8b, 1, 2, 3))).rejects.toThrow()
    const saved = globalThis.DecompressionStream
    // @ts-expect-error simulate an old runtime
    delete globalThis.DecompressionStream
    try {
      await expect(gunzip(gzipSync(bdf))).rejects.toThrow(/DecompressionStream/)
    } finally {
      globalThis.DecompressionStream = saved
    }
  })

  test('$Font with string, bytes, ArrayBuffer, iterables, URL', async () => {
    const text = bdf.toString('utf8')
    for (const src of [
      text,
      new Uint8Array(bdf),
      new Uint8Array(bdf).buffer,
      gzipSync(bdf),
      text.split('\n'),
      readlineiter('./test/fonts/spec_example_fixed.bdf'),
    ]) {
      const f = await $Font(src)
      expect(f.tobdf()).toBe(ref.tobdf())
    }
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array(bdf), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const f = await $Font(new URL('https://example.com/f.bdf'), {
        charset: 'iso8859-1',
      })
      expect(f.charset).toBe('iso88591')
      expect(f.glyphs.size).toBe(2)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('load_url: gzip body, HTTP errors, init passed through', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('404')) {
        return new Response('nope', { status: 404, statusText: 'Not Found' })
      }
      expect(init).toEqual({ cache: 'no-store' })
      return new Response(new Uint8Array(gzipSync(bdf)), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const f = await new Font().load_url('https://x/f.bdf.gz', {
        cache: 'no-store',
      })
      expect(f.glyphs.size).toBe(2)
      await expect(new Font().load_url('https://x/404')).rejects.toThrow(
        'Failed to fetch https://x/404: 404 Not Found'
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('loading resets the previous content but keeps encoding options', () => {
    const f = new Font().encoding({ charset: 'cp1252' })
    f.load_string(
      readFileSync('./test/fonts/unifont-13.0.04-2atest.bdf', 'utf8')
    )
    f.load_string(bdf.toString('utf8'))
    expect(f.glyphs.size).toBe(2)
    expect(f.charset).toBe('cp1252')
  })
})
