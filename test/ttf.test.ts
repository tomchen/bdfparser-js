import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import opentype from 'opentype.js'
import '../src/cjk' // exact charset tables: the golden files were made with Python's codecs
import { Font } from '../src/Font'
import { bitmapContours } from '../src/outline'
import { readTtf, writeTtf, WriteTtfOptions } from '../src/ttf'
import type { GlyphMetaInFont } from '../src/types'

/** heavy cases only run with BDFPARSER_SLOW_TESTS=1 */
const SLOW = process.env.BDFPARSER_SLOW_TESTS === '1'

const FONTS = join(__dirname, 'fonts')
const FIXTURES = join(__dirname, 'fixtures')
const GOLDEN = join(FIXTURES, 'golden')

const fontCache = new Map<string, string>()
const loadFont = (path: string): Font => {
  let text = fontCache.get(path)
  if (text === undefined) {
    text = readFileSync(path, 'utf8')
    fontCache.set(path, text)
  }
  return new Font().load_string(text)
}

const toArrayBuffer = (b: Uint8Array): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

/** Index of the first differing byte, or -1 if equal */
const firstDiff = (a: Uint8Array, b: Uint8Array): number => {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i
  }
  return a.length === b.length ? -1 : n
}

// ---------------------------------------------------------------------------
// independent sfnt parsing / validation

type Table = { tag: string; checksum: number; offset: number; length: number }

const u32 = (b: Uint8Array, o: number): number =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const u16 = (b: Uint8Array, o: number): number => (b[o] << 8) | b[o + 1]
const i16 = (b: Uint8Array, o: number): number => (u16(b, o) << 16) >> 16

/** Reference checksum (BigInt arithmetic, independent of the implementation) */
const refChecksum = (b: Uint8Array): number => {
  let sum = 0n
  for (let i = 0; i < b.length; i += 4) {
    let v = 0n
    for (let k = 0; k < 4; k++) {
      v = (v << 8n) | BigInt(b[i + k] ?? 0)
    }
    sum += v
  }
  return Number(sum & 0xffffffffn)
}

const parseDirectory = (b: Uint8Array): Map<string, Table> => {
  const n = u16(b, 4)
  const m = new Map<string, Table>()
  for (let i = 0; i < n; i++) {
    const o = 12 + 16 * i
    const tag = String.fromCharCode(...b.subarray(o, o + 4))
    m.set(tag, {
      tag,
      checksum: u32(b, o + 4),
      offset: u32(b, o + 8),
      length: u32(b, o + 12),
    })
  }
  return m
}

const tableData = (b: Uint8Array, t: Table | undefined): Uint8Array => {
  if (t === undefined) throw new Error('missing table')
  return b.subarray(t.offset, t.offset + t.length)
}

/** Structural validation following SPEC-v3 §8 */
const validateSfnt = (b: Uint8Array, metadata = true): Map<string, Table> => {
  expect(u32(b, 0)).toBe(0x00010000)
  const n = u16(b, 4)
  const expectedTags = [
    ...(metadata ? ['BDFP'] : []),
    'OS/2',
    'cmap',
    'glyf',
    'head',
    'hhea',
    'hmtx',
    'loca',
    'maxp',
    'name',
    'post',
    'prep',
  ]
  expect(n).toBe(expectedTags.length)
  const e = Math.floor(Math.log2(n))
  expect(u16(b, 6)).toBe(16 * 2 ** e)
  expect(u16(b, 8)).toBe(e)
  expect(u16(b, 10)).toBe(16 * n - 16 * 2 ** e)
  const dir = parseDirectory(b)
  expect([...dir.keys()]).toEqual(expectedTags)
  let expectedOffset = 12 + 16 * n
  for (const t of dir.values()) {
    expect(t.offset).toBe(expectedOffset)
    const padded = Math.ceil(t.length / 4) * 4
    // zero padding
    for (let i = t.offset + t.length; i < t.offset + padded; i++) {
      expect(b[i]).toBe(0)
    }
    const data = new Uint8Array(b.subarray(t.offset, t.offset + padded))
    if (t.tag === 'head') {
      data.fill(0, 8, 12)
    }
    expect(refChecksum(data)).toBe(t.checksum)
    expectedOffset += padded
  }
  expect(b.length).toBe(expectedOffset)
  // whole-file checksum
  expect(refChecksum(b)).toBe(0xb1b0afba)
  // fixed sizes
  expect(dir.get('head')?.length).toBe(54)
  expect(dir.get('hhea')?.length).toBe(36)
  expect(dir.get('maxp')?.length).toBe(32)
  expect(dir.get('OS/2')?.length).toBe(96)
  // loca / glyf consistency
  const numGlyphs = u16(tableData(b, dir.get('maxp')), 4)
  const loca = tableData(b, dir.get('loca'))
  expect(loca.length).toBe(4 * (numGlyphs + 1))
  let prev = 0
  for (let i = 0; i <= numGlyphs; i++) {
    const v = u32(loca, 4 * i)
    expect(v).toBeGreaterThanOrEqual(prev)
    expect(v % 4).toBe(0)
    prev = v
  }
  expect(prev).toBe(dir.get('glyf')?.length)
  expect(dir.get('hmtx')?.length).toBe(4 * numGlyphs)
  return dir
}

// ---------------------------------------------------------------------------
// bitmap helpers (independent of the library's Glyph code)

const glyphBits = (meta: GlyphMetaInFont): string[] =>
  meta[16].slice(0, meta[3]).map((hex) =>
    [...hex]
      .map((d) => parseInt(d, 16).toString(2).padStart(4, '0'))
      .join('')
      .slice(0, meta[2])
      .padEnd(meta[2], '0')
  )

/** Ink pixels as a set of "x,y" (absolute, y up) */
const inkSet = (meta: GlyphMetaInFont): Set<string> => {
  const s = new Set<string>()
  const rows = glyphBits(meta)
  rows.forEach((row, i) => {
    const y = meta[5] + (meta[3] - 1 - i)
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '1') s.add(`${meta[4] + c},${y}`)
    }
  })
  return s
}

/** em in pixels per SPEC-v3 §8 */
const emOf = (font: Font): number => {
  const props = font.props as Record<string, unknown>
  const int = (k: string): number | undefined =>
    Number.isInteger(props[k]) ? (props[k] as number) : undefined
  const ascent = int('font_ascent') ?? font.headers.fbby + font.headers.fbbyoff
  const descent = int('font_descent') ?? -font.headers.fbbyoff
  const ps = int('pixel_size')
  if (ps !== undefined && ps > 0) return ps
  return ascent + descent > 0 ? ascent + descent : font.headers.fbby
}

