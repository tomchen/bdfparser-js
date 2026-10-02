import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  bitmapContours,
  Contour,
  flattenContour,
  rasterize,
} from '../src/outline'

/** Deterministic PRNG (mulberry32) */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const randomBitmap = (rand: () => number): string[] => {
  const w = 1 + Math.floor(rand() * 12)
  const h = 1 + Math.floor(rand() * 12)
  const density = rand()
  const rows: string[] = []
  for (let r = 0; r < h; r++) {
    let row = ''
    for (let c = 0; c < w; c++) {
      row += rand() < density ? (rand() < 0.1 ? '2' : '1') : '0'
    }
    rows.push(row)
  }
  return rows
}

const normalize = (b: string[]): string[] =>
  b.map((row) => row.replace(/[^0]/g, '1'))

const xy = (c: Contour): [number, number][] => c.map(([x, y]) => [x, y])

/** Shoelace signed area (positive = counter-clockwise, y up) */
const signedArea = (c: Contour): number => {
  let a = 0
  for (let i = 0; i < c.length; i++) {
    const [x0, y0] = c[i]
    const [x1, y1] = c[(i + 1) % c.length]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

const inkCount = (b: string[]): number =>
  b.reduce((n, row) => n + row.replace(/0/g, '').length, 0)

describe('bitmapContours: square, dotsize 1 (merged outline)', () => {
  test('empty bitmaps', () => {
    expect(bitmapContours([])).toEqual([])
    expect(bitmapContours(['', ''])).toEqual([])
    expect(bitmapContours(['000', '000'])).toEqual([])
  })

  test('single pixel', () => {
    expect(bitmapContours(['1'])).toEqual([
      [
        [0, 0, true],
        [0, 1, true],
        [1, 1, true],
        [1, 0, true],
      ],
    ])
  })

  test('single pixel with ppu and offsets', () => {
    expect(bitmapContours(['2'], { ppu: 10, xoff: -2, yoff: 3 })).toEqual([
      [
        [-20, 30, true],
        [-20, 40, true],
        [-10, 40, true],
        [-10, 30, true],
      ],
    ])
  })

  test('2x2 block', () => {
    expect(bitmapContours(['11', '11']).map(xy)).toEqual([
      [
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
      ],
    ])
  })

  test('row and column are merged without collinear points', () => {
    expect(bitmapContours(['111']).map(xy)).toEqual([
      [
        [0, 0],
        [0, 1],
        [3, 1],
        [3, 0],
      ],
    ])
    expect(bitmapContours(['1', '1', '1']).map(xy)).toEqual([
      [
        [0, 0],
        [0, 3],
        [1, 3],
        [1, 0],
      ],
    ])
  })

  test('ring with a hole: outer clockwise, hole counter-clockwise', () => {
    const cs = bitmapContours(['111', '101', '111'])
    expect(cs.map(xy)).toEqual([
      [
        [0, 0],
        [0, 3],
        [3, 3],
        [3, 0],
      ],
      [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
      ],
    ])
    expect(signedArea(cs[0])).toBe(-9)
    expect(signedArea(cs[1])).toBe(1)
  })

  test('diagonally touching pixels form two contours', () => {
    expect(bitmapContours(['01', '10']).map(xy)).toEqual([
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
      ],
      [
        [1, 1],
        [1, 2],
        [2, 2],
        [2, 1],
      ],
    ])
    expect(bitmapContours(['10', '01']).map(xy)).toEqual([
      [
        [1, 0],
        [1, 1],
        [2, 1],
        [2, 0],
      ],
      [
        [0, 1],
        [0, 2],
        [1, 2],
        [1, 1],
      ],
    ])
  })

  test('checkerboard: one square per pixel', () => {
    const cs = bitmapContours(['101', '010', '101'])
    expect(cs).toHaveLength(5)
    for (const c of cs) {
      expect(c).toHaveLength(4)
      expect(signedArea(c)).toBe(-1)
    }
    expect(cs.map((c) => [c[0][0], c[0][1]])).toEqual([
      [0, 0],
      [2, 0],
      [1, 1],
      [0, 2],
      [2, 2],
    ])
  })

  test('ring touching itself diagonally: hole opens to the outside', () => {
    // bottom-right pixel missing: hole (1,1) touches outside (2,0) at (2,1)
    const cs = bitmapContours(['111', '101', '110'])
    expect(cs.map(xy)).toEqual([
      [
        [0, 0],
        [0, 3],
        [3, 3],
        [3, 1],
        [2, 1],
        [2, 2],
        [1, 2],
        [1, 1],
        [2, 1],
        [2, 0],
      ],
    ])
    expect(signedArea(cs[0])).toBe(-7)
  })

  test('U shape (concave) and nested rings', () => {
    const u = bitmapContours(['101', '101', '111'])
    expect(u.map(xy)).toEqual([
      [
        [0, 0],
        [0, 3],
        [1, 3],
        [1, 1],
        [2, 1],
        [2, 3],
        [3, 3],
        [3, 0],
      ],
    ])
    const nested = bitmapContours(['11111', '10001', '10101', '10001', '11111'])
    expect(nested.map(signedArea)).toEqual([-25, 9, -1])
  })

  test('validation', () => {
    expect(() => bitmapContours(['1'], { dotsize: 0 })).toThrow(RangeError)
    expect(() => bitmapContours(['1'], { dotsize: 1.6 })).toThrow(RangeError)
    expect(() => bitmapContours(['1'], { dotsize: NaN })).toThrow(RangeError)
    expect(() => bitmapContours(['1'], { dotsize: 1.5 })).not.toThrow()
    expect(() =>
      bitmapContours(['1'], { shape: 'triangle' as 'square' })
    ).toThrow(/shape/)
    expect(() => bitmapContours(['1'], { ppu: 0 })).toThrow(RangeError)
    expect(() => bitmapContours(['1'], { ppu: 1.5 })).toThrow(RangeError)
  })

  test('rows of different lengths: missing characters are not ink', () => {
    expect(bitmapContours(['11', '1']).map(xy)).toEqual([
      [
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 1],
        [1, 1],
        [1, 0],
      ],
    ])
    expect(
      bitmapContours(['1', '', '01'], { dotsize: 0.5, ppu: 2 }).map(xy)
    ).toEqual([
      [
        [3, 1],
        [3, 2],
        [4, 2],
        [4, 1],
      ],
      [
        [1, 5],
        [1, 6],
        [2, 6],
        [2, 5],
      ],
    ])
  })
})

