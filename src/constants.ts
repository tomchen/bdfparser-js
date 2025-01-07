export const PATTERN_VVECTOR_DELIMITER = '[\\s]+'

export const EMPTY_GLYPH = {
  glyphname: 'empty',
  codepoint: 8203,
  bbw: 0,
  bbh: 0,
  bbxoff: 0,
  bbyoff: 0,
  swx0: 0,
  swy0: 0,
  dwx0: 0,
  dwy0: 0,
  swx1: 0,
  swy1: 0,
  dwx1: 0,
  dwy1: 0,
  vvectorx: 0,
  vvectory: 0,
  hexdata: [] as string[],
} as const

export const META_TITLES = [
  'glyphname',
  'codepoint',
  'bbw',
  'bbh',
  'bbxoff',
  'bbyoff',
  'swx0',
  'swy0',
  'dwx0',
  'dwy0',
  'swx1',
  'swy1',
  'dwx1',
  'dwy1',
  'vvectorx',
  'vvectory',
  'hexdata',
] as const

export const DIRE_SHORTCUT_MAP = {
  lr: 'lrtb',
  rl: 'rltb',
  tb: 'tbrl',
  bt: 'btrl',
  lrtb: undefined,
  lrbt: undefined,
  rltb: undefined,
  rlbt: undefined,
  tbrl: undefined,
  tblr: undefined,
  btrl: undefined,
  btlr: undefined,
} as const

export const DIRE_MAP = { lr: 1, rl: 2, tb: 0, bt: -1 } as const
