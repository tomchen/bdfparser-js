"""
Known (already analysed and reported) Python <-> TypeScript divergences.

compare.py labels every divergence with the id of the first matching entry
(or NEW). Matchers see the operation (dict), the case, and both raw results
(`py`, `js`: canonical result text or error message).

Keep entries specific: a matcher should only match the documented root cause.
See README.md ("Findings") for the minimal reproducers and spec references.
"""

from __future__ import annotations

import json
import re


def _err(x):
    return isinstance(x, str) and re.match(r'^[A-Za-z]*(Error|Exception)\b', x) is not None


def _has(case, t):
    return t in (case.get('tags') or [])


KNOWN = [
    # id, short description, matcher(op, case, py, js, pyerr, jserr)
    (
        'K01-empty-draw',
        'draw/drawall/drawcps of zero glyphs: Python raises ValueError (max() of empty sequence), JS returns an empty Bitmap',
        lambda op, c, py, js, pe, je: pe and not je and 'empty' in py and js.startswith('{"$bitmap":[]'),
    ),
    (
        'K02-todata-empty-row',
        'Bitmap.todata(4|5) with zero-width rows: Python int("", 2) raises, JS returns "" / 0',
        lambda op, c, py, js, pe, je: pe and not je and "base 2: ''" in py,
    ),
    (
        'K03-negative-size',
        'Bitmap.crop (and draw/transform through a FONTBOUNDINGBOX) with a negative width or height: Python yields empty/odd rows, JS throws RangeError (String.repeat); inside Font.transform both may raise but after mutating different glyphs',
        lambda op, c, py, js, pe, je: (je and not pe and ('repeat' in js or 'Invalid count value' in js))
        or (pe and je and _has(c, 'negsize') and ('repeat' in js or 'Invalid count value' in js)),
    ),
    (
        'K04-overlay-size',
        'Bitmap.overlay of bitmaps of different sizes: Python truncates to the smaller size (zip), JS keeps the size of `this`',
        lambda op, c, py, js, pe, je: op.get('op') == 'bop' and op.get('m') == 'overlay',
    ),
    (
        'K05-bigint-prop',
        'Integer property values beyond 2**53: JS parseInt loses precision (and writes 1e+21 style for >= 1e21)',
        lambda op, c, py, js, pe, je: _has(c, 'bigint') and not pe and not je,
    ),
    (
        'K06-weird-prop-key',
        'Property keys that are integer-like ("123": JS object reorders them first), "__proto__"/"constructor"... (JS Object prototype), or lower-case "comment" (collides with the comment list)',
        lambda op, c, py, js, pe, je: _has(c, 'weirdkey'),
    ),
    (
        'K07-exotic-whitespace',
        'Exotic whitespace: Python str.split/strip treat U+001C-001F and U+0085 as whitespace, JS \\s / trim() treat U+FEFF as whitespace',
        lambda op, c, py, js, pe, je: _has(c, 'exotic'),
    ),
    (
        'K08-lenient-number',
        'Non-standard numeric tokens: Python int() accepts "1_2" / "+1_2" / non-ASCII digits (BBX, ENCODING, SWIDTH...) and float() accepts "inf", "nan", "2_1" in STARTFONT; JS Number() accepts "0x10" and "Infinity"; "inf"/"Infinity" are written back differently (spec §2.9: malformed numbers => BDFParseError)',
        lambda op, c, py, js, pe, je: _has(c, 'lenientint'),
    ),
    (
        'K09-removeglyph-detached',
        'Font.removeglyph(glyph) with a Glyph that was already removed (detached): JS deletes whatever glyph now has that codepoint (its _store getter hides the old slot), Python is a no-op',
        lambda op, c, py, js, pe, je: _has(c, 'stalehandle') and op.get('op') == 'hremove',
    ),
    (
        'K10-gb18030-4byte',
        'GB18030 4-byte codes: Python encodes/decodes them, JS (without iconv) does not (sanctioned by SPEC-v3 §4)',
        lambda op, c, py, js, pe, je: 'gb18030' in str(op.get('charset', '')).lower(),
    ),
    (
        'K11-todata-precision',
        'Bitmap.todata(5) (and todata(4) for > 53-bit rows in other paths): JS parseInt loses precision above 2**53, Python ints are exact',
        lambda op, c, py, js, pe, je: op.get('m') == 'todata' and (op.get('a') or [1])[0] in (3, 5) and not pe and not je,
    ),
    (
        'K12-ragged-bitmap',
        'Operations on "ragged" bitmaps (rows of different lengths, e.g. after replace("10", "2")): Python raises IndexError / returns other lengths, JS emits "undefined" pixels',
        lambda op, c, py, js, pe, je: _has(c, 'ragged') and (op.get('op') == 'bop' or op.get('op') in ('htransform', 'transform')),
    ),
]