describe('bitmapContours: separate dots', () => {
  test('square dots, dotsize 0.5, ppu 10', () => {
    expect(
      bitmapContours(['01', '10'], { dotsize: 0.5, ppu: 10, xoff: 1 })
    ).toEqual([
      [
        [13, 3, true],
        [13, 8, true],
        [18, 8, true],
        [18, 3, true],
      ],
      [
        [23, 13, true],
        [23, 18, true],
        [28, 18, true],
        [28, 13, true],
      ],
    ])
  })

  test('square dots, dotsize 1.5: overlapping squares are kept separate', () => {
    const cs = bitmapContours(['11'], { dotsize: 1.5, ppu: 4 })
    expect(cs).toEqual([
      [
        [-1, -1, true],
        [-1, 5, true],
        [5, 5, true],
        [5, -1, true],
      ],
      [
        [3, -1, true],
        [3, 5, true],
        [9, 5, true],
        [9, -1, true],
      ],
    ])
  })

  test('circle dots: 8 off-curve points clockwise from the top', () => {
    // ppu 64, dotsize 1: cx = cy = 32, R = 32 * K = 34.6365...
    const cs = bitmapContours(['1'], { shape: 'circle', ppu: 64 })
    expect(cs).toEqual([
      [
        [32, 67, false],
        [56, 56, false],
        [67, 32, false],
        [56, 8, false],
        [32, -3, false],
        [8, 8, false],
        [-3, 32, false],
        [8, 56, false],
      ],
    ])
    expect(signedArea(cs[0])).toBeLessThan(0)
  })

  test('circle dots with dotsize and offsets', () => {
    const cs = bitmapContours(['1', '0', '1'], {
      shape: 'circle',
      ppu: 10,
      dotsize: 0.7,
      xoff: -1,
      yoff: -1,
    })
    // R = 3.5 * K = 3.788...; cx = -5, cy = -5 / 15
    expect(cs).toEqual([
      [
        [-5, -1, false],
        [-2, -2, false],
        [-1, -5, false],
        [-2, -8, false],
        [-5, -9, false],
        [-8, -8, false],
        [-9, -5, false],
        [-8, -2, false],
      ],
      [
        [-5, 19, false],
        [-2, 18, false],
        [-1, 15, false],
        [-2, 12, false],
        [-5, 11, false],
        [-8, 12, false],
        [-9, 15, false],
        [-8, 18, false],
      ],
    ])
  })
})

