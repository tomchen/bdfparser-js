/**
 * Command line interface (SPEC-v3 §9), Node.js only:
 *
 * ```
 * bdfparser convert INPUT OUTPUT [--shape square|circle] [--dotsize F] [--ppu N]
 *                                [--pixelsize N] [--charset NAME]
 * bdfparser info INPUT [--pixelsize N]
 * bdfparser preview INPUT TEXT [--pixelsize N]
 * ```
 *
 * Input: `.bdf`, `.pcf`, `.pcf.gz`, `.ttf` (auto-detected by content). Output
 * format by extension: `.bdf`, `.pcf`, `.ttf`, `.svg` (SVG font).
 *
 * @module
 */

import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { VERSION } from './constants'
import { Font } from './Font'
import { PropValue } from './types'
import { setWarningHandler } from './warn'

/** Output streams used by {@link main} (injectable for tests) */
export type CliIO = {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

const defaultIO: CliIO = {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
}

const OUTPUT_FORMATS = ['bdf', 'pcf', 'ttf', 'svg'] as const
type OutputFormat = (typeof OUTPUT_FORMATS)[number]

const USAGE = `usage: bdfparser [-h] [--version] [-q] {convert,info,preview} ...

BDF / PCF / TTF bitmap font parser, editor and converter

commands:
  convert INPUT OUTPUT [--shape square|circle] [--dotsize F] [--ppu N]
                       [--pixelsize N] [--charset NAME]
                      convert a font (.bdf .pcf .pcf.gz .ttf) to .bdf .pcf .ttf or .svg
  info INPUT [--pixelsize N]
                      print font information
  preview INPUT TEXT [--pixelsize N]
                      print TEXT rendered with # and .

options:
  -h, --help          show this help message and exit
  --version           show program's version number and exit
  -q, --quiet         do not print warnings
`

class UsageError extends Error {}

type Args = {
  command: string
  positional: string[]
  options: Record<string, string>
  quiet: boolean
}

const VALUE_OPTIONS = new Set([
  'shape',
  'dotsize',
  'ppu',
  'pixelsize',
  'charset',
])

const parseArgs = (argv: string[]): Args | 'help' | 'version' => {
  const positional: string[] = []
  const options: Record<string, string> = {}
  let quiet = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') {
      return 'help'
    }
    if (a === '--version' || a === '-V') {
      return 'version'
    }
    if (a === '-q' || a === '--quiet') {
      quiet = true
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq)
      if (!VALUE_OPTIONS.has(name)) {
        throw new UsageError(`unrecognized option: ${a}`)
      }
      let value: string
      if (eq !== -1) {
        value = a.slice(eq + 1)
      } else {
        if (i + 1 >= argv.length) {
          throw new UsageError(`option --${name} expects a value`)
        }
        value = argv[++i]
      }
      options[name] = value
    } else {
      positional.push(a)
    }
  }
  const command = positional.shift()
  if (command === undefined) {
    throw new UsageError('a command is required (convert, info or preview)')
  }
  return { command, positional, options, quiet }
}

const intOption = (args: Args, name: string): number | undefined => {
  const v = args.options[name]
  if (v === undefined) {
    return undefined
  }
  if (!/^[+-]?\d+$/.test(v)) {
    throw new UsageError(`--${name}: invalid int value: '${v}'`)
  }
  return parseInt(v, 10)
}

const floatOption = (args: Args, name: string): number | undefined => {
  const v = args.options[name]
  if (v === undefined) {
    return undefined
  }
  const n = Number(v)
  if (v.trim() === '' || Number.isNaN(n)) {
    throw new UsageError(`--${name}: invalid float value: '${v}'`)
  }
  return n
}

/**
 * Load a font file (BDF, PCF, gzip-compressed PCF/BDF or TTF, auto-detected).
 *
 * @param path - File path
 * @param pixelsize - Pixel size for TTF files without `BDFP` table
 *
 * @returns Loaded `Font`
 */
export const loadFontFile = (path: string, pixelsize?: number): Font => {
  let data: Uint8Array = readFileSync(path)
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    data = gunzipSync(data)
  }
  return new Font().load_bytes(data, { pixelsize })
}

const outputFormat = (path: string): OutputFormat => {
  const lower = path.toLowerCase()
  for (const fmt of OUTPUT_FORMATS) {
    if (lower.endsWith('.' + fmt)) {
      return fmt
    }
  }
  throw new Error(
    `cannot tell the output format from '${path}' (use .bdf, .pcf, .ttf or .svg)`
  )
}

