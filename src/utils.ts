import { Bitmap } from './Bitmap'
import { Font } from './Font'
import { Glyph } from './Glyph'
import { GlyphMeta } from './types'

export const setProperty = <
  O extends Record<PropertyKey, unknown>,
  K extends keyof O
>(
  obj: O,
  key: K,
  value: O[K]
): void => {
  obj[key] = value
}

/**
 * Shortcut for `new Font().load_filelines(filelines)` so you don't need to write `new` and `.load_filelines`
 *
 * @param filelines - Asynchronous iterator containing each line in string text from the font file
 *
 * @returns The newly instantiated `Font` object that's loaded the font file
 */
export const $Font = async (
  filelines: AsyncIterableIterator<string>
): Promise<Font> => {
  return await new Font().load_filelines(filelines)
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
