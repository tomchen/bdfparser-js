/**
 * Package build checks: the ESM / CJS builds made with the real
 * `tsup.config.ts` options must keep the public class names and be
 * tree-shakable (`"sideEffects": false` only helps if the bundle itself has no
 * top-level side effects, e.g. esbuild `keepNames` `__name(...)` calls).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { build, type Options } from 'tsup'
import config from '../tsup.config'

let dir: string

const libOptions = (): Options => {
  const all = (Array.isArray(config) ? config : [config]) as Options[]
  const lib = all.find(
    (c) =>
      typeof c.entry === 'object' &&
      !Array.isArray(c.entry) &&
      'index' in c.entry
  )
  if (lib === undefined) {
    throw new Error('no ESM/CJS library entry in tsup.config.ts')
  }
  return lib
}

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
  await build({
    ...libOptions(),
    dts: false,
    sourcemap: false,
    outDir: join(dir, 'lib'),
    silent: true,
    config: false,
  })
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

  test('is tree-shakable', async () => {
    const full = await consumerSize(['Font'])
    const warnOnly = await consumerSize(['setWarningHandler'])
    const bitmapOnly = await consumerSize(['Bitmap'])
    // the whole library is ~85 kB minified; `setWarningHandler` alone is tiny
    expect(full).toBeGreaterThan(50000)
    expect(warnOnly).toBeLessThan(5000)
    expect(bitmapOnly).toBeLessThan(full / 3)
  })
})
