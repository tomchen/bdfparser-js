#!/usr/bin/env python3
"""
Parity harness — curated probes: one minimal reproducer per finding (see
README.md "Findings"), so every run re-checks whether each known divergence
still exists. Also regression probes for divergences found by this harness
and fixed upstream ('expect': 'agree').

    python probes.py OUT.jsonl
"""

from __future__ import annotations

import json
import sys


def bdf(props=(), glyphs=(), header='', fbb='8 8 0 0', version='2.1', size='8 75 75'):
    lines = [f'STARTFONT {version}', 'FONT F', f'SIZE {size}', f'FONTBOUNDINGBOX {fbb}']
    if header:
        lines.append(header)
    if props:
        lines.append(f'STARTPROPERTIES {sum(1 for p in props if not p.startswith("COMMENT"))}')
        lines += list(props)
        lines.append('ENDPROPERTIES')
    lines.append(f'CHARS {len(glyphs)}')
    for g in glyphs:
        lines += g.split('\n')
    lines.append('ENDFONT')
    return '\n'.join(lines) + '\n'


def glyph(enc, bbx='1 1 0 0', rows=('80',), name='g', extra=''):
    s = f'STARTCHAR {name}\nENCODING {enc}\n'
    if extra:
        s += extra + '\n'
    return s + f'BBX {bbx}\nBITMAP\n' + '\n'.join(rows) + ('\n' if rows else '') + 'ENDCHAR'


LOAD = {'op': 'load', 'how': 'string'}