const allFonts: [string, string][] = [
  ['spec_example_fixed', join(FONTS, 'spec_example_fixed.bdf')],
  ['unifont-for-test', join(FONTS, 'unifont-13.0.04-for-test.bdf')],
  ['unifont-2atest', join(FONTS, 'unifont-13.0.04-2atest.bdf')],
  ['edge', join(FIXTURES, 'edge.bdf')],
  ...[
    'big5',
    'cp1250',
    'cp1251',
    'cp1252',
    'euckr',
    'gb2312',
    'iso10646',
    'iso2022cn',
    'shiftjis',
    'unicode',
    'utf8',
  ].map((e): [string, string] => [
    `enctest-${e}`,
    join(FONTS, `unifont-13.0.04-enctest-${e}.bdf`),
  ]),
]

// ---------------------------------------------------------------------------

describe('writeTtf: cross-language golden files (Python bdfparser)', () => {
  const manifestPath = join(GOLDEN, 'manifest.json')
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        file: string
        font: string
        options: WriteTtfOptions
      }[])
    : []

  test('manifest present', () => {
    expect(manifest.length).toBeGreaterThan(50)
  })

  for (const { file, font, options } of manifest) {
    test(`${file}`, () => {
      const f = loadFont(join(__dirname, font))
      const out = writeTtf(f, options)
      const golden = new Uint8Array(readFileSync(join(GOLDEN, file)))
      const d = firstDiff(out, golden)
      expect(
        d,
        `first difference at byte ${d} (length ${out.length} vs ${golden.length})`
      ).toBe(-1)
    })
  }

  test('reading golden files restores the BDF font', () => {
    for (const { file, font, options } of manifest) {
      if (options.metadata === false) continue
      const f = loadFont(join(__dirname, font))
      const g = readTtf(new Uint8Array(readFileSync(join(GOLDEN, file))))
      expect(g.glyphs).toEqual(f.glyphs)
      expect(g.unencoded).toEqual(f.unencoded)
      expect(g.headers).toEqual(f.headers)
    }
  })
})

describe('writeTtf: structure and opentype.js parsing', () => {
  for (const [key, path] of allFonts) {
    for (const opts of [
      { shape: 'square', dotsize: 1, ppu: 64 },
      { shape: 'circle', dotsize: 0.8, ppu: 10 },
    ] as WriteTtfOptions[]) {
      test(`${key} ${opts.shape} ${opts.dotsize} ppu ${opts.ppu}`, () => {
        const font = loadFont(path)
        const ppu = opts.ppu as number
        const data = writeTtf(font, opts)
        validateSfnt(data)
        const ot = opentype.parse(toArrayBuffer(data))
        const cps = [...font.glyphs.keys()].sort((a, b) => a - b)
        const metas: GlyphMetaInFont[] = [
          ...cps.map((cp) => font.glyphs.get(cp) as GlyphMetaInFont),
          ...font.unencoded.map((u) => u.meta),
        ]
        expect(ot.numGlyphs).toBe(1 + metas.length)
        const em = emOf(font)
        expect(ot.unitsPerEm).toBe(em * ppu)
        expect(ot.glyphs.get(0).name).toBe('.notdef')
        const names = new Set<string>()
        metas.forEach((meta, i) => {
          const g = ot.glyphs.get(i + 1)
          // names: valid, unique
          expect(g.name).toMatch(/^[A-Za-z_.][A-Za-z0-9_.]{0,62}$/)
          expect(names.has(g.name as string)).toBe(false)
          names.add(g.name as string)
          if (
            /^[A-Za-z_.][A-Za-z0-9_.]{0,62}$/.test(meta[0]) &&
            meta[0] !== '.notdef'
          ) {
            // the first glyph with a valid BDF name keeps it
            if (metas.findIndex((m) => m[0] === meta[0]) === i) {
              expect(g.name).toBe(meta[0])
            }
          }
          // advance widths
          const dw =
            meta[8] ?? font.headers.dwx0 ?? Math.max(0, meta[4] + meta[2])
          expect(g.advanceWidth).toBe(dw * ppu)
          // contours as produced by bitmapContours
          const contours = g.getContours()
          const expected = bitmapContours(glyphBits(meta), {
            ...opts,
            ppu,
            xoff: meta[4],
            yoff: meta[5],
          })
          expect(
            contours.map((c) => c.map((p) => [p.x, p.y, p.onCurve]))
          ).toEqual(expected)
        })
        // cmap (opentype.js reads format 12 when present)
        const glyphIndexMap = ot.tables.cmap.glyphIndexMap as Record<
          string,
          number
        >
        const expectedMap: Record<string, number> = {}
        cps.forEach((cp, i) => {
          const ch = font.cp2char(cp)
          if (typeof ch === 'string' && [...ch].length === 1) {
            const u = ch.codePointAt(0) as number
            if (!(u in expectedMap)) expectedMap[u] = i + 1
          }
        })
        expect(glyphIndexMap).toEqual(expectedMap)
      })
    }
  }
})

