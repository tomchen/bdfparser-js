import { Bitmap } from './Bitmap'
import { Font } from './Font'
import { Glyph } from './Glyph'
import { GlyphMeta } from './types'
import iconvlite from 'iconv-lite'

/**
 * Shortcut for `new Font().load_filelines(filelines).encoding(encodingOptions)`
 *
 * @param filelines - Asynchronous iterator containing each line in string text from the font file
 * @param encodingOptions - Encoding options
 * @param encodingOptions.iconv - iconv-lite instance
 * @param encodingOptions.charset - force a charset name
 * @param encodingOptions.char2cp - use a customized character to codepoint method
 * @param encodingOptions.cp2char - use a customized codepoint to character method
 *
 * @returns The newly instantiated `Font` object that's loaded the font file and encoding options
 */
export const $Font = async (
  filelines: AsyncIterableIterator<string>,
  encodingOptions: {
    iconv?: typeof iconvlite
    charset?: string
    char2cp?: (char: string) => number
    cp2char?: (cp: number) => string
  }
): Promise<Font> => {
  return (await new Font().load_filelines(filelines)).encoding(encodingOptions)
}

/**
 * Shortcut for `new Glyph(meta_obj, font)` so you don't need to write `new`
 *
 * @param meta_obj - Meta information
 * @param font - The font the glyph belongs to
 *
 * @returns The newly instantiated `Glyph` object
 */
export const $Glyph = (meta_obj: GlyphMeta, font: Font): Glyph => {
  return new Glyph(meta_obj, font)
}

/**
 * Shortcut for `new Bitmap(bin_bitmap_list)` so you don't need to write `new`
 *
 * @param bin_bitmap_list - Binary bitmap data
 *
 * @returns The newly instantiated `Bitmap` object
 */
export const $Bitmap = (bin_bitmap_list: string[]): Bitmap => {
  return new Bitmap(bin_bitmap_list)
}
