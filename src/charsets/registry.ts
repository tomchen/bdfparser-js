/**
 * Charset table registry (SPEC-v3 §11.1).
 *
 * Exact decode tables generated from Python's codecs by
 * `tools/gen_charsets.py`: the single-byte tables are part of the core
 * (`./sbcs`), the multi-byte ones (`./cjk-data`) are registered by the
 * optional sub-module `bdfparser/cjk` (or by {@link registerCharsetTables}).
 * Tables are decoded lazily, on first use, and cached.
 *
 * See `tools/gen_charsets.py` for the (compact, ASCII-only) data format.
 *
 * @module
 */

import { SBCS_TABLES } from './sbcs'

/** Code length class of a charset: 1 byte, 1–2 bytes, or 1, 2 or 4 bytes */
export type CharsetKind = 'sbcs' | 'dbcs' | 'gb18030'

/** One encoded decode table (see `tools/gen_charsets.py`) */
export type TableSpec = {
  /** lead bytes (inclusive range) of the 2-byte codes */
  l?: number[]
  /** trail bytes (inclusive range) of the 2-byte codes */
  t?: number[]
  /** base table (codec name) of the `$` (same as base) runs */
  b?: string
  /** code transform to the base table (`'sjis'`: Shift_JIS → EUC-JP) */
  x?: string
  /** item stream */
  d: string
  /** reverse exceptions: (code point, code + 1) pairs */
  e?: string
}

/** A set of charset tables, as exported by `bdfparser/cjk` */
export type CharsetTables = {
  /** codec name (Python's, e.g. `'gb2312'`, `'shift_jis'`) → table */
  tables: Record<string, TableSpec>
  /** GB18030 4-byte ranges */
  gb18030?: string
}

const FINAL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'
const CONT = 'ghijklmnopqrstuvwxyz0123456789+/'
/** char code → digit (0–31 final, 32–63 continuation), -1 otherwise */
const DIGITS = /* @__PURE__ */ (() => {
  const d = new Int8Array(128).fill(-1)
  for (let i = 0; i < 32; i++) {
    d[FINAL.charCodeAt(i)] = i
    d[CONT.charCodeAt(i)] = 32 + i
  }
  return d
})()

/** Sequential reader of the variable-length numbers of a table string */
class NumReader {
  i = 0
  constructor(readonly s: string) {}
  get done(): boolean {
    return this.i >= this.s.length
  }
  num(): number {
    let v = 0
    for (;;) {
      const c = this.s.charCodeAt(this.i++)
      const d = c < 128 ? DIGITS[c] : -1
      if (d < 0) {
        throw new Error(`Corrupt charset table data at ${this.i - 1}`)
      }
      if (d < 32) {
        return v * 32 + d
      }
      v = v * 32 + d - 32
    }
  }
}

const unzigzag = (z: number): number => (z % 2 === 0 ? z / 2 : -(z + 1) / 2)

/** Shift_JIS code → EUC-JP code (same as `sjis2euc` in the generator) */
const sjis2euc = (code: number): number => {
  if (code < 0x100) {
    return code >= 0xa1 && code <= 0xdf ? 0x8e00 | code : code
  }
  const s1 = code >> 8
  const s2 = code & 0xff
  let j1 = (s1 - (s1 <= 0x9f ? 0x70 : 0xb0)) * 2
  let j2: number
  if (s2 < 0x9f) {
    j1 -= 1
    j2 = s2 - 0x1f - (s2 >= 0x7f ? 1 : 0)
  } else {
    j2 = s2 - 0x7e
  }
  return (((j1 | 0x80) & 0xff) << 8) | ((j2 | 0x80) & 0xff)
}

const registered = new Map<string, TableSpec>()
const forwardCache = new Map<string, Int32Array>()
const reverseCache = new Map<string, Map<number, number>>()
let gb18030Source: string | null = null
let gb18030Runs: [Int32Array, Int32Array, Int32Array] | null = null

