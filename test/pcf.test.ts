/**
 * PCF reader / writer tests.
 *
 * The writer must be byte-identical to `bdftopcf` (X.Org bdftopcf 1.1). When
 * the `bdftopcf` binary is available it is run directly (and the committed
 * golden files are checked to be up to date); otherwise the tests compare
 * against the golden files in `test/fixtures/pcf/` (gzip-compressed PCF files
 * and a SHA-256 manifest for the seeded random fonts), all produced by
 * `bdftopcf`. Regenerate them with:
 *
 *   UPDATE_PCF_GOLDENS=1 npx vitest run test/pcf.test.ts
 *
 * and check the golden-only mode (as on CI without bdftopcf) with:
 *
 *   PCF_NO_BDFTOPCF=1 npx vitest run test/pcf.test.ts
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import readlineiter from 'readlineiter'
import { afterAll, describe, expect, test } from 'vitest'
import { Font } from '../src/index'
import {
  readPcf,
  readPcfAsync,
  writePcf,
  type PcfWriteOptions,
} from '../src/pcf'
import type { GlyphMetaInFont } from '../src/types'

/* ------------------------------------------------------------------------ */
/* Environment                                                              */
/* ------------------------------------------------------------------------ */

const FONTS = 'test/fonts'
const GOLDEN = 'test/fixtures/pcf'
const MANIFEST = join(GOLDEN, 'bdftopcf-sha256.json')
const UPDATE = process.env.UPDATE_PCF_GOLDENS === '1'
// PCF_NO_BDFTOPCF=1 simulates a system without bdftopcf (golden files only)
const HAVE_BDFTOPCF =
  process.env.PCF_NO_BDFTOPCF !== '1' &&
  spawnSync('bdftopcf', ['-v']).status === 0
const HAVE_FCQUERY = spawnSync('fc-query', ['--version']).status === 0
const TMP = mkdtempSync(join(tmpdir(), 'bdfparser-pcf-'))
const manifest: Record<string, string> = existsSync(MANIFEST)
  ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, string>)
  : {}
const newManifest: Record<string, string> = {}

afterAll(() => {
  if (UPDATE && HAVE_BDFTOPCF && Object.keys(newManifest).length > 0) {
    mkdirSync(GOLDEN, { recursive: true })
    const sorted = Object.fromEntries(
      Object.entries({ ...manifest, ...newManifest }).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0
      )
    )
    writeFileSync(MANIFEST, JSON.stringify(sorted, null, 1) + '\n')
  }
  rmSync(TMP, { recursive: true, force: true })
})

let tmpCounter = 0

/** run bdftopcf on BDF text */
const runBdftopcf = (bdf: string, flags: string[] = []): Uint8Array => {
  const n = tmpCounter++
  const inp = join(TMP, `in${n}.bdf`)
  const out = join(TMP, `out${n}.pcf`)
  writeFileSync(inp, bdf, 'latin1')
  const r = spawnSync('bdftopcf', [...flags, '-o', out, inp])
  if (r.status !== 0) {
    throw new Error(`bdftopcf failed: ${r.stderr.toString()}`)
  }
  const b = new Uint8Array(readFileSync(out))
  rmSync(inp)
  rmSync(out)
  return b
}

/**
 * Golden-file key suffix for bdftopcf flags. `-l`/`-L` and `-m`/`-M` differ
 * only in case, so they are spelled out to keep file names unique on
 * case-insensitive file systems (macOS, Windows).
 */
const FLAG_NAMES: Record<string, string> = {
  '-l': '-lsbbit',
  '-m': '-msbbit',
  '-L': '-lsbbyte',
  '-M': '-msbbyte',
}
const flagsKey = (flags: string[]): string =>
  flags.map((f) => FLAG_NAMES[f] ?? f).join('')

const sha256 = (b: Uint8Array): string =>
  createHash('sha256').update(b).digest('hex')

/**
 * The `bdftopcf` output for a BDF text: from the binary if installed (also
 * checking the committed golden), else from the committed golden file.
 */
const refPcf = (key: string, bdf: string, flags: string[] = []): Uint8Array => {
  const golden = join(GOLDEN, `${key}.pcf.gz`)
  if (HAVE_BDFTOPCF) {
    const out = runBdftopcf(bdf, flags)
    if (UPDATE) {
      mkdirSync(GOLDEN, { recursive: true })
      writeFileSync(golden, gzipSync(out, { level: 9 }))
    } else if (existsSync(golden)) {
      expectBytes(new Uint8Array(gunzipSync(readFileSync(golden))), out)
    }
    return out
  }
  if (!existsSync(golden)) {
    throw new Error(
      `Missing golden file ${golden} (needs bdftopcf + UPDATE_PCF_GOLDENS=1)`
    )
  }
  return new Uint8Array(gunzipSync(readFileSync(golden)))
}

/** SHA-256 of the `bdftopcf` output (binary if installed, else manifest) */
const refHash = (key: string, bdf: string, flags: string[]): string => {
  if (HAVE_BDFTOPCF) {
    const h = sha256(runBdftopcf(bdf, flags))
    newManifest[key] = h
    if (!UPDATE && manifest[key] !== undefined) {
      expect(manifest[key], `stale manifest entry ${key}`).toBe(h)
    }
    return h
  }
  const h = manifest[key]
  if (h === undefined) {
    throw new Error(`Missing manifest entry ${key}`)
  }
  return h
}