const propvalue = (v: PropValue | string[] | undefined): string => {
  if (v === null || v === undefined) {
    return ''
  }
  if (typeof v === 'number') {
    return String(v)
  }
  if (Array.isArray(v)) {
    return v.join(' | ')
  }
  return '"' + v.replace(/"/g, '""') + '"'
}

const expectPositional = (args: Args, n: number, names: string): void => {
  if (args.positional.length !== n) {
    throw new UsageError(`${args.command} expects ${names}`)
  }
}

const cmdConvert = (args: Args): number => {
  expectPositional(args, 2, 'INPUT OUTPUT')
  const [input, output] = args.positional
  const shape = args.options.shape
  if (shape !== undefined && shape !== 'square' && shape !== 'circle') {
    throw new UsageError(
      `--shape: invalid choice: '${shape}' (choose from 'square', 'circle')`
    )
  }
  const dotsize = floatOption(args, 'dotsize')
  const ppu = intOption(args, 'ppu')
  const fmt = outputFormat(output)
  const font = loadFontFile(input, intOption(args, 'pixelsize'))
  if (args.options.charset) {
    font.charsetconvert(args.options.charset)
  }
  let data: Uint8Array | string
  switch (fmt) {
    case 'bdf':
      data = font.tobdf()
      break
    case 'pcf':
      data = font.topcf()
      break
    case 'ttf': {
      const opts: {
        shape?: 'square' | 'circle'
        dotsize?: number
        ppu?: number
      } = {}
      if (shape !== undefined) {
        opts.shape = shape
      }
      if (dotsize !== undefined) {
        opts.dotsize = dotsize
      }
      if (ppu !== undefined) {
        opts.ppu = ppu
      }
      data = font.tottf(opts)
      break
    }
    case 'svg':
      data = font.tosvgfont()
      break
  }
  writeFileSync(output, data)
  return 0
}

const cmdInfo = (args: Args, io: CliIO): number => {
  expectPositional(args, 1, 'INPUT')
  const font = loadFontFile(args.positional[0], intOption(args, 'pixelsize'))
  const h = font.headers
  const lines = [
    `fontname: ${h.fontname ?? ''}`,
    `glyphs: ${font.glyphs.size} (+ ${font.unencoded.length} unencoded)`,
    `bbox: ${h.fbbx} ${h.fbby} ${h.fbbxoff} ${h.fbbyoff}`,
    `charset: ${font.charset}`,
    'properties:',
  ]
  for (const [k, v] of Object.entries(font.props)) {
    const name =
      k === 'comment' ? 'COMMENT' : (font._propnames.get(k) ?? k.toUpperCase())
    lines.push(`  ${name} ${propvalue(v)}`.trimEnd())
  }
  io.stdout(lines.join('\n') + '\n')
  return 0
}

const cmdPreview = (args: Args, io: CliIO): number => {
  expectPositional(args, 2, 'INPUT TEXT')
  const font = loadFontFile(args.positional[0], intOption(args, 'pixelsize'))
  io.stdout(font.draw(args.positional[1]).toString() + '\n')
  return 0
}

/**
 * Entry point of the `bdfparser` command.
 *
 * @param argv - Arguments (without `node` and the script path)
 * @param io - Output streams
 *
 * @returns Exit status (0 success, 1 error, 2 usage error)
 */
export const main = (
  argv: string[] = process.argv.slice(2),
  io: CliIO = defaultIO
): number => {
  let args: Args | 'help' | 'version'
  try {
    args = parseArgs(argv)
  } catch (e) {
    io.stderr(`${USAGE}bdfparser: error: ${(e as Error).message}\n`)
    return 2
  }
  if (args === 'help') {
    io.stdout(USAGE)
    return 0
  }
  if (args === 'version') {
    io.stdout(`bdfparser ${VERSION}\n`)
    return 0
  }
  const previous = setWarningHandler(
    args.quiet ? null : (m) => io.stderr(`[bdfparser] warning: ${m}\n`)
  )
  try {
    switch (args.command) {
      case 'convert':
        return cmdConvert(args)
      case 'info':
        return cmdInfo(args, io)
      case 'preview':
        return cmdPreview(args, io)
      default:
        throw new UsageError(
          `invalid command: '${args.command}' (choose from 'convert', 'info', 'preview')`
        )
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`${USAGE}bdfparser: error: ${e.message}\n`)
      return 2
    }
    io.stderr(`bdfparser: error: ${(e as Error).message}\n`)
    return 1
  } finally {
    setWarningHandler(previous)
  }
}

/** `true` when this module is the executed script (also through npm's bin symlink) */
const isEntry = (): boolean => {
  try {
    const script = process.argv[1]
    return (
      script !== undefined &&
      import.meta.url === pathToFileURL(realpathSync(script)).href
    )
  } catch {
    return false
  }
}

if (isEntry()) {
  process.exitCode = main()
}
