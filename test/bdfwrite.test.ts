import { readFileSync } from 'fs'
import {
  Font,
  readPcf,
  readTtf,
  setWarningHandler,
  writePcf,
  writeTtf,
} from '../src/index'

beforeAll(() => {
  setWarningHandler(null)
})
afterAll(() => {
  setWarningHandler(undefined)
})

describe('tobdf: byte-identical round trip of FontForge-written fonts', () => {
  test.each([
    'HanWangYanKai-26.bdf',
    'unifont-13.0.04.bdf',
    'unifont-13.0.04-for-test.bdf',
    'unifont-13.0.04-reduced.bdf',
  ])('%s', (name) => {
    const text = readFileSync(`./test/fonts/${name}`, 'utf8')
    const font = new Font().load_string(text)
    const out = font.tobdf()
    expect(out === text).toBe(true)
    // and again from the output
    expect(new Font().load_string(out).tobdf() === text).toBe(true)
  })

  test('HanWangYanKai-26 keeps its unencoded glyphs', () => {
    const font = new Font().load_string(
      readFileSync('./test/fonts/HanWangYanKai-26.bdf', 'utf8')
    )
    expect(font.glyphs.size).toBe(13970)
    expect(font.unencoded).toHaveLength(190)
    expect(font.unencoded[0].meta[0]).toBe('.notdef')
  })
})

describe('tobdf format', () => {
  test('headers, metrics, comments, properties, unencoded altcode', () => {
    const src = `STARTFONT 2.2
FONT  F
SIZE 8 75 75
FONTBOUNDINGBOX 8 8 0 -1
METRICSSET 1
CONTENTVERSION 3
SWIDTH 500 0
DWIDTH 8 0
SWIDTH1 0 1000
DWIDTH1 0 8
VVECTOR 4,7
COMMENT one
STARTPROPERTIES 5
COMMENT "pc"
MinSpace 4
RAW abc
QUOTED "say ""hi"""
NEG -1
KEYONLY
ENDPROPERTIES
CHARS 2
STARTCHAR a
ENCODING 97
SWIDTH 500 0
DWIDTH 8 0
SWIDTH1 0 1000
DWIDTH1 0 8
VVECTOR 4 7
BBX 1 1 0 0
BITMAP
80
ENDCHAR
STARTCHAR u
ENCODING -1 66
BBX 0 0 0 0
BITMAP
ENDCHAR
ENDFONT
`
    expect(new Font().load_string(src).tobdf()).toBe(`STARTFONT 2.2
FONT F
SIZE 8 75 75
FONTBOUNDINGBOX 8 8 0 -1
METRICSSET 1
CONTENTVERSION 3
SWIDTH 500 0
DWIDTH 8 0
SWIDTH1 0 1000
DWIDTH1 0 8
VVECTOR 4 7
COMMENT "one"
STARTPROPERTIES 5
COMMENT "pc"
MinSpace 4
RAW "abc"
QUOTED "say ""hi"""
NEG -1
KEYONLY
ENDPROPERTIES
CHARS 2
STARTCHAR a
ENCODING 97
SWIDTH 500 0
DWIDTH 8 0
SWIDTH1 0 1000
DWIDTH1 0 8
VVECTOR 4 7
BBX 1 1 0 0
BITMAP
80
ENDCHAR
STARTCHAR u
ENCODING -1 66
BBX 0 0 0 0
BITMAP
ENDCHAR
ENDFONT
`)
  })

  test('integral version, no properties, property comments only', () => {
    const f = Font.create()
    f.headers.bdfversion = 2
    for (const k of Object.keys(f.props)) {
      f.delprop(k)
    }
    expect(f.tobdf()).toBe(
      'STARTFONT 2.0\nFONT Untitled\nSIZE 16 75 75\nFONTBOUNDINGBOX 16 16 0 -2\nCHARS 0\nENDFONT\n'
    )
    f.props.comment = ['only']
    expect(f.tobdf()).toContain(
      'STARTPROPERTIES 0\nCOMMENT "only"\nENDPROPERTIES\n'
    )
    f.setprop('X', 1.5)
    expect(f.tobdf()).toContain('X 1.5\n')
    delete (f.headers as Partial<typeof f.headers>).bdfversion
    delete (f.headers as Partial<typeof f.headers>).fontname
    expect(f.tobdf().startsWith('STARTFONT 2.1\nFONT \n')).toBe(true)
  })

  test('missing headers', () => {
    expect(() => new Font().tobdf()).toThrow(
      'Cannot write BDF: missing header(s) pointsize, xres, yres, fbbx, fbby, fbbxoff, fbbyoff (font not loaded?)'
    )
  })
})

describe('topcf / tottf wrappers', () => {
  const font = new Font().load_string(
    readFileSync('./test/fonts/spec_example_fixed.bdf', 'utf8')
  )
  test('topcf', () => {
    expect(font.topcf()).toEqual(writePcf(font))
    expect(font.topcf({ byteorder: 'lsb' })).toEqual(
      writePcf(font, { byteorder: 'lsb' })
    )
    expect(readPcf(font.topcf()).glyphs.size).toBe(2)
  })
  test('tottf', () => {
    expect(font.tottf()).toEqual(writeTtf(font))
    const opts = { shape: 'circle', dotsize: 0.8, ppu: 10 } as const
    expect(font.tottf(opts)).toEqual(writeTtf(font, opts))
    expect(readTtf(font.tottf()).tobdf()).toBe(font.tobdf())
  })
})
