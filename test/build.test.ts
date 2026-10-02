/**
 * Package build checks: the ESM / CJS builds made with the real
 * `tsup.config.ts` options must keep the public class names and be
 * tree-shakable (`"sideEffects": false` only helps if the bundle itself has no
 * top-level side effects, e.g. esbuild `keepNames` `__name(...)` calls); the
 * `bdfparser/cjk` sub-module must register its tables into the core build
 * next to it; the type declarations must need neither the DOM nor the
 * Node.js types.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { build, type Options } from 'tsup'
import config from '../tsup.config'
import pkg from '../package.json'

let dir: string

const entryOptions = (name: string): Options => {
  const all = (Array.isArray(config) ? config : [config]) as Options[]
  const lib = all.find(
    (c) =>
      typeof c.entry === 'object' &&
      !Array.isArray(c.entry) &&
      name in c.entry &&
      (c.format as string[]).includes('esm')
  )
  if (lib === undefined) {
    throw new Error(`no ESM/CJS entry '${name}' in tsup.config.ts`)
  }
  return lib
}
const libOptions = (): Options => entryOptions('index')

/** bundle (minified, tree-shaken) a consumer importing `names` from the ESM build */
const consumerSize = async (names: string[]): Promise<number> => {
  const entry = join(dir, `use-${names.join('-')}.mjs`)
  writeFileSync(
    entry,
    `import { ${names.join(', ')} } from ${JSON.stringify(
      join(dir, 'lib', 'index.js')
    )}\nconsole.log(${names.join(', ')})\n`
  )
  const out = join(dir, 'out-' + names.join('-'))
  await build({
    entry: { bundle: entry },
    format: ['esm'],
    minify: true,
    outDir: out,
    silent: true,
    config: false,
    platform: 'neutral',
    outExtension: () => ({ js: '.js' }),
  })
  return readFileSync(join(out, 'bundle.js')).length
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bdfparser-build-'))
  for (const name of ['index', 'cjk']) {
    await build({
      ...entryOptions(name),
      dts: name === 'cjk' ? entryOptions(name).dts : false,
      sourcemap: false,
      clean: false,
      outDir: join(dir, 'lib'),
      silent: true,
      config: false,
    })
  }
}, 120000)

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ESM / CJS build', () => {
  test('public classes keep their names', async () => {
    for (const file of ['index.js', 'index.cjs']) {
      const m = (await import(
        pathToFileURL(join(dir, 'lib', file)).href
      )) as typeof import('../src/index')
      expect(m.Font.name).toBe('Font')
      expect(m.Glyph.name).toBe('Glyph')
      expect(m.Bitmap.name).toBe('Bitmap')
      expect(m.BDFParseError.name).toBe('BDFParseError')
      expect(new m.BDFParseError('x').name).toBe('BDFParseError')
    }
  })

  test('bdfparser/cjk registers its tables into the core build (ESM and CJS)', async () => {
    const esm = (await import(
      pathToFileURL(join(dir, 'lib', 'index.js')).href
    )) as typeof import('../src/index')
    esm.setWarningHandler(null)
    expect(esm.getCodec('big5').exact).toBe(false)
    await import(pathToFileURL(join(dir, 'lib', 'cjk.js')).href)
    expect(esm.getCodec('big5').exact).toBe(true)
    expect(esm.cp2char(0xa741, 'big5')).toBe('你')
    const req = createRequire(import.meta.url)
    const cjs = req(
      join(dir, 'lib', 'index.cjs')
    ) as typeof import('../src/index')
    cjs.setWarningHandler(null)
    expect(cjs.getCodec('gb18030').exact).toBe(false)
    const cjk = req(join(dir, 'lib', 'cjk.cjs')) as typeof import('../src/cjk')
    expect(Object.keys(cjk.cjkTables.tables)).toContain('gb18030')
    expect(cjs.getCodec('gb18030').exact).toBe(true)
    expect(cjs.char2cp('😀', 'gb18030')).toBe(0x9439fc36)
  })

  test('package.json: cjk export, sideEffects', () => {
    const exp = pkg.exports['./cjk']
    expect(exp.import).toEqual({
      types: './dist/cjk.d.ts',
      default: './dist/cjk.js',
    })
    expect(exp.require).toEqual({
      types: './dist/cjk.d.cts',
      default: './dist/cjk.cjs',
    })
    // only the sub-module (and the IIFE scripts) have side effects
    expect(pkg.sideEffects).toEqual([
      './dist/cjk.js',
      './dist/cjk.cjs',
      './dist/bdfparser.global.js',
      './dist/bdfparser-cjk.global.js',
      // for bundling the sources (e.g. tools/parity/run_js.ts under Node)
      './src/cjk.ts',
    ])
    expect(pkg.scripts.parity).toBe('python3 tools/parity/run_all.py')
  })

  test('the type declarations need neither DOM nor Node.js types', async () => {
    await build({
      ...libOptions(),
      dts: { only: true, compilerOptions: { ignoreDeprecations: '6.0' } },
      sourcemap: false,
      clean: false,
      outDir: join(dir, 'lib'),
      silent: true,
      config: false,
    })
    const out = execFileSync(
      process.execPath,
      ['tools/check-dts.mjs', join(dir, 'lib')],
      { encoding: 'utf8' }
    )
    expect(out).toContain('need neither DOM nor Node.js types')
  }, 120000)

  test('is tree-shakable', async () => {
    const full = await consumerSize(['Font'])
    const warnOnly = await consumerSize(['setWarningHandler'])
    const bitmapOnly = await consumerSize(['Bitmap'])
    // the whole library is ~85 kB minified; `setWarningHandler` alone is tiny
    expect(full).toBeGreaterThan(50000)
    expect(warnOnly).toBeLessThan(5000)
    expect(bitmapOnly).toBeLessThan(full / 3)
    // the multi-byte tables are not in the core (only in bdfparser/cjk)
    expect(full).toBeLessThan(140000)
    const charsetOnly = await consumerSize(['cp2char'])
    expect(charsetOnly).toBeLessThan(25000)
  })
})
