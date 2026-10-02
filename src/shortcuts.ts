import { Bitmap } from './Bitmap'
import { EncodingOptions, Font, LoadOptions } from './Font'
import { Glyph } from './Glyph'
import { GlyphMeta } from './types'

/** Font sources accepted by {@link $Font} */
export type FontSource =
  | AsyncIterable<string>
  | Iterable<string>
  | string
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferView
  | URL

const isBinary = (
  s: unknown
): s is Uint8Array | ArrayBuffer | ArrayBufferView =>
  ArrayBuffer.isView(s) ||
  Object.prototype.toString.call(s) === '[object ArrayBuffer]'

const isURL = (s: unknown): s is URL =>
  typeof URL !== 'undefined' &&
  (s instanceof URL || Object.prototype.toString.call(s) === '[object URL]')

/**
 * Create and load a font in one call, then apply encoding options.
 *
 * `source` can be:
 * - an (async) iterable of lines, e.g. `readlineiter(path)` (Node) or `fetchline(url)` (browser) → BDF;
 * - a `string` → BDF text;
 * - a `Uint8Array` / `ArrayBuffer` → BDF, PCF, gzip-compressed PCF/BDF or TrueType (auto-detected);
 * - a `URL` → fetched with `fetch` (any of the formats above).
 *
 * @param source - Font source
 * @param encodingOptions - Encoding options (see `Font.encoding`)
 * @param loadOptions - Load options (`pixelsize` for TrueType fonts without `BDFP` table)
 *
 * @returns Promise of the newly instantiated, loaded `Font` object
 *
 * @example
 * const font = await $Font(new URL('./fonts/unifont.bdf', location.href))
 */
export const $Font = async (
  source: FontSource,
  encodingOptions: EncodingOptions = {},
  loadOptions: LoadOptions = {}
): Promise<Font> => {
  const font = new Font().encoding(encodingOptions)
  if (typeof source === 'string') {
    font.load_string(source)
  } else if (isBinary(source)) {
    await font.load_bytes_async(source, loadOptions)
  } else if (isURL(source)) {
    await font.load_url(source, undefined, loadOptions)
  } else {
    await font.load_filelines(source)
  }
  return font
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