describe('writeTtf: field values (edge.bdf)', () => {
  const font = loadFont(join(FIXTURES, 'edge.bdf'))
  const data = writeTtf(font)
  const dir = validateSfnt(data)
  const ot = opentype.parse(toArrayBuffer(data))
  const tbl = (t: string): Uint8Array => tableData(data, dir.get(t))

  test('glyph order and names', () => {
    const names = []
    for (let i = 0; i < ot.numGlyphs; i++) names.push(ot.glyphs.get(i).name)
    expect(names).toEqual([
      '.notdef',
      'control',
      'space',
      'A',
      'uni0042', // invalid BDF name "bad name"
      'uni0043', // duplicate BDF name "A"
      'uni0045', // valid BDF name
      'glyph7', // invalid name, uni0045 already used
      'vert',
      'wide',
      'uniFFFF',
      'linear',
      'blank',
      'smile',
      'unenc1', // unencoded
      'glyph15', // unencoded, BDF name ".notdef"
    ])
  })

  test('.notdef copies DEFAULT_CHAR', () => {
    expect(ot.glyphs.get(0).getContours()).toEqual(
      ot.glyphs.get(3).getContours()
    )
    expect(ot.glyphs.get(0).advanceWidth).toBe(6 * 64)
  })

  test('advance without DWIDTH = bbxoff + bbw', () => {
    expect(ot.glyphs.get(11).advanceWidth).toBe(5 * 64)
  })

  test('head', () => {
    const h = tbl('head')
    expect(u32(h, 0)).toBe(0x00010000)
    expect(u32(h, 12)).toBe(0x5f0f3cf5)
    expect(u16(h, 16)).toBe(0x000b)
    expect(u16(h, 18)).toBe(768)
    expect(u32(h, 20)).toBe(0) // created (int64)
    expect(u32(h, 24)).toBe(2082844800)
    expect(u32(h, 28)).toBe(0) // modified
    expect(u32(h, 32)).toBe(2082844800)
    // bounds: wide glyph (-2..68) and smile (y -1..7), A (0..7)
    expect([i16(h, 36), i16(h, 38), i16(h, 40), i16(h, 42)]).toEqual([
      -128,
      -192,
      68 * 64,
      7 * 64,
    ])
    expect(u16(h, 44)).toBe(3) // bold + italic
    expect(u16(h, 46)).toBe(12)
    expect(i16(h, 48)).toBe(2)
    expect(i16(h, 50)).toBe(1)
    expect(i16(h, 52)).toBe(0)
  })

  test('hhea / maxp', () => {
    const h = tbl('hhea')
    expect(i16(h, 4)).toBe(640)
    expect(i16(h, 6)).toBe(-192)
    expect(i16(h, 8)).toBe(0)
    expect(u16(h, 10)).toBe(70 * 64)
    expect(i16(h, 12)).toBe(-128) // min lsb (wide)
    expect(i16(h, 16)).toBe(68 * 64) // xMaxExtent
    expect(i16(h, 18)).toBe(1)
    expect(u16(h, 34)).toBe(16)
    const m = tbl('maxp')
    expect(u16(m, 4)).toBe(16)
    expect(u16(m, 6)).toBe(
      Math.max(
        ...[...Array(16).keys()].map(
          (i) => ot.glyphs.get(i).getContours().flat().length
        )
      )
    )
    expect(u16(m, 8)).toBe(32) // smile: checkerboard of 32 dots
    expect(u16(m, 14)).toBe(2) // maxZones
    expect([...m.subarray(16, 32)].some((b, i) => i !== 9 && b !== 0)).toBe(
      false
    )
    expect(u16(m, 24)).toBe(1) // maxStackElements (prep)
  })

  test('prep: dropout control program', () => {
    expect([...tbl('prep')]).toEqual([0xb8, 0x01, 0xff, 0x85, 0xb0, 0x04, 0x8d])
    expect(dir.get('prep')?.length).toBe(7)
    // last in the directory
    expect([...dir.keys()].at(-1)).toBe('prep')
  })

  test('OS/2', () => {
    const o = tbl('OS/2')
    expect(u16(o, 0)).toBe(4)
    expect(u16(o, 4)).toBe(700)
    expect(u16(o, 6)).toBe(5)
    const upem = 768
    expect(i16(o, 10)).toBe(Math.floor((upem * 65) / 100))
    expect(i16(o, 16)).toBe(Math.floor((upem * 14) / 100))
    expect(i16(o, 24)).toBe(Math.floor((upem * 48) / 100))
    expect(i16(o, 26)).toBe(64)
    expect(i16(o, 28)).toBe(192) // X_HEIGHT 6 * 64 / 2
    expect(String.fromCharCode(...o.subarray(58, 62))).toBe('BDFP')
    expect(u16(o, 62)).toBe(0x21 | 0x01 | 0x80)
    expect(u16(o, 64)).toBe(1)
    expect(u16(o, 66)).toBe(0xffff)
    expect(i16(o, 68)).toBe(640)
    expect(i16(o, 70)).toBe(-192)
    expect(u16(o, 74)).toBe(640)
    expect(u16(o, 76)).toBe(192)
    expect(u32(o, 78)).toBe(1)
    expect(i16(o, 86)).toBe(6 * 64)
    expect(i16(o, 88)).toBe(9 * 64)
    expect(u16(o, 92)).toBe(32)
    // xAvgCharWidth over glyphs with advance > 0
    const advs = [...Array(16).keys()]
      .map((i) => ot.glyphs.get(i).advanceWidth as number)
      .filter((a) => a > 0)
    const sum = advs.reduce((a, b) => a + b, 0)
    expect(i16(o, 2)).toBe(Math.floor(sum / advs.length + 0.5))
  })

  test('name', () => {
    const w = ot.names.windows ?? ot.names
    expect(w.copyright.en).toBe('© 2026 test')
    expect(w.fontFamily.en).toBe('Edge "Test" Ünïcödé')
    expect(w.fontSubfamily.en).toBe('Bold Italic')
    expect(w.fullName.en).toBe('Edge "Test" Ünïcödé Bold Italic')
    expect(w.version.en).toBe('Version 2.5')
    expect(w.postScriptName.en).toBe('EdgeTestncdBoldItalic')
    expect(w.uniqueID.en).toBe('EdgeTestncdBoldItalic')
    expect(w.license).toBeUndefined() // NOTICE "" is not present
    const n = tbl('name')
    const count = u16(n, 2)
    const ids = []
    for (let i = 0; i < count; i++) {
      expect(u16(n, 6 + 12 * i)).toBe(3)
      expect(u16(n, 8 + 12 * i)).toBe(1)
      expect(u16(n, 10 + 12 * i)).toBe(0x409)
      ids.push(u16(n, 12 + 12 * i))
    }
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  test('post', () => {
    const p = ot.tables.post
    expect(p.version).toBe(2)
    expect(p.underlinePosition).toBe(-128)
    expect(p.underlineThickness).toBe(64)
    expect(p.isFixedPitch).toBe(0)
    expect(p.glyphNameIndex).toEqual([
      0,
      ...[...Array(15).keys()].map((k) => 258 + k),
    ])
  })

  test('cmap: format 4 excludes U+FFFF, format 12 has everything', () => {
    const c = tbl('cmap')
    expect(u16(c, 0)).toBe(0)
    expect(u16(c, 2)).toBe(2)
    expect([u16(c, 4), u16(c, 6), u32(c, 8)]).toEqual([3, 1, 20])
    expect([u16(c, 12), u16(c, 14)]).toEqual([3, 10])
    // format 4
    const f4 = c.subarray(20)
    expect(u16(f4, 0)).toBe(4)
    const segX2 = u16(f4, 6)
    const seg = segX2 / 2
    const ends = [...Array(seg).keys()].map((i) => u16(f4, 14 + 2 * i))
    const starts = [...Array(seg).keys()].map((i) =>
      u16(f4, 16 + segX2 + 2 * i)
    )
    const deltas = [...Array(seg).keys()].map((i) =>
      u16(f4, 16 + 2 * segX2 + 2 * i)
    )
    // runs: 1 | 32 | 65-69 | 0x2000 | 0x4E00 | terminator; U+FFFF not mapped here
    expect(starts).toEqual([1, 32, 65, 0x2000, 0x4e00, 0xffff])
    expect(ends).toEqual([1, 32, 69, 0x2000, 0x4e00, 0xffff])
    expect(deltas).toEqual([
      0,
      (2 - 32 + 65536) % 65536,
      (3 - 65 + 65536) % 65536,
      (8 - 0x2000 + 65536) % 65536,
      (9 - 0x4e00 + 65536) % 65536,
      1,
    ])
    expect(u16(f4, 8)).toBe(8) // searchRange
    expect(u16(f4, 10)).toBe(2)
    expect(u16(f4, 12)).toBe(12 - 8)
    // format 12
    const f12 = c.subarray(u32(c, 16))
    expect(u16(f12, 0)).toBe(12)
    const ng = u32(f12, 12)
    const groups = [...Array(ng).keys()].map((i) => [
      u32(f12, 16 + 12 * i),
      u32(f12, 20 + 12 * i),
      u32(f12, 24 + 12 * i),
    ])
    expect(groups).toEqual([
      [1, 1, 1],
      [32, 32, 2],
      [65, 69, 3],
      [0x2000, 0x2000, 8],
      [0x4e00, 0x4e00, 9],
      [0xffff, 0x10000, 10],
      [66000, 66000, 12],
      [0x1f600, 0x1f600, 13],
    ])
  })

  test('glyf: flags without REPEAT, short and long coordinates', () => {
    const glyf = tbl('glyf')
    const loca = tbl('loca')
    // "wide" glyph (gid 9): one contour, 70*64 = 4480 > 255 → int16 x deltas
    const off = u32(loca, 4 * 9)
    expect(i16(glyf, off)).toBe(1)
    const npts = u16(glyf, off + 10) + 1
    expect(u16(glyf, off + 12)).toBe(0) // no instructions
    const flags = glyf.subarray(off + 14, off + 14 + npts)
    for (const f of flags) {
      expect(f & 0x08).toBe(0) // no REPEAT
      expect(f & 0x01).toBe(1) // on-curve
    }
    // empty glyph (space, gid 2): zero length
    expect(u32(loca, 4 * 3) - u32(loca, 4 * 2)).toBe(0)
  })

  test('hmtx lsb = xMin', () => {
    const h = tbl('hmtx')
    expect(i16(h, 4 * 9 + 2)).toBe(-128)
    expect(i16(h, 4 * 2 + 2)).toBe(0)
  })

  test('BDFP JSON', () => {
    const json = JSON.parse(new TextDecoder().decode(tbl('BDFP')))
    expect(Object.keys(json)).toEqual([
      'version',
      'ppu',
      'shape',
      'dotsize',
      'headers',
      'props',
      'propnames',
      'glyphs',
    ])
    expect(json.version).toBe(1)
    expect(json.headers.bdfversion).toBe('2.1')
    expect(json.props.minspace).toBe(4)
    expect(json.propnames.minspace).toBe('MinSpace')
    expect(json.glyphs[0]).toEqual([
      2,
      32,
      'space',
      0,
      0,
      0,
      0,
      240,
      0,
      4,
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ])
    expect(json.glyphs.at(-1)[17]).toBe(123)
    expect(new TextDecoder().decode(tbl('BDFP'))).toContain('"dotsize":1,')
  })

  test('timestamp and metadata=false', () => {
    const d = writeTtf(font, { timestamp: 1700000000, metadata: false })
    const dir2 = validateSfnt(d, false)
    const h = tableData(d, dir2.get('head'))
    expect(u32(h, 24)).toBe((1700000000 + 2082844800) % 2 ** 32)
    expect(u32(h, 20)).toBe(Math.floor((1700000000 + 2082844800) / 2 ** 32))
  })
})

describe('readTtf: round trip readTtf(writeTtf(F)) == F', () => {
  const variants: WriteTtfOptions[] = [
    { shape: 'square' },
    { shape: 'circle' },
    { shape: 'square', dotsize: 0.6, ppu: 10 },
    { shape: 'circle', dotsize: 0.5, ppu: 2 },
    { shape: 'circle', dotsize: 1.5, ppu: 4 },
    { shape: 'square', dotsize: 1, ppu: 2 },
  ]
  for (const [key, path] of allFonts) {
    test(key, () => {
      const f = loadFont(path)
      for (const opts of variants) {
        let data: Uint8Array
        try {
          data = writeTtf(f, opts)
        } catch (e) {
          // ppu 2 makes upem < 16 for tiny fonts
          expect(String(e)).toMatch(/unitsPerEm/)
          continue
        }
        const g = readTtf(data)
        expect(g.glyphs).toEqual(f.glyphs)
        expect([...g.glyphs.keys()]).toEqual([...f.glyphs.keys()])
        expect(g.unencoded).toEqual(f.unencoded)
        expect(g.headers).toEqual(f.headers)
        const { comment: _c, ...props } = f.props
        expect(g.props).toEqual(props)
        expect(g._propnames).toEqual(f._propnames)
        // a second write is identical
        expect(firstDiff(writeTtf(g, opts), data)).toBe(-1)
      }
    })
  }

  test('ArrayBuffer input', () => {
    const f = loadFont(join(FONTS, 'spec_example_fixed.bdf'))
    const data = writeTtf(f)
    expect(readTtf(toArrayBuffer(data)).glyphs).toEqual(f.glyphs)
    // sub-array view with a non-zero byteOffset
    const big = new Uint8Array(data.length + 8)
    big.set(data, 8)
    expect(readTtf(big.subarray(8)).glyphs).toEqual(f.glyphs)
  })

  test('HanWangYanKai-26 (14160 glyphs), square', () => {
    const f = loadFont(join(FONTS, 'HanWangYanKai-26.bdf'))
    const data = writeTtf(f)
    validateSfnt(data)
    const g = readTtf(data)
    expect(g.glyphs).toEqual(f.glyphs)
    expect(g.headers).toEqual(f.headers)
    expect(opentype.parse(toArrayBuffer(data)).numGlyphs).toBe(14161)
  })

  test.runIf(SLOW)(
    'HanWangYanKai-26 (14160 glyphs), circle 0.9 ppu 10',
    () => {
      const f = loadFont(join(FONTS, 'HanWangYanKai-26.bdf'))
      const g = readTtf(writeTtf(f, { shape: 'circle', dotsize: 0.9, ppu: 10 }))
      expect(g.glyphs).toEqual(f.glyphs)
    },
    300000
  )

  test.runIf(SLOW)('unifont reduced (5441 glyphs), both shapes', () => {
    const f = loadFont(join(FONTS, 'unifont-13.0.04-reduced.bdf'))
    for (const shape of ['square', 'circle'] as const) {
      const g = readTtf(writeTtf(f, { shape, ppu: 4 }))
      expect(g.glyphs).toEqual(f.glyphs)
    }
  })

  test.runIf(SLOW)(
    'full unifont (57086 glyphs), both shapes',
    () => {
      const f = loadFont(join(FONTS, 'unifont-13.0.04.bdf'))
      for (const shape of ['square', 'circle'] as const) {
        const g = readTtf(writeTtf(f, { shape, ppu: 2 }))
        expect(g.glyphs).toEqual(f.glyphs)
      }
    },
    600000
  )
})

describe('readTtf without BDFP (metadata=false + pixelsize)', () => {
  for (const [key, path] of allFonts) {
    test(key, () => {
      const f = loadFont(path)
      for (const opts of [
        { shape: 'square' },
        { shape: 'circle', dotsize: 0.7, ppu: 10 },
      ] as WriteTtfOptions[]) {
        const data = writeTtf(f, { ...opts, metadata: false })
        validateSfnt(data, false)
        expect(() => readTtf(data)).toThrow(/pixelsize/)
        const em = emOf(f)
        const g = readTtf(data, { pixelsize: em })
        // every glyph bitmap is reproduced (trimmed), codepoints via Unicode
        const cps = [...f.glyphs.keys()].sort((a, b) => a - b)
        const seen = new Set<number>()
        const gmetas = [...g.glyphs.values(), ...g.unencoded.map((u) => u.meta)]
        expect(gmetas.length).toBe(f.glyphs.size + f.unencoded.length)
        for (const cp of cps) {
          const meta = f.glyphs.get(cp) as GlyphMetaInFont
          const ch = f.cp2char(cp)
          const u =
            typeof ch === 'string' && [...ch].length === 1
              ? (ch.codePointAt(0) as number)
              : null
          let gm: GlyphMetaInFont | undefined
          if (u !== null && !seen.has(u)) {
            seen.add(u)
            gm = g.glyphs.get(u)
          } else {
            gm = g.unencoded.find(
              (x) =>
                x.meta[0] ===
                (/^[A-Za-z_.][A-Za-z0-9_.]{0,62}$/.test(meta[0])
                  ? meta[0]
                  : x.meta[0])
            )?.meta
          }
          expect(gm).toBeDefined()
          const m = gm as GlyphMetaInFont
          expect(inkSet(m)).toEqual(inkSet(meta))
          const dw = meta[8] ?? f.headers.dwx0 ?? Math.max(0, meta[4] + meta[2])
          expect(m[8]).toBe(dw)
          expect(m[9]).toBe(0)
          expect(m[6]).toBe(g.swidth(dw))
          // trimmed hexdata, upper-case, ceil(w/8)*2 digits
          for (const row of m[16]) {
            expect(row).toMatch(/^[0-9A-F]*$/)
            expect(row.length).toBe(Math.ceil(m[2] / 8) * 2)
          }
        }
        expect(g.headers.pointsize).toBe(em)
        expect(g.props.pixel_size).toBe(em)
        expect(g.props.charset_registry).toBe('ISO10646')
        expect(g.props.charset_encoding).toBe('1')
        expect(g._propnames.get('pixel_size')).toBe('PIXEL_SIZE')
        // FONTBOUNDINGBOX = union of glyph boxes
        let x0 = Infinity
        let y0 = Infinity
        let x1 = -Infinity
        let y1 = -Infinity
        for (const m of gmetas) {
          if (m[2] > 0 && m[3] > 0) {
            x0 = Math.min(x0, m[4])
            y0 = Math.min(y0, m[5])
            x1 = Math.max(x1, m[4] + m[2])
            y1 = Math.max(y1, m[5] + m[3])
          }
        }
        expect([
          g.headers.fbbx,
          g.headers.fbby,
          g.headers.fbbxoff,
          g.headers.fbbyoff,
        ]).toEqual([x1 - x0, y1 - y0, x0, y0])
      }
    })
  }

  test('names, header and props from the name table (edge.bdf)', () => {
    const f = loadFont(join(FIXTURES, 'edge.bdf'))
    const g = readTtf(writeTtf(f, { metadata: false }), { pixelsize: 12 })
    expect(g.headers.fontname).toBe('EdgeTestncdBoldItalic')
    expect(g.headers.bdfversion).toBe(2.1)
    expect(g.headers.xres).toBe(75)
    expect(g.props).toEqual({
      family_name: 'Edge "Test" Ünïcödé',
      copyright: '© 2026 test',
      pixel_size: 12,
      font_ascent: 10,
      font_descent: 3,
      charset_registry: 'ISO10646',
      charset_encoding: '1',
    })
    expect(g.glyphs.get(66)?.[0]).toBe('uni0042')
    expect(g.unencoded.map((u) => u.meta[0])).toEqual(['unenc1', 'glyph15'])
    expect(g.unencoded.map((u) => u.altcode)).toEqual([null, null])
    // empty glyph
    expect(g.glyphs.get(32)?.slice(2, 6)).toEqual([0, 0, 0, 0])
    expect(g.glyphs.get(32)?.[16]).toEqual([])
    // wide glyph hexdata
    expect(g.glyphs.get(0x4e00)?.[16]).toEqual([
      'FFFFFFFFFFFFFFFFFC',
      'AAAAAAAAAAAAAAAAA8',
    ])
  })

  test('pixelsize validation', () => {
    const f = loadFont(join(FONTS, 'spec_example_fixed.bdf'))
    const data = writeTtf(f, { metadata: false })
    expect(() => readTtf(data, { pixelsize: 0 })).toThrow(RangeError)
    expect(() => readTtf(data, { pixelsize: 2.5 })).toThrow(RangeError)
    // a different pixel size (non-integer ppu) still works
    const g = readTtf(data, { pixelsize: 7 })
    expect(g.headers.pointsize).toBe(7)
    expect(g.glyphs.size).toBe(2)
  })
})

describe('readTtf: fontTools-built fonts (quadratic curves, composites)', () => {
  const cases: [string, number][] = [
    ['fonttools-composite', 20],
    ['fonttools-composite', 13],
    ['fonttools-composite', 7],
    ['fonttools-composite-post3', 20],
    ['fonttools-cmap4-rangeoffset', 16],
    ['fonttools-cmap4-rangeoffset', 12],
    ['fonttools-cmap0-6', 16],
    ['fonttools-empty', 16],
  ]
  for (const [name, px] of cases) {
    const goldenPath = join(GOLDEN, `read-${name}-px${px}.json`)
    test.runIf(existsSync(goldenPath))(
      `${name} pixelsize ${px} equals Python read_ttf`,
      () => {
        const data = new Uint8Array(readFileSync(join(FIXTURES, `${name}.ttf`)))
        const g = readTtf(data, { pixelsize: px })
        const expected = JSON.parse(readFileSync(goldenPath, 'utf8'))
        expect(g.headers).toEqual(expected.headers)
        expect(g.props).toEqual(expected.props)
        expect(Object.fromEntries(g._propnames)).toEqual(expected.propnames)
        expect([...g.glyphs.entries()]).toEqual(expected.glyphs)
        expect(g.unencoded).toEqual(expected.unencoded)
      }
    )
  }

  test('composite glyphs are the union of their transformed components', () => {
    const data = new Uint8Array(
      readFileSync(join(FIXTURES, 'fonttools-composite.ttf'))
    )
    const g = readTtf(data, { pixelsize: 20 }) // ppu 50
    const byName = new Map(
      [...g.glyphs.values()].map((m) => [m[0], m] as const)
    )
    const A = inkSet(byName.get('A') as GlyphMetaInFont)
    const Acomp = inkSet(byName.get('Acomp') as GlyphMetaInFont)
    // A is shifted by (100, 300) units = (2, 6) pixels inside Acomp
    for (const p of A) {
      const [x, y] = p.split(',').map(Number)
      expect(Acomp.has(`${x + 2},${y + 6}`)).toBe(true)
    }
    // Match: .notdef box plus A anchored at notdef point 2 (500,700) → (10,14) px
    const match = inkSet(byName.get('Match') as GlyphMetaInFont)
    expect(match.has('0,0')).toBe(true)
    for (const p of A) {
      const [x, y] = p.split(',').map(Number)
      expect(match.has(`${x + 10},${y + 17}`)).toBe(true)
    }
    // names from post format 2, codepoints from cmap (smallest code wins)
    expect(byName.get('O')?.[1]).toBe(0x30)
    expect(g.glyphs.get(0x1f600)?.[0]).toBe('Oscaled')
    expect(g.unencoded.map((u) => u.meta[0])).toEqual(['unmapped'])
    expect(g.props.family_name).toBe('FT Test')
    expect(g.headers.fontname).toBe('Untitled')
  })

  test('cmap format 4 with idRangeOffset, post 1.0, name platforms 0 / 1', () => {
    const data = new Uint8Array(
      readFileSync(join(FIXTURES, 'fonttools-cmap4-rangeoffset.ttf'))
    )
    const g = readTtf(data, { pixelsize: 16 })
    expect([...g.glyphs.entries()].map(([cp, m]) => [cp, m[0]])).toEqual([
      [0x42, 'space'],
      [0x44, 'exclam'],
      [0x41, 'quotedbl'],
      [0x2603, 'dollar'],
      [0x43, 'ampersand'],
      [0x45, 'parenleft'],
    ])
    expect(g.unencoded.map((u) => u.meta[0])).toEqual([
      '.null',
      'nonmarkingreturn',
      'numbersign',
      'percent',
      'quotesingle',
    ])
    expect(g.headers.fontname).toBe('MacPS')
    expect(g.props.family_name).toBe('Plat0 Family')
    expect(g.props.copyright).toBe('Café © Mac')
  })

  test('cmap (0,3) format 6 preferred over (1,0) format 0', () => {
    const data = new Uint8Array(
      readFileSync(join(FIXTURES, 'fonttools-cmap0-6.ttf'))
    )
    const g = readTtf(data, { pixelsize: 16 })
    expect([...g.glyphs.keys()]).toEqual([0x103, 0x100, 0x101])
    expect(g.unencoded.map((u) => u.meta[0])).toEqual(['b'])
  })

  test('font without ink: FONTBOUNDINGBOX fallback', () => {
    const data = new Uint8Array(
      readFileSync(join(FIXTURES, 'fonttools-empty.ttf'))
    )
    const g = readTtf(data, { pixelsize: 16 })
    expect([
      g.headers.fbbx,
      g.headers.fbby,
      g.headers.fbbxoff,
      g.headers.fbbyoff,
    ]).toEqual([16, 16, 0, -2])
    expect(g.glyphs.get(32)?.[0]).toBe('uni0020')
  })

  test('post format 3: default glyph names', () => {
    const data = new Uint8Array(
      readFileSync(join(FIXTURES, 'fonttools-composite-post3.ttf'))
    )
    const g = readTtf(data, { pixelsize: 20 })
    expect(g.glyphs.get(0x41)?.[0]).toBe('uni0041')
    expect(g.glyphs.get(0x1f600)?.[0]).toBe('u1F600')
    expect(g.unencoded.map((u) => u.meta[0])).toEqual(['glyph10'])
  })
})

// ---------------------------------------------------------------------------
// error handling

/** Re-assemble an sfnt from tables (test-side, independent implementation) */
const assemble = (tables: [string, Uint8Array][], sfnt = 0x00010000) => {
  const n = tables.length
  let size = 12 + 16 * n
  for (const [, d] of tables) size += Math.ceil(d.length / 4) * 4
  const out = new Uint8Array(size)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, sfnt)
  dv.setUint16(4, n)
  let off = 12 + 16 * n
  tables.forEach(([tag, d], i) => {
    for (let k = 0; k < 4; k++) out[12 + 16 * i + k] = tag.charCodeAt(k)
    dv.setUint32(12 + 16 * i + 8, off)
    dv.setUint32(12 + 16 * i + 12, d.length)
    out.set(d, off)
    off += Math.ceil(d.length / 4) * 4
  })
  return out
}

const splitTables = (b: Uint8Array): [string, Uint8Array][] =>
  [...parseDirectory(b).values()].map((t) => [
    t.tag,
    new Uint8Array(b.subarray(t.offset, t.offset + t.length)),
  ])

describe('readTtf: errors', () => {
  const f = loadFont(join(FONTS, 'spec_example_fixed.bdf'))
  const good = writeTtf(f)

  test('CFF-based OpenType', () => {
    const otto = new Uint8Array(good)
    otto.set([0x4f, 0x54, 0x54, 0x4f], 0)
    expect(() => readTtf(otto)).toThrow('CFF-based OpenType is not supported')
  })

  test('not a font / too short / truncated', () => {
    expect(() => readTtf(new Uint8Array(4))).toThrow(/too short/)
    expect(() =>
      readTtf(new TextEncoder().encode('STARTFONT 2.1\nFONT x\n'))
    ).toThrow(/Not a TrueType font/)
    const ttc = new Uint8Array(good)
    ttc.set([0x74, 0x74, 0x63, 0x66], 0)
    expect(() => readTtf(ttc)).toThrow(/Not a TrueType font/)
    expect(() => readTtf(good.subarray(0, 40))).toThrow(/Malformed/)
    expect(() => readTtf(good.subarray(0, good.length - 100))).toThrow(
      /Malformed/
    )
    // 'true' sfnt version is accepted
    const t = new Uint8Array(good)
    t.set([0x74, 0x72, 0x75, 0x65], 0)
    expect(readTtf(t).glyphs).toEqual(f.glyphs)
  })

  test('input types: views, foreign-realm ArrayBuffer, invalid', () => {
    const big = new Uint8Array(good.length + 5)
    big.set(good, 3)
    expect(readTtf(big.subarray(3, 3 + good.length)).glyphs).toEqual(f.glyphs)
    expect(
      readTtf(new DataView(good.slice().buffer) as unknown as Uint8Array).glyphs
    ).toEqual(f.glyphs)
    const foreign = runInNewContext('new ArrayBuffer(n)', {
      n: good.length,
    }) as ArrayBuffer
    new Uint8Array(foreign).set(good)
    expect(foreign instanceof ArrayBuffer).toBe(false)
    expect(readTtf(foreign).glyphs).toEqual(f.glyphs)
    expect(() => readTtf('true' as unknown as Uint8Array)).toThrow(TypeError)
  })

  test('missing required table', () => {
    const tables = splitTables(good).filter(([t]) => t !== 'glyf')
    expect(() => readTtf(assemble(tables))).toThrow(/missing required table/)
  })

  test('bad BDFP table', () => {
    const tables = splitTables(good)
    const withBdfp = (json: string): Uint8Array =>
      assemble(
        tables.map(([t, d]) => [
          t,
          t === 'BDFP' ? new TextEncoder().encode(json) : d,
        ])
      )
    expect(() => readTtf(withBdfp('{not json'))).toThrow(/Malformed BDFP/)
    expect(() => readTtf(withBdfp('[]'))).toThrow(/Malformed BDFP/)
    expect(() => readTtf(withBdfp('{"ppu":64}'))).toThrow(/Malformed BDFP/)
    expect(() =>
      readTtf(
        withBdfp('{"ppu":0,"headers":{},"props":{},"propnames":{},"glyphs":[]}')
      )
    ).toThrow(/ppu/)
    expect(() =>
      readTtf(
        withBdfp(
          '{"ppu":64,"headers":{},"props":{},"propnames":{},"glyphs":[[1,2]]}'
        )
      )
    ).toThrow(/glyph entry/)
    expect(() =>
      readTtf(
        withBdfp(
          '{"ppu":64,"headers":{},"props":{},"propnames":{},"glyphs":[[9,2,"x"]]}'
        )
      )
    ).toThrow(/glyph entry/)
  })

  test('huge glyph boxes are rejected instead of exhausting the memory', () => {
    // corrupt BDFP box
    const json = JSON.parse(
      new TextDecoder().decode(
        tableData(good, parseDirectory(good).get('BDFP'))
      )
    )
    json.glyphs[0][3] = 100000
    json.glyphs[0][4] = 100000
    const tables = splitTables(good).map(([t, d]): [string, Uint8Array] => [
      t,
      t === 'BDFP' ? new TextEncoder().encode(JSON.stringify(json)) : d,
    ])
    expect(() => readTtf(assemble(tables))).toThrow(
      `Malformed TrueType font: glyph ${json.glyphs[0][0]} bounding box too large (100000x100000 pixels)`
    )
    json.glyphs[0][3] = 0
    json.glyphs[0][4] = 1e9
    const tables2 = splitTables(good).map(([t, d]): [string, Uint8Array] => [
      t,
      t === 'BDFP' ? new TextEncoder().encode(JSON.stringify(json)) : d,
    ])
    expect(() => readTtf(assemble(tables2))).toThrow(/too large/)
    // no BDFP and an absurd pixel size: every font unit is many pixels
    const plain = writeTtf(f, { metadata: false })
    expect(() => readTtf(plain, { pixelsize: 1e6 })).toThrow(/too large/)
  })

  test('short (spec) BDFP glyph entries [gid, cp, name]', () => {
    const json = JSON.parse(
      new TextDecoder().decode(
        tableData(good, parseDirectory(good).get('BDFP'))
      )
    )
    json.glyphs = json.glyphs.map((e: unknown[]) => e.slice(0, 3))
    const data = assemble(
      splitTables(good).map(([t, d]) => [
        t,
        t === 'BDFP' ? new TextEncoder().encode(JSON.stringify(json)) : d,
      ])
    )
    const g = readTtf(data)
    expect(g.headers).toEqual(f.headers)
    expect([...g.glyphs.keys()]).toEqual([...f.glyphs.keys()])
    for (const [cp, meta] of f.glyphs) {
      const m = g.glyphs.get(cp) as GlyphMetaInFont
      expect(m[0]).toBe(meta[0])
      expect(inkSet(m)).toEqual(inkSet(meta))
      expect(m[8]).toBe(meta[8])
      expect(m[6]).toBe(g.swidth(meta[8] as number))
    }
  })

  test('bad glyph data', () => {
    // loca pointing beyond glyf
    const tables = splitTables(good)
    const loca = tables.find(([t]) => t === 'loca')?.[1] as Uint8Array
    const badLoca = new Uint8Array(loca)
    new DataView(badLoca.buffer).setUint32(badLoca.length - 4, 1 << 20)
    expect(() =>
      readTtf(assemble(tables.map(([t, d]) => [t, t === 'loca' ? badLoca : d])))
    ).toThrow(/Malformed/)
    // bad indexToLocFormat
    const head = new Uint8Array(tables.find(([t]) => t === 'head')?.[1] ?? [])
    head[51] = 7
    expect(() =>
      readTtf(assemble(tables.map(([t, d]) => [t, t === 'head' ? head : d])))
    ).toThrow(/indexToLocFormat/)
    // numberOfHMetrics 0
    const hhea = new Uint8Array(tables.find(([t]) => t === 'hhea')?.[1] ?? [])
    hhea[34] = 0
    hhea[35] = 0
    expect(() =>
      readTtf(assemble(tables.map(([t, d]) => [t, t === 'hhea' ? hhea : d])))
    ).toThrow(/numberOfHMetrics/)
  })

  test('name table: invalid UTF-16 records are skipped, priorities', () => {
    const tables = splitTables(writeTtf(f, { metadata: false }))
    const recs: [number, number, number, number, Uint8Array][] = [
      // odd length → skipped
      [3, 1, 0x409, 6, new Uint8Array([0, 0x41, 0])],
      // lone surrogate → skipped
      [3, 1, 0x409, 4, new Uint8Array([0xd8, 0x00, 0, 0x41])],
      // other language, lower priority than 0x409
      [3, 1, 0x411, 1, new Uint8Array([0, 0x4a])],
      [3, 1, 0x409, 1, new Uint8Array([0, 0x45, 0, 0x4e])],
      // unsupported platform → ignored
      [2, 0, 0, 0, new Uint8Array([0x41])],
      // symbol encoding (3,0) accepted
      [3, 0, 0x409, 0, new Uint8Array([0, 0x43])],
    ]
    let size = 6 + 12 * recs.length
    for (const r of recs) size += r[4].length
    const name = new Uint8Array(size)
    const dv = new DataView(name.buffer)
    dv.setUint16(2, recs.length)
    dv.setUint16(4, 6 + 12 * recs.length)
    let so = 0
    recs.forEach(([pid, eid, lid, nid, b], i) => {
      const o = 6 + 12 * i
      dv.setUint16(o, pid)
      dv.setUint16(o + 2, eid)
      dv.setUint16(o + 4, lid)
      dv.setUint16(o + 6, nid)
      dv.setUint16(o + 8, b.length)
      dv.setUint16(o + 10, so)
      name.set(b, 6 + 12 * recs.length + so)
      so += b.length
    })
    const g = readTtf(
      assemble(tables.map(([t, d]) => [t, t === 'name' ? name : d])),
      { pixelsize: 24 }
    )
    expect(g.headers.fontname).toBe('Untitled')
    expect(g.props.family_name).toBe('EN')
    expect(g.props.copyright).toBe('C')
  })

  test('composite glyph cycle', () => {
    // glyph 1 = composite referencing itself
    const tables = splitTables(writeTtf(f, { metadata: false }))
    const glyf = tables.find(([t]) => t === 'glyf')?.[1] as Uint8Array
    const loca = tables.find(([t]) => t === 'loca')?.[1] as Uint8Array
    const dv = new DataView(loca.buffer)
    const start = dv.getUint32(4)
    const comp = new Uint8Array(20)
    const cdv = new DataView(comp.buffer)
    cdv.setInt16(0, -1)
    cdv.setUint16(10, 0x0002) // ARGS_ARE_XY_VALUES, bytes
    cdv.setUint16(12, 1) // glyph 1
    const newGlyf = new Uint8Array(glyf)
    newGlyf.set(comp, start)
    expect(() =>
      readTtf(
        assemble(tables.map(([t, d]) => [t, t === 'glyf' ? newGlyf : d])),
        { pixelsize: 24 }
      )
    ).toThrow(/too deep/)
  })
})

describe('writeTtf: option validation', () => {
  const f = loadFont(join(FONTS, 'spec_example_fixed.bdf'))
  test.each([
    [{ ppu: 3 }],
    [{ ppu: 0 }],
    [{ ppu: 2.5 }],
    [{ ppu: 64.0000001 }],
    [{ dotsize: 0 }],
    [{ dotsize: 1.51 }],
    [{ shape: 'hexagon' as 'square' }],
    [{ timestamp: 1.5 }],
  ])('%o throws', (opts) => {
    expect(() => writeTtf(f, opts)).toThrow()
  })

  test('unitsPerEm range', () => {
    // em 24: ppu 1000 → 24000 > 16384
    expect(() => writeTtf(f, { ppu: 1000 })).toThrow(/unitsPerEm/)
    const tiny = loadFont(join(FONTS, 'spec_example_fixed.bdf'))
    tiny.setprop('PIXEL_SIZE', 4)
    expect(() => writeTtf(tiny, { ppu: 2 })).toThrow(/unitsPerEm/)
    expect(() => writeTtf(new Font())).toThrow()
  })

  test('values that do not fit their TrueType field throw', () => {
    const g = loadFont(join(FONTS, 'spec_example_fixed.bdf'))
    const meta = g.glyphs.get(106) as GlyphMetaInFont
    meta[8] = -1 // negative advance
    expect(() => writeTtf(g)).toThrow(/out of range/)
    meta[8] = 8
    meta[4] = 1000 // x offset too large for int16 at ppu 64
    expect(() => writeTtf(g)).toThrow(/out of range/)
  })

  test('deterministic', () => {
    expect(firstDiff(writeTtf(f), writeTtf(f))).toBe(-1)
  })

  test('font without glyphs', () => {
    const e = Font.create({ pixelsize: 16 })
    const data = writeTtf(e)
    validateSfnt(data)
    const ot = opentype.parse(toArrayBuffer(data))
    expect(ot.numGlyphs).toBe(1)
    const g = readTtf(data)
    expect(g.glyphs.size).toBe(0)
    expect(g.headers).toEqual(e.headers)
    expect(g.props).toEqual(e.props)
  })

  test('non-Unicode charset: cmap goes through cp2char', () => {
    const g = loadFont(join(FONTS, 'unifont-13.0.04-enctest-gb2312.bdf'))
    const ot = opentype.parse(toArrayBuffer(writeTtf(g)))
    const unicodes = []
    for (let i = 1; i < ot.numGlyphs; i++) {
      unicodes.push(ot.glyphs.get(i).unicode)
    }
    const cps = [...g.glyphs.keys()].sort((a, b) => a - b)
    expect(unicodes).toEqual(
      cps.map((cp) => (g.cp2char(cp) as string).codePointAt(0))
    )
  })
})
