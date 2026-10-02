import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
  },
  {
    entry: { 'bdfparser.global': 'src/index.ts' },
    format: ['iife'],
    globalName: 'bdfparser',
    minify: true,
    sourcemap: true,
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
