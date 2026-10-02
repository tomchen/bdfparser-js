/**
 * SPEC-v3 §11 hardening decisions (parity with the Python bdfparser; the
 * findings K02–K17 of tools/parity/README.md). The charset tables (§11.1) are
 * tested in charsets.test.ts.
 */
import '../src/cjk'
import { Bitmap } from '../src/Bitmap'
import { BDFParseError } from '../src/errors'
import { fmtnum } from '../src/fmt'
import { Font } from '../src/Font'
import { $Font } from '../src/shortcuts'
import { readPcf, writePcf } from '../src/pcf'
import { readTtf, writeTtf } from '../src/ttf'
import { setWarningHandler } from '../src/warn'

const bdf = ({
  props = [] as string[],
  glyphs = [] as string[],
  header = [] as string[],
  fbb = '8 8 0 0',
  version = '2.1',
} = {}): string =>
  [
    `STARTFONT ${version}`,
    'FONT F',
    'SIZE 8 75 75',
    `FONTBOUNDINGBOX ${fbb}`,
    ...header,
    ...(props.length > 0
      ? [`STARTPROPERTIES ${props.length}`, ...props, 'ENDPROPERTIES']
      : []),
    `CHARS ${glyphs.length}`,
    ...glyphs,
    'ENDFONT',
    '',
  ].join('\n')

const glyph = (
  enc: number | string,
  { bbx = '1 1 0 0', rows = ['80'], name = 'g', extra = [] as string[] } = {}
): string =>
  [
    `STARTCHAR ${name}`,
    `ENCODING ${enc}`,
    ...extra,
    `BBX ${bbx}`,
    'BITMAP',
    ...rows,
    'ENDCHAR',
  ].join('\n')

let warnings: string[] = []
let previous: ReturnType<typeof setWarningHandler>
beforeEach(() => {
  warnings = []
  previous = setWarningHandler((m) => warnings.push(m))
})
afterEach(() => {
  setWarningHandler(previous)
})