/** byte equality with a useful failure message */
const expectBytes = (actual: Uint8Array, expected: Uint8Array): void => {
  let first = -1
  const n = Math.max(actual.length, expected.length)
  for (let i = 0; i < n; i++) {
    if (actual[i] !== expected[i]) {
      first = i
      break
    }
  }
  expect({ length: actual.length, firstDifference: first }).toEqual({
    length: expected.length,
    firstDifference: -1,
  })
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

const loadPath = (path: string): Promise<Font> =>
  new Font().load_filelines(readlineiter(path))

const loadText = (text: string): Promise<Font> =>
  new Font().load_filelines(
    (async function* () {
      yield* text.split('\n')
    })()
  )

/**
 * Make a BDF text acceptable to bdftopcf without changing its meaning for
 * bdfparser: trim lines, drop blank lines, final newline, and add the
 * FONT_ASCENT / FONT_DESCENT properties writePcf would assume.
 */
const bdftopcfInput = (text: string): string => {
  let lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  // bdfparser ignores junk before STARTFONT, unknown header keywords and
  // junk lines between the properties, CHARS and the glyphs
  lines = lines.slice(lines.findIndex((l) => l.startsWith('STARTFONT')))
  const HEADER =
    /^(STARTFONT|FONT|SIZE|FONTBOUNDINGBOX|COMMENT|CONTENTVERSION|METRICSSET|SWIDTH1?|DWIDTH1?|VVECTOR|STARTPROPERTIES)(\s|$)/
  const props = lines.findIndex((l) => l.startsWith('STARTPROPERTIES'))
  const endProps = lines.findIndex((l) => l === 'ENDPROPERTIES')
  const chars = lines.findIndex((l) => l.startsWith('CHARS '))
  let inGlyph = false
  lines = lines.filter((l, i) => {
    if (i < props) {
      return HEADER.test(l)
    }
    if (i <= endProps) {
      return true
    }
    if (i < chars) {
      return false
    }
    if (l.startsWith('STARTCHAR')) {
      inGlyph = true
    }
    const keep = inGlyph || l.startsWith('CHARS ') || l === 'ENDFONT'
    if (l === 'ENDCHAR') {
      inGlyph = false
    }
    return keep
  })
  const fbb = (lines.find((l) => l.startsWith('FONTBOUNDINGBOX ')) as string)
    .split(/\s+/)
    .map(Number)
  const add: string[] = []
  if (!lines.some((l) => /^FONT_ASCENT\s/.test(l))) {
    add.push(`FONT_ASCENT ${fbb[2] + fbb[4]}`)
  }
  if (!lines.some((l) => /^FONT_DESCENT\s/.test(l))) {
    add.push(`FONT_DESCENT ${-fbb[4]}`)
  }
  if (add.length) {
    const i = lines.findIndex((l) => l.startsWith('STARTPROPERTIES'))
    const n = parseInt(lines[i].split(/\s+/)[1], 10)
    lines.splice(i, 1, `STARTPROPERTIES ${n + add.length}`, ...add)
  }
  return lines.join('\n') + '\n'
}

type Model = {
  headers: unknown
  props: unknown
  propnames: [string, string][]
  glyphs: [number, GlyphMetaInFont][]
  unencoded: unknown
}
const model = (f: Font): Model => ({
  headers: { ...f.headers },
  props: { ...f.props },
  propnames: [...f._propnames],
  glyphs: [...f.glyphs],
  unencoded: f.unencoded,
})
/** model without bitmaps */
const metricsModel = (f: Font): unknown => ({
  ...model(f),
  glyphs: [...f.glyphs].map(([cp, m]) => [cp, m.slice(0, 16)]),
  unencoded: f.unencoded.map((u) => u.meta.slice(0, 16)),
})

/** ink pixels of a glyph, relative to the origin, bdftopcf hex semantics */
const inkPixels = (meta: GlyphMetaInFont): string[] => {
  const [, , bw, bh, bx, by] = meta
  const out: string[] = []
  for (let r = 0; r < bh; r++) {
    let row = (meta[16][r] ?? '').trim()
    if (row.length % 2) {
      row += '0'
    }
    for (let c = 0; c < bw; c++) {
      const byte = c >> 3
      if (byte * 2 + 2 > row.length) {
        break
      }
      if (parseInt(row.slice(byte * 2, byte * 2 + 2), 16) & (0x80 >> (c & 7))) {
        out.push(`${bx + c},${by + bh - 1 - r}`)
      }
    }
  }
  return out.sort()
}

const firstToken = (name: string): string => {
  const t = name.replace(/^[ \t\n\v\f\r]+/, '').split(/[ \t\n\v\f\r]/)[0]
  const b = new TextEncoder().encode(t)
  return b.length > 99 ? new TextDecoder().decode(b.slice(0, 99)) : t
}

const isInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v)

/**
 * Check that `r` (= readPcf(writePcf(f)) or readPcf(bdftopcf(f))) faithfully
 * represents the BDF font `f` (§6 reconstruction + bdftopcf semantics).
 */
const expectReconstructs = (f: Font, r: Font): void => {
  const h = f.headers
  // glyph order / codepoints / names / metrics / pixels
  type E = { enc: number; meta: GlyphMetaInFont }
  const all: E[] = [
    ...[...f.glyphs].map(([cp, meta]) => ({ enc: cp, meta })),
    ...f.unencoded.map((u) => ({
      enc: u.altcode !== null && u.altcode >= 0 ? u.altcode : -1,
      meta: u.meta,
    })),
  ]
  const inRange = (e: E): boolean => e.enc >= 0 && e.enc <= 0xffff
  const lastIndexOf = new Map<number, number>()
  all.forEach((e, i) => {
    if (inRange(e)) {
      lastIndexOf.set(e.enc, i)
    }
  })
  const encoded = all.filter(
    (e, i) => inRange(e) && lastIndexOf.get(e.enc) === i
  )
  const unenc = all.filter((e) => !inRange(e))
  const rEnc = [...r.glyphs]
  expect(rEnc.map(([cp]) => cp)).toEqual(encoded.map((e) => e.enc))
  expect(r.unencoded.length).toBe(unenc.length)
  const rAll: GlyphMetaInFont[] = [
    ...rEnc.map(([, m]) => m),
    ...r.unencoded.map((u) => u.meta),
  ]
  const fAll = [...encoded, ...unenc].map((e) => e.meta)
  const box = (m: GlyphMetaInFont): string => `${m[2]},${m[3]},${m[4]},${m[5]}`
  const terminal =
    rAll.length > 0 &&
    rAll.every((m) => box(m) === box(rAll[0]) && m[4] === 0) &&
    !fAll.every((m) => box(m) === box(rAll[0]))
  for (let i = 0; i < rAll.length; i++) {
    const fm = fAll[i]
    const rm = rAll[i]
    const dwx = fm[8] ?? h.dwx0 ?? Math.max(0, fm[4] + fm[2])
    expect(rm[0]).toBe(firstToken(fm[0]))
    expect(rm[6]).toBe(fm[6] ?? h.swx0 ?? f.swidth(dwx))
    expect([rm[7], rm[9]]).toEqual([0, 0])
    expect(rm.slice(10, 16)).toEqual([null, null, null, null, null, null])
    expect(rm[16].length).toBe(rm[2] === 0 ? 0 : rm[3])
    let expected = inkPixels(fm)
    if (terminal) {
      const [, , w, hh, , yo] = rAll[0]
      expected = expected.filter((p) => {
        const [x, y] = p.split(',').map(Number)
        return x >= 0 && x < w && y >= yo && y < yo + hh
      })
    } else {
      expect(rm.slice(2, 6)).toEqual(fm.slice(2, 6))
      expect(rm[8]).toBe(dwx)
    }
    expect(inkPixels(rm)).toEqual(expected)
  }
  // FONTBOUNDINGBOX = bounds of all glyphs
  let lsb = 32767
  let rsb = -32768
  let asc = -32768
  let desc = -32768
  for (const m of rAll) {
    const met = [m[4], m[4] + m[2], m[8] ?? 0, m[3] + m[5], -m[5]]
    if (met.some((v) => v !== 0)) {
      lsb = Math.min(lsb, met[0])
      rsb = Math.max(rsb, met[1])
      asc = Math.max(asc, met[3])
      desc = Math.max(desc, met[4])
    }
  }
  if (lsb !== 32767) {
    expect([r.headers.fbbx, r.headers.fbby, r.headers.fbbxoff]).toEqual([
      rsb - lsb,
      asc + desc,
      lsb,
    ])
    expect(r.headers.fbbyoff).toBe(-desc)
  }
  // properties
  let ascent: number | null = null
  let descent: number | null = null
  for (const [k, v] of Object.entries(f.props)) {
    if (k === 'comment' || v === null || Array.isArray(v)) {
      continue
    }
    const name = f._propnames.get(k) ?? k.toUpperCase()
    if (name.startsWith('COMMENT')) {
      continue
    }
    if (name === 'FONT_ASCENT' || name === 'FONT_DESCENT') {
      if (isInt(v)) {
        if (name === 'FONT_ASCENT') {
          ascent = v
        } else {
          descent = v
        }
      }
      continue
    }
    if (name === 'DEFAULT_CHAR') {
      if (isInt(v) && (v & 0xffff) !== 0 && (v & 0xffff) !== 0xffff) {
        expect(r.props.default_char).toBe(v & 0xffff)
      } else {
        expect(r.props.default_char).toBeUndefined()
      }
      continue
    }
    if (
      (name === 'X_HEIGHT' || name === 'QUAD_WIDTH' || name === 'WEIGHT') &&
      v === -1
    ) {
      expect(isInt(r.props[k])).toBe(true)
      continue
    }
    expect(r.props[k]).toEqual(isInt(v) ? v : String(v))
    expect(r._propnames.get(k)).toBe(name)
  }
  expect(r.props.font_ascent).toBe(ascent ?? h.fbby + h.fbbyoff)
  expect(r.props.font_descent).toBe(descent ?? -h.fbbyoff)
  if (!('font' in f.props)) {
    expect(r.props.font).toBe(h.fontname)
  }
  expect(r.headers.fontname).toBe(
    typeof r.props.font === 'string' ? r.props.font : ''
  )
  for (const k of ['point_size', 'weight', 'x_height', 'quad_width']) {
    expect(isInt(r.props[k])).toBe(true)
  }
  expect(r.headers.xres).toBe(r.props.resolution_x)
  expect(r.headers.yres).toBe(r.props.resolution_y)
  expect(r.headers.pointsize).toBe(
    Math.floor((r.props.point_size as number) / 10 + 0.5)
  )
  expect(r.headers.bdfversion).toBe(2.1)
  expect(r.headers.metricsset).toBe(0)
}

