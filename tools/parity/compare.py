#!/usr/bin/env python3
"""
Parity harness — comparison.

    python compare.py results PY.jsonl JS.jsonl CASES.jsonl [--json OUT.json] [--max N] [--tables AGREED.json]
        Compare per-operation results and report every *independent*
        divergence: once an operation diverges, the registers it writes (fonts
        F/G/S/C/P/T, the bitmap register B, glyph handles H) are "tainted" and
        later divergences of operations reading tainted registers are counted
        as cascades, not reported. Two errors count as equal (exception classes
        and messages differ by language). Each divergence is labelled with a
        known-issue id (known_issues.py) or NEW. Exit status 1 if any NEW
        divergence exists.

    python compare.py tables PY.json JS.json AGREED_OUT.json [--report OUT.txt]
        Compare the full charset tables (cp2char over the code space, char2cp
        over the BMP) and write the per-charset "agreed codes" used by
        gen_cases.py so random fonts only use codes both sides map identically.
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from known_issues import DESCRIPTIONS, label  # noqa: E402

READONLY = {
    'tobdf', 'digest', 'model', 'svgfont', 'pcf', 'ttf', 'drawall', 'draw', 'drawcps', 'itercps', 'iterglyphs',
    'gdraw', 'gorigin', 'gstr', 'gchr', 'gbychar', 'lacks', 'c2p', 'p2c', 'getprop', 'swidth', 'length',
}
# operations whose result fully describes the register they (re)write
FRESH = {'load', 'create', 'bset', 'clone', 'subset', 'pcfrt', 'ttfrt', 'bglyph', 'bdrawall'}
FONTMUT = {'addglyph', 'removeglyph', 'transform', 'charsetconvert', 'setprop', 'delprop', 'updatebbox', 'encoding'}


def regs(op):
    """(reads, writes) register sets of an operation."""
    n = op.get('op')
    f = op.get('f', 'F')
    if n in ('load', 'create'):
        return set(), {op.get('to', 'F')}
    if n in ('clone', 'subset', 'pcfrt', 'ttfrt'):
        return {f}, {op.get('to', {'clone': 'C', 'subset': 'S', 'pcfrt': 'P', 'ttfrt': 'T'}[n])}
    if n == 'merge':
        return {f, op.get('g', 'G')}, {f}
    if n in FONTMUT:
        return {f}, {f}
    if n in ('newglyph', 'gget'):
        return {f, 'H'}, {f, 'H'}
    if n.startswith('h'):
        return {'F', 'H'}, {'F', 'H'}
    if n == 'bset':
        return set(), {'B'}
    if n in ('bglyph', 'bdrawall'):
        return {f}, {'B'}
    if n == 'bop':
        return {'B'}, {'B'}
    if n in READONLY:
        return {f}, set()
    return set(), set()  # cs, csname: stateless


def short(s, n=160):
    if s is None:
        return 'None'
    s = str(s)
    return s if len(s) <= n else s[:n] + f'... ({len(s)} chars)'


def load_jsonl(p):
    out = {}
    with open(p, encoding='utf-8') as f:
        for line in f:
            if line.strip():
                d = json.loads(line)
                out[d['id']] = d
    return out


def same(a, b):
    ea, eb = a[3] is not None, b[3] is not None
    if ea and eb:
        # both raised: equal unless they left the target font in different states
        sa = a[4] if len(a) > 4 else None
        sb = b[4] if len(b) > 4 else None
        return sa is None or sb is None or sa == sb
    return ea == eb and a[2] == b[2]


def first_diff(rp, rj):
    """First diverging operation: (index, py_result, js_result) or None (used by minimize.py)."""
    n = max(len(rp), len(rj))
    for i in range(n):
        a = rp[i] if i < len(rp) else None
        b = rj[i] if i < len(rj) else None
        if a is None or b is None:
            return i, a, b
        if not same(a, b):
            return i, a, b
    return None


def independent_diffs(case, rp, rj):
    """All divergences not explained by an earlier divergence, plus the cascade count.
    Each divergence carries the charset of the font register it read (from the
    Python side's load / charsetconvert results), for known_issues matchers."""
    tainted: set[str] = set()
    charset: dict[str, str] = {}
    out = []
    cascades = 0
    n = max(len(rp), len(rj))
    for i in range(n):
        a = rp[i] if i < len(rp) else None
        b = rj[i] if i < len(rj) else None
        op = case['ops'][i] if i < len(case['ops']) else {'op': '?'}
        if a is None or b is None:
            out.append((i, a, b, None))
            break
        reads, writes = regs(op)
        cs = charset.get(op.get('f', 'F'))
        try:
            if op['op'] == 'encoding' and a[2] is not None:
                charset[op.get('f', 'F')] = json.loads(a[2])
            elif op['op'] in ('load', 'charsetconvert', 'clone', 'subset') and a[2] is not None:
                v = json.loads(a[2])
                reg = op.get('to', 'F') if op['op'] == 'load' else op.get('to', {'clone': 'C', 'subset': 'S'}.get(op['op'], op.get('f', 'F')))
                if op['op'] in ('clone', 'subset'):
                    charset[reg] = charset.get(op.get('f', 'F'))
                else:
                    charset[reg] = v[1]
        except (ValueError, IndexError, TypeError, KeyError):
            pass
        if same(a, b):
            if op['op'] in FRESH and a[3] is None:
                # the written register is fully described by the (equal) result
                tainted -= writes
            elif reads & tainted:
                tainted |= writes
            continue
        if reads & tainted:
            cascades += 1
        else:
            out.append((i, a, b, cs))
        tainted |= writes
        if op['op'] == 'load' and (a[3] or b[3]):
            break
    return out, cascades


def classify(op, a, b):
    ea = a is not None and a[3] is not None
    eb = b is not None and b[3] is not None
    kind = 'py-error' if ea and not eb else 'js-error' if eb and not ea else 'error-state' if ea and eb else 'value'
    name = op.get('op') if op else '?'
    if name == 'bop':
        name = 'bop.' + str(op.get('m'))
    return f'{name}:{kind}'


def cmp_results(pyp, jsp, casesp, outjson=None, maxshow=40, tables=None):
    tables = json.loads(Path(tables).read_text()) if tables else {}
    P = load_jsonl(pyp)
    J = load_jsonl(jsp)
    C = load_jsonl(casesp)
    diffs = []
    nops = 0
    ncascade = 0
    for cid, case in C.items():
        rp = P.get(cid, {}).get('res')
        rj = J.get(cid, {}).get('res')
        if rp is None or rj is None:
            diffs.append({'id': cid, 'i': -1, 'sig': 'missing-result', 'label': 'NEW', 'py': str(rp is not None), 'js': str(rj is not None)})
            continue
        nops += len(rp)
        found, casc = independent_diffs(case, rp, rj)
        ncascade += casc
        for i, a, b, cs in found:
            op = case['ops'][i] if i < len(case['ops']) else None
            pe = a is not None and a[3] is not None
            je = b is not None and b[3] is not None
            pyv = (a[3] if pe else a[2]) if a else None
            jsv = (b[3] if je else b[2]) if b else None
            if pe and je:  # error-state divergence: show the messages and the states
                pyv = f'{a[3]} || state {a[4] if len(a) > 4 else None}'
                jsv = f'{b[3]} || state {b[4] if len(b) > 4 else None}'
            diffs.append(
                {
                    'id': cid,
                    'i': i,
                    'op': op,
                    'sig': classify(op, a, b),
                    'label': label(op, case, pyv, jsv, pe, je, {'charset': cs, 'tables': tables}),
                    'py': pyv,
                    'js': jsv,
                }
            )
    ncases = len({d['id'] for d in diffs})
    nnew = sum(1 for d in diffs if d['label'] == 'NEW')
    print(f'compared {len(C)} cases, {nops} operations: {len(diffs)} independent divergence(s) in {ncases} case(s) '
          f'({nnew} NEW), {ncascade} cascaded op divergence(s) suppressed')
    by_label = Counter(d['label'] for d in diffs)
    for lab, cnt in sorted(by_label.items()):
        sigs = Counter(d['sig'] for d in diffs if d['label'] == lab)
        print(f'  {cnt:5d}  {lab}  ' + ', '.join(f'{s} x{c}' for s, c in sigs.most_common()))
        if lab in DESCRIPTIONS:
            print(f'         {DESCRIPTIONS[lab]}')
    shown = defaultdict(int)
    total = 0
    for d in diffs:
        key = (d['label'], d['sig'])
        if d['label'] != 'NEW' and shown[key] >= 1:
            continue
        if shown[key] >= 3 or total >= maxshow:
            continue
        shown[key] += 1
        total += 1
        print(f"\n--- [{d['label']}] {d['id']} op#{d['i']} {d['sig']}")
        print('  op:', short(json.dumps(d.get('op'), ensure_ascii=False), 300))
        print('  py:', short(d['py'], 300))
        print('  js:', short(d['js'], 300))
    if outjson:
        Path(outjson).write_text(json.dumps(diffs, ensure_ascii=False, indent=1))
    return diffs


# ---------------------------------------------------------------------------


def cmp_tables(pyp, jsp, outp, report=None):
    P = json.loads(Path(pyp).read_text())
    J = json.loads(Path(jsp).read_text())
    agreed = {}
    lines = []
    ndiff = 0
    for tid in P:
        p, j = P[tid], J[tid]
        pp = {k: v for k, v in p['p2c']}
        jp = {k: v for k, v in j['p2c']}
        pc = {k: v for k, v in p['c2p']}
        jc = {k: v for k, v in j['c2p']}
        p2c_diff = sorted(k for k in set(pp) | set(jp) if pp.get(k) != jp.get(k))
        c2p_diff = sorted(k for k in set(pc) | set(jc) if pc.get(k) != jc.get(k))
        cps, chars = [], []
        for cp in sorted(set(pp) & set(jp)):
            ch = pp[cp]
            if cp < 0 or ch != jp[cp] or not isinstance(ch, str) or len(ch) != 1 or ch.startswith('!'):
                continue
            if pc.get(ord(ch)) != jc.get(ord(ch)):
                continue
            cps.append(cp)
            chars.append(ch)
        agreed[tid] = {'cps': cps, 'chars': chars, 'bad_chars': c2p_diff, 'bad_cps': p2c_diff}
        ok = not p2c_diff and not c2p_diff and p['key'] == j['key'] and p['known'] == j['known']
        ndiff += not ok
        lines.append(
            f"{tid:20s} {'OK' if ok else 'DIFF':4s} key py={p['key']} js={j['key']} known py={p['known']} js={j['known']} "
            f"| cp2char: py {len(pp)} js {len(jp)} differ {len(p2c_diff)} "
            f"| char2cp: py {len(pc)} js {len(jc)} differ {len(c2p_diff)} | agreed {len(cps)}"
        )
        for k in p2c_diff[:6]:
            lines.append(f'      cp2char(0x{k:X}): py={pp.get(k)!r} js={jp.get(k)!r}')
        for k in c2p_diff[:6]:
            a, b = pc.get(k), jc.get(k)
            fa = f'0x{a:X}' if isinstance(a, int) else repr(a)
            fb = f'0x{b:X}' if isinstance(b, int) else repr(b)
            lines.append(f'      char2cp(U+{k:04X} {chr(k)!r}): py={fa} js={fb}')
    Path(outp).write_text(json.dumps(agreed))
    text = '\n'.join(lines)
    text += f'\n{len(P)} charset tables compared, {ndiff} differ (codec table variants, see README.md)'
    print(text)
    if report:
        Path(report).write_text(text + '\n')


def main(argv):
    if argv and argv[0] == 'results':
        outjson = argv[argv.index('--json') + 1] if '--json' in argv else None
        maxshow = int(argv[argv.index('--max') + 1]) if '--max' in argv else 40
        tables = argv[argv.index('--tables') + 1] if '--tables' in argv else None
        diffs = cmp_results(argv[1], argv[2], argv[3], outjson, maxshow, tables)
        sys.exit(1 if any(d['label'] == 'NEW' for d in diffs) else 0)
    if argv and argv[0] == 'tables':
        report = argv[argv.index('--report') + 1] if '--report' in argv else None
        cmp_tables(argv[1], argv[2], argv[3], report)
        return
    raise SystemExit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
