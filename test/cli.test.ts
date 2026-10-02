import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { gzipSync } from 'zlib'
import { loadFontFile, main } from '../src/cli'
import {
  Font,
  VERSION,
  getCodec,
  readPcf,
  setWarningHandler,
} from '../src/index'

const SPEC = './test/fonts/spec_example_fixed.bdf'
const UNIFONT = './test/fonts/unifont-13.0.04-for-test.bdf'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bdfparser-cli-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const run = (...argv: string[]) => {
  let stdout = ''
  let stderr = ''
  const code = main(argv, {
    stdout: (t) => {
      stdout += t
    },
    stderr: (t) => {
      stderr += t
    },
  })
  return { code, stdout, stderr }
}

describe('cli', () => {
  test('help and version', () => {
    for (const a of ['-h', '--help']) {
      const r = run(a)
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('usage: bdfparser')
    }
    expect(run('--version').stdout).toBe(`bdfparser ${VERSION}\n`)
    expect(run('-V').code).toBe(0)
  })

  test('info (same output as the Python CLI)', () => {
    const r = run('info', SPEC)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe(`fontname: Helvetica-BoldOblique
glyphs: 2 (+ 0 unencoded)
bbox: 9 24 -2 -6
charset: iso10646
properties:
  MinSpace 4
  Copyright "Copyright (c) 1987 Adobe Systems, Inc."
`)
    const f = Font.create()
    f.props.comment = ['a', 'b']
    f.setprop('EMPTY', null)
    f.setprop('Q', 'say "x"')
    f.newglyph(-1)
    const p = join(dir, 'info.bdf')
    writeFileSync(p, f.tobdf())
    const r2 = run('info', p)
    expect(r2.stdout).toContain('glyphs: 0 (+ 1 unencoded)\n')
    expect(r2.stdout).toContain('  COMMENT a | b\n')
    expect(r2.stdout).toContain('  EMPTY\n')
    expect(r2.stdout).toContain('  Q "say ""x"""\n')
  })

  test('preview', () => {
    const r = run('preview', UNIFONT, 'Hi')
    expect(r.code).toBe(0)
    expect(r.stdout.split('\n')[4]).toBe('.#....#.....#...........')
  })

  test('convert to every format, including .pcf.gz input', () => {
    const pcf = join(dir, 'a.pcf')
    expect(run('convert', SPEC, pcf).code).toBe(0)
    const font = new Font().load_string(readFileSync(SPEC, 'utf8'))
    expect(new Uint8Array(readFileSync(pcf))).toEqual(font.topcf())
    const gz = join(dir, 'a.pcf.gz')
    writeFileSync(gz, gzipSync(readFileSync(pcf)))
    const ttf = join(dir, 'a.ttf')
    expect(
      run(
        'convert',
        gz,
        ttf,
        '--shape',
        'circle',
        '--dotsize=0.8',
        '--ppu',
        '10'
      ).code
    ).toBe(0)
    expect(new Uint8Array(readFileSync(ttf))).toEqual(
      readPcf(font.topcf()).tottf({ shape: 'circle', dotsize: 0.8, ppu: 10 })
    )
    const bdf = join(dir, 'b.bdf')
    expect(run('convert', ttf, bdf).code).toBe(0)
    expect(loadFontFile(bdf).glyphs.size).toBe(2)
    const svg = join(dir, 'c.SVG')
    expect(run('convert', SPEC, svg).code).toBe(0)
    expect(readFileSync(svg, 'utf8')).toBe(font.tosvgfont())
  })

  test('convert with --charset', () => {
    const out = join(dir, 'gb.bdf')
    const r = run('convert', UNIFONT, out, '--charset', 'gb2312', '-q')
    expect(r.code).toBe(0)
    expect(r.stderr).toBe('')
    const f = loadFontFile(out)
    expect(f.props.charset_registry).toBe('GB2312.1980')
    expect(f.glyph('的')?.cp()).toBe(0x3544)
    // the CLI loads the exact multi-byte tables (bdfparser/cjk)
    expect(getCodec('gb2312').exact).toBe(true)
  })

  test('warnings go to stderr unless --quiet', () => {
    const r = run('convert', UNIFONT, join(dir, 'w.bdf'), '--charset', 'gb2312')
    expect(r.code).toBe(0)
    expect(r.stderr).toMatch(
      /^\[bdfparser\] warning: \d+ glyph\(s\) could not be converted/
    )
    // the handler is restored afterwards
    const msgs: string[] = []
    setWarningHandler((m) => msgs.push(m))
    run('info', SPEC)
    new Font()
      .load_string(readFileSync('./test/fonts/spec_example_bad.bdf', 'utf8'))
      .glyph("'")!
      .draw()
    expect(msgs).toHaveLength(1)
    setWarningHandler(undefined)
  })

  test('TTF without BDFP needs --pixelsize', () => {
    const font = new Font().load_string(readFileSync(SPEC, 'utf8'))
    const p = join(dir, 'nometa.ttf')
    writeFileSync(p, font.tottf({ metadata: false }))
    const r = run('info', p)
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/^bdfparser: error: /)
    const r2 = run('info', p, '--pixelsize', '24')
    expect(r2.code).toBe(0)
    expect(r2.stdout).toContain('glyphs: 2')
  })

  test.each([
    [[], 'a command is required'],
    [['frob'], "invalid command: 'frob'"],
    [['info'], 'info expects INPUT'],
    [['convert', SPEC], 'convert expects INPUT OUTPUT'],
    [['preview', SPEC], 'preview expects INPUT TEXT'],
    [['info', SPEC, '--bogus'], 'unrecognized option: --bogus'],
    [['info', SPEC, '--pixelsize'], 'option --pixelsize expects a value'],
    [['info', SPEC, '--pixelsize', 'x'], "--pixelsize: invalid int value: 'x'"],
    [
      ['convert', SPEC, 'o.ttf', '--dotsize', 'big'],
      "--dotsize: invalid float value: 'big'",
    ],
    [
      ['convert', SPEC, 'o.ttf', '--shape', 'star'],
      "--shape: invalid choice: 'star'",
    ],
  ])('usage error %j', (argv, msg) => {
    const r = run(...(argv as string[]))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(`bdfparser: error: ${msg}`)
  })

  test('runtime errors', () => {
    let r = run('convert', SPEC, join(dir, 'x.png'))
    expect(r.code).toBe(1)
    expect(r.stderr).toContain("cannot tell the output format from '")
    r = run('info', join(dir, 'missing.bdf'))
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('ENOENT')
    const bad = join(dir, 'bad.bdf')
    writeFileSync(bad, 'STARTFONT 2.1\nSIZE x\n')
    r = run('info', bad)
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('line 2: SIZE needs 3 numbers')
  })

  test('runs as a script', () => {
    let out: string
    try {
      out = execFileSync('bun', ['src/cli.ts', '--version'], {
        encoding: 'utf8',
      })
    } catch {
      return // bun not available
    }
    expect(out).toBe(`bdfparser ${VERSION}\n`)
  })
})