describe('§11.2 numbers', () => {
  test.each([
    ['ENCODING 1_2', glyph('1_2')],
    ['ENCODING 0x10', glyph('0x10')],
    ['ENCODING ٣ (non-ASCII digit)', glyph('٣')],
    ['BBX 1_0', glyph(65, { bbx: '1_0 1 0 0' })],
    ['BBX Infinity', glyph(65, { bbx: 'Infinity 1 0 0' })],
    ['SWIDTH 1e3', glyph(65, { extra: ['SWIDTH 1e3 0'] })],
  ])('malformed integer: %s', (_name, g) => {
    expect(() => new Font().load_string(bdf({ glyphs: [g] }))).toThrow(
      BDFParseError
    )
  })

  test.each(['inf', 'Infinity', 'nan', '0x10', '2_1', '.5', '1e1', '2.', ''])(
    'malformed STARTFONT version %j',
    (v) => {
      expect(() => new Font().load_string(bdf({ version: v }))).toThrow(
        /malformed version number in STARTFONT/
      )
    }
  )

  test('STARTFONT versions with the strict syntax', () => {
    expect(
      new Font().load_string(bdf({ version: '02.10' })).headers.bdfversion
    ).toBe(2.1)
    expect(new Font().load_string(bdf({ version: '3' })).tobdf()).toMatch(
      /^STARTFONT 3\.0\n/
    )
  })

  test('numeric fields must fit signed 32-bit', () => {
    expect(() =>
      new Font().load_string(bdf({ glyphs: [glyph(2147483648)] }))
    ).toThrow(
      new BDFParseError(
        'number 2147483648 in ENCODING is out of the 32-bit range',
        7
      )
    )
    expect(() =>
      new Font().load_string(
        bdf({
          glyphs: [glyph(-1, { extra: [] })].map((g) =>
            g.replace('ENCODING -1', 'ENCODING -1 4294967296')
          ),
        })
      )
    ).toThrow(/out of the 32-bit range/)
    expect(() =>
      new Font().load_string(bdf({ fbb: '8 8 -2147483649 0' }))
    ).toThrow(
      /number -2147483649 in FONTBOUNDINGBOX is out of the 32-bit range/
    )
    const ok = new Font().load_string(
      bdf({ glyphs: [glyph(2147483647)], fbb: '8 8 -2147483648 0' })
    )
    expect(ok.glyphs.has(2147483647)).toBe(true)
    expect(ok.headers.fbbxoff).toBe(-2147483648)
  })

  test('unquoted property integers: -2**31 .. 2**32-1, else raw strings', () => {
    const f = new Font().load_string(
      bdf({
        props: [
          'A 4294967295',
          'B 4294967296',
          'C -2147483648',
          'D -2147483649',
          'E +007',
          'F 99999999999999999999',
          'G 1000000000000000000000',
        ],
      })
    )
    expect(f.props.a).toBe(4294967295)
    expect(f.props.b).toBe('4294967296')
    expect(f.props.c).toBe(-2147483648)
    expect(f.props.d).toBe('-2147483649')
    expect(f.props.e).toBe(7)
    expect(f.props.f).toBe('99999999999999999999')
    // written back as quoted strings, never as 1e+21
    const out = f.tobdf()
    expect(out).toContain('G "1000000000000000000000"\n')
    expect(out).toContain('A 4294967295\n')
    expect(out).not.toContain('e+')
  })

  test('todata(5): RangeError for rows wider than 53 pixels', () => {
    expect(new Bitmap(['1'.repeat(53)]).todata(5)).toEqual([2 ** 53 - 1])
    expect(() => new Bitmap(['1'.repeat(54)]).todata(5)).toThrow(RangeError)
    expect(() => new Bitmap(['0'.repeat(60)]).todata(5)).toThrow(
      'todata(5): rows wider than 53 pixels cannot be represented exactly as numbers (row width 60)'
    )
    // todata(4) is exact at any width
    expect(new Bitmap(['1'.repeat(60)]).todata(4)).toEqual(['f'.repeat(15)])
  })

  test('todata(4|5) of zero-width rows', () => {
    expect(new Bitmap(['', '']).todata(5)).toEqual([0, 0])
    expect(new Bitmap(['', '']).todata(4)).toEqual(['', ''])
  })

  test('PCF writer range guards, before allocating', () => {
    const base = (props: string[]) =>
      new Font().load_string(
        bdf({ props, glyphs: [glyph(65, { extra: ['DWIDTH 1 0'] })] })
      )
    // K15: absurd FONT_ASCENT used to allocate gigabytes
    expect(() =>
      writePcf(base(['FONT_ASCENT 600000000', 'FONT_DESCENT 0']))
    ).toThrow(
      new RangeError(
        'PCF: FONT_ASCENT 600000000 / FONT_DESCENT 0 do not fit in 16 bits'
      )
    )
    expect(() =>
      writePcf(base(['FONT_ASCENT 20000', 'FONT_DESCENT 20000']))
    ).toThrow(
      'PCF: FONT_ASCENT 20000 / FONT_DESCENT 20000 do not fit in 16 bits'
    )
    // ascent / descent derived from FONTBOUNDINGBOX
    const f = base([])
    f.headers.fbby = 40000
    expect(() => writePcf(f)).toThrow(/do not fit in 16 bits/)
    // property values: 32-bit words (checked first, in property order)
    const g = base(['FONT_ASCENT 600000000'])
    g.setprop('Huge', 2 ** 32)
    expect(() => writePcf(g)).toThrow(
      'PCF: property Huge value 4294967296 does not fit in 32 bits'
    )
    // generated properties too: POINT_SIZE = float32(pointsize) * 10
    const h = base([])
    h.headers.pointsize = 2 ** 30
    expect(() => writePcf(h)).toThrow(
      'PCF: property POINT_SIZE value 10737418240 does not fit in 32 bits'
    )
    // per glyph: negative size, then metrics
    const k = base([])
    ;(k.glyphs.get(65) as unknown[])[2] = -1
    expect(() => writePcf(k)).toThrow(
      'Glyph "g" has a negative sized bitmap, -1x1'
    )
    const m = base([])
    ;(m.glyphs.get(65) as unknown[])[8] = 40000
    expect(() => writePcf(m)).toThrow(
      'Glyph "g": metric value 40000 does not fit in 16 bits'
    )
    // 2**32 - 1 is a valid 32-bit word
    const n = base([])
    n.setprop('MAXU', 2 ** 32 - 1)
    expect(readPcf(writePcf(n)).props.maxu).toBe(-1)
  })
})