/** writePcf's glyph order survives readPcf (encoded first, no collisions) */
const keepsGlyphOrder = (f: Font): boolean => {
  const encs = [
    ...f.glyphs.keys(),
    ...f.unencoded.map((u) =>
      u.altcode !== null && u.altcode >= 0 ? u.altcode : -1
    ),
  ]
  const enc = encs.map((e) => e >= 0 && e <= 0xffff)
  const firstUnenc = enc.indexOf(false)
  const inRange = encs.filter((e) => e >= 0 && e <= 0xffff)
  return (
    (firstUnenc < 0 || enc.slice(firstUnenc).every((x) => !x)) &&
    new Set(inRange).size === inRange.length
  )
}

/** TOC of a PCF file */
const toc = (
  b: Uint8Array
): { type: number; format: number; size: number; offset: number }[] => {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const n = dv.getUint32(4, true)
  return Array.from({ length: n }, (_, i) => ({
    type: dv.getUint32(8 + i * 16, true),
    format: dv.getUint32(12 + i * 16, true),
    size: dv.getUint32(16 + i * 16, true),
    offset: dv.getUint32(20 + i * 16, true),
  }))
}
const T = {
  PROPERTIES: 1,
  ACCELERATORS: 2,
  METRICS: 4,
  BITMAPS: 8,
  INK_METRICS: 16,
  BDF_ENCODINGS: 32,
  SWIDTHS: 64,
  GLYPH_NAMES: 128,
  BDF_ACCELERATORS: 256,
}
const tableOffset = (b: Uint8Array, type: number): number =>
  (toc(b).find((t) => t.type === type) as { offset: number }).offset
/** hide tables by renaming their TOC type to an unknown one */
const dropTables = (b: Uint8Array, types: number[]): Uint8Array => {
  const c = b.slice()
  const dv = new DataView(c.buffer)
  toc(c).forEach((t, i) => {
    if (types.includes(t.type)) {
      dv.setUint32(8 + i * 16, 0x40000000 | t.type, true)
    }
  })
  return c
}
const hasInk = (b: Uint8Array): boolean =>
  ((toc(b).find((t) => t.type === T.ACCELERATORS)?.format ?? 0) & 0x100) !== 0

/** bdftopcf flags -> equivalent writePcf options (`null` for -p8) */
const FLAG_SETS: [string[], PcfWriteOptions | null][] = [
  [['-p1'], { glyphpad: 1 }],
  [['-p2'], { glyphpad: 2 }],
  [['-p8'], null],
  [['-u2'], { scanunit: 2 }],
  [['-u4'], { scanunit: 4 }],
  [['-l'], { bitorder: 'lsb' }],
  [['-L'], { byteorder: 'lsb' }],
  [['-m'], { bitorder: 'msb' }],
  [['-M'], { byteorder: 'msb' }],
  [['-t'], {}],
  [['-i'], {}],
  [['-l', '-u2'], { bitorder: 'lsb', scanunit: 2 }],
  [['-L', '-u4'], { byteorder: 'lsb', scanunit: 4 }],
  [['-l', '-L', '-p1'], { bitorder: 'lsb', byteorder: 'lsb', glyphpad: 1 }],
  [['-l', '-u4'], { bitorder: 'lsb', scanunit: 4 }],
  [['-L', '-p2', '-u2'], { byteorder: 'lsb', glyphpad: 2, scanunit: 2 }],
  [['-l', '-L', '-u4', '-p8'], null],
]
/** bdftopcf computes terminal padding / ink metrics on byte-swapped data */
const swapped = (o: PcfWriteOptions): boolean =>
  (o.bitorder ?? 'msb') !== (o.byteorder ?? 'msb') && (o.scanunit ?? 1) > 1

/* ------------------------------------------------------------------------ */
/* Seeded random BDF fonts                                                  */
/* ------------------------------------------------------------------------ */

