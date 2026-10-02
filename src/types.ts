import { DIRE_MAP, DIRE_SHORTCUT_MAP } from './constants'

export const setProperty = <
  O extends Record<PropertyKey, unknown>,
  K extends keyof O
>(
  obj: O,
  key: K,
  value: O[K]
): void => {
  obj[key] = value
}

export type BdfHeaders = {
  bdfversion: number
  fontname: string
  pointsize: number
  xres: number
  yres: number
  fbbx: number
  fbby: number
  fbbxoff: number
  fbbyoff: number
  swx0?: number
  swy0?: number
  dwx0?: number
  dwy0?: number
  swx1?: number
  swy1?: number
  dwx1?: number
  dwy1?: number
  vvectorx?: number
  vvectory?: number
  metricsset?: number
  contentversion?: number
  comment?: string[]
}
export type BdfHeadersTemp = Partial<BdfHeaders>

export type Props = Record<string, string | number | null> & {
  comment?: string[]
}

export type GlyphMetaInFont = [
  string, // glyphname
  number, // codepoint
  number, // bbw
  number, // bbh
  number, // bbxoff
  number, // bbyoff
  number | null, // swx0
  number | null, // swy0
  number | null, // dwx0
  number | null, // dwy0
  number | null, // swx1
  number | null, // swy1
  number | null, // dwx1
  number | null, // dwy1
  number | null, // vvectorx
  number | null, // vvectory
  string[] // hexdata
]

export type GlyphMetaInFontTemp = [
  string | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  string[] | null
]

export type GlyphMeta = {
  glyphname: GlyphMetaInFont[0]
  codepoint: GlyphMetaInFont[1]
  bbw: GlyphMetaInFont[2]
  bbh: GlyphMetaInFont[3]
  bbxoff: GlyphMetaInFont[4]
  bbyoff: GlyphMetaInFont[5]
  swx0: GlyphMetaInFont[6]
  swy0: GlyphMetaInFont[7]
  dwx0: GlyphMetaInFont[8]
  dwy0: GlyphMetaInFont[9]
  swx1: GlyphMetaInFont[10]
  swy1: GlyphMetaInFont[11]
  dwx1: GlyphMetaInFont[12]
  dwy1: GlyphMetaInFont[13]
  vvectorx: GlyphMetaInFont[14]
  vvectory: GlyphMetaInFont[15]
  hexdata: GlyphMetaInFont[16]
}
export type GlyphMetaTemp = Partial<GlyphMeta>

export type TodataFuncRetType<T> = T extends undefined
  ? string[]
  : T extends 0
  ? string
  : T extends 1
  ? string[]
  : T extends 2
  ? number[][]
  : T extends 3
  ? number[]
  : T extends 4
  ? string[]
  : T extends 5
  ? number[]
  : never

export type CodepointRangeType = number | [number, number] | [number, number][]
export type OrderType = -1 | 0 | 1 | 2
export type GlyphDrawModeType = -1 | 0 | 1 | 2

export type DirectionType = keyof typeof DIRE_SHORTCUT_MAP
export type DirectionPartType = keyof typeof DIRE_MAP
export type DirectionNumberType = (typeof DIRE_MAP)[keyof typeof DIRE_MAP]
