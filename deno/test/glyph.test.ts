import { Font, Glyph } from '../mod.ts'
import readlineiter from 'https://raw.githubusercontent.com/tomchen/fetchline/main/packages/readlineiter-deno/mod.ts'
import {
  unifont_path,
  glyph_a_meta,
  bitmap_a_bindata,
  specfont_path,
} from './info.ts'
import { expect, test, describe } from './jest_to_deno.ts'

describe('Glyph', () => {
  let font: Font
  let glyph_a: Glyph

  const beforeEach = async () => {
    font = new Font()
    await font.load_filelines(readlineiter(unifont_path))
    glyph_a = new Glyph(glyph_a_meta, font)
    return
  }

  describe('basic', () => {
    test('init', async () => {
      await beforeEach()
      expect(glyph_a).toBeInstanceOf(Glyph)
    })

    test('meta', async () => {
      await beforeEach()
      expect(glyph_a.meta).toEqual(glyph_a_meta)
    })

    test('font', async () => {
      await beforeEach()
      expect(glyph_a.font).toEqual(font)
    })

    test('cp', async () => {
      await beforeEach()
      expect(glyph_a.cp()).toEqual(97)
    })

    test('chr', async () => {
      await beforeEach()
      expect(glyph_a.chr()).toEqual('a')
    })
  })

  describe('draw', () => {
    test('default', async () => {
      await beforeEach()
      expect(glyph_a.draw().bindata).toEqual(bitmap_a_bindata)
    })
    test('mode1', async () => {
      await beforeEach()
      expect(glyph_a.draw(1).bindata).toEqual([
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00111100',
        '01000010',
        '00000010',
        '00111110',
        '01000010',
        '01000010',
        '01000110',
        '00111010',
        '00000000',
        '00000000',
      ])
    })
    test('mode2', async () => {
      await beforeEach()
      expect(glyph_a.draw(2).bindata).toEqual([
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00111100',
        '01000010',
        '00000010',
        '00111110',
        '01000010',
        '01000010',
        '01000110',
        '00111010',
        '00000000',
        '00000000',
      ])
    })
    test('mode_m1', async () => {
      await beforeEach()
      expect(glyph_a.draw(-1, [10, 10, -1, -1]).bindata).toEqual([
        '0000000000',
        '0001111000',
        '0010000100',
        '0000000100',
        '0001111100',
        '0010000100',
        '0010000100',
        '0010001100',
        '0001110100',
        '0000000000',
      ])
    })
    test('mode_m1_without_bb', async () => {
      await beforeEach()
      expect(() => {
        glyph_a.draw(-1)
      }).toThrow('Parameter bb in draw() method must be set when mode=-1')
    })
  })

  describe('str repr', () => {
    test('str', async () => {
      await beforeEach()
      expect(glyph_a.toString()).toEqual(`................
................
................
................
................
................
..####..........
.#....#.........
......#.........
..#####.........
.#....#.........
.#....#.........
.#...##.........
..###.#.........
................
................`)
    })

    test('repr', async () => {
      await beforeEach()
      expect(glyph_a.repr()).toEqual(`Glyph({
  "glyphname": "U+0061",
  "codepoint": 97,
  "bbw": 8,
  "bbh": 16,
  "bbxoff": 0,
  "bbyoff": -2,
  "swx0": 500,
  "swy0": 0,
  "dwx0": 8,
  "dwy0": 0,
  "swx1": null,
  "swy1": null,
  "dwx1": null,
  "dwy1": null,
  "vvectorx": null,
  "vvectory": null,
  "hexdata": [
    "00",
    "00",
    "00",
    "00",
    "00",
    "00",
    "3C",
    "42",
    "02",
    "3E",
    "42",
    "42",
    "46",
    "3A",
    "00",
    "00"
  ]
}, Font(<-gnu-Unifont-Medium-R-Normal-Sans-16-160-75-75-c-80-iso10646-1>)`)
    })
  })
})