const mulberry32 = (seed: number): (() => number) => {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A random BDF font (encoded glyphs first, then ENCODING -1 glyphs, unique
 * codepoints) that both bdftopcf and bdfparser accept. Modes: proportional
 * ('free', with large metrics 20% of the time => uncompressed metrics),
 * character cell ('cell' => terminal padding + ink metrics), identical
 * glyph boxes ('uniform' => constant metrics + ink metrics).
 */
const randomBdf = (seed: number): string => {
  const rnd = mulberry32(seed)
  const ri = (a: number, b: number): number =>
    a + Math.floor(rnd() * (b - a + 1))
  const pick = <V>(a: V[]): V => a[Math.floor(rnd() * a.length)]
  const mode = pick(['free', 'cell', 'uniform', 'cell'])
  const asc = ri(0, 14)
  const desc = ri(0, 5)
  const cellW = ri(1, 20)
  const xres = pick([75, 100, 72, 96])
  const yres = rnd() < 0.8 ? xres : pick([75, 100])
  const L: string[] = [
    'STARTFONT 2.1',
    `FONT -Test-Font-${seed}`,
    `SIZE ${pick([16, 12, 9, 1, 30])} ${xres} ${yres}`,
    `FONTBOUNDINGBOX ${cellW} ${asc + desc} 0 ${-desc}`,
  ]
  const props: string[] = [`FONT_ASCENT ${asc}`, `FONT_DESCENT ${desc}`]
  if (rnd() < 0.5) props.push(`POINT_SIZE ${ri(10, 300)}`)
  if (rnd() < 0.3) props.push('FONT "-explicit-font-prop"')
  if (rnd() < 0.3) props.push(`X_HEIGHT ${pick([-1, 5, 7])}`)
  if (rnd() < 0.3) props.push(`QUAD_WIDTH ${pick([-1, 9])}`)
  if (rnd() < 0.3) props.push(`WEIGHT ${pick([-1, 100])}`)
  if (rnd() < 0.3) props.push(`RESOLUTION_X ${xres}`)
  if (rnd() < 0.3) props.push(`RESOLUTION ${ri(50, 150)}`)
  if (rnd() < 0.4) props.push(`DEFAULT_CHAR ${ri(0, 300)}`)
  if (rnd() < 0.5)
    props.push('CHARSET_REGISTRY "ISO10646"', 'CHARSET_ENCODING "1"')
  if (rnd() < 0.3) props.push('COPYRIGHT "with ""quotes"" inside"')
  if (rnd() < 0.3) props.push(`MinSpace ${ri(-5, 5)}`)
  if (rnd() < 0.3) props.push('STR_NUM "123"')
  L.push(`STARTPROPERTIES ${props.length}`, ...props, 'ENDPROPERTIES')
  const n = ri(1, 24)
  const used = new Set<number>()
  const glyphs: string[][] = []
  const unenc: string[][] = []
  const big = rnd() < 0.2
  const noenc = rnd() < 0.05
  const uw = big ? ri(100, 140) : ri(0, 12)
  const uh = ri(0, 12)
  const ux = big ? ri(-140, 140) : ri(-3, 3)
  const uy = ri(-4, 3)
  const ud = big ? ri(120, 300) : ri(-2, 14)
  const names = [
    'x',
    '0',
    '1',
    '5',
    '9',
    'a',
    'space',
    'very_long_' + 'n'.repeat(120),
    'x two',
    'uni0041',
  ]
  for (let k = 0; k < n; k++) {
    let bw: number, bh: number, bx: number, by: number, dw: number
    if (mode === 'uniform') {
      ;[bw, bh, bx, by, dw] = [uw, uh, ux, uy, ud]
    } else if (mode === 'cell') {
      bw = ri(0, cellW)
      bx = ri(0, cellW - bw)
      bh = ri(0, asc + desc)
      by = ri(-desc, asc - bh)
      dw = cellW
    } else if (big) {
      bw = ri(0, 140)
      bh = ri(0, 30)
      bx = ri(-130, 130)
      by = ri(-130, 6)
      dw = rnd() < 0.1 ? -ri(1, 200) : ri(0, 300)
    } else {
      bw = ri(0, 18)
      bh = ri(0, 20)
      bx = ri(-5, 5)
      by = ri(-6, 6)
      dw = rnd() < 0.1 ? -ri(1, 10) : ri(0, 20)
    }
    let encLine: string
    let unencoded = false
    const r = rnd()
    if (noenc || r < 0.1) {
      encLine = 'ENCODING -1'
      unencoded = true
    } else if (r < 0.15) {
      let c: number
      do {
        c = ri(0, 70000)
      } while (used.has(c))
      used.add(c)
      encLine = `ENCODING -1 ${c}`
      unencoded = true
    } else {
      let c: number
      do {
        c =
          rnd() < 0.1
            ? ri(0x10000, 0x10ffff)
            : rnd() < 0.5
              ? ri(0, 255)
              : ri(0, 0xffff)
      } while (used.has(c))
      used.add(c)
      encLine = `ENCODING ${c}`
    }
    const name = rnd() < 0.4 ? pick(names) : `g${k}`
    const G = [
      `STARTCHAR ${name}`,
      encLine,
      `SWIDTH ${ri(-100, 1000)} 0`,
      `DWIDTH ${dw} 0`,
      `BBX ${bw} ${bh} ${bx} ${by}`,
      'BITMAP',
    ]
    const bpr = Math.ceil(bw / 8)
    const style = rnd()
    for (let y = 0; y < bh; y++) {
      const len =
        style < 0.7
          ? bpr
          : style < 0.85
            ? bpr + ri(0, 2)
            : Math.max(0, bpr - ri(0, 1))
      let s = ''
      for (let i = 0; i < len; i++) {
        s += ri(0, 255).toString(16).padStart(2, '0')
      }
      if (style > 0.95 && s.length) {
        s = s.slice(0, -1)
      }
      s = rnd() < 0.2 ? s.toLowerCase() : s.toUpperCase()
      G.push(s === '' ? '00' : s)
    }
    G.push('ENDCHAR')
    ;(unencoded ? unenc : glyphs).push(G)
  }
  const all = [...glyphs, ...unenc]
  L.push(`CHARS ${all.length}`)
  for (const g of all) {
    L.push(...g)
  }
  L.push('ENDFONT')
  return L.join('\n') + '\n'
}

/** hand-made character-cell font: terminal padding, ink metrics, clipping */
const TERMINAL_BDF = `STARTFONT 2.1
FONT -Misc-Cell-Medium-R-Normal--10-100-75-75-C-60-ISO10646-1
SIZE 10 75 75
FONTBOUNDINGBOX 6 10 0 -2
STARTPROPERTIES 5
FONT_ASCENT 8
FONT_DESCENT 2
DEFAULT_CHAR 65
CHARSET_REGISTRY "ISO10646"
CHARSET_ENCODING "1"
ENDPROPERTIES
CHARS 7
STARTCHAR A
ENCODING 65
SWIDTH 600 0
DWIDTH 6 0
BBX 5 7 0 0
BITMAP
20
50
88
F8
88
88
88
ENDCHAR
STARTCHAR x
ENCODING 120
SWIDTH 600 0
DWIDTH 6 0
BBX 5 5 0 0
BITMAP
88
50
20
50
88
ENDCHAR
STARTCHAR 1
ENCODING 49
SWIDTH 600 0
DWIDTH 6 0
BBX 3 7 1 0
BITMAP
40
C0
40
40
40
40
E0
ENDCHAR
STARTCHAR g
ENCODING 103
SWIDTH 600 0
DWIDTH 6 0
BBX 4 6 1 -2
BITMAP
70
90
90
70
10
E0
ENDCHAR
STARTCHAR space
ENCODING 32
SWIDTH 600 0
DWIDTH 6 0
BBX 0 0 0 0
BITMAP
ENDCHAR
STARTCHAR U+1F600
ENCODING 128512
SWIDTH 600 0
DWIDTH 6 0
BBX 6 6 0 0
BITMAP
78
84
A4
84
B4
78
ENDCHAR
STARTCHAR wide
ENCODING -1
SWIDTH 1000 0
DWIDTH 10 0
BBX 10 12 -2 -3
BITMAP
FFC0
8040
8040
8040
8040
8040
8040
8040
8040
8040
8040
FFC0
ENDCHAR
ENDFONT
`

/* ------------------------------------------------------------------------ */
/* Tests                                                                    */
/* ------------------------------------------------------------------------ */

const TEST_FONTS = [
  'spec_example_fixed',
  'unifont-13.0.04-2atest',
  'unifont-13.0.04-enctest-big5',
  'unifont-13.0.04-enctest-cp1250',
  'unifont-13.0.04-enctest-cp1251',
  'unifont-13.0.04-enctest-cp1252',
  'unifont-13.0.04-enctest-euckr',
  'unifont-13.0.04-enctest-gb2312',
  'unifont-13.0.04-enctest-iso10646',
  'unifont-13.0.04-enctest-iso2022cn',
  'unifont-13.0.04-enctest-shiftjis',
  'unifont-13.0.04-enctest-unicode',
  'unifont-13.0.04-enctest-utf8',
  'unifont-13.0.04-for-test',
  'unifont-13.0.04-for-test-emptylines',
  'unifont-13.0.04-reduced',
  'HanWangYanKai-26',
  'unifont-13.0.04',
]

describe('writePcf is byte-identical to bdftopcf (test fonts)', () => {
  test.each(TEST_FONTS)(
    '%s',
    async (name) => {
      const path = `${FONTS}/${name}.bdf`
      const font = await loadPath(path)
      const ref = refPcf(name, bdftopcfInput(readFileSync(path, 'latin1')))
      expectBytes(writePcf(font), ref)
      // and through the Font method
      expectBytes(font.topcf(), ref)
      // readPcf(bdftopcf(F)) reconstructs F
      const r = readPcf(ref)
      expectReconstructs(font, r)
      // PCF -> model -> PCF is byte-identical
      expectBytes(writePcf(r), ref)
    },
    180000
  )
})

describe('bdftopcf flag variants', () => {
  const cases: [string, () => Promise<Font>, string][] = [
    [
      'unifont-13.0.04-for-test',
      () => loadPath(`${FONTS}/unifont-13.0.04-for-test.bdf`),
      bdftopcfInput(
        readFileSync(`${FONTS}/unifont-13.0.04-for-test.bdf`, 'latin1')
      ),
    ],
    ['terminal', () => loadText(TERMINAL_BDF), TERMINAL_BDF],
  ]
  for (const [name, load, bdf] of cases) {
    describe(name, () => {
      test.each(FLAG_SETS.map(([f, o]) => [f.join(' '), f, o] as const))(
        'bdftopcf %s',
        async (_label, flags, opts) => {
          const font = await load()
          const base = readPcf(refPcf(name, bdf))
          const ref = refPcf(`${name}${flagsKey(flags)}`, bdf, flags)
          const r = readPcf(ref)
          if (opts === null) {
            // bdftopcf -p8 is broken (PCF_SIZE_TO_INDEX(8) == 0): the file
            // says pad 1 but holds the first bytes of 8-padded rows.
            expect(toc(ref)[3].format & 3).toBe(0)
            expect(metricsModel(r)).toEqual(metricsModel(base))
            return
          }
          const bug = swapped(opts) && hasInk(ref)
          if (!bug) {
            expect(model(r)).toEqual(model(base))
            expectBytes(writePcf(font, opts), ref)
          }
          // our output is always correct, whatever bdftopcf does
          expect(model(readPcf(writePcf(font, opts)))).toEqual(model(base))
        }
      )
    })
  }

  test('the terminal font exercises terminal padding and ink metrics', async () => {
    const font = await loadText(TERMINAL_BDF)
    const p = writePcf(font)
    expect(hasInk(p)).toBe(true)
    const types = toc(p).map((t) => t.type)
    expect(types).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256])
    const r = readPcf(p)
    // every glyph padded to the 6x10 cell; the wide unencoded glyph clipped
    for (const m of [...r.glyphs.values(), ...r.unencoded.map((u) => u.meta)]) {
      expect(m.slice(2, 6)).toEqual([6, 10, 0, -2])
      expect(m[8]).toBe(6)
    }
    expect([...r.glyphs.keys()]).toEqual([65, 120, 49, 103, 32])
    expect(r.unencoded.map((u) => u.meta[0])).toEqual(['U+1F600', 'wide'])
    expect(r.props.default_char).toBe(65)
    expect(r.props.x_height).toBe(5)
    expect(r.props.quad_width).toBe(6)
    expect(r.props.weight).toBe(10)
    expect(r.props.resolution).toBe(103)
    expect(r.props.point_size).toBe(100)
    expect(r.headers.fontname).toBe(font.headers.fontname)
    expectReconstructs(font, r)
    // bdftopcf -p8 output is readable (bitmaps are garbage by its bug)
    expect(() =>
      readPcf(refPcf('terminal-p8', TERMINAL_BDF, ['-p8']))
    ).not.toThrow()
  })
})

