#!/usr/bin/env python3
"""
Generate bdfparser-js's charset tables from the Python bdfparser (SPEC-v3
§11.1: Python's codecs are the reference).

Run from the Python repository (so that `bdfparser` is importable):

    cd ../bdfparser && uv run python ../bdfparser-js/tools/gen_charsets.py

Writes (in bdfparser-js):

- src/charsets/table.ts     canonical charset table (keys, codecs, kinds, GL,
                            CHARSET_REGISTRY / CHARSET_ENCODING, aliases) and
                            the strict byte ranges of the multi-byte charsets
                            (TextDecoder fallback without `bdfparser/cjk`)
- src/charsets/sbcs.ts      single-byte decode tables (core)
- src/charsets/cjk-data.ts  multi-byte tables (sub-module `bdfparser/cjk`)
- test/fixtures/charsets.json
                            SHA-256 of cp2char / char2cp over the whole code
                            space of every charset key, computed with the
                            Python library, plus canonicalisation vectors

Table format (decoded by src/charsets/registry.ts): the codes of a charset
are enumerated in ascending order: the single bytes 0x00-0xFF, then (multi-byte
charsets) every `lead << 8 | trail` for lead in `l` and trail in `t`
(inclusive ranges). `d` is a stream of items over these positions, written
with a 64-character ASCII alphabet (variable-length numbers: digits from CONT
carry 5 high bits each, a digit from FINAL ends the number):

    number            literal: code point = previous value + unzigzag(number)
    '!' number        n + 1 unmapped positions
    '#' number        n + 1 positions, each the previous value + 1
    '$' number        n + 1 positions copied from the base table `b` at the
                      same code (or at `sjis2euc(code)` when `x` is 'sjis')

`e` lists the characters for which the Python encoder does not choose the
smallest code (or none): pairs `code point, code + 1` (0 = not encodable).
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from bdfparser import encoding as enc

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

FINAL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'
CONT = 'ghijklmnopqrstuvwxyz0123456789+/'
SKIP, SEQ, SAME = '!', '#', '$'

# multi-byte codec -> (base codec, transform) used for '$' runs
BASES = {
    'gbk': ('gb2312', None),
    'cp936': ('gbk', None),
    'gb18030': ('cp936', None),
    'big5hkscs': ('big5', None),
    'cp950': ('big5', None),
    'cp949': ('euc_kr', None),
    'shift_jis': ('euc_jp', 'sjis'),
    'cp932': ('shift_jis', None),
}

# WHATWG TextDecoder label per multi-byte codec (fallback without bdfparser/cjk)
WHATWG = {
    'gb2312': 'gbk',
    'gbk': 'gbk',
    'cp936': 'gbk',
    'gb18030': 'gb18030',
    'euc_jp': 'euc-jp',
    'shift_jis': 'shift_jis',
    'cp932': 'shift_jis',
    'euc_kr': 'euc-kr',
    'cp949': 'euc-kr',
    'johab': '',
    'big5': 'big5',
    'big5hkscs': 'big5',
    'cp950': 'big5',
}


def num(n: int) -> str:
    assert n >= 0
    digits = []
    digits.append(FINAL[n & 31])
    n >>= 5
    while n:
        digits.append(CONT[n & 31])
        n >>= 5
    return ''.join(reversed(digits))


def zigzag(n: int) -> int:
    return n * 2 if n >= 0 else -n * 2 - 1


def sjis2euc(code: int) -> int:
    """Shift_JIS code -> EUC-JP code (mirrored in src/charsets/registry.ts)."""
    if code < 0x100:
        return 0x8E00 | code if 0xA1 <= code <= 0xDF else code
    s1, s2 = code >> 8, code & 0xFF
    j1 = (s1 - (0x70 if s1 <= 0x9F else 0xB0)) * 2
    if s2 < 0x9F:
        j1 -= 1
        j2 = s2 - 0x1F - (1 if s2 >= 0x7F else 0)
    else:
        j2 = s2 - 0x7E
    return (((j1 | 0x80) & 0xFF) << 8) | ((j2 | 0x80) & 0xFF)


def positions(spec: dict) -> list[int]:
    out = list(range(0x100))
    if 'l' in spec:
        l0, l1 = spec['l']
        t0, t1 = spec['t']
        out += [(lead << 8) | t for lead in range(l0, l1 + 1) for t in range(t0, t1 + 1)]
    return out


def encode_stream(values: list[int], base: list[int] | None) -> str:
    """values / base: code point or -1 per position."""
    out = []
    prev = 0
    i = 0
    n = len(values)
    while i < n:
        v = values[i]
        if base is not None and base[i] == v:
            j = i
            while j < n and base[j] == values[j]:
                j += 1
            run = j - i
            # a short run of mapped values may be cheaper as literals / '#'
            out.append(SAME + num(run - 1))
            # '$' updates the previous value to the last copied mapped value
            for k in range(i, j):
                if values[k] >= 0:
                    prev = values[k]
            i = j
            continue
        if v < 0:
            j = i
            while j < n and values[j] < 0 and not (base is not None and base[j] == values[j]):
                j += 1
            out.append(SKIP + num(j - i - 1))
            i = j
            continue
        if v == prev + 1 and i + 1 < n and values[i + 1] == v + 1:
            j = i
            while j < n and values[j] == prev + 1 + (j - i) and not (
                base is not None and base[j] == values[j]
            ):
                j += 1
            out.append(SEQ + num(j - i - 1))
            prev = values[j - 1]
            i = j
            continue
        out.append(num(zigzag(v - prev)))
        prev = v
        i += 1
    return ''.join(out)


def decode_stream(spec: dict, tables: dict[str, list[int]]) -> list[int]:
    """Reference decoder (mirrors registry.ts), used to verify the output."""
    pos = positions(spec)
    s = spec['d']
    vals = [-1] * len(pos)
    base = None
    if 'b' in spec:
        bt = tables[spec['b']]
        xf = sjis2euc if spec.get('x') == 'sjis' else (lambda c: c)
        base = [bt[xf(c)] if xf(c) < len(bt) else -1 for c in pos]
    i = 0
    p = 0
    prev = 0

    def read() -> int:
        nonlocal i
        v = 0
        while s[i] in CONT:
            v = v * 32 + CONT.index(s[i])
            i += 1
        v = v * 32 + FINAL.index(s[i])
        i += 1
        return v

    while i < len(s):
        c = s[i]
        if c in (SKIP, SEQ, SAME):
            i += 1
            k = read() + 1
            for _ in range(k):
                if c == SEQ:
                    prev += 1
                    vals[p] = prev
                elif c == SAME:
                    vals[p] = base[p]
                    if vals[p] >= 0:
                        prev = vals[p]
                p += 1
        else:
            z = read()
            prev += z >> 1 if z % 2 == 0 else -((z + 1) >> 1)
            vals[p] = prev
            p += 1
    assert p == len(pos), (p, len(pos))
    return vals


def ts_str(s: str) -> str:
    assert '"' not in s and '\\' not in s
    return '"' + s + '"'


def ts_long_str(s: str, indent: str = '    ') -> str:
    # split long strings for readable diffs (joined at build time by esbuild)
    width = 100
    parts = [s[k : k + width] for k in range(0, len(s), width)] or ['']
    return ('\n' + indent + '+ ').join(ts_str(p) for p in parts)


def main() -> int:
    table = enc.charset_table()
    codecs_sbcs: dict[str, str] = {}
    codecs_mbcs: dict[str, str] = {}
    for key, info in table.items():
        if info['kind'] == 'unicode' or key == 'jisx0201':
            continue
        target = codecs_sbcs if info['kind'] == 'sbcs' else codecs_mbcs
        target.setdefault(info['codec'], key)

    fwd: dict[str, dict[int, str]] = {}
    for codec, key in {**codecs_sbcs, **codecs_mbcs}.items():
        m = enc.charset_map(key)
        for code, ch in m.items():
            assert len(ch) == 1, (codec, hex(code), ch)
        fwd[codec] = m

    # ---- reverse exceptions (Python's encoder vs the smallest code)
    ranges = enc.gb18030_ranges()

    def gb4_from_index(idx: int) -> int:
        b3 = idx % 10
        idx //= 10
        b2 = idx % 126
        idx //= 126
        b1 = idx % 10
        b0 = idx // 10
        return ((0x81 + b0) << 24) | ((0x30 + b1) << 16) | ((0x81 + b2) << 8) | (0x30 + b3)

    def gb4_rev(u: int) -> int | None:
        for idx, cp, n in ranges:
            if cp <= u < cp + n:
                return gb4_from_index(idx + u - cp)
        return None

    exceptions: dict[str, list[tuple[int, int | None]]] = {}
    for codec, key in {**codecs_sbcs, **codecs_mbcs}.items():
        m = fwd[codec]
        smallest: dict[str, int] = {}
        for code in sorted(m):
            smallest.setdefault(m[code], code)
        c = enc.charset_codec(key, False)
        exc = []
        chars = sorted(set(m.values()))
        if codec == 'gb18030':
            # every character: the 4-byte codes are algorithmic
            chars = [chr(u) for u in range(0x110000) if not 0xD800 <= u <= 0xDFFF]
        for ch in chars:
            py = c.char2cp(ch)
            js = smallest.get(ch)
            if js is None and codec == 'gb18030':
                js = gb4_rev(ord(ch))
            if py != js:
                exc.append((ord(ch), py))
        exceptions[codec] = exc

    # ---- GL forms: verify the JS algorithm (SPEC-v3 §4) against Python
    for key, info in table.items():
        if not (info['gl'] or info['forcegl']):
            continue
        codec = info['codec']
        m = fwd[codec]
        c = enc.charset_codec(key, True)
        excmap = dict(exceptions[codec])
        smallest: dict[str, int] = {}
        for code in sorted(m):
            smallest.setdefault(m[code], code)

        def js_cp2char(cp: int) -> str | None:
            if cp < 0x100:
                return m.get(cp)
            if cp < 0x10000:
                if not (0x21 <= cp >> 8 <= 0x7E and 0x21 <= cp & 0xFF <= 0x7E):
                    return None
                return m.get(cp + 0x8080)
            return None

        for cp in range(0x10000):
            assert js_cp2char(cp) == c.cp2char(cp), (key, hex(cp))
        for ch in sorted(set(m.values())):
            code = excmap[ord(ch)] if ord(ch) in excmap else smallest.get(ch)
            js = None
            if code is not None:
                if 0x100 <= code <= 0xFFFF:
                    code -= 0x8080
                js = code if js_cp2char(code) == ch else None
            assert js == c.char2cp(ch), (key, ch)

    # ---- encode the tables
    def spec_for(codec: str, mbcs: bool) -> dict:
        m = fwd[codec]
        spec: dict = {}
        if mbcs:
            two = [c for c in m if c >= 0x100]
            spec['l'] = [min(c >> 8 for c in two), max(c >> 8 for c in two)]
            spec['t'] = [min(c & 0xFF for c in two), max(c & 0xFF for c in two)]
            if codec in BASES:
                spec['b'] = BASES[codec][0]
                if BASES[codec][1]:
                    spec['x'] = BASES[codec][1]
        return spec

    flat: dict[str, list[int]] = {}
    for codec, m in fwd.items():
        size = 0x10000 if codec in codecs_mbcs else 0x100
        arr = [-1] * size
        for code, ch in m.items():
            arr[code] = ord(ch)
        flat[codec] = arr

    specs: dict[str, dict] = {}
    for codec in list(codecs_sbcs) + list(codecs_mbcs):
        mbcs = codec in codecs_mbcs
        spec = spec_for(codec, mbcs)
        pos = positions(spec)
        values = [flat[codec][c] for c in pos]
        # every mapped code must be a position
        assert sum(v >= 0 for v in values) == len(fwd[codec]), codec
        base = None
        if 'b' in spec:
            bt = flat[spec['b']]
            xf = sjis2euc if spec.get('x') == 'sjis' else (lambda c: c)
            base = [bt[xf(c)] if xf(c) < len(bt) else -1 for c in pos]
        spec['d'] = encode_stream(values, base)
        e = []
        for u, code in exceptions[codec]:
            e.append(num(u))
            e.append(num(0 if code is None else code + 1))
        if e:
            spec['e'] = ''.join(e)
        assert decode_stream(spec, flat) == values, codec
        specs[codec] = spec

    gb = []
    prev_end_idx = 0
    prev_end_cp = 0
    for idx, cp, n in ranges:
        gb.append(num(idx - prev_end_idx))
        gb.append(num(zigzag(cp - prev_end_cp)))
        gb.append(num(n - 1))
        prev_end_idx = idx + n
        prev_end_cp = cp + n
    gb18030 = ''.join(gb)

    # ---- strict byte ranges of the multi-byte charsets (fallback)
    def to_ranges(vals: set[int]) -> list[int]:
        out: list[int] = []
        for v in sorted(vals):
            if out and out[-1] == v - 1:
                out[-1] = v
            else:
                out += [v, v]
        return out

    fallback = {}
    for codec in codecs_mbcs:
        m = fwd[codec]
        single = {c for c in m if c < 0x100}
        lead = {c >> 8 for c in m if c >= 0x100}
        trail = {c & 0xFF for c in m if c >= 0x100}
        fallback[codec] = [WHATWG[codec], to_ranges(single), to_ranges(lead), to_ranges(trail)]

    header = (
        '// GENERATED by tools/gen_charsets.py from the Python bdfparser '
        f'(Python {sys.version.split()[0]}) - do not edit\n'
    )

    # ---- src/charsets/table.ts
    lines = [header]
    lines.append("import type { CharsetKind } from './registry'\n")
    lines.append('/** Unicode keys (identity mapping); keys starting with a UNICODE_PREFIXES entry are Unicode too */')
    lines.append(
        'export const UNICODE_KEYS: readonly string[] = '
        + json.dumps([k for k, v in table.items() if v['kind'] == 'unicode'])
    )
    lines.append('export const UNICODE_PREFIXES: readonly string[] = ' + json.dumps(list(enc.UNICODE_PREFIXES)))
    lines.append('')
    lines.append('/**')
    lines.append(' * Canonical key -> [codec, kind, GL (0 no, 1 GL-capable 94x94 set, 2 always GL),')
    lines.append(' * CHARSET_REGISTRY, CHARSET_ENCODING] (non-Unicode keys)')
    lines.append(' */')
    lines.append('export const CHARSETS: Record<string, [string, CharsetKind, 0 | 1 | 2, string, string]> = {')
    aliases = {}
    for key, info in table.items():
        for a in info['aliases']:
            aliases[a] = key
        if info['kind'] == 'unicode':
            continue
        gl = 2 if info['forcegl'] else 1 if info['gl'] else 0
        reg, en = info['props']
        lines.append(f"  {key}: {json.dumps([info['codec'], info['kind'], gl, reg, en])},")
    lines.append('}')
    lines.append('')
    lines.append('/** Aliases (already lower-case, without `-`, `_` and spaces) -> canonical key */')
    lines.append('export const ALIASES: Record<string, string> = ' + json.dumps(aliases))
    lines.append('')
    lines.append('/**')
    lines.append(' * Multi-byte codecs without their exact tables: [WHATWG TextDecoder label')
    lines.append(" * ('' = none), valid single bytes, lead bytes, trail bytes] (inclusive ranges)")
    lines.append(' */')
    lines.append('export const MBCS_RANGES: Record<string, [string, number[], number[], number[]]> = {')
    for codec, v in fallback.items():
        lines.append(f'  {codec}: {json.dumps(v)},')
    lines.append('}')
    (ROOT / 'src' / 'charsets').mkdir(exist_ok=True)
    (ROOT / 'src' / 'charsets' / 'table.ts').write_text('\n'.join(lines) + '\n', encoding='utf-8')

    def write_specs(path: Path, name: str, doc: str, codecs: list[str], extra: str = '') -> None:
        out = [header, "import type { TableSpec } from './registry'\n", f'/** {doc} */']
        out.append(f'export const {name}: Record<string, TableSpec> = {{')
        for codec in codecs:
            spec = specs[codec]
            out.append(f'  {codec}: {{')
            for k in ('l', 't'):
                if k in spec:
                    out.append(f'    {k}: {json.dumps(spec[k])},')
            for k in ('b', 'x'):
                if k in spec:
                    out.append(f'    {k}: {json.dumps(spec[k])},')
            out.append('    d: ' + ts_long_str(spec['d'], '      ') + ',')
            if 'e' in spec:
                out.append('    e: ' + ts_long_str(spec['e'], '      ') + ',')
            out.append('  },')
        out.append('}')
        out.append(extra)
        path.write_text('\n'.join(out), encoding='utf-8')

    write_specs(
        ROOT / 'src' / 'charsets' / 'sbcs.ts',
        'SBCS_TABLES',
        'Single-byte codecs (Python codec name -> table)',
        list(codecs_sbcs),
    )
    write_specs(
        ROOT / 'src' / 'charsets' / 'cjk-data.ts',
        'CJK_TABLES',
        'Multi-byte codecs (Python codec name -> table)',
        list(codecs_mbcs),
        '\n/** GB18030 4-byte codes: runs (index - previous end, zigzag(code point - previous end), length - 1) */\n'
        'export const GB18030_RANGES = ' + ts_long_str(gb18030, '  ') + '\n',
    )

    # ---- test fixture
    extra_codes = [0x10000, 0x8FA2C2, 0xA4D4A4A1, 0x1000000, 0xFFFFFFFF, 0x100000000]
    astral_in_tables = sorted({ord(ch) for m in fwd.values() for ch in m.values() if ord(ch) > 0xFFFF})
    sample_astral = sorted(set(range(0x10000, 0x110000, 61)) | {0x10000, 0x10FFFF} | set(astral_in_tables))

    def sha(lines_iter) -> str:
        h = hashlib.sha256()
        for s in lines_iter:
            h.update(s.encode('ascii'))
        return h.hexdigest()

    def cp2char_dump(c, codes):
        for code in codes:
            ch = c.cp2char(code)
            if ch is not None:
                yield f'{code:x}:{ord(ch):x}\n'

    def char2cp_dump(c, cps):
        for u in cps:
            code = c.char2cp(chr(u))
            if code is not None:
                yield f'{u:x}:{code:x}\n'

    def gb4_codes():
        for b0 in range(0x81, 0xFF):
            for b1 in range(0x30, 0x3A):
                for b2 in range(0x81, 0xFF):
                    for b3 in range(0x30, 0x3A):
                        yield (b0 << 24) | (b1 << 16) | (b2 << 8) | b3

    variants = []
    for key, info in table.items():
        variants.append((key, False))
        if info['gl']:
            variants.append((key, True))
    hashes = {}
    bmp = list(range(0x10000))
    for key, gl in variants:
        c = enc.charset_codec(key, gl if gl else None)
        name = key + ('/gl' if gl else '')
        hashes[name] = {
            'cp2char': sha(cp2char_dump(c, bmp + extra_codes)),
            'char2cp': sha(char2cp_dump(c, bmp + sample_astral)),
            'mapped': sum(1 for code in range(0x10000) if c.cp2char(code) is not None),
        }
        if info_kind(table, key) == 'gb18030':
            hashes[name]['cp2char4'] = sha(cp2char_dump(c, gb4_codes()))

    names = [
        'ISO8859-1', 'ISO8859-01', 'iso-8859-15', 'ISO_8859-5', 'iso8859', 'ISO8859-0', 'ISO8859-x',
        'KOI8-R', 'KOI8-U', 'KOI8-RU', 'koi8', 'KOI8 r', 'microsoft-cp1252', 'Windows-1251', 'win1250',
        'ms1253', 'cp01252', 'ibm437', 'IBM-CP850', 'cp866', 'CP874', 'cp932', 'MS932', 'windows-936',
        'cp949', 'CP950', 'Big5', 'big5-0', 'BIG5.ETEN-0', 'Big5-HKSCS', 'big5hkscs-0', 'GB2312.1980-0',
        'GB2312', 'gbk', 'GBK-0', 'gb18030', 'GB18030.2000-0', 'EUC-CN', 'ISO-2022-CN', 'HZ', 'hz-gb-2312',
        'JISX0208.1983-0', 'JISX0201.1976-0', 'Shift_JIS', 'SJIS', 'shift-jis', 'EUC-JP', 'KSC5601.1987-0',
        'KSX1001', 'ks_x_1001', 'EUC-KR', 'johab', 'ISO10646-1', 'UTF-8', 'utf_16le', 'UCS-2', 'unicode',
        'TIS620', 'tis-620', 'MacRoman', 'ascii', 'ISO646.1991-IRV', 'FontSpecific', 'adobe-fontspecific',
        '-misc-fixed', '  spaced name\t', '1252', '437', 'iso-ir-100', 'latin1', 'l1', 'binary', '_utf32',
        'constructor', '__proto__', 'toString', 'cp1252.x', 'koi8-ru', 'Big5-1', 'GB2312-1', 'iso8859-16',
        'iso8859-12', 'iso885912', 'cp', 'windows', 'ms', 'ibm', 'IBM-1', 'microsoft-symbol', 'koi8-x',
    ]
    pairs = [
        (None, None), ('ISO8859', '1'), ('ISO8859', '01'), ('ISO8859', 2), ('ISO8859', 'x'), ('ISO8859', '0'),
        ('ISO8859', ''), ('KOI8', 'R'), ('KOI8', 'RU'), ('KOI8', 'U'), ('KOI8', ''), ('KOI8', None),
        ('MICROSOFT', 'CP1252'), ('microsoft', 'cp932'), ('IBM', 'CP437'), ('IBM', 'x'), ('windows', '1251'),
        ('GB2312.1980', '0'), ('BIG5', '0'), ('JISX0208.1983', '0'), ('KSC5601.1987', '0'), ('KSX1001', '0'),
        ('ISO10646', '1'), ('FontSpecific', '0'), ('SJIS', None), ('-ISO8859', '5'), ('cp1252', 'x'),
        ('1252', None), ('', '1'), ('  ', None), ('ISO8859', '16'), ('Big5.ETEN', '0'), ('constructor', '0'),
    ]
    canon = {
        'names': [[n, enc.sanitize_charset(n), enc.canonical_charset(n)] for n in names],
        'pairs': [[r, e, enc.sanitize_charset(r, e)] for r, e in pairs],
        'props': [[k, list(enc.charset_props(k))] for k in sorted(
            set(table) | {enc.canonical_charset(n) for n in names}
        )],
    }
    fixture = {
        'generator': 'tools/gen_charsets.py',
        'python': sys.version.split()[0],
        'extra_codes': extra_codes,
        # astral characters of the char2cp dumps: every 61st code point from
        # U+10000, U+10FFFF and the astral characters of the tables (ranges)
        'astral_stride': 61,
        'astral_tables': ranges_of(astral_in_tables),
        'table': {k: v for k, v in table.items()},
        'hashes': hashes,
        'canonical': canon,
    }
    (ROOT / 'test' / 'fixtures' / 'charsets.json').write_text(
        json.dumps(fixture, indent=1, ensure_ascii=True) + '\n', encoding='utf-8'
    )

    for name, path in (
        ('table', ROOT / 'src' / 'charsets' / 'table.ts'),
        ('sbcs', ROOT / 'src' / 'charsets' / 'sbcs.ts'),
        ('cjk-data', ROOT / 'src' / 'charsets' / 'cjk-data.ts'),
    ):
        print(f'{name}: {path.stat().st_size} bytes')
    print(
        'exceptions:',
        {k: len(v) for k, v in exceptions.items() if v},
        'gb18030 runs:',
        len(ranges),
    )
    return 0


def ranges_of(vals: list[int]) -> list[list[int]]:
    out: list[list[int]] = []
    for v in sorted(vals):
        if out and out[-1][1] == v - 1:
            out[-1][1] = v
        else:
            out.append([v, v])
    return out


def info_kind(table: dict, key: str) -> str:
    return table[key]['kind']


if __name__ == '__main__':
    sys.exit(main())