describe('flattenContour', () => {
  test('polygon is returned closed', () => {
    expect(
      flattenContour([
        [0, 0, true],
        [0, 1, true],
        [1, 1, true],
      ])
    ).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 0],
    ])
  })

  test('all off-curve: starts at implied midpoint, 16 lines per curve', () => {
    const f = flattenContour([
      [0, 2, false],
      [2, 0, false],
      [0, -2, false],
      [-2, 0, false],
    ])
    expect(f).toHaveLength(1 + 4 * 16)
    // starts at the midpoint of the last and first points
    expect(f[0]).toEqual([-1, 1])
    expect(f[f.length - 1]).toEqual([-1, 1])
    // curve midpoint (t = 0.5) of (-1,1) -> ctrl (0,2) -> (1,1)
    expect(f[8]).toEqual([0, 1.5])
    expect(f[16]).toEqual([1, 1])
    expect(f[24]).toEqual([1.5, 0])
  })

  test('mixed on/off points', () => {
    const f = flattenContour([
      [0, 0, false],
      [0, 10, true],
      [10, 10, true],
    ])
    // starts at the first on-curve point
    expect(f[0]).toEqual([0, 10])
    expect(f[1]).toEqual([10, 10])
    expect(f).toHaveLength(2 + 16)
    expect(f[f.length - 1]).toEqual([0, 10])
  })

  test('degenerate inputs', () => {
    expect(flattenContour([])).toEqual([])
    const single = flattenContour([[3, 4, false]])
    expect(single.length).toBeGreaterThan(0)
    for (const pt of single) {
      expect(pt).toEqual([3, 4])
    }
  })
})

describe('rasterize', () => {
  test('square and orientation independence (non-zero winding)', () => {
    const cw: Contour = [
      [0, 0, true],
      [0, 20, true],
      [20, 20, true],
      [20, 0, true],
    ]
    const ccw: Contour = [...cw].reverse()
    expect(rasterize([cw], 10, 0, 0, 2, 2)).toEqual(['11', '11'])
    expect(rasterize([ccw], 10, 0, 0, 2, 2)).toEqual(['11', '11'])
    expect(rasterize([cw], 10, -1, -1, 4, 4)).toEqual([
      '0000',
      '0110',
      '0110',
      '0000',
    ])
  })

  test('hole (opposite orientation) and overlap (same orientation)', () => {
    const outer: Contour = [
      [0, 0, true],
      [0, 3, true],
      [3, 3, true],
      [3, 0, true],
    ]
    const hole: Contour = [
      [1, 1, true],
      [2, 1, true],
      [2, 2, true],
      [1, 2, true],
    ]
    expect(rasterize([outer, hole], 1, 0, 0, 3, 3)).toEqual([
      '111',
      '101',
      '111',
    ])
    const same: Contour = [
      [1, 1, true],
      [1, 2, true],
      [2, 2, true],
      [2, 1, true],
    ]
    expect(rasterize([outer, same], 1, 0, 0, 3, 3)).toEqual([
      '111',
      '111',
      '111',
    ])
  })

  test('empty', () => {
    expect(rasterize([], 10, 0, 0, 2, 1)).toEqual(['00'])
    expect(rasterize([], 10, 0, 0, 0, 0)).toEqual([])
  })
})