describe('writePcf options', () => {
  const OPTS: PcfWriteOptions[] = [
    {},
    { glyphpad: 1 },
    { glyphpad: 2 },
    { glyphpad: 8 },
    { scanunit: 2 },
    { scanunit: 4 },
    { bitorder: 'lsb' },
    { byteorder: 'lsb' },
    { bitorder: 'lsb', byteorder: 'lsb', glyphpad: 1 },
    { bitorder: 'lsb', scanunit: 2, glyphpad: 2 },
    { byteorder: 'lsb', scanunit: 4, glyphpad: 8 },
    { bitorder: 'lsb', byteorder: 'lsb', scanunit: 4, glyphpad: 4 },
  ]
  test.each(OPTS.map((o) => [JSON.stringify(o), o] as const))(
    'round trip %s',
    async (_label, o) => {
      for (const font of [
        await loadPath(`${FONTS}/unifont-13.0.04-for-test.bdf`),
        await loadText(TERMINAL_BDF),
        await loadPath(`${FONTS}/spec_example_fixed.bdf`),
      ]) {
        const base = readPcf(writePcf(font))
        const p = writePcf(font, o)
        const f = toc(p)[0].format
        expect(f & 3).toBe([1, 2, 4, 8].indexOf(o.glyphpad ?? 4))
        expect((f >> 4) & 3).toBe([1, 2, 4].indexOf(o.scanunit ?? 1))
        expect((f & 8) !== 0).toBe((o.bitorder ?? 'msb') === 'msb')
        expect((f & 4) !== 0).toBe((o.byteorder ?? 'msb') === 'msb')
        expect(model(readPcf(p))).toEqual(model(base))
        // other readers' view: fixed point
        expectBytes(
          writePcf(readPcf(p), o),
          writePcf(readPcf(writePcf(base, o)), o)
        )
      }
    }
  )

  test('invalid options', async () => {
    const font = await loadText(TERMINAL_BDF)
    const bad: unknown[] = [
      { byteorder: 'big' },
      { bitorder: 'x' },
      { glyphpad: 3 },
      { scanunit: 8 },
      { bitorder: 'lsb', glyphpad: 1, scanunit: 2 },
      { byteorder: 'lsb', glyphpad: 2, scanunit: 4 },
    ]
    for (const o of bad) {
      expect(() => writePcf(font, o as PcfWriteOptions)).toThrow(RangeError)
    }
    // bit order == byte order: any scan unit is fine
    expect(() =>
      writePcf(font, {
        bitorder: 'lsb',
        byteorder: 'lsb',
        glyphpad: 1,
        scanunit: 4,
      })
    ).not.toThrow()
  })
})