describe('§11.3 properties', () => {
  test('file order is kept for integer-like names (K06a)', () => {
    const f = new Font().load_string(
      bdf({ props: ['B 1', '123 5', 'A 2', '7 x'] })
    )
    const out = f.tobdf()
    expect(out).toContain(
      'STARTPROPERTIES 4\nB 1\n123 5\nA 2\n7 "x"\nENDPROPERTIES\n'
    )
    // through every writer and reader
    expect(f.clone().tobdf()).toBe(out)
    expect(readTtf(writeTtf(f)).tobdf()).toBe(out)
    const pcf = readPcf(writePcf(f))
    expect([...pcf._propnames.keys()].slice(0, 4)).toEqual([
      'b',
      '123',
      'a',
      '7',
    ])
    // setprop appends, delprop + setprop moves to the end
    f.setprop('9', 1).delprop('B').setprop('B', 3)
    expect(f.tobdf()).toContain('123 5\nA 2\n7 "x"\n9 1\nB 3\nENDPROPERTIES')
    // keys added directly to font.props come after the known ones
    f.props['55'] = 'direct'
    f.props.zz = 1
    expect(f.tobdf()).toContain('B 3\n55 "direct"\nZZ 1\nENDPROPERTIES')
  })

  test('null-prototype props: __proto__, constructor, toString (K06b)', () => {
    const f = new Font().load_string(
      bdf({ props: ['__proto__ "x"', 'constructor 5'] })
    )
    expect(Object.getPrototypeOf(f.props)).toBeNull()
    expect(f.props['__proto__']).toBe('x')
    expect(f.getprop('__PROTO__')).toBe('x')
    expect(f.getprop('constructor')).toBe(5)
    expect(f.getprop('toString')).toBeNull()
    expect(f.tobdf()).toContain(
      'STARTPROPERTIES 2\n__proto__ "x"\nconstructor 5\nENDPROPERTIES'
    )
    expect(Object.getPrototypeOf(f.clone().props)).toBeNull()
    expect(Font.create().getprop('valueOf')).toBeNull()
    // a plain object assigned by the user still works
    f.props = { hasownproperty: 1 } as unknown as typeof f.props
    expect(f.getprop('toString')).toBeNull()
    expect(f.getprop('hasOwnProperty')).toBe(1)
  })

  test('COMMENT-like property lines are comments, with a warning (K06c/d)', () => {
    const f = new Font().load_string(
      bdf({ props: ['comment "abc"', 'Comment 5', 'COMMENT x', 'cOmMeNt'] })
    )
    expect(f.props.comment).toEqual(['abc', '5', 'x', ''])
    expect(warnings).toEqual([
      "line 6: property 'comment' treated as a COMMENT line",
      "line 7: property 'Comment' treated as a COMMENT line",
      "line 9: property 'cOmMeNt' treated as a COMMENT line",
      "The property count next to 'STARTPROPERTIES' keyword is 4, which does not match the actual property count 0",
    ])
    expect(f.tobdf()).toContain(
      'STARTPROPERTIES 0\nCOMMENT "abc"\nCOMMENT "5"\nCOMMENT "x"\nCOMMENT ""\nENDPROPERTIES'
    )
    // non-ASCII look-alikes are ordinary properties
    const g = new Font().load_string(bdf({ props: ['commenſ 1'] }))
    expect(g.props['commenſ']).toBe(1)
  })

  test('props.comment that is not a list (like Python: iterated, falsy = none)', () => {
    const f = Font.create()
    f.setprop('comment', 'ab')
    expect(f.tobdf()).toContain('COMMENT "a"\nCOMMENT "b"\n')
    f.setprop('comment', '')
    expect(f.tobdf()).not.toContain('COMMENT')
    f.setprop('comment', 5)
    expect(() => f.tobdf()).toThrow(TypeError)
  })
})

