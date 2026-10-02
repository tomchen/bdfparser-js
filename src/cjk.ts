/**
 * `bdfparser/cjk`: exact tables of the multi-byte (CJK) charsets (SPEC-v3
 * §11.1), generated from Python's codecs: GB 2312, GBK, CP936, GB18030
 * (including the 4-byte codes), EUC-JP / JIS X 0208, Shift_JIS, CP932,
 * EUC-KR / KS C 5601, CP949, Johab, Big5, Big5-HKSCS and CP950.
 *
 * Importing the module registers the tables (side effect):
 *
 * ```js
 * import { Font } from 'bdfparser'
 * import 'bdfparser/cjk'
 * ```
 *
 * In browsers without a bundler, load `bdfparser-cjk.global.js` after
 * `bdfparser.global.js`. Without this module, the core falls back to the
 * runtime's `TextDecoder` for these charsets (with a warning).
 *
 * @module
 */

import { CJK_TABLES, GB18030_RANGES } from './charsets/cjk-data'
import type { CharsetTables } from './charsets/registry'
import { registerCharsetTables } from './index'

/** The tables (already registered by importing this module) */
export const cjkTables: CharsetTables = {
  tables: CJK_TABLES,
  gb18030: GB18030_RANGES,
}

registerCharsetTables(cjkTables)