describe('writePcf edge cases', () => {
  const base = async (): Promise<Font> => loadText(TERMINAL_BDF)

  test('font not loaded', () => {
    expect(() => writePcf(new Font())).toThrow(/not loaded/)
  })

  test('fallbacks for missing FONT_ASCENT/FONT_DESCENT, DWIDTH, SWIDTH', async () => {
    const font = await loadPath(`${FONTS}/spec_example_fixed.bdf`)
    const r0 = readPcf(writePcf(font))
    expect(r0.props.font_ascent).toBe(18)
    expect(r0.props.font_descent).toBe(6)
    const j = font.glyphs.get(106) as GlyphMetaInFont
    j[8] = null
    j[6] = null
    let r = readPcf(writePcf(font))
    expect(r.glyphs.get(106)?.[8]).toBe(7) // max(0, bbxoff + bbw)
    expect(r.glyphs.get(106)?.[6]).toBe(font.swidth(7))
    font.headers.dwx0 = 9
    font.headers.swx0 = 123
    r = readPcf(writePcf(font))
    expect(r.glyphs.get(106)?.[8]).toBe(9)
    expect(r.glyphs.get(106)?.[6]).toBe(123)
    // header values that are not usable integers
    font.headers.xres = 0
    font.headers.yres = 0.5
    r = readPcf(writePcf(font))
    expect([r.props.resolution_x, r.props.resolution_y]).toEqual([75, 75])
    expect(r.props.resolution).toBe(103)
  })

  test('property handling', async () => {
    const font = await base()
    font.setprop('NOTHING', null)
    font.setprop('COMMENT_LIKE', 'dropped by bdftopcf')
    font.setprop('Fraction', 1.5)
    font.setprop('Big', 2 ** 32 + 5)
    font.setprop('Utf8', 'Grüße 漢字')
    font.setprop('DEFAULT_CHAR', '65')
    font.setprop('X_HEIGHT', '-1')
    font.setprop('FONT', 7)
    font.props.comment = ['a comment']
    const r = readPcf(writePcf(font))
    expect('nothing' in r.props).toBe(false)
    expect('comment_like' in r.props).toBe(false)
    expect('comment' in r.props).toBe(false)
    expect(r.props.fraction).toBe('1.5')
    expect(r.props.big).toBe(5)
    expect(r.props.utf8).toBe('Grüße 漢字')
    expect(r._propnames.get('fraction')).toBe('Fraction')
    expect(r.props.default_char).toBeUndefined() // string DEFAULT_CHAR is ignored
    expect(r.props.x_height).toBe('-1')
    expect(r.props.font).toBe(7) // an integer FONT is not the font name
    expect(r.headers.fontname).toBe('')
    font.setprop('FONT', 'from-prop')
    const r2 = readPcf(writePcf(font))
    expect(r2.props.font).toBe('from-prop')
    expect(r2.headers.fontname).toBe('from-prop')
  })

  test('glyph names: first token, max 99 bytes', async () => {
    const font = await base()
    ;(font.glyphs.get(65) as GlyphMetaInFont)[0] = '  two words'
    ;(font.glyphs.get(120) as GlyphMetaInFont)[0] = 'é'.repeat(60)
    ;(font.glyphs.get(49) as GlyphMetaInFont)[0] = ''
    const r = readPcf(writePcf(font))
    expect(r.glyphs.get(65)?.[0]).toBe('two')
    // 99 bytes cut inside a 2-byte UTF-8 sequence => not UTF-8 => Latin-1
    const n = r.glyphs.get(120)?.[0] as string
    expect(n.length).toBe(99)
    expect(r.glyphs.get(49)?.[0]).toBe('')
  })

  test('hex rows: missing, extra, odd, lowercase, invalid digits', async () => {
    const font = await base()
    const a = font.glyphs.get(65) as GlyphMetaInFont
    a[16] = ['2', 'ff', 'z8', '8800FF']
    const r = readPcf(writePcf(font))
    // the glyph (BBX 5 7 0 0) is padded into the 6x10 cell (ascent 8)
    expect(r.glyphs.get(65)?.[16]).toEqual([
      '00', // cell row above the glyph
      '20', // odd length: '0' appended
      'F8', // bits beyond bbw cleared
      '08', // invalid digit skipped
      '88', // extra bytes ignored
      '00', // missing rows are empty
      '00',
      '00',
      '00', // cell rows below the baseline
      '00',
    ])
  })

  test('negative or out of range metrics are rejected', async () => {
    const font = await base()
    const a = font.glyphs.get(65) as GlyphMetaInFont
    a[2] = -1
    expect(() => writePcf(font)).toThrow(RangeError)
    a[2] = 5
    a[8] = 40000
    expect(() => writePcf(font)).toThrow(/16 bits/)
    a[8] = 6
    a[5] = -32768
    expect(() => writePcf(font)).toThrow(/16 bits/)
  })

  test('codepoints > 0xFFFF, altcodes, no encoded glyph at all', async () => {
    const font = await base()
    // ENCODING -1 70000: out of range, stays unencoded (like U+1F600)
    font.unencoded[0].altcode = 70000
    let r = readPcf(writePcf(font))
    expect(r.unencoded.map((u) => u.meta[0])).toEqual(['U+1F600', 'wide'])
    // ENCODING -1 65: encoded at its altcode, 'A' loses its encoding
    font.unencoded[0].altcode = 0x41
    r = readPcf(writePcf(font))
    expect(r.glyphs.get(0x41)?.[0]).toBe('wide')
    expect(r.unencoded.map((u) => u.meta[0])).toEqual(['A', 'U+1F600'])
    // only unencoded glyphs: bdftopcf writes 256/0/256/0 and 65025 empty cells
    const g = [...font.glyphs.values()]
    font.glyphs.clear()
    font.unencoded = g.map((meta) => ({ altcode: null, meta }))
    const p = writePcf(font)
    const enc = toc(p).find((t) => t.type === T.BDF_ENCODINGS) as {
      offset: number
      size: number
    }
    expect(enc.size).toBe(((14 + 65025 * 2 + 3) >> 2) << 2)
    const dv = new DataView(p.buffer)
    expect([0, 2, 4, 6].map((o) => dv.getUint16(enc.offset + 4 + o))).toEqual([
      256, 0, 256, 0,
    ])
    r = readPcf(p)
    expect(r.glyphs.size).toBe(0)
    expect(r.unencoded.length).toBe(g.length)
    // and an empty font
    font.unencoded = []
    r = readPcf(writePcf(font))
    expect(r.glyphs.size + r.unencoded.length).toBe(0)
  })
})

