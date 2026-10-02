"""
Generate the cross-language golden files used by test/ttf.test.ts and
test/outline.test.ts, using the *Python* bdfparser implementation.

Run from the Python repository (read only there):

    cd ../bdfparser && uv run python ../bdfparser-js/test/fixtures/golden/generate.py

Outputs (all in this directory):

- ``*.bdf``: deterministic glyph subsets of the larger test fonts (text-level
  subsetting, independent of either library);
- ``*.ttf`` + ``manifest.json``: ``write_ttf`` output for every font × option
  set (``timestamp=0`` unless stated);
- ``outline.json``: ``bitmap_contours`` output for seeded random bitmaps;
- ``read-*.json``: ``read_ttf`` output for the fontTools-made fixtures
  (``../fonttools-*.ttf``, built by ``../gen_fonttools.py`` and
  ``../gen_fonttools_variants.py``).
"""

from __future__ import annotations

import json
import random
import re
from pathlib import Path

from bdfparser import Font
from bdfparser.outline import bitmap_contours
from bdfparser.ttf import read_ttf, write_ttf

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent
FONTS = FIXTURES.parent / 'fonts'


def subset_bdf(src: Path, dst: Path, pick) -> None:
    """Keep the header/properties and the glyph blocks whose index passes ``pick``."""
    text = src.read_text(encoding='utf-8')
    head, rest = text.split('\nCHARS ', 1)
    rest = rest.split('\n', 1)[1]
    blocks = re.findall(r'STARTCHAR .*?\nENDCHAR\n', rest, flags=re.S)
    kept = [b for i, b in enumerate(blocks) if pick(i, b)]
    dst.write_text(head + f'\nCHARS {len(kept)}\n' + ''.join(kept) + 'ENDFONT\n', encoding='utf-8')


def main() -> None:
    subset_bdf(
        FONTS / 'unifont-13.0.04-for-test.bdf',
        HERE / 'unifont-subset.bdf',
        lambda i, b: i % 8 == 0 or i < 4,
    )
    subset_bdf(
        FONTS / 'HanWangYanKai-26.bdf',
        HERE / 'hanwang-subset.bdf',
        lambda i, b: i % 500 == 0 or 60 <= i < 64,
    )

    fonts = {
        'spec': FONTS / 'spec_example_fixed.bdf',
        'unifont': HERE / 'unifont-subset.bdf',
        'hanwang': HERE / 'hanwang-subset.bdf',
        'edge': FIXTURES / 'edge.bdf',
        'gb2312': FONTS / 'unifont-13.0.04-enctest-gb2312.bdf',
        'big5': FONTS / 'unifont-13.0.04-enctest-big5.bdf',
        'cp1252': FONTS / 'unifont-13.0.04-enctest-cp1252.bdf',
        'shiftjis': FONTS / 'unifont-13.0.04-enctest-shiftjis.bdf',
        'euckr': FONTS / 'unifont-13.0.04-enctest-euckr.bdf',
    }
    variants = [
        ('square', 1.0),
        ('square', 0.8),
        ('circle', 1.0),
        ('circle', 0.7),
    ]
    manifest = []
    for key, path in fonts.items():
        font = Font(str(path))
        for shape, dotsize in variants:
            for ppu in (64, 10):
                name = f'{key}-{shape}-{dotsize:g}-ppu{ppu}.ttf'
                (HERE / name).write_bytes(write_ttf(font, shape=shape, dotsize=dotsize, ppu=ppu))
                manifest.append(
                    {
                        'file': name,
                        'font': str(path.relative_to(FIXTURES.parent)),
                        'options': {'shape': shape, 'dotsize': dotsize, 'ppu': ppu},
                    }
                )
        # extra option sets
        for extra in (
            {'metadata': False},
            {'timestamp': 1700000000, 'ppu': 2},
            {'shape': 'circle', 'dotsize': 1.5, 'ppu': 4},
            {'shape': 'square', 'dotsize': 0.5, 'ppu': 2},
        ):
            tag = '-'.join(f'{k}{v}' for k, v in extra.items())
            name = f'{key}-{tag}.ttf'
            try:
                data = write_ttf(font, **extra)
            except ValueError:
                continue  # e.g. upem too small for ppu 2
            (HERE / name).write_bytes(data)
            manifest.append(
                {
                    'file': name,
                    'font': str(path.relative_to(FIXTURES.parent)),
                    'options': extra,
                }
            )
    (HERE / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n', encoding='utf-8')

    # outline contours for seeded random bitmaps
    rng = random.Random(20261002)
    configs = [
        ('square', 1.0, [1, 2, 3, 10, 64]),
        ('square', 0.6, [2, 10, 64]),
        ('square', 0.8, [2, 10, 64]),
        ('square', 1.5, [2, 3, 64]),
        ('circle', 1.0, [2, 10, 64]),
        ('circle', 0.7, [2, 10, 64]),
        ('circle', 0.5, [1, 2, 3, 64]),
        ('circle', 1.5, [2, 10, 64]),
    ]
    cases = []
    for i in range(640):
        shape, dotsize, ppus = configs[i % len(configs)]
        w = rng.randint(1, 9)
        h = rng.randint(1, 9)
        density = rng.random()
        bindata = [
            ''.join(
                ('2' if rng.random() < 0.1 else '1') if rng.random() < density else '0'
                for _ in range(w)
            )
            for _ in range(h)
        ]
        ppu = ppus[i % len(ppus)]
        xoff = rng.randint(-4, 4)
        yoff = rng.randint(-4, 4)
        contours = bitmap_contours(bindata, shape, dotsize, ppu, xoff, yoff)
        cases.append(
            {
                'bindata': bindata,
                'shape': shape,
                'dotsize': dotsize,
                'ppu': ppu,
                'xoff': xoff,
                'yoff': yoff,
                'contours': [[list(p) for p in c] for c in contours],
            }
        )
    (HERE / 'outline.json').write_text(json.dumps(cases, separators=(',', ':')) + '\n', encoding='utf-8')

    # read_ttf of fontTools-built fonts (quadratic curves, composite glyphs)
    for src, pixelsizes in (
        ('fonttools-composite.ttf', (20, 13, 7)),
        ('fonttools-composite-post3.ttf', (20,)),
        ('fonttools-cmap4-rangeoffset.ttf', (16, 12)),
        ('fonttools-cmap0-6.ttf', (16,)),
        ('fonttools-empty.ttf', (16,)),
    ):
        data = (FIXTURES / src).read_bytes()
        for ps in pixelsizes:
            f = read_ttf(data, pixelsize=ps)
            out = {
                'headers': f.headers,
                'props': f.props,
                'propnames': dict(f._propnames),
                'glyphs': [[cp, m] for cp, m in f.glyphs.items()],
                'unencoded': f.unencoded,
            }
            (HERE / f'read-{src[:-4]}-px{ps}.json').write_text(
                json.dumps(out, ensure_ascii=False, indent=0) + '\n', encoding='utf-8'
            )


if __name__ == '__main__':
    main()
