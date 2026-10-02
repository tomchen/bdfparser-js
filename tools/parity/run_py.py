#!/usr/bin/env python3
"""
Parity harness — Python runner.

Reads a JSONL file of cases (see gen_cases.py), executes every operation of
every case with the *Python* bdfparser (../bdfparser/src, or $BDFPARSER_PY),
and writes one JSONL result line per case:

    {"id": ..., "res": [[op_index, op_name, canonical_result_text_or_null, error_or_null], ...]}

Every result is serialised with `canon()` (a canonical JSON-like text that the
TypeScript runner reproduces byte for byte); results longer than LIMIT
characters are replaced by their SHA-256 (unless --full).

Usage:
    python run_py.py CASES.jsonl OUT.jsonl [--full] [--only id1,id2]
    python run_py.py --tables TABLES_SPEC.json OUT.json
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sys
import time
import warnings
from pathlib import Path

HERE = Path(__file__).resolve().parent
PYSRC = Path(os.environ.get('BDFPARSER_PY', HERE.parent.parent.parent / 'bdfparser' / 'src'))
sys.path.insert(0, str(PYSRC))

from bdfparser import Bitmap, Font, Glyph  # noqa: E402
from bdfparser.encoding import canonical_charset, charset_codec, charset_props, sanitize_charset  # noqa: E402
from bdfparser.outline import bitmap_contours, rasterize  # noqa: E402
from bdfparser.pcf import read_pcf  # noqa: E402
from bdfparser.ttf import read_ttf  # noqa: E402

warnings.simplefilter('ignore')

LIMIT = 600
FULL = False

# ---------------------------------------------------------------------------
# canonical serialisation (must match run_js.ts `canon`)


def js_num(f: float) -> str:
    """ECMAScript Number::toString for a finite float."""
    if f != f:
        return 'NaN'
    if f in (float('inf'), float('-inf')):
        return 'Infinity' if f > 0 else '-Infinity'
    if f == 0:
        return '0'
    sign = '-' if f < 0 else ''
    r = repr(abs(f))
    m = re.fullmatch(r'(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?', r)
    assert m, r
    ip, fp, ex = m.group(1), m.group(2) or '', int(m.group(3) or 0)
    digits = (ip + fp).lstrip('0')
    # position of the decimal point relative to the start of `digits`
    lead_zeros = len(ip + fp) - len((ip + fp).lstrip('0'))
    n = len(ip) - lead_zeros + ex
    digits = digits.rstrip('0') or '0'
    k = len(digits)
    if k <= n <= 21:
        return sign + digits + '0' * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + '.' + digits[n:]
    if -6 < n <= 0:
        return sign + '0.' + '0' * (-n) + digits
    e = n - 1
    es = ('+' if e >= 0 else '-') + str(abs(e))
    if k == 1:
        return sign + digits + 'e' + es
    return sign + digits[0] + '.' + digits[1:] + 'e' + es


def canon_str(s: str) -> str:
    out = ['"']
    b = s.encode('utf-16-be', 'surrogatepass')
    for i in range(0, len(b), 2):
        u = (b[i] << 8) | b[i + 1]
        if u == 0x22:
            out.append('\\"')
        elif u == 0x5C:
            out.append('\\\\')
        elif 0x20 <= u < 0x7F:
            out.append(chr(u))
        else:
            out.append('\\u%04x' % u)
    out.append('"')
    return ''.join(out)


def canon(v) -> str:
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return js_num(v)
    if isinstance(v, str):
        return canon_str(v)
    if isinstance(v, (bytes, bytearray, memoryview)):
        b = bytes(v)
        d = {'$bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()}
        if FULL:
            d['b64'] = base64.b64encode(b).decode()
        return canon(d)
    if isinstance(v, Bitmap):
        return canon({'$bitmap': list(v.bindata)})
    if isinstance(v, (list, tuple)):
        return '[' + ','.join(canon(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(canon_str(str(k)) + ':' + canon(x) for k, x in v.items()) + '}'
    raise TypeError(f'cannot canon {type(v).__name__}')


def shrink(text: str) -> str:
    if FULL or len(text) <= LIMIT:
        return text
    return canon({'$sha256': hashlib.sha256(text.encode()).hexdigest(), 'n': len(text)})


# ---------------------------------------------------------------------------
# model


def meta17(lst):
    return [lst[i] for i in range(17)]


def model(font: Font):
    return {
        'headers': [[k, v] for k, v in font.headers.items()],
        'props': [[k, v] for k, v in font.props.items()],
        'propnames': [[k, v] for k, v in font._propnames.items()],
        'glyphs': [[cp, meta17(m)] for cp, m in font.glyphs.items()],
        'unencoded': [[e['altcode'], meta17(e['meta'])] for e in font.unencoded],
        'charset': font.charset,
    }


def digest(font: Font):
    text = canon(model(font))
    if FULL:
        return model(font)
    return {'model': hashlib.sha256(text.encode()).hexdigest(), 'n': len(font.glyphs), 'u': len(font.unencoded)}


def glyph_meta(g):
    if g is None:
        return None
    return [g.meta.get(k) for k in META_KEYS]


META_KEYS = (
    'glyphname', 'codepoint', 'bbw', 'bbh', 'bbxoff', 'bbyoff', 'swx0', 'swy0', 'dwx0', 'dwy0',
    'swx1', 'swy1', 'dwx1', 'dwy1', 'vvectorx', 'vvectory', 'hexdata',
)

# ---------------------------------------------------------------------------
# helpers


def rng(r):
    """JSON range -> Python itercps range."""
    if r is None or isinstance(r, int):
        return r
    if isinstance(r, list) and len(r) == 2 and all(isinstance(x, int) for x in r):
        return (r[0], r[1])
    return [tuple(t) for t in r]


def bm(rows):
    return Bitmap(list(rows))


def apply_bop(B: Bitmap, m: str, a: list):
    """Apply one bitmap operation; returns (bitmap, value). `value` is NOTHING for mutators."""
    if m == 'crop':
        return B.crop(*a), NOTHING
    if m == 'overlay':
        return B.overlay(bm(a[0])), NOTHING
    if m == 'overlay_same':
        return B.overlay(bm(lcg_rows(a[0], B.width(), B.height()))), NOTHING
    if m == 'concat':
        return B.concat(bm(a[0]), *a[1:]), NOTHING
    if m == 'concatall':
        return Bitmap.concatall([bm(x) for x in a[0]], *a[1:]), NOTHING
    if m in ('enlarge', 'replace', 'shadow', 'glow', 'bytepad', 'setpixel', 'rotate', 'shift', 'bold', 'italic'):
        return getattr(B, m)(*a), NOTHING
    if m in ('fliph', 'flipv', 'invert', 'trim'):
        return getattr(B, m)(), NOTHING
    if m == 'paste':
        return B.paste(bm(a[0]), *a[1:]), NOTHING
    if m == 'clone':
        return B.clone(), NOTHING
    if m == 'fromstring':
        return Bitmap.fromstring(a[0]), NOTHING
    if m == 'blank':
        return Bitmap.blank(*a), NOTHING
    if m == 'todata':
        return B, B.todata(*a)
    if m == 'getpixel':
        return B, B.getpixel(*a)
    if m == 'bbox':
        return B, list(B.bbox())
    if m == 'width':
        return B, B.width()
    if m == 'height':
        return B, B.height()
    if m == 'str':
        return B, str(B)
    if m == 'equals':
        return B, B.equals(bm(a[0]))
    if m == 'tosvg':
        return B, B.tosvg(*a)
    if m == 'contours':
        cs = bitmap_contours(B.bindata, *a)
        return B, [[[x, y, on] for (x, y, on) in c] for c in cs]
    if m == 'raster':
        shape, dotsize, ppu = a
        cs = bitmap_contours(B.bindata, shape, dotsize, ppu, 0, 0)
        return B, rasterize(cs, ppu, 0, 0, B.width(), B.height())
    raise ValueError(f'unknown bitmap op {m}')


NOTHING = object()


def lcg_rows(seed: int, w: int, h: int) -> list[str]:
    """Deterministic pseudo-random '0'/'1'/'2' rows (same in run_js.ts)."""
    x = seed % 65537
    rows = []
    for _ in range(h):
        r = []
        for _ in range(w):
            x = (x * 75 + 74) % 65537
            v = x % 7
            r.append('1' if v < 2 else '2' if v == 2 else '0')
        rows.append(''.join(r))
    return rows


def make_fn(fnops):
    def fn(b: Bitmap):
        for step in fnops:
            b, _ = apply_bop(b, step[0], step[1:])
        return b

    return fn


def draw_kw(kw: dict) -> dict:
    out = {}
    for k, v in kw.items():
        if k == 'r':
            out['r'] = rng(v)
        elif k == 'ucgs':
            out['usecurrentglyphspacing'] = v
        else:
            out[k] = v
    return out


# ---------------------------------------------------------------------------
# case execution


class Ctx:
    def __init__(self, case):
        self.case = case
        self.fonts: dict[str, Font] = {}
        self.handles: list = []
        self.B = Bitmap([])


def src_text(case, src):
    if src in ('bdf', 'bdf2'):
        return case[src]
    raise KeyError(src)


def src_bytes(case, src):
    if src == 'file':
        return Path(case['file']).read_bytes()
    if src + '_b64' in case:
        return base64.b64decode(case[src + '_b64'])
    return case[src].encode('utf-8')


def run_op(ctx: Ctx, op: dict):
    name = op['op']
    case = ctx.case
    F = ctx.fonts.get(op.get('f', 'F'))

    if name == 'load':
        how = op.get('how', 'string')
        src = op.get('src', 'bdf')
        f = Font()
        if how == 'string':
            f.load_string(src_text(case, src))
        elif how == 'lines':
            f.load_lines(re.split(r'(?<=\n)', src_text(case, src)))
        else:
            kw = {} if op.get('pixelsize') is None else {'pixelsize': op['pixelsize']}
            f.load_bytes(src_bytes(case, src), **kw)
        ctx.fonts[op.get('to', 'F')] = f
        return [digest(f), f.charset, len(f)]
    if name == 'create':
        f = Font.create(**op.get('kw', {}))
        ctx.fonts[op.get('to', 'F')] = f
        return digest(f)
    if name == 'tobdf':
        return F.tobdf()
    if name == 'model':
        return model(F)
    if name == 'digest':
        return digest(F)
    if name == 'svgfont':
        kw = dict(op.get('kw', {}))
        if 'ccns' in kw:
            kw['controlcharnoskip'] = kw.pop('ccns')
        if 'uf' in kw:
            kw['unicodeformat'] = kw.pop('uf')
        return F.tosvgfont(**kw)
    if name == 'pcf':
        return F.topcf(**op.get('kw', {}))
    if name == 'pcfrt':
        g = read_pcf(F.topcf(**op.get('kw', {})))
        ctx.fonts[op.get('to', 'P')] = g
        return [digest(g), g.tobdf()]
    if name == 'ttf':
        return F.tottf(**op.get('kw', {}))
    if name == 'ttfrt':
        g = read_ttf(F.tottf(**op.get('kw', {})), op.get('pixelsize'))
        ctx.fonts[op.get('to', 'T')] = g
        return [digest(g), g.tobdf()]
    if name == 'drawall':
        return F.drawall(**draw_kw(op.get('kw', {})))
    if name == 'draw':
        return F.draw(op['text'], **draw_kw(op.get('kw', {})))
    if name == 'drawcps':
        return F.drawcps(op['cps'], **draw_kw(op.get('kw', {})))
    if name == 'itercps':
        return list(F.itercps(op.get('order', 1), rng(op.get('r'))))
    if name == 'iterglyphs':
        return [glyph_meta(g) for g in F.iterglyphs(op.get('order', 1), rng(op.get('r')))]
    if name == 'gdraw':
        g = F.glyphbycp(op['cp'])
        if g is None:
            return None
        return g.draw(op.get('mode', 0), tuple(op['bb']) if op.get('bb') is not None else None)
    if name == 'gorigin':
        g = F.glyphbycp(op['cp'])
        if g is None:
            return None
        return list(g.origin(*op.get('a', [])))
    if name == 'gstr':
        g = F.glyphbycp(op['cp'])
        return None if g is None else str(g)
    if name == 'gchr':
        out = []
        for cp in op['cps']:
            g = F.glyphbycp(cp)
            out.append(None if g is None else g.chr())
        return out
    if name == 'gbychar':
        return [glyph_meta(F.glyph(c)) for c in op['chars']]
    if name == 'lacks':
        return F.lacksglyphs(op['text'])
    if name == 'c2p':
        return [F.char2cp(c) for c in op['chars']]
    if name == 'p2c':
        return [F.cp2char(cp) for cp in op['cps']]
    if name == 'setprop':
        F.setprop(op['key'], op['value'])
        return digest(F)
    if name == 'delprop':
        F.delprop(op['key'])
        return digest(F)
    if name == 'getprop':
        return [F.getprop(k) for k in op['keys']]
    if name == 'addglyph':
        F.addglyph(dict(op['meta']), op.get('replace', True))
        return digest(F)
    if name == 'removeglyph':
        F.removeglyph(op['cp'])
        return digest(F)
    if name == 'newglyph':
        rows = op.get('rows')
        g = F.newglyph(
            op['cp'],
            None if rows is None else bm(rows),
            op.get('mode', 0),
            op.get('name'),
            op.get('dwidth'),
        )
        ctx.handles.append(g)
        return [len(ctx.handles) - 1, glyph_meta(g), digest(F)]
    if name == 'gget':
        g = F.glyphbycp(op['cp'])
        ctx.handles.append(g)
        return [len(ctx.handles) - 1, glyph_meta(g)]
    if name.startswith('h'):
        hi = op['h']
        g = ctx.handles[hi] if 0 <= hi < len(ctx.handles) else None
        if g is None:
            return 'nohandle'
        if name == 'hsetbitmap':
            bb = op.get('bb')
            g.setbitmap(bm(op['rows']), op.get('mode', 0), tuple(bb) if bb is not None else None, op.get('trim', True))
        elif name == 'hsetmeta':
            g.setmeta(dict(op['meta']))
        elif name == 'hshift':
            g.shift(op.get('dx', 0), op.get('dy', 0))
        elif name == 'htransform':
            g.transform(make_fn(op['fn']), op.get('mode', 0))
        elif name == 'hclone':
            ctx.handles.append(g.clone())
            return [len(ctx.handles) - 1, glyph_meta(g)]
        elif name == 'haddglyph':
            F.addglyph(g, op.get('replace', True))
        elif name == 'hremove':
            F.removeglyph(g)
        elif name == 'hmeta':
            return glyph_meta(g)
        elif name == 'hdraw':
            return g.draw(op.get('mode', 0))
        else:
            raise ValueError(f'unknown op {name}')
        return [glyph_meta(g), digest(g.font)]
    if name == 'updatebbox':
        F.updatebbox()
        return [F.headers.get(k) for k in ('fbbx', 'fbby', 'fbbxoff', 'fbbyoff')]
    if name == 'subset':
        g = F.subset(rng(op['r']))
        ctx.fonts[op.get('to', 'S')] = g
        return digest(g)
    if name == 'merge':
        F.merge(ctx.fonts[op['g']], op.get('replace', False))
        return digest(F)
    if name == 'transform':
        F.transform(make_fn(op['fn']), rng(op.get('r')), op.get('mode', 0))
        return digest(F)
    if name == 'clone':
        g = F.clone()
        ctx.fonts[op.get('to', 'C')] = g
        return digest(g)
    if name == 'charsetconvert':
        F.charsetconvert(op['charset'])
        return [digest(F), F.charset]
    if name == 'encoding':
        F.encoding(charset=op['charset'])
        return F.charset
    if name == 'swidth':
        return [F.swidth(d) for d in op['dwxs']]
    if name == 'length':
        return [len(F), F.charset]
    # bitmap register
    if name == 'bset':
        ctx.B = bm(op['rows'])
        return None
    if name == 'bglyph':
        g = F.glyphbycp(op['cp'])
        ctx.B = g.draw(op.get('mode', 0)) if g is not None else Bitmap([])
        return ctx.B
    if name == 'bdrawall':
        ctx.B = F.drawall(**draw_kw(op.get('kw', {})))
        return ctx.B
    if name == 'bop':
        B, val = apply_bop(ctx.B, op['m'], op.get('a', []))
        ctx.B = B
        return ctx.B if val is NOTHING else val
    # module-level charset functions
    if name == 'cs':
        codec = charset_codec(canonical_charset(op['charset']), op.get('gl'))
        return [
            canonical_charset(op['charset']),
            [codec.cp2char(cp) for cp in op.get('cps', [])],
            [codec.char2cp(c) for c in op.get('chars', [])],
        ]
    if name == 'csname':
        return [
            [sanitize_charset(r, e) for r, e in op.get('pairs', [])],
            [canonical_charset(n) for n in op.get('names', [])],
            [list(charset_props(canonical_charset(n))) for n in op.get('names', [])],
        ]
    raise ValueError(f'unknown op {name}')


STATEFUL = {
    'setprop', 'delprop', 'addglyph', 'removeglyph', 'newglyph', 'updatebbox', 'merge', 'transform',
    'charsetconvert', 'encoding', 'hsetbitmap', 'hsetmeta', 'hshift', 'htransform', 'haddglyph', 'hremove',
}


def run_case(case):
    ctx = Ctx(case)
    res = []
    for i, op in enumerate(case['ops']):
        try:
            v = run_op(ctx, op)
            res.append([i, op['op'], shrink(canon(v)), None])
        except Exception as e:  # noqa: BLE001
            entry = [i, op['op'], None, f'{type(e).__name__}: {e}'[:300]]
            # state of the target font after the exception (operations may fail
            # half-way: both sides raising is only "equal" if they leave the same state)
            f = ctx.fonts.get(op.get('f', 'F'))
            if f is not None and op['op'] in STATEFUL:
                try:
                    entry.append(shrink(canon(digest(f))))
                except Exception:  # noqa: BLE001
                    entry.append(None)
            res.append(entry)
            if op['op'] == 'load':
                break
    return res


# ---------------------------------------------------------------------------
# charset tables


def run_tables(spec_path: str, out_path: str) -> None:
    spec = json.loads(Path(spec_path).read_text())
    cps = spec['cps']
    chars = [chr(c) for c in spec['chars']]
    out = {}
    for ent in spec['charsets']:
        name, gl = ent['name'], ent.get('gl')
        key = canonical_charset(name)
        codec = charset_codec(key, gl)
        rec = {'key': key, 'known': codec.known}
        p2c = {}
        for cp in cps + ent.get('extra_cps', []):
            try:
                ch = codec.cp2char(cp)
            except Exception as e:  # noqa: BLE001
                ch = '!' + type(e).__name__
            if ch is not None:
                p2c[cp] = ch
        c2p = {}
        for ch in chars:
            try:
                cp = codec.char2cp(ch)
            except Exception as e:  # noqa: BLE001
                cp = '!' + type(e).__name__
            if cp is not None:
                c2p[ord(ch)] = cp
        rec['p2c'] = [[k, v] for k, v in p2c.items()]
        rec['c2p'] = [[k, v] for k, v in c2p.items()]
        out[ent['id']] = rec
    Path(out_path).write_text(canon(out))


def main(argv):
    global FULL
    if argv and argv[0] == '--tables':
        run_tables(argv[1], argv[2])
        return
    inp, outp = argv[0], argv[1]
    FULL = '--full' in argv
    only = None
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].split(','))
    t0 = time.time()
    n = 0
    with open(inp, encoding='utf-8') as fin, open(outp, 'w', encoding='utf-8') as fout:
        for line in fin:
            if not line.strip():
                continue
            case = json.loads(line)
            if only is not None and case['id'] not in only:
                continue
            t = time.time()
            res = run_case(case)
            fout.write(json.dumps({'id': case['id'], 'ms': round((time.time() - t) * 1000), 'res': res}) + '\n')
            n += 1
    print(f'[py] {n} cases in {time.time() - t0:.1f}s', file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv[1:])
