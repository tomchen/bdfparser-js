/**
 * Simulated browser: the IIFE bundle (`dist/bdfparser.global.js`, rebuilt here
 * into a temporary directory with the same tsup options) is evaluated in a
 * bare `vm` context that only has standard Web APIs — no `require`, no
 * `process`, no `Buffer` — exactly like a classic `<script src>` in a page.
 */
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import vm from 'vm'
import { gzipSync } from 'zlib'
import { build, type Options } from 'tsup'
import config from '../tsup.config'

type Lib = typeof import('../src/index')

let dir: string
let lib: Lib
let cjkCode: string
let context: vm.Context
let fetched: string[] = []
const warnings: string[] = []

const fontText = readFileSync(
  './test/fonts/unifont-13.0.04-for-test.bdf',
  'utf8'
)
const fontBytes = new Uint8Array(
  readFileSync('./test/fonts/spec_example_fixed.bdf')
)

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bdfparser-browser-'))
  await build({
    entry: { 'bdfparser.global': 'src/index.ts' },
    format: ['iife'],
    globalName: 'bdfparser',
    minify: true,
    target: 'es2020',
    platform: 'browser',
    outDir: dir,
    outExtension: () => ({ js: '.js' }),
    silent: true,
    config: false,
  })
  const cjkOptions = (config as Options[]).find(
    (c) =>
      typeof c.entry === 'object' &&
      !Array.isArray(c.entry) &&
      'bdfparser-cjk.global' in c.entry
  ) as Options
  await build({
    ...cjkOptions,
    sourcemap: false,
    outDir: dir,
    silent: true,
    config: false,
  })
  cjkCode = readFileSync(join(dir, 'bdfparser-cjk.global.js'), 'utf8')
  const code = readFileSync(join(dir, 'bdfparser.global.js'), 'utf8')
  const fetchMock = async (url: string | URL) => {
    fetched.push(String(url))
    const u = String(url)
    if (u.endsWith('.gz')) {
      return new Response(new Uint8Array(gzipSync(fontBytes)))
    }
    if (u.endsWith('missing.bdf')) {
      return new Response('', { status: 404, statusText: 'Not Found' })
    }
    return new Response(u.endsWith('spec.bdf') ? fontBytes : fontText)
  }
  context = vm.createContext({
    console: { ...console, warn: (m: string) => warnings.push(m) },
    TextDecoder,
    TextEncoder,
    DecompressionStream,
    URL,
    Response,
    Blob,
    fetch: fetchMock,
  })
  vm.runInContext(code, context, { filename: 'bdfparser.global.js' })
  lib = vm.runInContext('bdfparser', context) as Lib
}, 120000)

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  fetched = []
})

const fakeCanvas = () => {
  const calls: [string, number, number, number, number][] = []
  const ctx = {
    fillStyle: '' as unknown,
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push([String(this.fillStyle), x, y, w, h])
    },
  }
  return { ctx, calls }
}

describe('IIFE bundle in a browser-like context', () => {
  test('exposes the global `bdfparser` without Node globals', () => {
    expect(typeof lib.Font).toBe('function')
    expect(typeof lib.$Font).toBe('function')
    expect(typeof lib.Bitmap.fromstring).toBe('function')
    expect(typeof lib.readPcf).toBe('function')
    expect(typeof lib.writeTtf).toBe('function')
    expect(lib.VERSION).toBe('3.0.0')
  })

  test('$Font(string) + draw + draw2canvas with x, y, pixelsize (issue #2)', async () => {
    const font = await lib.$Font(fontText)
    const bitmap = font.draw('Hi')
    const { ctx, calls } = fakeCanvas()
    bitmap.draw2canvas(ctx, {
      x: 100,
      y: 50,
      pixelsize: 3,
      pixelcolors: { '0': null, '1': '#0f0', '2': null },
    })
    const ink = bitmap.bindata
      .join('')
      .split('')
      .filter((c) => c === '1').length
    expect(calls).toHaveLength(ink)
    expect(
      calls.every(([c, , , w, h]) => c === '#0f0' && w === 3 && h === 3)
    ).toBe(true)
    const first = bitmap.bindata.findIndex((r) => r.includes('1'))
    expect(calls[0][1]).toBe(100 + bitmap.bindata[first].indexOf('1') * 3)
    expect(calls[0][2]).toBe(50 + first * 3)
    // legacy signature
    const legacy = fakeCanvas()
    bitmap.draw2canvas(legacy.ctx, { '1': 'black' }, 7, 8)
    expect(legacy.calls[0][1]).toBe(7 + bitmap.bindata[first].indexOf('1'))
  })

  test('load_url with a mocked fetch (plain and gzip), $Font(URL)', async () => {
    const font = await new lib.Font().load_url('https://cdn.example/spec.bdf')
    expect(font.glyphs.size).toBe(2)
    const gz = await new lib.Font().load_url('https://cdn.example/spec.pcf.gz')
    expect(gz.glyphs.size).toBe(2)
    const viaUrl = await lib.$Font(new URL('https://cdn.example/unifont.bdf'))
    expect(viaUrl.glyphs.size).toBe(849)
    expect(fetched).toEqual([
      'https://cdn.example/spec.bdf',
      'https://cdn.example/spec.pcf.gz',
      'https://cdn.example/unifont.bdf',
    ])
    await expect(
      new lib.Font().load_url('https://cdn.example/missing.bdf')
    ).rejects.toThrow('404')
  })

  test('bytes from this realm (cross-realm Uint8Array / ArrayBuffer)', () => {
    const font = new lib.Font().load_bytes(fontBytes)
    expect(font.glyphs.size).toBe(2)
    expect(
      new lib.Font().load_bytes(fontBytes.slice().buffer).glyphs.size
    ).toBe(2)
    const pcf = font.topcf()
    expect(new lib.Font().load_bytes(pcf).glyphs.size).toBe(2)
    const ttf = font.tottf({ shape: 'circle' })
    expect(new lib.Font().load_bytes(ttf).tobdf()).toBe(font.tobdf())
  })

  test('non-Unicode charsets work without iconv (TextDecoder only)', async () => {
    const big5 = readFileSync(
      './test/fonts/unifont-13.0.04-enctest-big5.bdf',
      'utf8'
    )
    const font = await lib.$Font(big5)
    expect(font.charset).toBe('big5')
    expect(font.lacksglyphs('A人光')).toBeNull()
    expect(lib.getCodec('cp1251').exact).toBe(true) // single-byte: built in
  })

  test('bdfparser-cjk.global.js: needs bdfparser.global.js first, then registers the exact tables', () => {
    expect(() =>
      vm.runInContext(cjkCode, vm.createContext({}), {
        filename: 'bdfparser-cjk.global.js',
      })
    ).toThrow('load bdfparser.global.js first')
    expect(lib.getCodec('big5').exact).toBe(false)
    vm.runInContext(cjkCode, context, { filename: 'bdfparser-cjk.global.js' })
    expect(lib.getCodec('big5').exact).toBe(true)
    expect(lib.cp2char(0xa741, 'big5')).toBe('你')
    expect(lib.char2cp('😀', 'gb18030')).toBe(0x9439fc36)
    expect(lib.cp2char(0x8740, 'cp932')).toBe('①')
  })

  test('warnings go through console.warn by default', () => {
    new lib.Font()
      .load_string(readFileSync('./test/fonts/spec_example_bad.bdf', 'utf8'))
      .glyph("'")!
      .draw()
    expect(
      warnings.some((w) => w.startsWith('[bdfparser] Glyph "quoteright"'))
    ).toBe(true)
  })
})
