import { readFileSync } from 'fs'
import {
  $Bitmap,
  Bitmap,
  Font,
  Glyph,
  GlyphMeta,
  defaultglyphname,
  setWarningHandler,
} from '../src/index'

const read = (name: string): Font =>
  new Font().load_string(readFileSync(`./test/fonts/${name}`, 'utf8'))

let warnings: string[] = []
beforeEach(() => {
  warnings = []
  setWarningHandler((m) => warnings.push(m))
})
afterAll(() => {
  setWarningHandler(undefined)
})

describe('Bitmap editing', () => {
  const bm = () => Bitmap.fromstring('.#..\n##..\n....\n')

  test('fromstring / toString / blank / equals', () => {
    const b = Bitmap.fromstring('\r\n  \n#.&\r\n012\n\n  ')
    expect(b.bindata).toEqual(['102', '012'])
    expect(Bitmap.fromstring(b.toString()).equals(b)).toBe(true)
    expect(Bitmap.fromstring('').bindata).toEqual([])
    expect(() => Bitmap.fromstring('#x')).toThrow(
      'Invalid character "x" in bitmap row 0'
    )
    expect(() => Bitmap.fromstring(' #')).toThrow(/Invalid character/)
    expect(() => Bitmap.fromstring('##\n#')).toThrow(
      'Bitmap rows have different lengths'
    )
    expect(Bitmap.blank(3, 2).bindata).toEqual(['000', '000'])
    expect(Bitmap.blank(0, 0).bindata).toEqual([])
    expect(() => Bitmap.blank(-1, 2)).toThrow(RangeError)
    expect(b.equals(new Bitmap(['102']))).toBe(false)
    expect(b.equals(new Bitmap(['102', '011']))).toBe(false)
    expect($Bitmap(['1']).equals(new Bitmap(['1']))).toBe(true)
  })

  test('width of an empty bitmap is 0', () => {
    expect(new Bitmap([]).width()).toBe(0)
    expect(new Bitmap([]).height()).toBe(0)
  })

  test('getpixel / setpixel', () => {
    const b = bm()
    expect(b.getpixel(1, 0)).toBe(1)
    expect(b.getpixel(0, 0)).toBe(0)
    const orig = b.bindata
    expect(
      b.setpixel(3, 2).setpixel(1, 0, 0).setpixel(0, 2, 2).bindata
    ).toEqual(['0000', '1100', '2001'])
    expect(orig).toEqual(['0100', '1100', '0000']) // copy-on-write
    for (const [x, y] of [
      [-1, 0],
      [4, 0],
      [0, 3],
      [0, -1],
      [0.5, 0],
    ]) {
      expect(() => b.getpixel(x, y)).toThrow(RangeError)
      expect(() => b.setpixel(x, y)).toThrow(RangeError)
    }
    expect(() => b.setpixel(0, 0, 3 as 1)).toThrow(
      'Pixel value must be 0, 1 or 2, not 3'
    )
  })

  test('fliph / flipv / invert', () => {
    expect(bm().fliph().bindata).toEqual(['0010', '0011', '0000'])
    expect(bm().flipv().bindata).toEqual(['0000', '1100', '0100'])
    expect(new Bitmap(['0120']).invert().bindata).toEqual(['1001'])
  })

  test('rotate', () => {
    const b = new Bitmap(['110', '001'])
    expect(b.clone().rotate().bindata).toEqual(['01', '01', '10'])
    expect(b.clone().rotate(180).bindata).toEqual(['100', '011'])
    expect(b.clone().rotate(270).bindata).toEqual(['01', '10', '10'])
    expect(b.clone().rotate(-90).bindata).toEqual(['01', '10', '10'])
    expect(b.clone().rotate(360).bindata).toEqual(b.bindata)
    expect(b.clone().rotate(-450).equals(b.clone().rotate(270))).toBe(true)
    expect(() => b.rotate(45)).toThrow('multiple of 90')
    expect(new Bitmap([]).rotate().bindata).toEqual([])
  })

  test('shift / bbox / trim', () => {
    expect(bm().shift(1, 1).bindata).toEqual(['0110', '0000', '0000'])
    expect(bm().shift(-1, -1).bindata).toEqual(['0000', '1000', '1000'])
    expect(bm().shift().bindata).toEqual(bm().bindata)
    const b = new Bitmap(['00000', '00100', '01120', '00000'])
    expect(b.bbox()).toEqual([3, 2, 1, 1])
    expect(b.clone().crop(...b.bbox()).bindata).toEqual(['010', '112'])
    expect(b.clone().trim().bindata).toEqual(['010', '112'])
    expect(Bitmap.blank(3, 3).bbox()).toEqual([0, 0, 0, 0])
    expect(Bitmap.blank(3, 3).trim().bindata).toEqual([])
    expect(new Bitmap([]).bbox()).toEqual([0, 0, 0, 0])
  })

  test('bold', () => {
    expect(new Bitmap(['101', '010']).bold().bindata).toEqual(['1111', '0110'])
    expect(new Bitmap(['2001']).bold(2).bindata).toEqual(['222111'])
    expect(new Bitmap(['12']).bold().bindata).toEqual(['112'])
    expect(new Bitmap(['1']).bold(0).bindata).toEqual(['1'])
    expect(() => new Bitmap(['1']).bold(-1)).toThrow(RangeError)
  })

  test('italic', () => {
    const b = new Bitmap(['1', '1', '1', '1'])
    expect(b.clone().italic().bindata).toEqual(['01', '01', '10', '10'])
    expect(b.clone().italic(1).bindata).toEqual([
      '0001',
      '0010',
      '0100',
      '1000',
    ])
    expect(b.clone().italic(2, 2).bindata).toEqual(['01', '01', '10', '10'])
    expect(b.clone().italic(1, 3).bindata).toEqual([
      '0001',
      '0010',
      '0100',
      '1000',
    ])
    expect(new Bitmap([]).italic().bindata).toEqual([])
    expect(() => b.italic(0)).toThrow(RangeError)
    expect(() => b.italic(-2)).toThrow('step must be a positive integer')
  })

  test('paste', () => {
    const base = Bitmap.blank(4, 3)
    const p = new Bitmap(['12', '01'])
    expect(base.clone().paste(p, 1, 1).bindata).toEqual([
      '0000',
      '0120',
      '0010',
    ])
    expect(base.clone().paste(p).bindata).toEqual(['1200', '0100', '0000'])
    expect(base.clone().paste(p, 3, 2).bindata).toEqual([
      '0000',
      '0000',
      '0001',
    ])
    expect(base.clone().paste(p, -1, -1).bindata).toEqual([
      '1000',
      '0000',
      '0000',
    ])
    expect(new Bitmap(['11']).paste(new Bitmap(['02'])).bindata).toEqual(['12'])
  })

  test('overlay / concat edge cases', () => {
    const a = new Bitmap(['10'])
    a.overlay(new Bitmap(['011', '111']))
    expect(a.bindata).toEqual(['11'])
    expect(warnings).toEqual([
      'the bitmaps to overlay have different height',
      'the bitmaps to overlay have different width',
    ])
    expect(Bitmap.concatall([]).bindata).toEqual([])
    expect(
      Bitmap.concatall([new Bitmap(['1']), new Bitmap(['1'])], {
        direction: 0,
        offsetlist: [-1],
      }).bindata
    ).toEqual(['1'])
    expect(new Bitmap(['10', '01']).replace(1, 2).bindata).toEqual(['20', '02'])
  })

  test('todata with wide rows (no precision loss)', () => {
    const row = '1' + '0'.repeat(70) + '1'
    expect(new Bitmap([row]).todata(4)).toEqual(['8' + '0'.repeat(16) + '1'])
    expect(new Bitmap(['']).todata(4)).toEqual([''])
    expect(new Bitmap(['']).todata(5)).toEqual([0])
  })
})

