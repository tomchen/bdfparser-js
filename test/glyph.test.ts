import { Font, Glyph } from '../src/index'
import {
  unifont_path,
  glyph_a_meta,
  bitmap_a_bindata,
  specfont_path,
} from './info'

describe('Glyph', () => {
  let font
  let glyph_a

  beforeEach(async () => {
    font = new Font()
    await font.load_file_path(unifont_path)
    glyph_a = new Glyph(glyph_a_meta, font)
    return
  })

  describe('basic', () => {
    test('init', () => {
      expect(glyph_a).toBeInstanceOf(Glyph)
    })

    test('meta', () => {
      expect(glyph_a.meta).toEqual(glyph_a_meta)
    })

    test('font', () => {
      expect(glyph_a.font).toEqual(font)
    })

    test('cp', () => {
      expect(glyph_a.cp()).toEqual(97)
    })

    test('chr', () => {
      expect(glyph_a.chr()).toEqual('a')
    })
  })

  describe('draw', () => {
    test('default', () => {
      expect(glyph_a.draw().bindata).toEqual(bitmap_a_bindata)
    })
    test('mode1', () => {
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
    test('mode2', () => {
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
    test('mode_m1', () => {
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
    test('mode_m1_without_bb', () => {
      expect(() => {
        glyph_a.draw(-1)
      }).toThrowError(
        new Error('Parameter bb in draw() method must be set when mode=-1')
      )
    })
  })

  describe('str repr', () => {
    test('str', () => {
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

    test('repr', () => {
      expect(glyph_a.repr().substring(0, 7)).toEqual('Glyph({')
    })
  })
})

describe('Glyph draw spec quoteright', () => {
  let font
  let glyph_qr

  beforeEach(async () => {
    font = new Font()
    await font.load_file_path(specfont_path)
    glyph_qr = font.glyph("'")
    return
  })

  test('default', () => {
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

  test('mode1', () => {
    expect(glyph_qr.draw(1).bindata).toEqual([
      '0111',
      '0111',
      '0111',
      '0110',
      '1110',
      '1100',
    ])
  })

  test('mode2', () => {
    expect(glyph_qr.draw(2).bindata).toEqual([
      '01110000',
      '01110000',
      '01110000',
      '01100000',
      '11100000',
      '11000000',
    ])
  })

  test('mode_m1', () => {
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

  test('origin', () => {
    expect(glyph_qr.origin()).toEqual([2, 6])
    expect(glyph_qr.origin(1)).toEqual([-2, -12])
    expect(glyph_qr.origin(2)).toEqual([-2, -12])
    expect(glyph_qr.origin(-1, null, 1, 1)).toEqual([-1, -1])
    expect(glyph_qr.origin(null, true)).toEqual([-2, -6])
    expect(glyph_qr.origin(1, true)).toEqual([2, 12])
    expect(glyph_qr.origin(2, true)).toEqual([2, 12])
    expect(glyph_qr.origin(-1, true, 1, 1)).toEqual([1, 1])
  })
})

describe('Glyph draw spec j', () => {
  let font
  let glyph_j

  beforeEach(async () => {
    font = new Font()
    await font.load_file_path(specfont_path)
    glyph_j = font.glyph('j')
    return
  })

  test('default', () => {
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

  test('mode1', () => {
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

  test('mode2', () => {
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

  test('mode_m1', () => {
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
