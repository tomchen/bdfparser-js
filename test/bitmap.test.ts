import { Font, Bitmap } from '../src/index'
import readlineiter from 'readlineiter'
import { specfont_path, bitmap_qr2_bindata, bitmap_qr3_bindata } from './info'
import iconv from 'iconv-lite'

describe('Bitmap', () => {
  let font: Font
  let bitmap_qr: Bitmap
  let bitmap_qr2: Bitmap

  beforeEach(async () => {
    font = new Font()
    await font.encoding({ iconv }).load_filelines(readlineiter(specfont_path))

    bitmap_qr = font.glyph("'")!.draw(2)
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
    let bitmap_j: Bitmap
    beforeEach(() => {
      bitmap_j = font.glyph('j')!.draw(2)
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
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], {
          offsetlist: [-5, 4],
        }).bindata
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
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], { direction: 2 })
          .bindata
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
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], { direction: 0 })
          .bindata
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
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], { direction: -1 })
          .bindata
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
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], { align: 0 })
          .bindata
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
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], {
          direction: 2,
          align: 0,
        }).bindata
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
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], {
          direction: 0,
          align: 0,
        }).bindata
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
        Bitmap.concatall([bitmap_qr, bitmap_j, bitmap_qr2], {
          direction: -1,
          align: 0,
        }).bindata
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

    test('glow 0', () => {
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

    test('glow 1', () => {
      expect(bitmap_qr.glow(1).bindata).toEqual([
        '0222220000',
        '0211120000',
        '0211120000',
        '0211120000',
        '2211220000',
        '2111200000',
        '2112200000',
        '2222000000',
      ])
    })
  })

  describe('pad', () => {
    let bitmap_qr3: Bitmap

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

  describe('tosvg', () => {
    let bitmap_j: Bitmap

    beforeEach(() => {
      bitmap_j = font.glyph('j')!.draw(2)
    })

    test('defaults', () => {
      expect(bitmap_j.tosvg()).toEqual(
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="22"><path d="M0 22V20H1V19H2V18H3V19H4V18H3V14H4V9H5V5H8V9H7V14H6V19H5V20H4V21H3V22ZM6 4V0H9V4Z" fill="#000000" /></svg>'
      )
    })

    test('undefined rect', () => {
      expect(bitmap_j.tosvg(undefined, 'rect')).toEqual(
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="22"><rect x="6" y="0" width="3" height="4" fill="#000000" /><rect x="5" y="5" width="3" height="4" fill="#000000" /><rect x="4" y="9" width="3" height="5" fill="#000000" /><rect x="3" y="14" width="3" height="4" fill="#000000" /><rect x="2" y="18" width="1" height="4" fill="#000000" /><rect x="4" y="18" width="2" height="1" fill="#000000" /><rect x="1" y="19" width="1" height="3" fill="#000000" /><rect x="3" y="19" width="2" height="1" fill="#000000" /><rect x="0" y="20" width="1" height="2" fill="#000000" /><rect x="3" y="20" width="1" height="1" fill="#000000" /></svg>'
      )
    })

    test('4 path', () => {
      expect(bitmap_j.tosvg(4, 'path')).toEqual(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="88"><path d="M0 88V80H4V76H8V72H12V76H16V72H12V56H16V36H20V20H32V36H28V56H24V76H20V80H16V84H12V88ZM24 16V0H36V16Z" fill="#000000" /></svg>'
      )
    })

    test('4 pathOnly false', () => {
      expect(bitmap_j.tosvg(4, 'pathOnly', false)).toEqual(
        'M0 88V80H4V76H8V72H12V76H16V72H12V56H16V36H20V20H32V36H28V56H24V76H20V80H16V84H12V88ZM24 16V0H36V16Z'
      )
    })

    test('4 rect true', () => {
      expect(bitmap_j.tosvg(4, 'rect', true)).toEqual(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="88"><rect x="24" y="72" width="12" height="16" fill="#000000" /><rect x="20" y="52" width="12" height="16" fill="#000000" /><rect x="16" y="32" width="12" height="20" fill="#000000" /><rect x="12" y="16" width="12" height="16" fill="#000000" /><rect x="8" y="0" width="4" height="16" fill="#000000" /><rect x="16" y="12" width="8" height="4" fill="#000000" /><rect x="4" y="0" width="4" height="12" fill="#000000" /><rect x="12" y="8" width="8" height="4" fill="#000000" /><rect x="0" y="0" width="4" height="8" fill="#000000" /><rect x="12" y="4" width="4" height="4" fill="#000000" /></svg>'
      )
    })

    test('10 path true', () => {
      expect(bitmap_j.tosvg(10, 'path', true)).toEqual(
        '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="220"><path d="M0 0V20H10V30H20V40H30V30H40V40H30V80H40V130H50V170H80V130H70V80H60V30H50V20H40V10H30V0ZM60 180V220H90V180Z" fill="#000000" /></svg>'
      )
    })

    test('undefined pathOnly true', () => {
      expect(bitmap_j.tosvg(undefined, 'pathOnly', true)).toEqual(
        'M0 0V2H1V3H2V4H3V3H4V4H3V8H4V13H5V17H8V13H7V8H6V3H5V2H4V1H3V0ZM6 18V22H9V18Z'
      )
    })

    test('undefined, rect, undefined, {x: 0, y: 0}', () => {
      expect(
        bitmap_j.tosvg(undefined, 'rect', undefined, { x: 0, y: 0 })
      ).toEqual(
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="22"><rect x="6" y="0" width="3" height="4" fill="#000000" /><rect x="5" y="5" width="3" height="4" fill="#000000" /><rect x="4" y="9" width="3" height="5" fill="#000000" /><rect x="3" y="14" width="3" height="4" fill="#000000" /><rect x="2" y="18" width="1" height="4" fill="#000000" /><rect x="4" y="18" width="2" height="1" fill="#000000" /><rect x="1" y="19" width="1" height="3" fill="#000000" /><rect x="3" y="19" width="2" height="1" fill="#000000" /><rect x="0" y="20" width="1" height="2" fill="#000000" /><rect x="3" y="20" width="1" height="1" fill="#000000" /></svg>'
      )
    })

    test('undefined, rect, undefined, {x: 2, y: -5}', () => {
      expect(
        bitmap_j.tosvg(undefined, 'rect', undefined, { x: 2, y: -5 })
      ).toEqual(
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="22"><rect x="8" y="-5" width="3" height="4" fill="#000000" /><rect x="7" y="0" width="3" height="4" fill="#000000" /><rect x="6" y="4" width="3" height="5" fill="#000000" /><rect x="5" y="9" width="3" height="4" fill="#000000" /><rect x="4" y="13" width="1" height="4" fill="#000000" /><rect x="6" y="13" width="2" height="1" fill="#000000" /><rect x="3" y="14" width="1" height="3" fill="#000000" /><rect x="5" y="14" width="2" height="1" fill="#000000" /><rect x="2" y="15" width="1" height="2" fill="#000000" /><rect x="5" y="15" width="1" height="1" fill="#000000" /></svg>'
      )
    })

    test('undefined, path, true, {y: 0}', () => {
      expect(bitmap_j.tosvg(undefined, 'path', true, { y: 0 })).toEqual(
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="22"><path d="M0 0V2H1V3H2V4H3V3H4V4H3V8H4V13H5V17H8V13H7V8H6V3H5V2H4V1H3V0ZM6 18V22H9V18Z" fill="#000000" /></svg>'
      )
    })

    test('undefined, path, true, {y: -2}', () => {
      expect(bitmap_j.tosvg(undefined, 'path', true, { y: -2 })).toEqual(
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="22"><path d="M0 -2V0H1V1H2V2H3V1H4V2H3V6H4V11H5V15H8V11H7V6H6V1H5V0H4V-1H3V-2ZM6 16V20H9V16Z" fill="#000000" /></svg>'
      )
    })

    test('2, pathOnly, false, {x: 0, y: 0}', () => {
      expect(bitmap_j.tosvg(2, 'pathOnly', false, { x: 0, y: 0 })).toEqual(
        'M0 44V40H2V38H4V36H6V38H8V36H6V28H8V18H10V10H16V18H14V28H12V38H10V40H8V42H6V44ZM12 8V0H18V8Z'
      )
    })

    test('2, pathOnly, false, {x: -5, y: 12}', () => {
      expect(bitmap_j.tosvg(2, 'pathOnly', false, { x: -5, y: 12 })).toEqual(
        'M-5 56V52H-3V50H-1V48H1V50H3V48H1V40H3V30H5V22H11V30H9V40H7V50H5V52H3V54H1V56ZM7 20V12H13V20Z'
      )
    })
  })
})