describe('Glyph editing', () => {
  let font: Font
  beforeEach(() => {
    font = read('spec_example_fixed.bdf')
  })

  test('defaultglyphname', () => {
    expect(defaultglyphname(0x41)).toBe('uni0041')
    expect(defaultglyphname(0xffff)).toBe('uniFFFF')
    expect(defaultglyphname(0x1f600)).toBe('u1F600')
    expect(defaultglyphname(0x10ffff)).toBe('u10FFFF')
    expect(defaultglyphname(0xb0a1, false)).toBe('char45217')
  })

  test('setbitmap is the inverse of draw (no trim)', () => {
    for (const name of [
      'spec_example_fixed.bdf',
      'unifont-13.0.04-2atest.bdf',
      'unifont-13.0.04-for-test.bdf',
    ]) {
      const f = read(name)
      for (const g of f.iterglyphs()) {
        const before = [...f.glyphs.get(g.cp())!]
        g.setbitmap(g.draw(1), 1, null, false)
        const after = f.glyphs.get(g.cp())!
        expect(after.slice(0, 16)).toEqual(before.slice(0, 16))
        expect(after[16]).toEqual(
          (before[16] as string[]).map((h) => h.toUpperCase())
        )
      }
    }
  })

  test('setbitmap modes, trim, offsets and hex format', () => {
    const g = font.glyph('j')!
    // mode 0: bottom-left at (fbbxoff, fbbyoff) = (-2, -6)
    g.setbitmap(new Bitmap(['000', '010', '000', '000']))
    expect(g.meta).toMatchObject({
      bbw: 1,
      bbh: 1,
      bbxoff: -1,
      bbyoff: -4,
      hexdata: ['80'],
    })
    expect(font.glyphs.get(106)!.slice(2, 6)).toEqual([1, 1, -1, -4])
    // mode 1: at current (bbxoff, bbyoff)
    g.setbitmap(new Bitmap(['111111111', '000000001']), 1, null, false)
    expect(g.meta).toMatchObject({
      bbw: 9,
      bbh: 2,
      bbxoff: -1,
      bbyoff: -4,
      hexdata: ['FF80', '0080'],
    })
    // mode 2 behaves as mode 1; trim
    g.setbitmap(['0000', '0200'], 2)
    expect(g.meta).toMatchObject({
      bbw: 1,
      bbh: 1,
      bbxoff: 0,
      bbyoff: -4,
      hexdata: ['80'],
    })
    // mode -1 and options object
    g.setbitmap(new Bitmap(['1']), { mode: -1, bb: [0, 0, 5, 6] })
    expect(g.meta).toMatchObject({ bbxoff: 5, bbyoff: 6 })
    g.setbitmap(new Bitmap(['00', '01']), {
      mode: -1,
      bb: [0, 0, 5, 6],
      trim: false,
    })
    expect(g.meta).toMatchObject({
      bbw: 2,
      bbh: 2,
      bbxoff: 5,
      bbyoff: 6,
      hexdata: ['00', '40'],
    })
    g.setbitmap(new Bitmap(['1']), {})
    expect(g.meta).toMatchObject({ bbxoff: -2, bbyoff: -6 })
    // empty bitmap
    g.setbitmap(Bitmap.blank(3, 3))
    expect(g.meta).toMatchObject({
      bbw: 0,
      bbh: 0,
      bbxoff: 0,
      bbyoff: 0,
      hexdata: [],
    })
    g.setbitmap(new Bitmap([]), 1, null, false)
    expect(g.meta).toMatchObject({ bbw: 0, bbh: 0, hexdata: [] })
    // wide glyph (> 53 bits)
    g.setbitmap(new Bitmap(['1'.repeat(70)]), 1)
    expect(g.meta.hexdata).toEqual(['FFFFFFFFFFFFFFFFFC'])
    expect(g.draw(1).bindata).toEqual(['1'.repeat(70)])
    // errors
    expect(() => g.setbitmap(new Bitmap(['1']), -1)).toThrow(
      'must be set when mode=-1'
    )
    expect(() => g.setbitmap(new Bitmap(['1']), 3 as 0)).toThrow(
      'Unknown setbitmap mode 3'
    )
    expect(() => g.setbitmap(new Bitmap(['1', '11']))).toThrow(
      'different lengths'
    )
  })

  test('draw and origin errors', () => {
    const g = font.glyph('j')!
    expect(() => g.draw(5 as 0)).toThrow('Unknown draw mode 5')
    expect(() => g.origin({ mode: 7 as 0 })).toThrow('Unknown origin mode 7')
    expect(g.origin({ mode: 2 })).toEqual([2, 6])
    expect(g.draw(-1, [3, 3, 0, 0]).bindata).toEqual(['001', '011', '011'])
  })

  test('setmeta, shift, transform, clone, changebitmap', () => {
    const g = font.glyph('j')!
    expect(g.setmeta({ dwx0: 9, glyphname: 'jay' })).toBe(g)
    expect(font.glyphs.get(106)!.slice(0, 1)).toEqual(['jay'])
    expect(font.glyphs.get(106)![8]).toBe(9)
    expect(() => g.setmeta({ nope: 1 } as Partial<GlyphMeta>)).toThrow(
      'Unknown glyph meta key "nope"'
    )
    const hex = ['FF']
    g.setmeta({ hexdata: hex, bbw: 8, bbh: 1 })
    hex.push('00')
    expect(font.glyphs.get(106)![16]).toEqual(['FF'])
    g.shift(2, -1)
    expect(font.glyphs.get(106)!.slice(4, 6)).toEqual([0, -7])
    g.shift()
    expect(font.glyphs.get(106)!.slice(4, 6)).toEqual([0, -7])
    g.transform((b) => b.fliph(), 1)
    expect(font.glyphs.get(106)![16]).toEqual(['FF'])
    g.transform((b) => {
      b.bindata = ['1']
    }, 1)
    expect(font.glyphs.get(106)!.slice(2, 6)).toEqual([1, 1, 0, -7])
    g.transform(() => new Bitmap(['11']), 1)
    expect(font.glyphs.get(106)![2]).toBe(2)
    const c = g.clone()
    c.setmeta({ dwx0: 1 })
    c.meta.hexdata.push('00')
    expect(font.glyphs.get(106)![8]).toBe(9)
    expect(font.glyphs.get(106)![16]).toEqual(['C0'])
    expect(c.font).toBe(font)
    g.changebitmap(new Bitmap(['01', '10']))
    expect(font.glyphs.get(106)!.slice(2, 6)).toEqual([2, 2, 0, -7])
    expect(font.glyphs.get(106)![16]).toEqual(['40', '80'])
    expect(g.repr()).toContain('Font(<Helvetica-BoldOblique>)')
  })

  test('changing the codepoint moves the glyph (overwrite, to/from unencoded)', () => {
    const g = font.glyph('j')!
    g.setmeta({ codepoint: 39 })
    expect([...font.glyphs.keys()]).toEqual([39])
    expect(font.glyphs.get(39)![0]).toBe('j')
    g.setmeta({ codepoint: -5 })
    expect(font.glyphs.size).toBe(0)
    expect(font.unencoded).toHaveLength(1)
    expect(g.meta.codepoint).toBe(-1)
    expect(font.unencoded[0].meta[1]).toBe(-1)
    g.shift(1, 0) // still attached while unencoded
    expect(font.unencoded[0].meta[4]).toBe(-1)
    g.setmeta({ codepoint: -1, glyphname: 'x' })
    expect(font.unencoded[0].meta[0]).toBe('x')
    g.setmeta({ codepoint: 200 })
    expect(font.unencoded).toHaveLength(0)
    expect(font.glyphs.get(200)![0]).toBe('x')
  })

  test('stale views of the same glyph do not revert each other', () => {
    const g1 = font.glyphbycp(106)!
    const g2 = font.glyphbycp(106)!
    const x0 = g1.meta.bbxoff
    g1.setmeta({ codepoint: 90 })
    // g2 only changes what it changes (bbxoff), it does not move the glyph back
    g2.shift(2)
    expect([...font.glyphs.keys()].sort((a, b) => a - b)).toEqual([39, 90])
    expect(font.glyphs.get(90)![4]).toBe(x0 + 2)
    expect(g2.meta.codepoint).toBe(90)
    expect(g2.meta.bbxoff).toBe(x0 + 2)
    g1.setmeta({ glyphname: 'Z' }) // and g1 does not revert g2's shift
    expect(font.glyphs.get(90)![0]).toBe('Z')
    expect(font.glyphs.get(90)![4]).toBe(x0 + 2)
    // a direct change of `meta` is written with the next editing method
    g1.meta.dwx0 = 9
    g1.shift(1)
    expect(font.glyphs.get(90)![8]).toBe(9)
    expect(font.glyphs.get(90)![4]).toBe(x0 + 3)
    // the meta object is updated in place, hexdata is not shared with the font
    const m = g2.meta
    g2.shift(0, 1)
    expect(g2.meta).toBe(m)
    expect(g2.meta.hexdata).not.toBe(font.glyphs.get(90)![16])
    expect(g2.meta.hexdata).toEqual(font.glyphs.get(90)![16])
    expect(() => g2.setmeta({ codepoint: 1.5 })).toThrow(TypeError)
    expect(font.glyphs.get(90)![1]).toBe(90)
  })

  test('a glyph obtained before charsetconvert() keeps its new codepoint', () => {
    const f = read('unifont-13.0.04-enctest-gb2312.bdf')
    const g = f.glyphbycp(0xc8cb)! // 人 in GB2312 (EUC)
    f.charsetconvert('ISO10646-1')
    const cps = [...f.glyphs.keys()].sort((a, b) => a - b)
    expect(cps).toContain(0x4eba)
    g.shift(1, 0)
    expect([...f.glyphs.keys()].sort((a, b) => a - b)).toEqual(cps)
    expect(f.glyphs.get(0x4eba)![4]).toBe(g.meta.bbxoff)
    expect(g.meta.codepoint).toBe(0x4eba)
    expect(g.chr()).toBe('人')
  })

  test('detached glyphs do not write back; removed glyphs become detached', () => {
    const d = new Glyph(font.glyph('j')!.meta, font)
    d.setmeta({ dwx0: 99 })
    expect(font.glyphs.get(106)![8]).toBe(8)
    const g = font.glyph('j')!
    font.removeglyph(106)
    g.setmeta({ dwx0: 1 })
    expect(font.glyphs.has(106)).toBe(false)
    expect(g._store).toBeNull()
    // replaced in the font
    const q = font.glyph("'")!
    font.addglyph({ ...q.meta, glyphname: 'new' })
    q.setmeta({ dwx0: 50 })
    expect(font.glyphs.get(39)![0]).toBe('new')
    expect(font.glyphs.get(39)![8]).toBe(5)
    // unencoded entry removed behind its back
    const u = font.newglyph(-1)
    font.unencoded.length = 0
    u.setmeta({ dwx0: 3 })
    expect(u._store).toBeNull()
  })
})