def _table_explained(op, py, js, ctx):
    """True if every differing element of a charset query is a measured codec-table difference."""
    tables = ctx.get('tables') or {}
    cs = ctx.get('charset')
    name = op.get('op')
    if name == 'cs':
        try:
            cs = json.loads(py)[0]  # canonical key (Python side)
        except (ValueError, IndexError, TypeError):
            return False
    if not cs or not tables:
        return False
    tids = [t for t in (cs, cs + '/gl') if t in tables]
    if not tids:
        return False
    bad_chars = set().union(*(tables[t]['bad_chars'] for t in tids))
    bad_cps = set().union(*(tables[t]['bad_cps'] for t in tids))
    try:
        pv, jv = json.loads(py), json.loads(js)
    except ValueError:
        return False
    if name == 'cs':
        pv, jv = pv[1] + pv[2], jv[1] + jv[2]
        items = [('cp', x) for x in op.get('cps', [])] + [('ch', x) for x in op.get('chars', [])]
    elif name == 'c2p':
        items = [('ch', x) for x in op['chars']]
    elif name in ('p2c', 'gchr'):
        items = [('cp', x) for x in op['cps']]
    elif name == 'gbychar':
        items = [('ch', x) for x in op['chars']]
    elif name in ('lacks', 'draw'):
        return any(ord(ch) in bad_chars for ch in op.get('text', ''))
    else:
        return False
    if not isinstance(pv, list) or not isinstance(jv, list) or len(pv) != len(jv) or len(pv) != len(items):
        return False
    for (kind, x), a, b in zip(items, pv, jv):
        if a == b:
            continue
        if kind == 'ch' and ord(x) not in bad_chars:
            return False
        if kind == 'cp' and x not in bad_cps:
            return False
    return True


def _csname_explained(op, py, js):
    """csname divergences only at names with a leading-zero ISO 8859 part or KOI8-RU."""
    try:
        pv, jv = json.loads(py), json.loads(js)
    except ValueError:
        return False
    rx = re.compile(r'8859[-_ ]?0\d|koi8[-_ ]?ru', re.I)
    pairs, names = op.get('pairs', []), op.get('names', [])
    for k, (a, b) in enumerate(zip(pv[0], jv[0])):
        if a != b and not rx.search(' '.join(str(x) for x in pairs[k])):
            return False
    for part in (1, 2):
        for k, (a, b) in enumerate(zip(pv[part], jv[part])):
            if a != b and not rx.search(names[k]):
                return False
    return True


KNOWN.append(
    (
        'K14-charset-name',
        'Charset name canonicalisation: "ISO8859-01" -> Python iso885901 / JS iso88591; "KOI8-RU" -> Python koi8r (KOI8/R) / JS koi8ru (WHATWG koi8-u, props KOI8RU/0)',
        lambda op, c, py, js, pe, je: op.get('op') == 'csname' and not pe and not je and (_has(c, 'charsetname') or _csname_explained(op, py, js)),
    )
)
KNOWN.append(
    (
        'K15-pcf-size-overflow',
        'PCF writer with absurd FONT_ASCENT/FONT_DESCENT (bitmaps padded to > 2**31 bytes): JS int32 overflow -> RangeError, Python writes multi-GB output',
        lambda op, c, py, js, pe, je: op.get('op') in ('pcf', 'pcfrt') and je and not pe and ('length cannot be negative' in js or 'Invalid typed array length' in js or 'allocation failed' in js),
    )
)
def _ragged_py_bitmap(py, js):
    try:
        pv, jv = json.loads(py), json.loads(js)
    except ValueError:
        return False
    if not (isinstance(pv, dict) and isinstance(jv, dict) and '$bitmap' in pv and '$bitmap' in jv):
        return False
    return len({len(r) for r in pv['$bitmap']}) > 1 and len({len(r) for r in jv['$bitmap']}) <= 1


KNOWN.append(
    (
        'K16-concatall-empty',
        'Bitmap.concatall vertical (direction 0/-1) with empty bitmaps and non-zero offsets: Python emits zero-width rows (ragged result, zip() truncation), JS pads them to the full width',
        lambda op, c, py, js, pe, je: not pe and not je and _ragged_py_bitmap(py, js),
    )
)
KNOWN.append(
    (
        'K13-codec-table',
        'Character <-> codepoint differences fully explained by the measured codec-table differences between Python codecs and WHATWG TextDecoder (see the charset table report)',
        None,
    )
)


def label(op, case, py, js, pyerr, jserr, ctx=None):
    ctx = ctx or {}
    if not pyerr and not jserr and _table_explained(op or {}, py or '', js or '', ctx):
        return 'K13-codec-table'
    for kid, _desc, fn in KNOWN:
        if fn is None:
            continue
        try:
            if fn(op or {}, case, py or '', js or '', pyerr, jserr):
                return kid
        except Exception:  # noqa: BLE001
            continue
    return 'NEW'


DESCRIPTIONS = {kid: desc for kid, desc, _ in KNOWN}