PROBES = [
    # --- regressions: found by this harness during development, fixed upstream
    ('R01-empty-draw', 'agree', 'Font.drawall/draw with no glyph to draw (Python raised ValueError, fixed in bdfparser 844c1c7)', [],
     bdf(glyphs=[glyph(65)]), [LOAD, {'op': 'drawall', 'kw': {'r': 0}}, {'op': 'draw', 'text': ''}]),
    ('R02-stale-writeback', 'agree', 'Editing through a stale attached Glyph (write-back rules; fixed in 844c1c7 / efda8f7)', [],
     '', [{'op': 'create', 'kw': {}}, {'op': 'newglyph', 'cp': 126, 'rows': ['00010'], 'mode': 2},
          {'op': 'transform', 'fn': [['crop', 1, 5]], 'r': [[125, 141]], 'mode': 0}, {'op': 'hsetmeta', 'h': 0, 'meta': {}}]),
    # --- open findings
    ('K02-todata-empty-row', 'diverge', 'Bitmap.todata(5|4) with zero-width rows', [],
     '', [{'op': 'bset', 'rows': ['', '']}, {'op': 'bop', 'm': 'todata', 'a': [5]}, {'op': 'bop', 'm': 'todata', 'a': [4]}]),
    ('K03-negative-size', 'diverge', 'Bitmap.crop with a negative width; glyph drawn in a negative FONTBOUNDINGBOX', ['negsize'],
     bdf(glyphs=[glyph(65)], fbb='-1 2 0 0'), [LOAD, {'op': 'gdraw', 'cp': 65, 'mode': 0},
                                               {'op': 'bset', 'rows': ['101']}, {'op': 'bop', 'm': 'crop', 'a': [-1, 2, 0, 0]}]),
    ('K04-overlay-size', 'diverge', 'Bitmap.overlay of different-size bitmaps', ['overlay'],
     '', [{'op': 'bset', 'rows': ['1001110']}, {'op': 'bop', 'm': 'overlay', 'a': [[]]},
          {'op': 'bset', 'rows': ['10']}, {'op': 'bop', 'm': 'overlay', 'a': [['01', '11']]}]),
    ('K05-bigint', 'diverge', 'Integers beyond 2**53 in properties and metrics', ['bigint'],
     bdf(props=['FOO 99999999999999999999', 'BAR 1000000000000000000000'],
         glyphs=[glyph(65, extra='SWIDTH 99999999999999999999 0')]), [LOAD, {'op': 'tobdf'}]),
    ('K06a-numeric-prop-key', 'diverge', 'Integer-like property names are reordered by JS objects', ['weirdkey'],
     bdf(props=['B 1', '123 5', 'A 2']), [LOAD, {'op': 'tobdf'}]),
    ('K06b-proto-prop-key', 'diverge', 'Property names __proto__ / constructor (JS Object prototype)', ['weirdkey'],
     bdf(props=['__proto__ "x"', 'constructor 5']), [LOAD, {'op': 'tobdf'}, {'op': 'getprop', 'keys': ['toString', 'valueOf']}]),
    ('K06c-comment-prop-key', 'diverge', 'Lower-case property name "comment" collides with props["comment"] (COMMENT lines)', ['weirdkey'],
     bdf(props=['comment "abc"']), [LOAD, {'op': 'tobdf'}]),
    ('K06d-comment-prop-crash', 'diverge', 'Lower-case "comment" integer property followed by a COMMENT line: Python AttributeError', ['weirdkey'],
     bdf(props=['comment 5', 'COMMENT x']), [LOAD]),
    ('K07-exotic-whitespace', 'diverge', 'U+001F / U+0085 / U+FEFF handled as whitespace by one side only', ['exotic'],
     bdf(glyphs=[glyph(65, extra='SWIDTH 500 0\x1f')], header='COMMENT hello\x85'), [LOAD, {'op': 'tobdf'}]),
    ('K08a-lenient-int', 'diverge', 'Python int() accepts "1_2" in ENCODING and BBX', ['lenientint'],
     bdf(glyphs=[glyph('1_2', bbx='1_0 1 0 0', rows=('8000',))]), [LOAD]),
    ('K08b-version-inf', 'diverge', 'STARTFONT inf / Infinity accepted by both, written back differently', ['lenientint'],
     bdf(version='Infinity'), [LOAD, {'op': 'tobdf'}]),
    ('K08c-version-hex', 'diverge', 'STARTFONT 0x10 accepted by JS Number() only', ['lenientint'],
     bdf(version='0x10'), [LOAD]),
    ('K09-removeglyph-detached', 'diverge', 'removeglyph(glyph) with an already-removed Glyph deletes the new glyph in JS', ['stalehandle'],
     bdf(glyphs=[glyph(5)]), [LOAD, {'op': 'gget', 'cp': 5}, {'op': 'hremove', 'h': 0},
                              {'op': 'addglyph', 'meta': {'codepoint': 5}, 'replace': False}, {'op': 'hremove', 'h': 0}]),
    ('K10-gb18030-4byte', 'diverge', 'GB18030 4-byte codes (spec §4: JS needs iconv)', [],
     bdf(glyphs=[glyph(0xB650)]), [LOAD, {'op': 'charsetconvert', 'charset': 'gb18030'},
                                   {'op': 'cs', 'charset': 'gb18030', 'cps': [0x81308130], 'chars': ['\U0001F600']}]),
    ('K11-todata-precision', 'diverge', 'Bitmap.todata(5) of a row wider than 53 bits', [],
     '', [{'op': 'bset', 'rows': ['1' * 60]}, {'op': 'bop', 'm': 'todata', 'a': [5]}]),
    ('K12-ragged-bitmap', 'diverge', 'rotate() of a ragged bitmap', ['ragged'],
     '', [{'op': 'bset', 'rows': ['110', '1']}, {'op': 'bop', 'm': 'rotate', 'a': [90]}]),
    ('K13a-gb2312', 'diverge', 'GB2312: 0xA1A4 (・ vs ·), GBK-only codes and 0x80 accepted by JS', [],
     '', [{'op': 'cs', 'charset': 'gb2312', 'cps': [0xA1A4, 0x8140, 0x80], 'chars': ['·', '€']}]),
    ('K13b-cp125x', 'diverge', 'windows-125x undefined bytes (0x81...) map to C1 controls in WHATWG', [],
     '', [{'op': 'cs', 'charset': 'cp1252', 'cps': [0x81, 0x8D, 0x80], 'chars': ['\x81']}]),
    ('K13c-iso8859-9-11', 'diverge', 'ISO 8859-9 / -11 / TIS-620 decoded as windows-1254 / windows-874 by WHATWG', [],
     '', [{'op': 'cs', 'charset': 'iso8859-9', 'cps': [0x80, 0x9F]}, {'op': 'cs', 'charset': 'iso8859-11', 'cps': [0x80]},
          {'op': 'cs', 'charset': 'tis620', 'cps': [0x80]}]),
    ('K13d-koi8u', 'diverge', 'KOI8-U: WHATWG koi8-u is KOI8-RU (0xAE, 0xBE)', [],
     '', [{'op': 'cs', 'charset': 'koi8u', 'cps': [0xAE, 0xBE], 'chars': ['ў', '╝']}]),
    ('K13e-big5', 'diverge', 'Big5: WHATWG big5 is Big5-HKSCS (0x8740...), 0xA145 • vs ‧', [],
     '', [{'op': 'cs', 'charset': 'big5', 'cps': [0xA145, 0x8740, 0xA2CC], 'chars': ['•', '‧', '¢']}]),
    ('K13f-shiftjis-eucjp', 'diverge', 'Shift_JIS / EUC-JP: JIS X 0208 vs windows-31j mappings (〜 vs ～ ...)', [],
     '', [{'op': 'cs', 'charset': 'shift_jis', 'cps': [0x8160, 0x815F, 0x80], 'chars': ['〜', '～', '¥']},
          {'op': 'cs', 'charset': 'euc-jp', 'cps': [0xA1C1, 0xADA1], 'chars': ['〜']}]),
    ('K13g-euckr-uhc', 'diverge', 'EUC-KR: WHATWG euc-kr is UHC (0x8141 갂)', [],
     '', [{'op': 'cs', 'charset': 'euc-kr', 'cps': [0x8141], 'chars': ['갂']}]),
    ('K13h-python-char2cp-invalid', 'diverge', 'Python char2cp returns non-round-tripping 3-byte (JIS X 0212), 8-byte (KS X 1001 composition) and 0x5C (¥) codes', [],
     '', [{'op': 'cs', 'charset': 'jisx0208', 'gl': True, 'cps': [], 'chars': ['ß', '¥', '¡']},
          {'op': 'cs', 'charset': 'ksc5601', 'gl': True, 'cps': [], 'chars': ['갂']}]),
    ('K13i-js-only-codecs', 'diverge', 'cp866, cp874, cp932, cp936, cp949, cp950, hz: Unicode identity in Python (unknown), real codecs in JS', [],
     '', [{'op': 'cs', 'charset': 'cp932', 'cps': [0x82A0, 0x80]}, {'op': 'cs', 'charset': 'cp866', 'cps': [0x80]},
          {'op': 'cs', 'charset': 'hz', 'cps': [0x80]}]),
    ('K14-charset-name', 'diverge', 'Charset name canonicalisation: ISO8859-01, KOI8-RU', ['charsetname'],
     '', [{'op': 'csname', 'pairs': [], 'names': ['ISO8859-01', 'KOI8-RU']}]),
    ('K16-concatall-empty', 'diverge', 'vertical concatall with empty bitmaps and offsets: Python emits zero-width rows', [],
     '', [{'op': 'bset', 'rows': []}, {'op': 'bop', 'm': 'concatall', 'a': [[[], [], ['0110', '0010']], -1, 0, [-2, 3]]}]),
]

HEAVY = [
    ('K15-pcf-size-overflow', 'diverge', 'PCF writer with FONT_ASCENT 600000000: Python allocates ~2.4 GB, JS RangeError', [],
     bdf(props=['FONT_ASCENT 600000000', 'FONT_DESCENT 0'], glyphs=[glyph(65, extra='DWIDTH 1 0')]), [LOAD, {'op': 'pcf', 'kw': {}}]),
]


def cases(heavy=False):
    for pid, expect, desc, tags, text, ops in PROBES + (HEAVY if heavy else []):
        yield {'id': pid, 'kind': 'probe', 'expect': expect, 'desc': desc, 'tags': tags, 'font': None, 'bdf': text, 'ops': ops}


def main(argv):
    heavy = '--heavy' in argv
    with open(argv[0], 'w', encoding='utf-8') as f:
        for c in cases(heavy):
            f.write(json.dumps(c) + '\n')


if __name__ == '__main__':
    main(sys.argv[1:])