describe('Font editing', () => {
  test('Font.create', () => {
    const f = Font.create()
    expect(f.headers).toEqual({
      bdfversion: 2.1,
      fontname: 'Untitled',
      pointsize: 16,
      xres: 75,
      yres: 75,
      fbbx: 16,
      fbby: 16,
      fbbxoff: 0,
      fbbyoff: -2,
      metricsset: 0,
    })
    expect(f.props).toEqual({
      family_name: 'Untitled',
      pixel_size: 16,
      font_ascent: 14,
      font_descent: 2,
      charset_registry: 'ISO10646',
      charset_encoding: '1',
    })
    expect(f.tobdf()).toBe(`STARTFONT 2.1
FONT Untitled
SIZE 16 75 75
FONTBOUNDINGBOX 16 16 0 -2
STARTPROPERTIES 6
FAMILY_NAME "Untitled"
PIXEL_SIZE 16
FONT_ASCENT 14
FONT_DESCENT 2
CHARSET_REGISTRY "ISO10646"
CHARSET_ENCODING "1"
ENDPROPERTIES
CHARS 0
ENDFONT
`)
    const g = Font.create({
      pixelsize: 10,
      ascent: 9,
      descent: 3,
      fontname: 'FN',
      familyname: 'Fam',
      xres: 96,
      yres: 72,
    })
    expect(g.headers).toMatchObject({
      fontname: 'FN',
      pointsize: 10,
      xres: 96,
      yres: 72,
      fbbx: 10,
      fbby: 12,
      fbbyoff: -3,
    })
    expect(Font.create({ pixelsize: 7 }).props.font_descent).toBe(0)
    expect(g.charset).toBe('iso10646')
  })

  test('setprop / getprop / delprop', () => {
    const f = Font.create()
    f.setprop('MyProp', 'v').setprop('MYPROP', 3).setprop('nullp', null)
    expect(f.getprop('myprop')).toBe(3)
    expect(f._propnames.get('myprop')).toBe('MyProp')
    expect(f.tobdf()).toContain('MyProp 3\nnullp\n')
    f.delprop('MYPROP').delprop('absent')
    expect(f.getprop('myprop')).toBeNull()
    expect(f._propnames.has('myprop')).toBe(false)
    f.setprop('COMMENT', ['c'] as never)
    expect(f._propnames.has('comment')).toBe(false)
  })

  test('swidth', () => {
    const f = Font.create()
    expect(f.swidth(8)).toBe(480)
    f.headers.xres = 0
    expect(f.swidth(8)).toBe(500)
    f.headers.fbbx = 0
    expect(f.swidth(3)).toBe(3000)
  })

  test('newglyph', () => {
    const f = Font.create({ pixelsize: 8 })
    const e = f.newglyph(0x20)
    expect(f.glyphs.get(0x20)).toEqual(
      [
        'uni0020',
        32,
        0,
        0,
        0,
        0,
        (1000 * 8 * 72) / (8 * 75),
        0,
        8,
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        [],
      ].map((v) => (typeof v === 'number' ? Math.floor(v + 0.5) : v))
    )
    expect(e.cp()).toBe(32)
    const a = f.newglyph(0x41, Bitmap.fromstring('.#.\n#.#\n###'), { mode: 1 })
    expect(f.glyphs.get(0x41)).toEqual([
      'uni0041',
      65,
      3,
      3,
      0,
      0,
      360,
      0,
      3,
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      ['40', 'A0', 'E0'],
    ])
    a.setmeta({ dwx0: 4 })
    expect(f.glyphs.get(0x41)![8]).toBe(4)
    f.newglyph(0x42, { bitmap: new Bitmap(['1']), name: 'B', dwidth: 5 })
    expect(f.glyphs.get(0x42)!.slice(0, 10)).toEqual([
      'B',
      66,
      1,
      1,
      0,
      -1,
      600,
      0,
      5,
      0,
    ])
    f.newglyph(0x41, null, { name: 'A2' })
    expect(f.glyphs.get(0x41)![0]).toBe('A2')
    expect([...f.glyphs.keys()]).toEqual([32, 65, 66])
    const u = f.newglyph(-3)
    expect(u.meta.glyphname).toBe('char-3')
    expect(f.unencoded[0].meta[1]).toBe(-1)
    f.setprop('CHARSET_REGISTRY', 'Big5')
    expect(f.newglyph(0xa440).meta.glyphname).toBe('char42048')
  })

  test('addglyph', () => {
    const f = Font.create()
    const g = new Glyph(
      {
        glyphname: 'x',
        codepoint: 120,
        bbw: 1,
        bbh: 1,
        bbxoff: 0,
        bbyoff: 0,
        swx0: null,
        swy0: null,
        dwx0: 2,
        dwy0: 0,
        swx1: null,
        swy1: null,
        dwx1: null,
        dwy1: null,
        vvectorx: null,
        vvectory: null,
        hexdata: ['80'],
      },
      read('spec_example_fixed.bdf')
    )
    f.addglyph(g)
    expect(g.font).toBe(f)
    g.shift(1)
    expect(f.glyphs.get(120)![4]).toBe(1)
    f.addglyph({ codepoint: 120, glyphname: 'y' }, false)
    expect(f.glyphs.get(120)![0]).toBe('x')
    expect(warnings).toEqual([
      'Glyph with codepoint 120 already exists, not replaced',
    ])
    f.addglyph({ codepoint: 120, glyphname: 'y' }, { replace: true })
    expect(f.glyphs.get(120)).toEqual([
      'y',
      120,
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
    ])
    f.addglyph({ codepoint: 121 }, {})
    expect(f.glyphs.get(121)![0]).toBe('uni0079')
    f.addglyph({ codepoint: -1 })
    expect(f.unencoded[0].meta[0]).toBe('char-1')
    expect(() => f.addglyph({ glyphname: 'nocp' })).toThrow(
      'The glyph has no codepoint'
    )
    expect(() => f.addglyph({ codepoint: 1, foo: 1 } as never)).toThrow(
      'Unknown glyph meta key "foo"'
    )
  })

  test('removeglyph', () => {
    const f = read('spec_example_fixed.bdf')
    f.removeglyph(1234)
    expect(f.glyphs.size).toBe(2)
    const j = f.glyph('j')!
    f.removeglyph(j)
    expect(f.glyphs.has(106)).toBe(false)
    expect(j._store).toBeNull()
    const q = new Glyph(f.glyph("'")!.meta, f) // detached, by codepoint
    f.removeglyph(q)
    expect(f.glyphs.size).toBe(0)
    const u = f.newglyph(-1)
    f.newglyph(-1)
    f.removeglyph(u)
    expect(f.unencoded).toHaveLength(1)
    // glyph attached to another font: removed by codepoint
    const other = read('spec_example_fixed.bdf')
    const f2 = read('spec_example_fixed.bdf')
    f2.removeglyph(other.glyph('j')!)
    expect(f2.glyphs.has(106)).toBe(false)
    // unencoded glyph of another font: nothing removed
    f2.removeglyph(other.newglyph(-1))
    expect(f2.glyphs.size).toBe(1)
  })

  test('updatebbox', () => {
    const f = Font.create({ pixelsize: 8 })
    f.updatebbox()
    expect([
      f.headers.fbbx,
      f.headers.fbby,
      f.headers.fbbxoff,
      f.headers.fbbyoff,
    ]).toEqual([8, 8, 0, -1])
    f.newglyph(65, new Bitmap(['1']), { mode: 1 })
    f.glyph('A')!.setbitmap(new Bitmap(['11', '11']), -1, [0, 0, -3, 5])
    f.newglyph(-1).setbitmap(new Bitmap(['1']), -1, [0, 0, 4, -2])
    f.newglyph(66) // empty
    f.updatebbox()
    expect([
      f.headers.fbbx,
      f.headers.fbby,
      f.headers.fbbxoff,
      f.headers.fbbyoff,
    ]).toEqual([8, 9, -3, -2])
  })

  test('clone, subset, merge', () => {
    const f = read('unifont-13.0.04-for-test.bdf').encoding({ charset: 'utf8' })
    f.newglyph(-1, new Bitmap(['1']))
    const c = f.clone()
    expect(c.tobdf()).toBe(f.tobdf())
    expect(c.charset).toBe('utf8')
    c.glyph('A')!.shift(1)
    c.headers.comment!.push('x')
    c.props.comment = ['y']
    c.unencoded[0].meta[16].push('00')
    expect(f.glyphs.get(65)![4]).toBe(0)
    expect(f.headers.comment).toHaveLength(2)
    expect(f.unencoded[0].meta[16]).toEqual(['80'])
    expect(c.clone().props.comment).toEqual(['y'])

    const s = f.subset([
      [0x41, 0x43],
      [0x7684, 0x7684],
    ])
    expect([...s.glyphs.keys()]).toEqual([65, 66, 67, 30340])
    expect(s.unencoded).toEqual([])
    expect(s.props).toEqual(f.props)
    expect(f.subset(3).glyphs.size).toBe(3)
    expect(f.subset([0x30, 0x39]).glyphs.size).toBe(10)
    expect(f.subset(null).glyphs.size).toBe(f.glyphs.size)
    s.glyph('A')!.shift(5)
    expect(f.glyphs.get(65)![4]).toBe(0)

    const t = f.subset([0x41, 0x42])
    t.glyph('A')!.shift(1)
    const m = f.subset([0x42, 0x44])
    m.glyph('B')!.shift(2)
    t.merge(m)
    expect([...t.glyphs.keys()]).toEqual([65, 66, 67, 68])
    expect(t.glyphs.get(66)![4]).toBe(0)
    t.merge(m, true)
    expect(t.glyphs.get(66)![4]).toBe(2)
    m.glyph('B')!.shift(1)
    expect(t.glyphs.get(66)![4]).toBe(2)
  })

  test('font.transform', () => {
    const f = read('spec_example_fixed.bdf')
    f.newglyph(-1, new Bitmap(['1']), { mode: 1 })
    const before = f.glyph('j')!.draw()
    f.transform((b) => b.fliph(), [100, 200])
    expect(f.glyph('j')!.draw().bindata).toEqual(before.clone().fliph().bindata)
    expect(f.unencoded[0].meta.slice(2, 6)).toEqual([1, 1, 0, 0])
    f.transform((b) => b.bold(), null, 1)
    expect(f.unencoded[0].meta.slice(2, 6)).toEqual([2, 1, 0, 0])
    expect(f.glyph("'")!.meta.bbw).toBe(5)
  })

  test('charsetconvert', () => {
    const f = read('unifont-13.0.04-for-test.bdf')
    f.encoding({ charset: 'iso10646', char2cp: () => 1 })
    f.charsetconvert('ISO-8859-2')
    expect(f.charset).toBe('iso88592')
    expect(f.props.charset_registry).toBe('ISO8859')
    expect(f.props.charset_encoding).toBe('2')
    expect(f.glyph('č')!.cp()).toBe(0xe8)
    expect(f.glyphs.size).toBe(251)
    expect(warnings).toEqual([
      "598 glyph(s) could not be converted to the charset 'iso88592' and were dropped",
    ])
    warnings = []
    f.charsetconvert('cp1250')
    expect(f.props.charset_registry).toBe('MICROSOFT')
    expect(f.props.charset_encoding).toBe('CP1250')
    expect(f.glyph('č')!.cp()).toBe(0xe8)
    // the custom converters were cleared by the first conversion
    expect(f.char2cp('A')).toBe(65)
    f.charsetconvert('utf8')
    expect(f.props.charset_registry).toBe('ISO10646')
    expect(f.glyph('č')!.cp()).toBe(0x10d)
    warnings = []
    f.charsetconvert('fontspecific')
    expect(warnings[0]).toBe(
      "Unknown charset 'fontspecific', characters are mapped to codepoints as Unicode"
    )
    expect(f.props.charset_registry).toBe('FONTSPECIFIC')
  })

  test('charsetconvert collisions: the later glyph wins', () => {
    const f = Font.create()
    f.newglyph(0x41, new Bitmap(['1']), { name: 'first' })
    f.newglyph(0x42, new Bitmap(['1']), { name: 'second' })
    f.encoding({ cp2char: () => 'A' })
    f.charsetconvert('ascii')
    expect([...f.glyphs.values()].map((g) => g[0])).toEqual(['second'])
    expect(warnings).toEqual([
      "1 glyph(s) could not be converted to the charset 'ascii' and were dropped",
    ])
  })
})
