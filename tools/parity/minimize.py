#!/usr/bin/env python3
"""
Parity harness — test-case minimiser.

Shrinks a diverging case to a small reproducer that still diverges at the
same operation (same op name and same divergence kind: value / py-error /
js-error), then prints the reproducer (BDF text + operations) and the full
Python and JavaScript outputs of the diverging operation.

    python minimize.py CASES.jsonl ID [ID ...] [--out DIR] [--js "bun tools/parity/run_js.ts"]

Strategy (greedy, batched): drop trailing operations, drop operations,
simplify the structured font spec (glyphs, properties, header lines, noise
flags, rows) and the arguments of operations (list elements, dict keys).
Each round evaluates all candidates of one kind in a single run of each
runner.
"""

from __future__ import annotations

import copy
import json
import os
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from compare import classify, first_diff  # noqa: E402
from gen_cases import rebuild  # noqa: E402

JSROOT = HERE.parent.parent
JS_CMD = os.environ.get('PARITY_JS', 'bun tools/parity/run_js.ts')
PY_CMD = os.environ.get('PARITY_PY', f'{shlex.quote(sys.executable)} tools/parity/run_py.py')


def run_both(cases: list[dict], full=False, tmp=None):
    tmp = Path(tmp or tempfile.mkdtemp(prefix='parity-min-'))
    cf = tmp / 'c.jsonl'
    with open(cf, 'w', encoding='utf-8') as f:
        for c in cases:
            f.write(json.dumps(c) + '\n')
    extra = ' --full' if full else ''
    outs = {}
    for side, cmd in (('py', PY_CMD), ('js', JS_CMD)):
        of = tmp / f'{side}.jsonl'
        subprocess.run(f'{cmd} {shlex.quote(str(cf))} {shlex.quote(str(of))}{extra}', shell=True, cwd=JSROOT,
                       check=True, stderr=subprocess.DEVNULL)
        outs[side] = {json.loads(l)['id']: json.loads(l)['res'] for l in open(of, encoding='utf-8') if l.strip()}
    return outs


def signature(case, rp, rj):
    d = first_diff(rp, rj)
    if d is None:
        return None
    i, a, b = d
    op = case['ops'][i] if i < len(case['ops']) else None
    return classify(op, a, b), i