describe('readPcf', () => {
  const small = async (): Promise<Uint8Array> =>
    writePcf(await loadPath(`${FONTS}/unifont-13.0.04-enctest-big5.bdf`))

  test('accepts ArrayBuffer and offset views', async () => {
    const p = await small()
    const m = model(readPcf(p))
    expect(model(readPcf(p.slice().buffer))).toEqual(m)
    const big = new Uint8Array(p.length + 13)
    big.set(p, 7)
    expect(model(readPcf(big.subarray(7, 7 + p.length)))).toEqual(m)
    expect(() => readPcf('PCF' as unknown as Uint8Array)).toThrow(TypeError)
    // ArrayBuffer / DataView from another realm (iframe, vm context)
    const foreign = runInNewContext('new ArrayBuffer(n)', {
      n: p.length,
    }) as ArrayBuffer
    new Uint8Array(foreign).set(p)
    expect(foreign instanceof ArrayBuffer).toBe(false)
    expect(model(readPcf(foreign))).toEqual(m)
    expect(
      model(readPcf(new DataView(p.slice().buffer) as unknown as Uint8Array))
    ).toEqual(m)
  })

  test('missing optional tables', async () => {
    const font = await loadText(TERMINAL_BDF.replace('"ISO10646"', '"ISO8859"'))
    const p = writePcf(font)
    const full = readPcf(p)
    // no glyph names: defaultglyphname (char{cp} for non-Unicode charsets)
    let r = readPcf(dropTables(p, [T.GLYPH_NAMES]))
    expect(r.glyphs.get(65)?.[0]).toBe('char65')
    expect(r.unencoded[0].meta[0]).toBe('glyph5')
    r = readPcf(
      dropTables(writePcf(await loadText(TERMINAL_BDF)), [T.GLYPH_NAMES])
    )
    expect(r.glyphs.get(65)?.[0]).toBe('uni0041')
    // no swidths: computed from DWIDTH
    r = readPcf(dropTables(p, [T.SWIDTHS]))
    expect(r.glyphs.get(65)?.[6]).toBe(
      Math.floor((6 * 72000) / (10 * 75) + 0.5)
    )
    // no accelerators: bounds from the metrics, no FONT_ASCENT/DESCENT added
    r = readPcf(dropTables(p, [T.ACCELERATORS]))
    expect(r.headers).toEqual(full.headers)
    r = readPcf(
      dropTables(p, [T.ACCELERATORS, T.BDF_ACCELERATORS, T.INK_METRICS])
    )
    expect(r.headers).toEqual(full.headers)
    expect(r.props.font_ascent).toBeUndefined()
    // no encodings: all glyphs unencoded, no DEFAULT_CHAR
    r = readPcf(dropTables(p, [T.BDF_ENCODINGS]))
    expect(r.glyphs.size).toBe(0)
    expect(r.unencoded.length).toBe(7)
    expect(r.props.default_char).toBeUndefined()
    // no properties: pointsize from fbby, 75 dpi, empty font name
    r = readPcf(dropTables(p, [T.PROPERTIES]))
    expect(r.headers.pointsize).toBe(r.headers.fbby)
    expect([r.headers.xres, r.headers.yres, r.headers.fontname]).toEqual([
      75,
      75,
      '',
    ])
    // PIXEL_SIZE fallback for the point size
    font.setprop('PIXEL_SIZE', 13)
    font.setprop('POINT_SIZE', 'abc')
    expect(readPcf(writePcf(font)).headers.pointsize).toBe(13)
  })

  test('uncompressed metrics and all-zero glyphs', async () => {
    const font = await loadText(TERMINAL_BDF)
    ;(font.glyphs.get(65) as GlyphMetaInFont)[8] = 300
    const p = writePcf(font)
    expect(toc(p)[2].format & 0x100).toBe(0)
    expect(readPcf(p).glyphs.get(65)?.[8]).toBe(300)
    // a font whose only glyph has all-zero metrics: FONTBOUNDINGBOX 0 0 0 0
    const z = await loadText(TERMINAL_BDF)
    z.glyphs = new Map([[32, z.glyphs.get(32) as GlyphMetaInFont]])
    ;(z.glyphs.get(32) as GlyphMetaInFont)[8] = 0
    z.unencoded = []
    const rz = readPcf(writePcf(z))
    expect([
      rz.headers.fbbx,
      rz.headers.fbby,
      rz.headers.fbbxoff,
      rz.headers.fbbyoff,
    ]).toEqual([0, 0, 0, 0])
    expect(
      readPcf(dropTables(writePcf(z), [T.ACCELERATORS, T.BDF_ACCELERATORS]))
        .headers.fbbx
    ).toBe(0)
  })

  test('non-UTF-8 strings are decoded as Latin-1', async () => {
    const font = await loadText(TERMINAL_BDF)
    ;(font.glyphs.get(65) as GlyphMetaInFont)[0] = 'AAA'
    const p = writePcf(font)
    const i = Buffer.from(p).indexOf('AAA\0')
    p[i + 1] = 0xe9
    expect(readPcf(p).glyphs.get(65)?.[0]).toBe('Aé'.concat('A'))
  })

  test('malformed input gives clear errors', async () => {
    const p = await small()
    const dv = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset)
    const mutate = (f: (b: Uint8Array) => void): Uint8Array => {
      const c = p.slice()
      f(c)
      return c
    }
    expect(() => readPcf(new Uint8Array(0))).toThrow(/Not a PCF file/)
    expect(() => readPcf(new TextEncoder().encode('STARTFONT 2.1\n'))).toThrow(
      /bad magic/
    )
    expect(() => readPcf(gzipSync(p))).toThrow(/gzip.*readPcfAsync/)
    // a truncated file either fails with a PCF error or, if only unread
    // bytes were cut (table padding, BDF_ACCELERATORS which is only read
    // without ACCELERATORS), gives the same font
    const lastTable = tableOffset(p, T.BDF_ACCELERATORS)
    const full = model(readPcf(p))
    let thrown = 0
    for (let len = 4; len < p.length; len++) {
      let f: Font
      try {
        f = readPcf(p.subarray(0, len))
      } catch (e) {
        expect((e as Error).message, `length ${len}`).toMatch(/PCF/)
        expect(e).not.toBeInstanceOf(RangeError)
        thrown++
        continue
      }
      expect(model(f), `length ${len}`).toEqual(full)
    }
    expect(thrown).toBeGreaterThan(lastTable * 0.9)
    const noAccel = dropTables(p, [T.ACCELERATORS])
    for (let len = lastTable; len < p.length; len++) {
      expect(() => readPcf(noAccel.subarray(0, len))).toThrow(/truncated/)
    }
    expect(() =>
      readPcf(mutate((c) => dv(c).setUint32(4, 5000, true)))
    ).toThrow(/table count/)
    expect(() =>
      readPcf(mutate((c) => dv(c).setUint32(20, 0xffffff00, true)))
    ).toThrow(/truncated/)
    expect(() => readPcf(dropTables(p, [T.METRICS]))).toThrow(/no METRICS/)
    expect(() => readPcf(dropTables(p, [T.BITMAPS]))).toThrow(/no BITMAPS/)
    const at = (type: number): number => tableOffset(p, type)
    expect(() =>
      readPcf(mutate((c) => dv(c).setUint32(at(T.METRICS), 0x20e, true)))
    ).toThrow(/Unsupported PCF metrics format/)
    expect(() =>
      readPcf(mutate((c) => dv(c).setUint32(at(T.BITMAPS) + 4, 9)))
    ).toThrow(/bitmap count/)
    expect(() =>
      readPcf(mutate((c) => dv(c).setUint32(at(T.BITMAPS), 0x3e, true)))
    ).toThrow(/scan unit/)
    expect(() =>
      readPcf(mutate((c) => dv(c).setUint32(at(T.BITMAPS) + 8, 0x7fff0000)))
    ).toThrow(/exceeds the bitmap data/)
    expect(() =>
      readPcf(mutate((c) => dv(c).setUint32(at(T.SWIDTHS) + 4, 1)))
    ).toThrow(/swidth count/)
    expect(() =>
      readPcf(mutate((c) => dv(c).setUint32(at(T.GLYPH_NAMES) + 4, 1)))
    ).toThrow(/glyph name count/)
    expect(() =>
      readPcf(mutate((c) => dv(c).setUint32(at(T.GLYPH_NAMES) + 8, 0x7fff0000)))
    ).toThrow(/string offset/)
    expect(() =>
      readPcf(mutate((c) => dv(c).setUint32(at(T.PROPERTIES) + 8, 0x7fff0000)))
    ).toThrow(/string offset/)
    expect(() =>
      readPcf(mutate((c) => dv(c).setUint32(at(T.PROPERTIES) + 4, 0x7fff0000)))
    ).toThrow(/truncated/)
    expect(() =>
      readPcf(mutate((c) => dv(c).setUint16(at(T.BDF_ENCODINGS) + 14, 0x7777)))
    ).toThrow(/missing glyph/)
    // compressed metrics: lsb (+0x80) > rsb
    expect(() => readPcf(mutate((c) => (c[at(T.METRICS) + 6] = 0xff)))).toThrow(
      /negative sized/
    )
  })

  test('readPcfAsync: gzip and plain input', async () => {
    const p = await small()
    const m = model(readPcf(p))
    expect(model(await readPcfAsync(gzipSync(p)))).toEqual(m)
    expect(
      model(await readPcfAsync(new Uint8Array(gzipSync(p)).buffer))
    ).toEqual(m)
    expect(model(await readPcfAsync(p))).toEqual(m)
    const broken = gzipSync(p).subarray(0, 40)
    await expect(readPcfAsync(broken)).rejects.toThrow(/decompress/)
    // the gzip-compressed goldens are valid .pcf.gz files
    const golden = join(GOLDEN, 'unifont-13.0.04-for-test.pcf.gz')
    if (existsSync(golden)) {
      const f = await readPcfAsync(new Uint8Array(readFileSync(golden)))
      expect(f.glyphs.size).toBe(849)
    }
  })
})