describe('§11.4 parsing and drawing', () => {
  test('ASCII whitespace only; a leading BOM is skipped (K07)', () => {
    const f = new Font().load_string(
      '﻿' +
        bdf({
          header: ['COMMENT hello\x85', 'COMMENT y﻿', '﻿COMMENT z'],
          props: ['FOO "a b"', 'BAR　x 1'],
          glyphs: [glyph(65, { name: 'g x', extra: ['SWIDTH 500 0\x0b'] })],
        })
    )
    expect(f.headers.comment).toEqual(['hello\x85', 'y﻿'])
    expect(warnings).toContain(
      "line 7: unknown header keyword '\ufeffCOMMENT' ignored"
    )
    expect(f.props.foo).toBe('a b')
    expect(f.props['bar　x']).toBe(1)
    expect(f.glyphs.get(65)?.[0]).toBe('g x')
    expect(f.glyphs.get(65)?.[6]).toBe(500)
    // U+001F is not a separator: a malformed number
    expect(() =>
      new Font().load_string(
        bdf({ glyphs: [glyph(65, { extra: ['SWIDTH 500 0\x1f'] })] })
      )
    ).toThrow(BDFParseError)
    // tabs, \v, \f and CR are
    const g = new Font().load_string(
      bdf({ glyphs: [glyph(65, { extra: ['SWIDTH\t500\v0\f'] })] }).replace(
        /\n/g,
        '\r\n'
      )
    )
    expect(g.glyphs.get(65)?.[6]).toBe(500)
  })

  test('U+FEFF is kept everywhere except a leading BOM (load_bytes, PCF strings)', () => {
    const text = bdf({ props: ['\ufeffFOO 1', 'FOO 2'] })
    const f = new Font().load_bytes(
      new TextEncoder().encode('\ufeff\ufeff' + text)
    )
    // one BOM is skipped, the second one is an unknown keyword
    expect(warnings[0]).toBe(
      "line 1: unknown header keyword '\ufeffSTARTFONT' ignored"
    )
    const g = new Font().load_bytes(new TextEncoder().encode('\ufeff' + text))
    expect(g.props['\ufefffoo']).toBe(1)
    expect(g.props.foo).toBe(2)
    expect(f.headers.bdfversion).toBeUndefined()
    // PCF property names / values keep their U+FEFF
    const r = readPcf(writePcf(g))
    expect(r.props['\ufefffoo']).toBe(1)
    expect(r.props.foo).toBe(2)
  })

  test('COMMENT lines inside BITMAP are ignored', () => {
    const f = new Font().load_string(
      bdf({
        glyphs: [
          glyph(65, { bbx: '1 2 0 0', rows: ['80', 'COMMENT x', '00'] }),
        ],
      })
    )
    expect(f.glyphs.get(65)?.[16]).toEqual(['80', '00'])
    expect(f.glyphbycp(65)?.draw(1).bindata).toEqual(['1', '0'])
  })

  test('negative BBX / FONTBOUNDINGBOX sizes: BDFParseError (K03)', () => {
    expect(() =>
      new Font().load_string(bdf({ glyphs: [glyph(65, { bbx: '-1 1 0 0' })] }))
    ).toThrow(new BDFParseError("glyph 'g' has a negative BBX size -1 1", 8))
    expect(() => new Font().load_string(bdf({ fbb: '8 -1 0 0' }))).toThrow(
      new BDFParseError('negative FONTBOUNDINGBOX size 8 -1', 4)
    )
    // negative offsets are fine
    expect(
      new Font().load_string(bdf({ fbb: '8 8 -3 -2' })).headers.fbbxoff
    ).toBe(-3)
  })

  test('a non-hex hex row: Error naming the glyph and the row', () => {
    const f = new Font().load_string(
      bdf({ glyphs: [glyph(65, { bbx: '1 2 0 0', rows: ['80', 'G0'] })] })
    )
    const msg =
      'Glyph "g" (codepoint 65): bitmap row 1 "G0" contains a non-hex character'
    for (const mode of [0, 1, 2] as const) {
      expect(() => f.glyphbycp(65)?.draw(mode)).toThrow(new Error(msg))
    }
    expect(() => f.draw('A')).toThrow(msg)
    expect(() => writeTtf(f)).toThrow(msg)
    // the PCF writer keeps bdftopcf's lenient behaviour
    const back = readPcf(writePcf(f)).glyphbycp(65)?.draw(1).bindata ?? []
    expect(back.slice(-2)).toEqual(['1', '0'])
    // rows beyond the BBX height: draw() checks every row, the TTF writer
    // only the rows it uses
    const g = new Font().load_string(
      bdf({ glyphs: [glyph(65, { rows: ['80', 'xx'] })] })
    )
    expect(() => g.glyphbycp(65)?.draw()).toThrow(/bitmap row 1 "xx"/)
    expect(() => writeTtf(g)).not.toThrow()
  })

  test('Bitmap.crop with a negative size: RangeError (K03)', () => {
    expect(() => new Bitmap(['101']).crop(-1, 2, 0, 0)).toThrow(
      new RangeError('Bitmap.crop: negative width or height (-1, 2)')
    )
    expect(() => new Bitmap(['101']).crop(1, -2)).toThrow(RangeError)
    expect(new Bitmap(['101']).crop(0, 0).bindata).toEqual([])
  })

  test('Font.transform visits font.glyphs order, then unencoded', () => {
    const f = new Font().load_string(
      bdf({
        glyphs: [
          glyph(66, { name: 'b' }),
          glyph(-1, { name: 'u' }),
          glyph(65, { name: 'a' }),
        ],
      })
    )
    const seen: string[] = []
    let n = 0
    expect(() =>
      f.transform((b) => {
        seen.push(b.toString())
        if (++n === 2) {
          throw new Error('stop')
        }
        return b.clone().invert()
      })
    ).toThrow('stop')
    // the first glyph of `glyphs` (66) was transformed, then it stopped at 65
    expect(f.glyphs.get(66)?.[16]).not.toEqual(['80'])
    expect(f.glyphs.get(65)?.[16]).toEqual(['80'])
    expect(f.unencoded[0].meta[16]).toEqual(['80'])
  })

  test('overlay keeps its size, aligns at the top-left, clips (K04)', () => {
    expect(new Bitmap(['1001110']).overlay(new Bitmap([])).bindata).toEqual([
      '1001110',
    ])
    expect(warnings).toEqual([
      'the bitmaps to overlay have different height',
      'the bitmaps to overlay have different width',
    ])
    expect(
      new Bitmap(['000', '000']).overlay(new Bitmap(['1111', '1', '1'])).bindata
    ).toEqual(['111', '100'])
  })

  test('vertical concatall skips empty bitmaps with the offset before them (K16)', () => {
    const b = (rows: string[]) => new Bitmap(rows)
    expect(
      Bitmap.concatall([b([]), b([]), b(['0110', '0010'])], {
        direction: -1,
        align: 0,
        offsetlist: [-2, 3],
      }).bindata
    ).toEqual(['0110', '0010'])
    expect(
      Bitmap.concatall([b(['1']), b(['', '']), b(['01'])], {
        direction: 0,
        offsetlist: [5, 1],
      }).bindata
    ).toEqual(
      Bitmap.concatall([b(['1']), b(['01'])], { direction: 0, offsetlist: [1] })
        .bindata
    )
    expect(
      Bitmap.concatall([b([]), b(['', ''])], { direction: 0 }).bindata
    ).toEqual([])
    // concat with an empty bitmap is the identity
    expect(
      b(['10']).concat(b([]), { direction: 0, offset: 3 }).bindata
    ).toEqual(['10'])
    // rows always have equal lengths
    const r = Bitmap.concatall([b(['1']), b(['111'])], {
      direction: -1,
      align: 0,
    })
    expect(new Set(r.bindata.map((x) => x.length)).size).toBe(1)
  })

  test('removeglyph of a removed (detached) Glyph is a no-op (K09)', () => {
    const f = new Font().load_string(bdf({ glyphs: [glyph(5)] }))
    const g = f.glyphbycp(5)!
    f.removeglyph(g)
    expect(f.glyphs.has(5)).toBe(false)
    f.addglyph({ codepoint: 5, glyphname: 'new' }, false)
    f.removeglyph(g)
    expect(f.glyphs.get(5)?.[0]).toBe('new')
    // a Glyph that was never attached removes by codepoint
    f.removeglyph(f.glyphbycp(5)!.clone())
    expect(f.glyphs.has(5)).toBe(false)
  })
})