class Minimizer:
    def __init__(self, case):
        self.case = copy.deepcopy(case)
        self.tmp = tempfile.mkdtemp(prefix='parity-min-')
        self.runs = 0
        o = run_both([self.case], tmp=self.tmp)
        self.runs += 1
        s = signature(self.case, o['py'][self.case['id']], o['js'][self.case['id']])
        if s is None:
            raise SystemExit(f"case {case['id']} does not diverge")
        self.sig, self.idx = s

    def first_ok(self, cands):
        """Return the first candidate that still diverges with the same signature."""
        cands = [c for c in cands if c is not None]
        if not cands:
            return None
        for k, c in enumerate(cands):
            c['id'] = f'cand{k}'
            if c.get('font') or c.get('font2'):
                try:
                    rebuild(c)
                except Exception:  # noqa: BLE001
                    c['_bad'] = True
        cands = [c for c in cands if not c.get('_bad')]
        o = run_both(cands, tmp=self.tmp)
        self.runs += 1
        for c in cands:
            rp, rj = o['py'].get(c['id']), o['js'].get(c['id'])
            if rp is None or rj is None:
                continue
            s = signature(c, rp, rj)
            if s is not None and s[0] == self.sig:
                c['ops'] = c['ops'][: s[1] + 1]
                c['id'] = self.case['id']
                return c
        return None

    def accept(self, c):
        if c is None:
            return False
        self.case = c
        return True

    # -- candidate generators ------------------------------------------------

    def cands_drop_ops(self):
        ops = self.case['ops']
        last = len(ops) - 1
        out = []
        # chunks first, then single ops (never the first load / the diverging op)
        n = len(ops)
        for size in (8, 4, 2, 1):
            for start in range(1, last, size):
                end = min(start + size, last)
                if end <= start:
                    continue
                c = copy.deepcopy(self.case)
                c['ops'] = ops[:start] + ops[end:]
                out.append(c)
        del n
        return out

    def cands_spec(self, key='font'):
        sp = self.case.get(key)
        if not sp:
            return []
        out = []

        def mk(f):
            c = copy.deepcopy(self.case)
            f(c[key])
            return c

        if key == 'font2':
            c = copy.deepcopy(self.case)
            if not any(o.get('src') == 'bdf2' or o.get('g') == 'G' for o in c['ops']):
                c.pop('font2', None)
                c.pop('bdf2', None)
                out.append(c)
        g = sp['glyphs']
        for size in (16, 8, 4, 2, 1):
            for s in range(0, len(g), size):
                out.append(mk(lambda f, s=s, size=size: f.__setitem__('glyphs', f['glyphs'][:s] + f['glyphs'][s + size:])))
        for flag in ('indent', 'blank', 'tabs', 'exotic', 'bom'):
            if sp.get(flag):
                out.append(mk(lambda f, flag=flag: f.__setitem__(flag, False)))
        if sp.get('eol') != '\n':
            out.append(mk(lambda f: f.__setitem__('eol', '\n')))
        if sp.get('malformed'):
            out.append(mk(lambda f: f.__setitem__('malformed', None)))
        if sp.get('fontname') != 'F':
            out.append(mk(lambda f: f.__setitem__('fontname', 'F')))
        for i in range(len(sp['header_extra'])):
            out.append(mk(lambda f, i=i: f['header_extra'].pop(i)))
        if sp.get('props'):
            items = sp['props']['items']
            for i in range(len(items)):
                def f_(f, i=i):
                    it = f['props']['items']
                    it.pop(i)
                    if isinstance(f['props']['count'], int):
                        f['props']['count'] = sum(1 for k, _ in it if k != '#COMMENT')
                out.append(mk(f_))
            out.append(mk(lambda f: f.__setitem__('props', None)))
        for gi, gl in enumerate(g):
            if gl.get('metrics'):
                out.append(mk(lambda f, gi=gi: f['glyphs'][gi].__setitem__('metrics', [])))
            if len(gl.get('rows') or []) > 1:
                out.append(mk(lambda f, gi=gi: f['glyphs'][gi].__setitem__('rows', f['glyphs'][gi]['rows'][:1])))
            if gl.get('name') not in ('g', None):
                out.append(mk(lambda f, gi=gi: f['glyphs'][gi].__setitem__('name', 'g')))
            for flag in ('blank_in_bitmap', 'no_endchar'):
                if gl.get(flag):
                    out.append(mk(lambda f, gi=gi, flag=flag: f['glyphs'][gi].__setitem__(flag, False)))
        return out

    def cands_args(self):
        out = []
        ops = self.case['ops']
        for i, op in enumerate(ops):
            for k, v in op.items():
                if k in ('op', 'to', 'f', 'g', 'src', 'how', 'h', 'm'):
                    continue
                vals = []
                if isinstance(v, list) and v:
                    for j in range(len(v)):
                        vals.append(v[:j] + v[j + 1:])
                    for j, x in enumerate(v):
                        if isinstance(x, list) and x:
                            for q in range(len(x)):
                                vals.append(v[:j] + [x[:q] + x[q + 1:]] + v[j + 1:])
                elif isinstance(v, dict) and v:
                    for kk in v:
                        vals.append({a: b for a, b in v.items() if a != kk})
                elif isinstance(v, str) and len(v) > 1:
                    vals += [v[: len(v) // 2], v[len(v) // 2:], v[1:], v[:-1]]
                for nv in vals:
                    c = copy.deepcopy(self.case)
                    c['ops'][i][k] = nv
                    out.append(c)
            if op['op'] == 'load' and op.get('how') != 'string' and 'bdf_b64' not in self.case:
                c = copy.deepcopy(self.case)
                c['ops'][i]['how'] = 'string'
                out.append(c)
        return out

    def run(self):
        self.case['ops'] = self.case['ops'][: self.idx + 1]
        changed = True
        while changed:
            changed = False
            for gen in (self.cands_drop_ops, lambda: self.cands_spec('font2'), lambda: self.cands_spec('font'),
                        self.cands_args):
                while True:
                    c = self.first_ok(gen())
                    if not self.accept(c):
                        break
                    changed = True
        return self.case


def show(case, outdir=None):
    o = run_both([case], full=True)
    rp, rj = o['py'][case['id']], o['js'][case['id']]
    d = first_diff(rp, rj)
    i, a, b = d
    lines = [f"### {case['id']}  (diverges at op #{i}: {json.dumps(case['ops'][i], ensure_ascii=False)})"]
    if case.get('bdf'):
        lines.append('--- BDF (repr of lines):')
        txt = case['bdf']
        if case.get('bdf_b64'):
            import base64
            lines.append('(bytes) ' + repr(base64.b64decode(case['bdf_b64'])))
        else:
            for ln in txt.splitlines(keepends=True):
                lines.append('    ' + repr(ln))
    if case.get('bdf2'):
        lines.append('--- BDF2:')
        for ln in case['bdf2'].splitlines(keepends=True):
            lines.append('    ' + repr(ln))
    lines.append('--- ops:')
    for k, op in enumerate(case['ops']):
        lines.append(f'  [{k}] ' + json.dumps(op, ensure_ascii=False))
    lines.append(f'--- python result of op #{i}:')
    lines.append('    ' + str(a[3] or a[2])[:3000])
    lines.append(f'--- js result of op #{i}:')
    lines.append('    ' + str(b[3] or b[2])[:3000])
    text = '\n'.join(lines)
    print(text)
    if outdir:
        Path(outdir).mkdir(parents=True, exist_ok=True)
        (Path(outdir) / f"{case['id']}.json").write_text(json.dumps(case, ensure_ascii=False, indent=1))
        (Path(outdir) / f"{case['id']}.txt").write_text(text + '\n')
    return text


def main(argv):
    cases_path = argv[0]
    outdir = argv[argv.index('--out') + 1] if '--out' in argv else None
    ids = [a for a in argv[1:] if not a.startswith('--') and a != outdir]
    allc = {}
    with open(cases_path, encoding='utf-8') as f:
        for line in f:
            if line.strip():
                c = json.loads(line)
                allc[c['id']] = c
    for cid in ids:
        m = Minimizer(allc[cid])
        res = m.run()
        print(f'\n[min] {cid}: signature {m.sig}, {len(res["ops"])} ops, {m.runs} runner rounds', file=sys.stderr)
        show(res, outdir)


if __name__ == '__main__':
    main(sys.argv[1:])
