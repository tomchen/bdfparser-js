import { Font } from '../src/index'
import readlineiter from 'readlineiter'
import iconv from 'iconv-lite'
import { char2cp, cp2char, sanitizeCharsetName } from '../src/encoding'

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

const cjks = [
  'utf8',
  'unicode',
  'iso10646',
  'gb2312',
  'iso2022cn',
  'big5',
  'shiftjis',
  'euckr',
]

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
    test('without iconv, charset overwritten when loading font', async () => {
      const font = new Font()
      await font
        .encoding({ charset: 'gbk' })
        .load_filelines(
          readlineiter('./test/fonts/unifont-13.0.04-enctest-utf8.bdf')
        )
      expect(font.props.charset_registry).toEqual('UTF-8')
      expect(font.charset).toEqual('utf8')
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
        char2cp: (char) => 0,
        cp2char: (cp) => '一',
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
        char2cp: (char) => 0,
        cp2char: (cp) => '一',
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
    for (const encoding of cjks) {
      test(`"A人光" bitmap in ${encoding} font`, async () => {
        const font = new Font()
        ;(
          await font.load_filelines(
            readlineiter(`./test/fonts/unifont-13.0.04-enctest-${encoding}.bdf`)
          )
        ).encoding({ iconv })
        expect(font.charset).toEqual(encoding)
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