/**
 * Register exact charset tables (normally done by importing `bdfparser/cjk`
 * or loading `bdfparser-cjk.global.js`). Later registrations replace earlier
 * ones for the same codec.
 *
 * @param tables - Tables, e.g. `cjkTables` of `bdfparser/cjk`
 */
export const registerCharsetTables = (tables: CharsetTables): void => {
  if (
    typeof tables !== 'object' ||
    tables === null ||
    typeof tables.tables !== 'object'
  ) {
    throw new TypeError('registerCharsetTables(): expected charset tables')
  }
  for (const codec of Object.keys(tables.tables)) {
    registered.set(codec, tables.tables[codec])
    forwardCache.delete(codec)
    reverseCache.delete(codec)
  }
  if (typeof tables.gb18030 === 'string') {
    gb18030Source = tables.gb18030
    gb18030Runs = null
  }
}

const specOf = (codec: string): TableSpec | undefined =>
  registered.get(codec) ??
  (Object.prototype.hasOwnProperty.call(SBCS_TABLES, codec)
    ? SBCS_TABLES[codec]
    : undefined)

/**
 * Whether the exact table of a (Python) codec is available.
 *
 * @param codec - Codec name
 *
 * @returns `true` if registered (or built in)
 */
export const hasTable = (codec: string): boolean =>
  specOf(codec) !== undefined && (codec !== 'gb18030' || gb18030Source !== null)

/**
 * Decoded table: code (0x00–0xFF, or 0x0000–0xFFFF for multi-byte codecs) →
 * Unicode code point, -1 if unmapped.
 *
 * @param codec - Codec name
 *
 * @returns The table, or `null` if not available
 */
export const forwardTable = (codec: string): Int32Array | null => {
  let fwd = forwardCache.get(codec)
  if (fwd !== undefined) {
    return fwd
  }
  const spec = specOf(codec)
  if (spec === undefined) {
    return null
  }
  const mbcs = spec.l !== undefined && spec.t !== undefined
  fwd = new Int32Array(mbcs ? 0x10000 : 0x100).fill(-1)
  const [l0, l1] = mbcs ? (spec.l as number[]) : [0, -1]
  const [t0, t1] = mbcs ? (spec.t as number[]) : [0, -1]
  const tw = t1 - t0 + 1
  const npos = 0x100 + (l1 - l0 + 1) * Math.max(tw, 0)
  const codeAt = (p: number): number =>
    p < 0x100
      ? p
      : ((l0 + Math.floor((p - 0x100) / tw)) << 8) | (t0 + ((p - 0x100) % tw))
  let base: Int32Array | null = null
  if (spec.b !== undefined) {
    base = forwardTable(spec.b)
    if (base === null) {
      throw new Error(
        `Charset table '${codec}' needs the table '${spec.b}', which is not registered`
      )
    }
  }
  const xf = spec.x === 'sjis' ? sjis2euc : (c: number): number => c
  const r = new NumReader(spec.d)
  let p = 0
  let prev = 0
  while (!r.done) {
    const c = spec.d[r.i]
    if (c === '!' || c === '#' || c === '$') {
      r.i++
      const n = r.num() + 1
      for (let k = 0; k < n; k++, p++) {
        if (c === '#') {
          fwd[codeAt(p)] = ++prev
        } else if (c === '$') {
          const v = (base as Int32Array)[xf(codeAt(p))] ?? -1
          fwd[codeAt(p)] = v
          if (v >= 0) {
            prev = v
          }
        }
      }
    } else {
      prev += unzigzag(r.num())
      fwd[codeAt(p++)] = prev
    }
  }
  if (p !== npos) {
    throw new Error(`Corrupt charset table '${codec}'`)
  }
  forwardCache.set(codec, fwd)
  return fwd
}

/**
 * Reverse table: Unicode code point → code (the one Python's encoder
 * produces: the smallest code, unless listed in the table's exceptions; -1 if
 * Python cannot encode it). Built lazily.
 *
 * @param codec - Codec name
 *
 * @returns The reverse table, or `null` if not available
 */