describe('more edge cases', () => {
  test('writer: unusual model values', async () => {
    const font = await loadText(TERMINAL_BDF)
    // value types other than string / number are ignored
    ;(font.props as Record<string, unknown>).flag = true
    // a key without remembered spelling is written in upper case
    font.props.lowerkey = 5
    // FONT_ASCENT as a string is ignored by bdftopcf => fallback
    font.setprop('FONT_ASCENT', '8')
    // no SWIDTH, no point size => swidth from FONTBOUNDINGBOX width
    const a = font.glyphs.get(65) as GlyphMetaInFont
    a[6] = null
    font.headers.pointsize = 0
    // missing name and bitmap rows
    ;(a as unknown[])[0] = null
    ;(a as unknown[])[16] = null
    // xres not an integer, yres < 1, no font name
    font.headers.xres = 7.5
    font.headers.yres = -3
    delete (font.headers as Partial<typeof font.headers>).fontname
    const r = readPcf(writePcf(font))
    expect('flag' in r.props).toBe(false)
    expect(r.props.lowerkey).toBe(5)
    expect(r._propnames.get('lowerkey')).toBe('LOWERKEY')
    expect(r.props.font_ascent).toBe(font.headers.fbby + font.headers.fbbyoff)
    expect(r.glyphs.get(65)?.[6]).toBe(Math.floor((6 * 1000) / 6 + 0.5))
    expect(r.props.point_size).toBe(0)
    expect(r.glyphs.get(65)?.[0]).toBe('')
    expect(r.glyphs.get(65)?.[16].every((row) => row === '00')).toBe(true)
    expect([r.props.resolution_x, r.props.resolution_y]).toEqual([75, 75])
    expect(r.props.font).toBe('')
  })

  test('reader: properties written by other tools', async () => {
    const font = await loadText(TERMINAL_BDF)
    // names differing only in case, and FONT_ASCENT/DESCENT kept by the tool
    // (bdftopcf only drops the exact upper-case names)
    font.props.p1 = 'first'
    font.props.p2 = 'second'
    font._propnames.set('p1', 'Dup')
    font._propnames.set('p2', 'DUP')
    font.props.fa = 3
    font.props.fd = 4
    font._propnames.set('fa', 'font_ascent')
    font._propnames.set('fd', 'font_descent')
    const r = readPcf(writePcf(font))
    expect(r.props.dup).toBe('second')
    expect(r._propnames.get('dup')).toBe('Dup')
    expect(r.props.font_ascent).toBe(3)
    expect(r.props.font_descent).toBe(4)
  })

  test('reader: other views, partial scan unit groups', async () => {
    const p = writePcf(await loadText(TERMINAL_BDF), {
      bitorder: 'lsb',
      byteorder: 'lsb',
      glyphpad: 1,
      scanunit: 4,
    })
    const m = model(readPcf(p))
    expect(
      model(readPcf(new Int8Array(p.buffer) as unknown as Uint8Array))
    ).toEqual(m)
    // claim bit order MSB in the BITMAPS table only: bit order != byte order,
    // so the bitmap block (not a multiple of 4 bytes) gets byte-swapped
    const c = p.slice()
    const off = tableOffset(c, T.BITMAPS)
    new DataView(c.buffer).setUint32(off, toc(c)[3].format | 8, true)
    const r = readPcf(c)
    expect(r.glyphs.size).toBe(5)
    expect(model(r)).not.toEqual(m)
  })

  test('readPcfAsync without DecompressionStream', async () => {
    const p = gzipSync(writePcf(await loadText(TERMINAL_BDF)))
    const g = globalThis as { DecompressionStream?: unknown }
    const saved = g.DecompressionStream
    delete g.DecompressionStream
    try {
      await expect(readPcfAsync(p)).rejects.toThrow(/DecompressionStream/)
    } finally {
      g.DecompressionStream = saved
    }
  })
})

describe('seeded random fonts', () => {
  const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1)
  const VARIANTS = FLAG_SETS.filter(([, o]) => o !== null) as [
    string[],
    PcfWriteOptions,
  ][]

  test.each(SEEDS)('seed %i', async (seed) => {
    const bdf = randomBdf(seed)
    const font = await loadText(bdf)
    // default flags
    const p = writePcf(font)
    expect(sha256(p)).toBe(refHash(`random-${seed}`, bdf, []))
    // one rotating flag combination per seed
    const [flags, opts] = VARIANTS[seed % VARIANTS.length]
    const po = writePcf(font, opts)
    const ref = refHash(`random-${seed}${flags.join('')}`, bdf, flags)
    if (!(swapped(opts) && hasInk(p))) {
      expect(sha256(po)).toBe(ref)
    }
    // reader: reconstruction, option independence, fixed point
    const r = readPcf(p)
    expectReconstructs(font, r)
    expect(model(readPcf(po))).toEqual(model(r))
    // PCF -> model -> PCF is byte-identical, unless the model cannot keep the
    // glyph order (codepoints > 0xFFFF before encoded glyphs, altcode
    // collisions) or bdftopcf produced -1 for X_HEIGHT / QUAD_WIDTH / WEIGHT
    // ("compute me" on the next run); then it is a fixed point after one cycle
    const p2 = writePcf(r)
    const minus1 = [
      r.props.x_height,
      r.props.quad_width,
      r.props.weight,
    ].includes(-1)
    if (keepsGlyphOrder(font) && !minus1) {
      expectBytes(p2, p)
    } else if (!minus1) {
      expectBytes(writePcf(readPcf(p2)), p2)
    }
  })
})

describe.skipIf(!HAVE_FCQUERY)(
  'external validation (fc-query / FreeType)',
  () => {
    test.each([
      {},
      { glyphpad: 8 },
      { glyphpad: 1, bitorder: 'lsb' },
      { byteorder: 'lsb', scanunit: 4 },
      { byteorder: 'lsb', bitorder: 'lsb', glyphpad: 2, scanunit: 2 },
    ] as PcfWriteOptions[])('%j', async (o) => {
      const font = await loadPath(`${FONTS}/unifont-13.0.04-for-test.bdf`)
      const file = join(TMP, `fc${tmpCounter++}.pcf`)
      writeFileSync(file, writePcf(font, o))
      const r = spawnSync('fc-query', [
        '--format=%{family}|%{pixelsize}|%{spacing}',
        file,
      ])
      expect(r.status).toBe(0)
      expect(r.stdout.toString()).toBe('GNU Unifont|16|110') // 110 = charcell
    })
  }
)