describe('§11.5 outputs', () => {
  test('TTF cmap: no surrogates (the glyphs stay, unmapped)', () => {
    const f = new Font().load_string(
      bdf({
        glyphs: [
          glyph(0xd800, { name: 'hi' }),
          glyph(0xdfff, { name: 'lo' }),
          glyph(65),
        ],
      })
    )
    const t = writeTtf(f, { metadata: false })
    const r = readTtf(t, { pixelsize: 8 })
    expect([...r.glyphs.keys()]).toEqual([65])
    expect(r.unencoded.map((u) => u.meta[0])).toEqual(['hi', 'lo'])
    // with a custom cp2char returning a lone surrogate
    const g = new Font().load_string(bdf({ glyphs: [glyph(65)] }))
    g.encoding({ cp2char: () => '\ud800' })
    const rg = readTtf(writeTtf(g, { metadata: false }), { pixelsize: 8 })
    expect(rg.glyphs.size).toBe(0)
  })

  test('tosvgfont uses cp2char (Unicode values), unmapped glyphs get no unicode', () => {
    const f = new Font().load_string(
      bdf({
        props: ['CHARSET_REGISTRY "GB2312.1980"', 'CHARSET_ENCODING "0"'],
        glyphs: [
          glyph(0x3021, { name: 'a' }),
          glyph(0x3022, { name: 'b' }),
          glyph(0x7f7f, { name: 'x' }),
          glyph(0x41, { name: 'A' }),
        ],
      })
    )
    const svg = f.tosvgfont()
    expect(svg).toContain('unicode-range="U+0041, U+554A, U+963F"')
    expect(svg).toContain('glyph-name="a"\n  unicode="&#x554a;"')
    expect(svg).toContain('glyph-name="x"\n  horiz-adv-x=')
    const chars = f.tosvgfont({ unicodeAttr: { format: 'char' } })
    expect(chars).toContain('unicode="啊"')
    // surrogates and control characters
    const u = new Font().load_string(
      bdf({ glyphs: [glyph(0xd800, { name: 's' }), glyph(1, { name: 'c' })] })
    )
    const s1 = u.tosvgfont({
      unicodeAttr: { format: 'char', controlCharNoSkip: true },
    })
    expect(s1).toContain('unicode-range="U+0001"')
    expect(s1).toContain('glyph-name="s"\n  horiz-adv-x=')
    expect(s1).toContain('glyph-name="c"\n  unicode="\x01"')
    expect(u.tosvgfont()).toContain('glyph-name="c"\n  horiz-adv-x=')
  })

  test('tosvgfont: integer properties beyond 2**53 are exact', () => {
    const f = new Font().load_string(
      bdf({
        props: [
          'UNDERLINE_POSITION 18446744073709551616',
          'FONT_ASCENT 9007199254740993',
        ],
      })
    )
    const svg = f.tosvgfont()
    expect(svg).toContain('underline-position="18446744073709551616"')
    expect(svg).toContain('ascent="9007199254740993"')
    expect(svg).toContain('x-height="4503599627370496"') // float(ascent) * 0.5
  })

  test('readTtf guard message', () => {
    const f = Font.create({ pixelsize: 8 })
    f.newglyph(65, Bitmap.fromstring('#'))
    expect(() =>
      readTtf(writeTtf(f, { metadata: false }), { pixelsize: 1e6 })
    ).toThrow(
      /^Malformed TrueType font: glyph 1 bounding box too large \(\d+x\d+ pixels\)$/
    )
  })
})