export const reverseTable = (codec: string): Map<number, number> | null => {
  let rev = reverseCache.get(codec)
  if (rev !== undefined) {
    return rev
  }
  const fwd = forwardTable(codec)
  if (fwd === null) {
    return null
  }
  rev = new Map()
  for (let code = 0; code < fwd.length; code++) {
    const u = fwd[code]
    if (u >= 0 && !rev.has(u)) {
      rev.set(u, code)
    }
  }
  const e = (specOf(codec) as TableSpec).e
  if (e !== undefined) {
    const r = new NumReader(e)
    while (!r.done) {
      const u = r.num()
      rev.set(u, r.num() - 1)
    }
  }
  reverseCache.set(codec, rev)
  return rev
}

const gbRuns = (): [Int32Array, Int32Array, Int32Array] | null => {
  if (gb18030Runs === null && gb18030Source !== null) {
    const r = new NumReader(gb18030Source)
    const idx: number[] = []
    const cps: number[] = []
    const lens: number[] = []
    let endIdx = 0
    let endCp = 0
    while (!r.done) {
      const i = endIdx + r.num()
      const c = endCp + unzigzag(r.num())
      const n = r.num() + 1
      idx.push(i)
      cps.push(c)
      lens.push(n)
      endIdx = i + n
      endCp = c + n
    }
    gb18030Runs = [
      Int32Array.from(idx),
      Int32Array.from(cps),
      Int32Array.from(lens),
    ]
  }
  return gb18030Runs
}

/** last run whose start (in `starts`) is <= v, or -1 */
const findRun = (starts: Int32Array, v: number): number => {
  let lo = 0
  let hi = starts.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid] <= v) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/**
 * GB18030 4-byte code → Unicode code point (`-1` if invalid / unmapped, `null`
 * if the GB18030 ranges are not registered).
 *
 * @param code - 4-byte code (`b0 << 24 | b1 << 16 | b2 << 8 | b3`)
 *
 * @returns Code point
 */
export const gb18030Decode4 = (code: number): number | null => {
  const runs = gbRuns()
  if (runs === null) {
    return null
  }
  const b0 = Math.floor(code / 0x1000000) & 0xff
  const b1 = (code >> 16) & 0xff
  const b2 = (code >> 8) & 0xff
  const b3 = code & 0xff
  if (
    b0 < 0x81 ||
    b0 > 0xfe ||
    b1 < 0x30 ||
    b1 > 0x39 ||
    b2 < 0x81 ||
    b2 > 0xfe ||
    b3 < 0x30 ||
    b3 > 0x39
  ) {
    return -1
  }
  const index =
    (((b0 - 0x81) * 10 + (b1 - 0x30)) * 126 + (b2 - 0x81)) * 10 + (b3 - 0x30)
  const k = findRun(runs[0], index)
  if (k < 0 || index >= runs[0][k] + runs[2][k]) {
    return -1
  }
  return runs[1][k] + index - runs[0][k]
}

/**
 * Unicode code point → GB18030 4-byte code (`-1` if none, `null` if the
 * GB18030 ranges are not registered).
 *
 * @param u - Code point
 *
 * @returns 4-byte code
 */
export const gb18030Encode4 = (u: number): number | null => {
  const runs = gbRuns()
  if (runs === null) {
    return null
  }
  const k = findRun(runs[1], u)
  if (k < 0 || u >= runs[1][k] + runs[2][k]) {
    return -1
  }
  let index = runs[0][k] + u - runs[1][k]
  const b3 = index % 10
  index = Math.floor(index / 10)
  const b2 = index % 126
  index = Math.floor(index / 126)
  const b1 = index % 10
  const b0 = Math.floor(index / 10)
  return (
    (0x81 + b0) * 0x1000000 +
    ((0x30 + b1) << 16) +
    ((0x81 + b2) << 8) +
    0x30 +
    b3
  )
}
