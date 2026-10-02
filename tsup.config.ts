import { defineConfig, type Options } from 'tsup'

type Plugin = NonNullable<Options['esbuildPlugins']>[number]

/**
 * `src/cjk.ts` imports `registerCharsetTables` from `./index`: in the
 * sub-module builds that import must stay external, pointing at the core
 * build next to it (`./index.js` / `./index.cjs`), so that the tables are
 * registered into the very registry the core uses.
 */
const coreExternal: Plugin = {
  name: 'bdfparser-core-external',
  setup(build) {
    const ext = build.initialOptions.format === 'cjs' ? '.cjs' : '.js'
    build.onResolve({ filter: /^\.\/index$/ }, (args) =>
      args.importer.endsWith('cjk.ts')
        ? { path: `./index${ext}`, external: true }
        : undefined
    )
  },
}

/**
 * IIFE sub-module (`bdfparser-cjk.global.js`): `./index` is the global
 * `bdfparser` of `bdfparser.global.js`, which must be loaded first.
 */
const coreGlobal: Plugin = {
  name: 'bdfparser-core-global',
  setup(build) {
    build.onResolve({ filter: /^\.\/index$/ }, (args) =>
      args.importer.endsWith('cjk.ts')
        ? { path: 'bdfparser-global', namespace: 'bdfparser-global' }
        : undefined
    )
    build.onLoad({ filter: /.*/, namespace: 'bdfparser-global' }, () => ({
      contents: `
const g = globalThis.bdfparser
if (!g || typeof g.registerCharsetTables !== 'function') {
  throw new Error('bdfparser-cjk.global.js: load bdfparser.global.js first')
}
export const registerCharsetTables = g.registerCharsetTables
`,
      loader: 'js',
    }))
  },
}

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    sourcemap: true,
    // no `keepNames` here: its `__name(...)` calls are side effects that
    // defeat tree-shaking (importing only `warn` would pull in everything);
    // the unminified ESM/CJS builds keep the original names anyway
    clean: true,
    target: 'es2020',
  },
  {
    // optional sub-module `bdfparser/cjk` (exact multi-byte charset tables)
    entry: { cjk: 'src/cjk.ts' },
    format: ['esm', 'cjs'],
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    sourcemap: true,
    target: 'es2020',
    esbuildPlugins: [coreExternal],
  },
  {
    entry: { 'bdfparser.global': 'src/index.ts' },
    format: ['iife'],
    globalName: 'bdfparser',
    minify: true,
    sourcemap: true,
    keepNames: true,
    target: 'es2020',
    platform: 'browser',
    outExtension: () => ({ js: '.js' }),
  },
  {
    entry: { 'bdfparser-cjk.global': 'src/cjk.ts' },
    format: ['iife'],
    minify: true,
    sourcemap: true,
    target: 'es2020',
    platform: 'browser',
    outExtension: () => ({ js: '.js' }),
    esbuildPlugins: [coreGlobal],
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  },
])
