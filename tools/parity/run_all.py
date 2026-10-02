#!/usr/bin/env python3
"""
Parity harness — driver. Runs every phase and prints a summary.

    python tools/parity/run_all.py [--n 2000] [--seed 1] [--n-all 1000] [--jobs 8]
                                   [--js bun|node|"CMD"] [--out DIR]
                                   [--skip-tables] [--skip-random] [--skip-all] [--skip-probes]
                                   [--skip-corpus] [--heavy]

Phases
  1. tables  : full charset tables (cp2char over the code space, char2cp over
               the BMP) on both sides -> codec-table report + agreed codes
  2. random  : N seeded random cases avoiding the known divergence triggers
               (finds NEW divergences)
  3. all     : N-ALL seeded random cases with every feature enabled (all
               divergences must be known; shows how often each one occurs)
  4. probes  : one minimal reproducer per known finding (+ regression probes);
               prints whether each finding still reproduces
  5. corpus  : every BDF / PCF / PCF.GZ / TTF file of both repositories' test
               font directories with a fixed operation script

Exit status 1 if any phase reports a NEW (unexplained) divergence.
Run from anywhere; paths are resolved relative to this file. Needs Python
>= 3.10 (stdlib only), the Python sources in ../bdfparser/src (or
$BDFPARSER_PY) and bun (or node, with the runner bundled by bun first).
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import shlex
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
JSROOT = HERE.parent.parent
PYROOT = Path(os.environ.get('BDFPARSER_PY', JSROOT.parent / 'bdfparser' / 'src')).parent


def sh(cmd: str, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=True, cwd=JSROOT, **kw)


def fingerprint() -> dict:
    out = {}
    for name, root, pats in (('python', PYROOT, ['src/bdfparser/*.py']), ('js', JSROOT, ['src/*.ts'])):
        h = hashlib.sha256()
        for pat in pats:
            for p in sorted(root.glob(pat)):
                h.update(p.name.encode())
                h.update(p.read_bytes())
        head = subprocess.run(['git', '-C', str(root), 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(['git', '-C', str(root), 'status', '--porcelain', '--', 'src'], capture_output=True, text=True).stdout.strip()
        out[name] = {'head': head, 'src_dirty': bool(dirty), 'src_sha256': h.hexdigest()[:16]}
    return out


def split(cases_path: Path, n: int, outdir: Path, weight=None) -> list[Path]:
    lines = [ln for ln in cases_path.read_text(encoding='utf-8').splitlines() if ln.strip()]
    n = max(1, min(n, len(lines)))
    shards: list[list[str]] = [[] for _ in range(n)]
    loads = [0.0] * n
    order = sorted(range(len(lines)), key=lambda i: -(weight(lines[i]) if weight else 1))
    for i in order:  # longest-processing-time-first greedy balancing
        k = loads.index(min(loads))
        shards[k].append(lines[i])
        loads[k] += weight(lines[i]) if weight else 1
    paths = []
    for k, sl in enumerate(shards):
        p = outdir / f'{cases_path.stem}.shard{k}.jsonl'
        p.write_text('\n'.join(sl) + '\n', encoding='utf-8')
        paths.append(p)
    return paths


def corpus_weight(line: str) -> float:
    d = json.loads(line)
    try:
        p = Path(d['file'])
        size = p.stat().st_size
        return size * (8 if p.name.endswith('.gz') else 1)
    except (KeyError, OSError):
        return 1


def run_phase(name, cases: Path, out: Path, py_cmd: str, js_cmd: str, jobs: int, tables: Path | None, weight=None):
    t0 = time.time()
    shards = split(cases, jobs, out, weight)
    times = {}

    def run(side, cmd, shard):
        of = shard.with_suffix(f'.{side}.jsonl')
        ts = time.time()
        r = sh(f'{cmd} {shlex.quote(str(shard))} {shlex.quote(str(of))}', capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f'{side} runner failed on {shard}:\n{r.stderr[-3000:]}')
        return side, of, time.time() - ts

    results = {'py': [], 'js': []}
    with cf.ThreadPoolExecutor(max_workers=2 * len(shards)) as ex:
        futs = [ex.submit(run, side, cmd, s) for s in shards for side, cmd in (('py', py_cmd), ('js', js_cmd))]
        for f in cf.as_completed(futs):
            side, of, dt = f.result()
            results[side].append(of)
            times[side] = max(times.get(side, 0), dt)
    merged = {}
    for side in ('py', 'js'):
        mp = out / f'{name}_{side}.jsonl'
        with open(mp, 'w', encoding='utf-8') as fo:
            for of in sorted(results[side]):
                fo.write(of.read_text(encoding='utf-8'))
        merged[side] = mp
    for s in shards:
        s.unlink()
        for side in ('py', 'js'):
            s.with_suffix(f'.{side}.jsonl').unlink(missing_ok=True)
    cmd = (
        f'{shlex.quote(sys.executable)} tools/parity/compare.py results {merged["py"]} {merged["js"]} {cases} '
        f'--json {out / (name + "_diffs.json")} --max 25'
        + (f' --tables {tables}' if tables else '')
    )
    r = sh(cmd, capture_output=True, text=True)
    (out / f'{name}_report.txt').write_text(r.stdout + r.stderr, encoding='utf-8')
    diffs = json.loads((out / f'{name}_diffs.json').read_text())
    ncases = sum(1 for ln in cases.read_text(encoding='utf-8').splitlines() if ln.strip())
    nops = sum(len(json.loads(ln)['res']) for ln in merged['py'].read_text(encoding='utf-8').splitlines() if ln.strip())
    labels: dict[str, int] = {}
    for d in diffs:
        labels[d['label']] = labels.get(d['label'], 0) + 1
    summary = {
        'phase': name,
        'cases': ncases,
        'operations': nops,
        'divergences': len(diffs),
        'new': labels.get('NEW', 0),
        'labels': labels,
        'seconds': round(time.time() - t0, 1),
        'py_seconds_max_shard': round(times.get('py', 0), 1),
        'js_seconds_max_shard': round(times.get('js', 0), 1),
    }
    print(f"[{name}] {ncases} cases, {nops} ops, {len(diffs)} divergence(s), {summary['new']} NEW "
          f"({summary['seconds']}s wall; slowest shard py {summary['py_seconds_max_shard']}s / js {summary['js_seconds_max_shard']}s)")
    for k, v in sorted(labels.items()):
        print(f'      {v:5d}  {k}')
    return summary


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--n', type=int, default=2000, help='random cases avoiding known triggers (default 2000)')
    ap.add_argument('--n-all', type=int, default=1000, help='random cases with all features (default 1000)')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--jobs', type=int, default=min(8, os.cpu_count() or 2))
    ap.add_argument('--js', default='bun', help='bun (default), node (bundled with bun build), or a full command')
    ap.add_argument('--out', default=str(HERE / 'out'))
    ap.add_argument('--skip-tables', action='store_true')
    ap.add_argument('--skip-random', action='store_true')
    ap.add_argument('--skip-all', action='store_true')
    ap.add_argument('--skip-corpus', action='store_true')
    ap.add_argument('--skip-probes', action='store_true')
    ap.add_argument('--heavy', action='store_true', help='also run the heavy probes (none at the moment)')
    a = ap.parse_args()

    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    py_cmd = f'{shlex.quote(sys.executable)} tools/parity/run_py.py'
    if a.js == 'bun':
        js_cmd = 'bun tools/parity/run_js.ts'
    elif a.js == 'node':
        bundle = out / 'run_js.node.mjs'
        r = sh(f'bun build tools/parity/run_js.ts --target=node --format=esm --outfile {shlex.quote(str(bundle))}', capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout + r.stderr)
            return 2
        js_cmd = f'node {shlex.quote(str(bundle))}'
    else:
        js_cmd = a.js
    gen = f'{shlex.quote(sys.executable)} tools/parity/gen_cases.py'
    t0 = time.time()
    fp0 = fingerprint()
    print(f'[parity] sources: {json.dumps(fp0)}')
    print(f'[parity] js runner: {js_cmd}; jobs: {a.jobs}; out: {out}')
    summaries = []

    agreed = out / 'agreed.json'
    if a.skip_tables and not agreed.exists():
        print('[parity] no agreed.json in the output directory: running the tables phase anyway')
    if not a.skip_tables or not agreed.exists():
        ts = time.time()
        sh(f'{gen} tables-spec {out / "tables_spec.json"}', check=True)
        with cf.ThreadPoolExecutor(2) as ex:
            f1 = ex.submit(sh, f'{py_cmd} --tables {out / "tables_spec.json"} {out / "tables_py.json"}', check=True)
            f2 = ex.submit(sh, f'{js_cmd} --tables {out / "tables_spec.json"} {out / "tables_js.json"}', check=True)
            f1.result()
            f2.result()
        r = sh(f'{shlex.quote(sys.executable)} tools/parity/compare.py tables {out / "tables_py.json"} {out / "tables_js.json"} '
               f'{agreed} --report {out / "tables_report.txt"}', capture_output=True, text=True, check=True)
        last = r.stdout.strip().splitlines()[-1]
        ndiff = int(last.split(' compared, ')[1].split(' ')[0])
        print(f'[tables] {last} ({time.time() - ts:.1f}s) -> {out / "tables_report.txt"}')
        # every differing table is a NEW divergence (SPEC-v3 §11.1: table-exact)
        summaries.append({'phase': 'tables', 'summary': last, 'new': ndiff, 'seconds': round(time.time() - ts, 1)})
    agreed_opt = f' --agreed {agreed}' if agreed.exists() else ''
    tables_opt = agreed if agreed.exists() else None

    if not a.skip_random and a.n > 0:
        cases = out / 'random.jsonl'
        sh(f'{gen} random {a.n} {a.seed} {cases}{agreed_opt} --avoid known', check=True, capture_output=True)
        summaries.append(run_phase('random', cases, out, py_cmd, js_cmd, a.jobs, tables_opt))
    if not a.skip_all and a.n_all > 0:
        cases = out / 'random_all.jsonl'
        sh(f'{gen} random {a.n_all} {a.seed + 1000} {cases}{agreed_opt}', check=True, capture_output=True)
        summaries.append(run_phase('random_all', cases, out, py_cmd, js_cmd, a.jobs, tables_opt))
    if not a.skip_probes:
        cases = out / 'probes.jsonl'
        sh(f'{shlex.quote(sys.executable)} tools/parity/probes.py {cases}' + (' --heavy' if a.heavy else ''), check=True)
        summ = run_phase('probes', cases, out, py_cmd, js_cmd, 1, tables_opt)
        diffs = json.loads((out / 'probes_diffs.json').read_text())
        diverged = {d['id'] for d in diffs}
        status = []
        for ln in cases.read_text(encoding='utf-8').splitlines():
            c = json.loads(ln)
            dv = c['id'] in diverged
            ok = dv == (c['expect'] == 'diverge')
            st = ('still diverges' if dv else 'AGREES NOW (fixed?)') if c['expect'] == 'diverge' else ('agrees' if not dv else 'REGRESSED')
            status.append({'id': c['id'], 'expect': c['expect'], 'diverges': dv, 'ok': ok, 'desc': c['desc']})
            print(f"      {'ok ' if ok else '!! '} {c['id']:30s} {st}")
        (out / 'probes_status.json').write_text(json.dumps(status, indent=1))
        # expected divergences are not NEW; a regression probe ('agree') that
        # diverges again is
        summ['new'] = sum(1 for x in status if x['expect'] == 'agree' and x['diverges'])
        summ['probe_changes'] = sum(1 for x in status if not x['ok'])
        summaries.append(summ)
    if not a.skip_corpus:
        cases = out / 'corpus.jsonl'
        sh(f'{gen} corpus {cases}', check=True, capture_output=True)
        summaries.append(run_phase('corpus', cases, out, py_cmd, js_cmd, a.jobs, tables_opt, corpus_weight))

    fp1 = fingerprint()
    if fp1 != fp0:
        print('[parity] WARNING: library sources changed while the harness was running; results may be inconsistent')
    total = round(time.time() - t0, 1)
    new = sum(s.get('new', 0) for s in summaries)
    changes = sum(s.get('probe_changes', 0) for s in summaries)
    if changes:
        print(f'[parity] {changes} probe(s) changed status (fixed or regressed): update known_issues.py / README.md')
    (out / 'summary.json').write_text(json.dumps({'sources': fp0, 'sources_end': fp1, 'phases': summaries, 'seconds': total, 'new': new}, indent=1))
    print(f'[parity] done in {total}s: {new} NEW divergence(s). Reports: {out}/*_report.txt')
    return 1 if new else 0


if __name__ == '__main__':
    sys.exit(main())
