import { Bitmap, Font, fmtnum } from '../src/index'

/** Parse `M x y (H x | V y)* Z` path data into polygons */
const parsePath = (d: string): [number, number][][] => {
  const polys: [number, number][][] = []
  const re = /([MHVZ])\s*(-?[\d.]+)?(?:\s+(-?[\d.]+))?/g
  let cur: [number, number][] = []
  let x = 0
  let y = 0
  for (const m of d.matchAll(re)) {
    switch (m[1]) {
      case 'M':
        x = Number(m[2])
        y = Number(m[3])
        cur = [[x, y]]
        break
      case 'H':
        x = Number(m[2])
        cur.push([x, y])
        break
      case 'V':
        y = Number(m[2])
        cur.push([x, y])
        break
      case 'Z':
        polys.push(cur)
        break
    }
  }
  return polys
}

/** Rasterize polygons (non-zero winding) at pixel centres, y down */
const rasterizePath = (polys: [number, number][][], w: number, h: number) => {
  const rows: string[] = []
  for (let r = 0; r < h; r++) {
    let row = ''
    for (let c = 0; c < w; c++) {
      const px = c + 0.5
      const py = r + 0.5
      let wn = 0
      for (const p of polys) {
        for (let i = 0; i < p.length; i++) {
          const [x0, y0] = p[i]
          const [x1, y1] = p[(i + 1) % p.length]
          if (x0 === x1 && x0 > px) {
            if (y0 <= py && py < y1) wn++
            else if (y1 <= py && py < y0) wn--
          }
        }
      }
      row += wn !== 0 ? '1' : '0'
    }
    rows.push(row)
  }
  return rows
}

/** seeded PRNG */
const mulberry32 = (a: number) => () => {
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe('Bitmap.tosvg', () => {
  const b = new Bitmap(['0111', '0101', '1110'])

  test('path (merged outline, holes)', () => {
    expect(b.tosvg()).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><path d="M0 3V2H1V0H4V2H3V1H2V2H3V3Z" fill="#000000" /></svg>'
    )
    expect(b.tosvg(2, 'pathOnly', true, { x: 1, y: -2 })).toBe(
      'M1 -2V0H3V4H9V0H7V2H5V0H7V-2Z'
    )
    const hole = new Bitmap(['111', '101', '111'])
    expect(hole.tosvg(1, 'pathOnly')).toBe('M0 3V0H3V3ZM1 2H2V1H1Z')
  })

  test('random bitmaps: the path covers exactly the ink pixels', () => {
    const rand = mulberry32(42)
    for (let n = 0; n < 300; n++) {
      const w = 1 + Math.floor(rand() * 9)
      const h = 1 + Math.floor(rand() * 9)
      const rows = Array.from({ length: h }, () =>
        Array.from({ length: w }, () =>
          rand() < 0.45 ? (rand() < 0.2 ? '2' : '1') : '0'
        ).join('')
      )
      const bm = new Bitmap(rows)
      const expected = rows.map((r) => r.replace(/2/g, '1'))
      expect(rasterizePath(parsePath(bm.tosvg(1, 'pathOnly')), w, h)).toEqual(
        expected
      )
      // inverted = vertically mirrored
      const inv = parsePath(bm.tosvg(1, 'pathOnly', true)).map((p) =>
        p.map(([x, y]) => [x, h - y] as [number, number])
      )
      expect(rasterizePath(inv, w, h)).toEqual(expected)
    }
  })

  test('circle', () => {
    expect(new Bitmap(['10', '01']).tosvg(1, 'path', false, {}, 'circle')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path d="M1 1.5a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0 -1 0ZM0 0.5a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0 -1 0Z" fill="#000000" /></svg>'
    )
    expect(
      new Bitmap(['10']).tosvg(4, 'pathOnly', true, { x: 1, y: 1 }, 'circle')
    ).toBe('M1 3a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z')
  })

  test('rect: unchanged greedy rectangles; "2" pixels filled black', () => {
    expect(new Bitmap(['1122', '1100']).tosvg(1, 'rect')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><rect x="0" y="0" width="2" height="2" fill="#000000" /><rect x="2" y="0" width="2" height="1" fill="#000000" /></svg>'
    )
    expect(() => b.tosvg(1, 'rect', false, {}, 'circle')).toThrow(
      'only supports'
    )
  })

  test('empty bitmaps', () => {
    for (const e of [new Bitmap([]), Bitmap.blank(3, 2)]) {
      expect(e.tosvg(1, 'pathOnly')).toBe('')
      expect(e.tosvg(1, 'pathOnly', false, {}, 'circle')).toBe('')
      expect(e.tosvg(2)).toBe(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${e.width() * 2}" height="${e.height() * 2}"></svg>`
      )
      expect(e.tosvg(2, 'rect')).toBe(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${e.width() * 2}" height="${e.height() * 2}"></svg>`
      )
    }
  })

  test('fractional pixel sizes use the shortest representation', () => {
    expect(new Bitmap(['1']).tosvg(0.1, 'pathOnly')).toBe('M0 0.1V0H0.1V0.1Z')
    expect(fmtnum(3)).toBe('3')
    expect(fmtnum(-0)).toBe('0')
    expect(fmtnum(0.30000000000000004)).toBe('0.30000000000000004')
  })

  test('invalid arguments', () => {
    expect(() => b.tosvg(1, 'png' as 'path')).toThrow(
      'Unknown SVG format "png"'
    )
    expect(() => b.tosvg(1, 'path', false, {}, 'star' as 'square')).toThrow(
      'Unknown shape "star"'
    )
  })
})

