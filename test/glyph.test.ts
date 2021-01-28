import { Font, Glyph } from '../src/index'
import {
  unifont_path,
  glyph_a_meta,
  bitmap_a_bindata,
  specfont_path,
} from './info'

describe('Font loading', () => {
  let font
  let glyph_a

  beforeEach(async () => {
    font = new Font()
    await font.load_file_path(unifont_path)
    glyph_a = new Glyph(glyph_a_meta, font)
    return glyph_a
  })

  test('init', async () => {
    expect(glyph_a).toBeInstanceOf(Glyph)
  })

  test('meta', async () => {
    expect(glyph_a.meta).toEqual(glyph_a_meta)
  })

  test('font', async () => {
    expect(glyph_a.font).toEqual(font)
  })

  test('cp', async () => {
    expect(glyph_a.cp()).toEqual(97)
  })

  test('chr', async () => {
    expect(glyph_a.chr()).toEqual('a')
  })
})
