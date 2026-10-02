"""
More fontTools-built TrueType fixtures exercising reader code paths:

- fonttools-cmap4-rangeoffset.ttf: only a (3,1) format 4 subtable whose
  segments need idRangeOffset; post format 1.0 (standard Mac names); name table
  with Unicode-platform (0) and Macintosh (1,0) records only;
- fonttools-cmap0-6.ttf: (1,0) format 0 and (0,3) format 6 subtables;
- fonttools-empty.ttf: only .notdef (no ink at all).

Usage: uv run python gen_fonttools_variants.py OUTDIR
"""

import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import newTable
from fontTools.ttLib.standardGlyphOrder import standardGlyphOrder
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
from fontTools.ttLib.tables._n_a_m_e import NameRecord

out = Path(sys.argv[1])


def box(x0, y0, x1, y1):
    pen = TTGlyphPen(None)
    pen.moveTo((x0, y0))
    pen.lineTo((x0, y1))
    pen.lineTo((x1, y1))
    pen.lineTo((x1, y0))
    pen.closePath()
    return pen.glyph()


def build(names, glyphs, cmap_tables, path, post_format=2.0, names_records=None):
    fb = FontBuilder(1024, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({})
    fb.setupGlyf(glyphs)
    glyf = fb.font['glyf']
    metrics = {}
    for n in names:
        g = glyf[n]
        g.recalcBounds(glyf)
        metrics[n] = (512, getattr(g, 'xMin', 0))
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=896, descent=-128)
    fb.setupNameTable({'familyName': 'Variant', 'styleName': 'Regular'})
    fb.setupOS2()
    fb.setupPost()
    fb.font['post'].formatType = post_format
    cmap = newTable('cmap')
    cmap.tableVersion = 0
    cmap.tables = cmap_tables
    fb.font['cmap'] = cmap
    if names_records is not None:
        fb.font['name'].names = names_records
    fb.save(str(path))


def sub(fmt, pid, eid, mapping):
    t = CmapSubtable.newSubtable(fmt)
    t.platformID, t.platEncID, t.language = pid, eid, 0
    t.cmap = mapping
    return t


# 1. format 4 with idRangeOffset (non-consecutive gids for consecutive codes),
#    post format 1 (standard names), name records on platforms 0 and 1 only
names = standardGlyphOrder[:12]
glyphs = {n: box(64 * (i % 4), 0, 64 * (i % 4) + 128 + 32 * i, 640) for i, n in enumerate(names)}
mapping = {0x41: names[5], 0x42: names[3], 0x43: names[9], 0x44: names[4], 0x45: names[11], 0x2603: names[7]}
recs = []
for nid, s in ((1, 'Plat0 Family'), (4, 'Plat0 Full'), (6, 'MacPS')):
    r = NameRecord()
    r.nameID, r.platformID, r.platEncID, r.langID = nid, 0, 3, 0
    r.string = s
    recs.append(r)
r = NameRecord()
r.nameID, r.platformID, r.platEncID, r.langID = 0, 1, 0, 0
r.string = 'Café © Mac'
recs.append(r)
build(names, glyphs, [sub(4, 3, 1, mapping)], out / 'fonttools-cmap4-rangeoffset.ttf', 1.0, recs)

# 2. format 0 (Mac) + format 6 (Unicode BMP): (0,3) is preferred
names = ['.notdef', 'a', 'b', 'c', 'd']
glyphs = {n: box(0, 0, 100 + 100 * i, 300 + 100 * i) for i, n in enumerate(names)}
build(
    names,
    glyphs,
    [sub(0, 1, 0, {0x61: 'a', 0x62: 'b'}), sub(6, 0, 3, {0x100: 'c', 0x101: 'd', 0x103: 'a'})],
    out / 'fonttools-cmap0-6.ttf',
)

# 3. no ink at all
build(['.notdef', 'space'], {'.notdef': TTGlyphPen(None).glyph(), 'space': TTGlyphPen(None).glyph()},
      [sub(4, 3, 1, {0x20: 'space'})], out / 'fonttools-empty.ttf', 3.0)
print('ok')