describe('property tests: rasterize(bitmapContours(b)) == b', () => {
  const configs: {
    shape: 'square' | 'circle'
    dotsize: number
    ppus: number[]
  }[] = [
    { shape: 'square', dotsize: 1, ppus: [1, 2, 3, 10, 64] },
    { shape: 'square', dotsize: 0.6, ppus: [2, 10, 64] },
    { shape: 'square', dotsize: 0.5, ppus: [2, 4, 64] },
    { shape: 'square', dotsize: 1.5, ppus: [2, 10, 64] },
    { shape: 'circle', dotsize: 1, ppus: [2, 10, 64] },
    { shape: 'circle', dotsize: 0.6, ppus: [2, 10, 64] },
    { shape: 'circle', dotsize: 0.5, ppus: [2, 4, 64] },
    { shape: 'circle', dotsize: 1.5, ppus: [2, 10, 64] },
  ]
  for (const { shape, dotsize, ppus } of configs) {
    test(`${shape} dotsize ${dotsize}, ppu ${ppus.join('/')}: 600 random bitmaps`, () => {
      const rand = mulberry32(
        12345 + Math.round(dotsize * 100) + (shape === 'circle' ? 7 : 0)
      )
      for (let i = 0; i < 600; i++) {
        const b = randomBitmap(rand)
        const ppu = ppus[i % ppus.length]
        const xoff = Math.floor(rand() * 9) - 4
        const yoff = Math.floor(rand() * 9) - 4
        const cs = bitmapContours(b, { shape, dotsize, ppu, xoff, yoff })
        const h = b.length
        const w = b[0].length
        expect(rasterize(cs, ppu, xoff, yoff, w, h)).toEqual(normalize(b))
        // integer coordinates, orientation, no collinear/duplicate points
        for (const c of cs) {
          for (const [x, y, on] of c) {
            expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true)
            expect(on).toBe(shape === 'square')
          }
        }
        if (shape === 'square' && dotsize === 1) {
          const total = cs.reduce((a, c) => a + signedArea(c), 0)
          expect(total + 0).toBe(-inkCount(b) * ppu * ppu + 0)
          for (const c of cs) {
            for (let k = 0; k < c.length; k++) {
              const [x0, y0] = c[(k + c.length - 1) % c.length]
              const [x1, y1] = c[k]
              const [x2, y2] = c[(k + 1) % c.length]
              // axis-aligned, turning at every vertex
              expect(x0 === x1 || y0 === y1).toBe(true)
              expect((x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1)).not.toBe(0)
            }
            // starts at the minimal (y, x) vertex
            const [sx, sy] = c[0]
            for (const [x, y] of c) {
              expect(y > sy || (y === sy && x >= sx)).toBe(true)
            }
          }
        } else {
          expect(cs).toHaveLength(inkCount(b))
          for (const c of cs) {
            const poly = flattenContour(c).map(
              ([x, y]): [number, number, boolean] => [x, y, true]
            )
            expect(signedArea(poly)).toBeLessThan(0)
          }
        }
      }
    })
  }
})

const goldenOutline = join(__dirname, 'fixtures', 'golden', 'outline.json')

describe.runIf(existsSync(goldenOutline))(
  'cross-language golden contours (generated by Python bdfparser)',
  () => {
    test('bitmap_contours output is identical', () => {
      const cases = JSON.parse(readFileSync(goldenOutline, 'utf8')) as {
        bindata: string[]
        shape: 'square' | 'circle'
        dotsize: number
        ppu: number
        xoff: number
        yoff: number
        contours: [number, number, boolean][][]
      }[]
      expect(cases.length).toBeGreaterThanOrEqual(500)
      for (const c of cases) {
        expect(
          bitmapContours(c.bindata, {
            shape: c.shape,
            dotsize: c.dotsize,
            ppu: c.ppu,
            xoff: c.xoff,
            yoff: c.yoff,
          })
        ).toEqual(c.contours)
      }
    })
  }
)
