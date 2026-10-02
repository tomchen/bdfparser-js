import { defineConfig } from 'tsup'

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
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  },
])