describe('Glyph draw spec quoteright', () => {
  let font: Font
  let glyph_qr: Glyph

  const beforeEach = async () => {
    font = new Font()
    await font.load_filelines(readlineiter(specfont_path))
    glyph_qr = font.glyph("'") as Glyph
    return
  }

  test('default', async () => {
    await beforeEach()
    expect(glyph_qr.draw().bindata).toEqual([
      '000001110',
      '000001110',
      '000001110',
      '000001100',
      '000011100',
      '000011000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
      '000000000',
    ])
  })

  test('mode1', async () => {
    await beforeEach()
    expect(glyph_qr.draw(1).bindata).toEqual([
      '0111',
      '0111',
      '0111',
      '0110',
      '1110',
      '1100',
    ])
  })

  test('mode2', async () => {
    await beforeEach()
    expect(glyph_qr.draw(2).bindata).toEqual([
      '01110000',
      '01110000',
      '01110000',
      '01100000',
      '11100000',
      '11000000',
    ])
  })

  test('mode_m1', async () => {
    await beforeEach()
    expect(glyph_qr.draw(-1, [6, 17, 1, 1]).bindata).toEqual([
      '001110',
      '001110',
      '001110',
      '001100',
      '011100',
      '011000',
      '000000',
      '000000',
      '000000',
      '000000',
      '000000',
      '000000',
      '000000',
      '000000',
      '000000',
      '000000',
      '000000',
    ])
  })

  test('origin', async () => {
    await beforeEach()
    expect(glyph_qr.origin()).toEqual([2, 6])
    expect(glyph_qr.origin({ mode: 1 })).toEqual([-2, -12])
    expect(glyph_qr.origin({ mode: 2 })).toEqual([-2, -12])
    expect(glyph_qr.origin({ mode: -1, xoff: 1, yoff: 1 })).toEqual([-1, -1])
    expect(glyph_qr.origin({ fromorigin: true })).toEqual([-2, -6])
    expect(glyph_qr.origin({ mode: 1, fromorigin: true })).toEqual([2, 12])
    expect(glyph_qr.origin({ mode: 2, fromorigin: true })).toEqual([2, 12])
    expect(
      glyph_qr.origin({ mode: -1, fromorigin: true, xoff: 1, yoff: 1 })
    ).toEqual([1, 1])
  })
})

describe('Glyph draw spec j', () => {
  let font: Font
  let glyph_j: Glyph

  const beforeEach = async () => {
    font = new Font()
    await font.load_filelines(readlineiter(specfont_path))
    glyph_j = font.glyph('j') as Glyph
    return
  }

  test('default', async () => {
    await beforeEach()
    expect(glyph_j.draw().bindata).toEqual([
      '000000000',
      '000000000',
      '000000111',
      '000000111',
      '000000111',
      '000000111',
      '000000000',
      '000001110',
      '000001110',
      '000001110',
      '000001110',
      '000011100',
      '000011100',
      '000011100',
      '000011100',
      '000011100',
      '000111000',
      '000111000',
      '000111000',
      '000111000',
      '001011000',
      '011110000',
      '111100000',
      '111000000',
    ])
  })

  test('mode1', async () => {
    await beforeEach()
    expect(glyph_j.draw(1).bindata).toEqual([
      '000000111',
      '000000111',
      '000000111',
      '000000111',
      '000000000',
      '000001110',
      '000001110',
      '000001110',
      '000001110',
      '000011100',
      '000011100',
      '000011100',
      '000011100',
      '000011100',
      '000111000',
      '000111000',
      '000111000',
      '000111000',
      '001011000',
      '011110000',
      '111100000',
      '111000000',
    ])
  })

  test('mode2', async () => {
    await beforeEach()
    expect(glyph_j.draw(2).bindata).toEqual([
      '0000001110000000',
      '0000001110000000',
      '0000001110000000',
      '0000001110000000',
      '0000000000000000',
      '0000011100000000',
      '0000011100000000',
      '0000011100000000',
      '0000011100000000',
      '0000111000000000',
      '0000111000000000',
      '0000111000000000',
      '0000111000000000',
      '0000111000000000',
      '0001110000000000',
      '0001110000000000',
      '0001110000000000',
      '0001110000000000',
      '0010110000000000',
      '0111100000000000',
      '1111000000000000',
      '1110000000000000',
    ])
  })

  test('mode_m1', async () => {
    await beforeEach()
    expect(glyph_j.draw(-1, [6, 17, 1, 1]).bindata).toEqual([
      '000000',
      '000000',
      '000111',
      '000111',
      '000111',
      '000111',
      '000000',
      '001110',
      '001110',
      '001110',
      '001110',
      '011100',
      '011100',
      '011100',
      '011100',
      '011100',
      '111000',
    ])
  })
})
