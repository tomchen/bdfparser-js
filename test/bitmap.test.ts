import { Font, Bitmap } from '../src/index'
import { specfont_path, bitmap_qr2_bindata, bitmap_qr3_bindata } from './info'

describe('Bitmap', () => {
  let font
  let bitmap_qr
  let bitmap_qr2

  beforeEach(async () => {
    font = new Font()
    await font.load_file_path(specfont_path)
    bitmap_qr = font.glyph("'").draw(2)
    bitmap_qr2 = new Bitmap(bitmap_qr2_bindata)
    return
  })

  describe('basic', () => {
    test('bindata', () => {
      expect(bitmap_qr.bindata).toEqual([
        '01110000',
        '01110000',
        '01110000',
        '01100000',
        '11100000',
        '11000000',
      ])
      expect(bitmap_qr2.bindata).toEqual([
        '01110',
        '02112',
        '01102',
        '10200',
        '01000',
      ])
    })

    test('width', () => {
      expect(bitmap_qr.width()).toEqual(8)
      expect(bitmap_qr2.width()).toEqual(5)
    })

    test('height', () => {
      expect(bitmap_qr.height()).toEqual(6)
      expect(bitmap_qr2.height()).toEqual(5)
    })

    test('clone', () => {
      expect(bitmap_qr.clone()).not.toBe(bitmap_qr)
      expect(bitmap_qr.clone().bindata).toEqual(bitmap_qr.bindata)
    })
  })

  describe('alter', () => {
    test('crop_default', () => {
      expect(bitmap_qr2.crop(6, 10).bindata).toEqual([
        '000000',
        '000000',
        '000000',
        '000000',
        '000000',
        '011100',
        '021120',
        '011020',
        '102000',
        '010000',
      ])
    })

    test('crop', () => {
      expect(bitmap_qr.crop(6, 10, -1, -2).bindata).toEqual([
        '000000',
        '000000',
        '001110',
        '001110',
        '001110',
        '001100',
        '011100',
        '011000',
        '000000',
        '000000',
      ])
    })

    test('replace', () => {
      expect(bitmap_qr2.replace('2', '3').bindata).toEqual([
        '01110',
        '03113',
        '01103',
        '10300',
        '01000',
      ])
    })
  })

  describe('overlay', () => {
    test('overlay', () => {
      expect(
        bitmap_qr.overlay(
          bitmap_qr2.crop(bitmap_qr.width(), bitmap_qr.height())
        ).bindata
      ).toEqual([
        '01110000',
        '01110000',
        '02112000',
        '01102000',
        '11200000',
        '11000000',
      ])
    })
  })

  describe('concat', () => {
    let bitmap_j
    beforeEach(() => {
      bitmap_j = font.glyph('j').draw(2)
    })

    test('concatall_onlyone', () => {
      expect(Bitmap.concatall([bitmap_qr]).bindata).toEqual(bitmap_qr.bindata)
    })

    test('concatall', () => {
      const w = bitmap_qr.width()
      expect(
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2]).bindata
      ).toEqual([
        '00000000000000111000000000000',
        '00000000000000111000000000000',
        '00000000000000111000000000000',
        '00000000000000111000000000000',
        '00000000000000000000000000000',
        '00000000000001110000000000000',
        '00000000000001110000000000000',
        '00000000000001110000000000000',
        '00000000000001110000000000000',
        '00000000000011100000000000000',
        '00000000000011100000000000000',
        '00000000000011100000000000000',
        '00000000000011100000000000000',
        '00000000000011100000000000000',
        '00000000000111000000000000000',
        '00000000000111000000000000000',
        '01110000000111000000000000000',
        '01110000000111000000000001110',
        '01110000001011000000000002112',
        '01100000011110000000000001102',
        '11100000111100000000000010200',
        '11000000111000000000000001000',
      ])
      expect(bitmap_qr.width()).toEqual(w)
    })

    test('concatall_offsetlist', () => {
      expect(
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], null, null, [-5, 4])
          .bindata
      ).toEqual([
        '0000000001110000000000000000',
        '0000000001110000000000000000',
        '0000000001110000000000000000',
        '0000000001110000000000000000',
        '0000000000000000000000000000',
        '0000000011100000000000000000',
        '0000000011100000000000000000',
        '0000000011100000000000000000',
        '0000000011100000000000000000',
        '0000000111000000000000000000',
        '0000000111000000000000000000',
        '0000000111000000000000000000',
        '0000000111000000000000000000',
        '0000000111000000000000000000',
        '0000001110000000000000000000',
        '0000001110000000000000000000',
        '0111001110000000000000000000',
        '0111001110000000000000001110',
        '0111010110000000000000002112',
        '0110111100000000000000001102',
        '1111111000000000000000010200',
        '1101110000000000000000001000',
      ])
    })

    test('concatall_direction_2', () => {
      expect(
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], 2).bindata
      ).toEqual([
        '00000000000111000000000000000',
        '00000000000111000000000000000',
        '00000000000111000000000000000',
        '00000000000111000000000000000',
        '00000000000000000000000000000',
        '00000000001110000000000000000',
        '00000000001110000000000000000',
        '00000000001110000000000000000',
        '00000000001110000000000000000',
        '00000000011100000000000000000',
        '00000000011100000000000000000',
        '00000000011100000000000000000',
        '00000000011100000000000000000',
        '00000000011100000000000000000',
        '00000000111000000000000000000',
        '00000000111000000000000000000',
        '00000000111000000000001110000',
        '01110000111000000000001110000',
        '02112001011000000000001110000',
        '01102011110000000000001100000',
        '10200111100000000000011100000',
        '01000111000000000000011000000',
      ])
    })

    test('concatall_direction_0', () => {
      expect(
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], 0).bindata
      ).toEqual([
        '0111000000000000',
        '0111000000000000',
        '0111000000000000',
        '0110000000000000',
        '1110000000000000',
        '1100000000000000',
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
        '0111000000000000',
        '0211200000000000',
        '0110200000000000',
        '1020000000000000',
        '0100000000000000',
      ])
    })

    test('concatall_direction_m1', () => {
      expect(
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], -1).bindata
      ).toEqual([
        '0111000000000000',
        '0211200000000000',
        '0110200000000000',
        '1020000000000000',
        '0100000000000000',
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
        '0111000000000000',
        '0111000000000000',
        '0111000000000000',
        '0110000000000000',
        '1110000000000000',
        '1100000000000000',
      ])
    })

    test('concatall_align_0', () => {
      expect(
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], null, 0).bindata
      ).toEqual([
        '01110000000000111000000001110',
        '01110000000000111000000002112',
        '01110000000000111000000001102',
        '01100000000000111000000010200',
        '11100000000000000000000001000',
        '11000000000001110000000000000',
        '00000000000001110000000000000',
        '00000000000001110000000000000',
        '00000000000001110000000000000',
        '00000000000011100000000000000',
        '00000000000011100000000000000',
        '00000000000011100000000000000',
        '00000000000011100000000000000',
        '00000000000011100000000000000',
        '00000000000111000000000000000',
        '00000000000111000000000000000',
        '00000000000111000000000000000',
        '00000000000111000000000000000',
        '00000000001011000000000000000',
        '00000000011110000000000000000',
        '00000000111100000000000000000',
        '00000000111000000000000000000',
      ])
    })

    test('concatall_direction_2_align_0', () => {
      expect(
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], 2, 0).bindata
      ).toEqual([
        '01110000000111000000001110000',
        '02112000000111000000001110000',
        '01102000000111000000001110000',
        '10200000000111000000001100000',
        '01000000000000000000011100000',
        '00000000001110000000011000000',
        '00000000001110000000000000000',
        '00000000001110000000000000000',
        '00000000001110000000000000000',
        '00000000011100000000000000000',
        '00000000011100000000000000000',
        '00000000011100000000000000000',
        '00000000011100000000000000000',
        '00000000011100000000000000000',
        '00000000111000000000000000000',
        '00000000111000000000000000000',
        '00000000111000000000000000000',
        '00000000111000000000000000000',
        '00000001011000000000000000000',
        '00000011110000000000000000000',
        '00000111100000000000000000000',
        '00000111000000000000000000000',
      ])
    })

    test('concatall_direction_0_align_0', () => {
      expect(
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], 0, 0).bindata
      ).toEqual([
        '0000000001110000',
        '0000000001110000',
        '0000000001110000',
        '0000000001100000',
        '0000000011100000',
        '0000000011000000',
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
        '0000000000001110',
        '0000000000002112',
        '0000000000001102',
        '0000000000010200',
        '0000000000001000',
      ])
    })

    test('concatall_direction_m1_align_0', () => {
      expect(
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], -1, 0).bindata
      ).toEqual([
        '0000000000001110',
        '0000000000002112',
        '0000000000001102',
        '0000000000010200',
        '0000000000001000',
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
        '0000000001110000',
        '0000000001110000',
        '0000000001110000',
        '0000000001100000',
        '0000000011100000',
        '0000000011000000',
      ])
    })

    test('concat', () => {
      const w = bitmap_qr.width()
      const w2 = bitmap_j.width()
      expect(bitmap_qr.concat(bitmap_j).bindata).toEqual([
        '000000000000001110000000',
        '000000000000001110000000',
        '000000000000001110000000',
        '000000000000001110000000',
        '000000000000000000000000',
        '000000000000011100000000',
        '000000000000011100000000',
        '000000000000011100000000',
        '000000000000011100000000',
        '000000000000111000000000',
        '000000000000111000000000',
        '000000000000111000000000',
        '000000000000111000000000',
        '000000000000111000000000',
        '000000000001110000000000',
        '000000000001110000000000',
        '011100000001110000000000',
        '011100000001110000000000',
        '011100000010110000000000',
        '011000000111100000000000',
        '111000001111000000000000',
        '110000001110000000000000',
      ])
      expect(bitmap_qr.width()).toEqual(w + w2)
    })
  })

  describe('enlarge', () => {
    test('enlarge', () => {
      expect(bitmap_qr2.enlarge(2, 3).bindata).toEqual([
        '0011111100',
        '0011111100',
        '0011111100',
        '0022111122',
        '0022111122',
        '0022111122',
        '0011110022',
        '0011110022',
        '0011110022',
        '1100220000',
        '1100220000',
        '1100220000',
        '0011000000',
        '0011000000',
        '0011000000',
      ])
    })
  })

  describe('effect', () => {
    test('shadow', () => {
      expect(bitmap_qr.shadow(2, -3).bindata).toEqual([
        '0111000000',
        '0111000000',
        '0111000000',
        '0112220000',
        '1112220000',
        '1102220000',
        '0002200000',
        '0022200000',
        '0022000000',
      ])
    })

    test('glow', () => {
      expect(bitmap_qr.glow().bindata).toEqual([
        '0022200000',
        '0211120000',
        '0211120000',
        '0211120000',
        '0211200000',
        '2111200000',
        '2112000000',
        '0220000000',
      ])
    })
  })

  describe('pad', () => {
    let bitmap_qr3

    beforeEach(() => {
      bitmap_qr3 = new Bitmap(bitmap_qr3_bindata)
    })

    test('bytepad', () => {
      expect(bitmap_qr2.bytepad().bindata).toEqual([
        '01110000',
        '02112000',
        '01102000',
        '10200000',
        '01000000',
      ])
    })

    test('bytepad4', () => {
      expect(bitmap_qr3.bytepad(4).bindata).toEqual([
        '011100000000',
        '021120000000',
        '011020003000',
        '102000002100',
        '010000000000',
      ])
    })
  })

  describe('todata', () => {
    const bitmap_todata_test = new Bitmap(['00010', '11010', '00201'])
    const bitmap_todata_test2 = new Bitmap(['00010', '11010'])

    test('todata0', () => {
      expect(bitmap_todata_test.todata(0)).toEqual(`00010
11010
00201`)
    })

    test('todata1_default', () => {
      expect(bitmap_todata_test.todata()).toEqual(['00010', '11010', '00201'])
    })

    test('todata2', () => {
      expect(bitmap_todata_test.todata(2)).toEqual([
        [0, 0, 0, 1, 0],
        [1, 1, 0, 1, 0],
        [0, 0, 2, 0, 1],
      ])
    })

    test('todata3', () => {
      // prettier-ignore
      expect(bitmap_todata_test.todata(3)).toEqual([
        0, 0, 0, 1, 0,
        1, 1, 0, 1, 0,
        0, 0, 2, 0, 1,
      ])
    })

    test('todata4', () => {
      expect(bitmap_todata_test2.todata(4)).toEqual(['02', '1a'])
    })

    test('todata4_error', () => {
      expect(() => {
        bitmap_todata_test.todata(4)
      }).toThrow(new Error('Invalid binary string: 00201'))
    })

    test('todata5', () => {
      expect(bitmap_todata_test2.todata(5)).toEqual([2, 26])
    })

    test('todata5_error', () => {
      expect(() => {
        bitmap_todata_test.todata(5)
      }).toThrow(new Error('Invalid binary string: 00201'))
    })
  })

  describe('str repr', () => {
    test('str', () => {
      expect(bitmap_qr.toString()).toEqual(`.###....
.###....
.###....
.##.....
###.....
##......`)
    })

    test('repr', () => {
      console.log(bitmap_qr.repr())
      expect(bitmap_qr.repr()).toEqual(`Bitmap([
  "01110000",
  "01110000",
  "01110000",
  "01100000",
  "11100000",
  "11000000"
])`)
    })
  })
})