describe('Font.tosvgfont (v3 fixes)', () => {
  test('metadata lines are emitted when their own property exists; Foundry', () => {
    const f = Font.create({ pixelsize: 8 })
    f.setprop('WEIGHT_NAME', 'Bold')
      .setprop('FOUNDRY', 'Acme & Co')
      .setprop('NOTICE', '<n>')
    f.newglyph(0x41, Bitmap.fromstring('#.\n.#'), { mode: 1 })
    f.newglyph(0x42) // blank glyph: skipped
    f.newglyph(0x3c, new Bitmap(['1']), { name: 'less<' })
    const svg = f.tosvgfont({ unicodeAttr: { format: 'char' } })
    expect(svg).toContain(
      '<metadata>\n  Title: Untitled\n  Weight: Bold\n  Foundry: Acme &amp; Co\n  Notice: &lt;n&gt;\n</metadata>'
    )
    expect(svg).not.toContain('Founfry')
    expect(svg).toContain('unicode-range="U+003C, U+0041-0042"')
    expect(svg).toContain('glyph-name="less&lt;"\n  unicode="&lt;"')
    expect(svg).not.toContain('uni0042')
    expect(svg).toContain('d="M1 1V2H2V1ZM0 2V3H1V2Z"')
  })

  test('empty font, vertical metrics attributes', () => {
    const f = new Font()
    expect(f.tosvgfont()).toContain('units-per-em="100"')
    const g = Font.create({ pixelsize: 4 })
    g.newglyph(0x41, new Bitmap(['1'])).setmeta({
      swy0: 5,
      vvectorx: 2,
      vvectory: 3,
    })
    const svg = g.tosvgfont()
    expect(svg).toContain(
      '  vert-adv-y="5"\n  vert-origin-x="2"\n  vert-origin-y="3"\n'
    )
  })
})

describe('Bitmap.draw2canvas', () => {
  const makeCtx = () => {
    const calls: [string, number, number, number, number][] = []
    const ctx = {
      fillStyle: '' as unknown,
      fillRect(x: number, y: number, w: number, h: number) {
        calls.push([String(this.fillStyle), x, y, w, h])
      },
    }
    return { ctx, calls }
  }
  const b = new Bitmap(['102', '010'])

  test('defaults', () => {
    const { ctx, calls } = makeCtx()
    expect(b.draw2canvas(ctx)).toBe(b)
    expect(calls).toEqual([
      ['black', 0, 0, 1, 1],
      ['red', 2, 0, 1, 1],
      ['black', 1, 1, 1, 1],
    ])
  })

  test('options {x, y, pixelsize, pixelcolors} (issue #2)', () => {
    const { ctx, calls } = makeCtx()
    b.draw2canvas(ctx, {
      x: 10,
      y: 20,
      pixelsize: 4,
      pixelcolors: { '0': '#eee', '1': '#000', '2': null },
    })
    expect(calls).toEqual([
      ['#000', 10, 20, 4, 4],
      ['#eee', 14, 20, 4, 4],
      ['#eee', 10, 24, 4, 4],
      ['#000', 14, 24, 4, 4],
      ['#eee', 18, 24, 4, 4],
    ])
    const c2 = makeCtx()
    b.draw2canvas(c2.ctx, { y: 5 })
    expect(c2.calls[0]).toEqual(['black', 0, 5, 1, 1])
  })

  test('v2 / v3-rc signature (pixelcolors, xoff, yoff) still works', () => {
    const { ctx, calls } = makeCtx()
    b.draw2canvas(ctx, { '1': 'blue' }, 3, 4)
    expect(calls).toEqual([
      ['blue', 3, 4, 1, 1],
      ['blue', 4, 5, 1, 1],
    ])
    const c2 = makeCtx()
    b.draw2canvas(c2.ctx, null, 1, 1)
    expect(c2.calls[0]).toEqual(['black', 1, 1, 1, 1])
    const c3 = makeCtx()
    new Bitmap(['13']).draw2canvas(c3.ctx, { '0': 'x' })
    expect(c3.calls).toEqual([])
  })
})