describe('Python-compatible number formatting (fmtnum)', () => {
  test.each([
    [0, '0'],
    [-0, '0'],
    [7, '7'],
    [2 ** 53 + 2, '9007199254740994'],
    [2 ** 64, '18446744073709551616'],
    [1e21, '1000000000000000000000'],
    [-1e22, '-10000000000000000000000'],
    [1.5, '1.5'],
    [0.1, '0.1'],
    [0.0001, '0.0001'],
    [0.00001, '1e-05'],
    [-1.5e-7, '-1.5e-07'],
    [123456.789, '123456.789'],
    [10n ** 30n, '1000000000000000000000000000000'],
  ])('fmtnum(%s) = %s', (n, s) => {
    expect(fmtnum(n)).toBe(s)
  })
})

describe('public types without DOM: URL-like sources', () => {
  test('$Font and load_url accept any object with a string href', async () => {
    const urls: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (u: string) => {
      urls.push(u)
      return new Response(bdf({ glyphs: [glyph(65)] }))
    }) as typeof fetch
    try {
      const f = await $Font({ href: 'https://example.com/a.bdf' })
      expect(f.glyphs.size).toBe(1)
      await new Font().load_url({ href: 'https://example.com/b.bdf' })
      await new Font().load_url(new URL('https://example.com/c.bdf'))
      expect(urls).toEqual([
        'https://example.com/a.bdf',
        'https://example.com/b.bdf',
        'https://example.com/c.bdf',
      ])
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
