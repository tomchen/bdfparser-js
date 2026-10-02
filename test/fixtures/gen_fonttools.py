"""Generate a TrueType test font with quadratic curves and composite glyphs (fontTools FontBuilder)."""
import sys
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent

out = sys.argv[1]
post3 = len(sys.argv) > 2 and sys.argv[2] == 'post3'

names = ['.notdef', 'space', 'O', 'A', 'Acomp', 'Oscaled', 'Oxy', 'O2x2', 'Match', 'Nested', 'unmapped']
fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder(names)
fb.setupCharacterMap(
    {0x20: 'space', 0x4F: 'O', 0x41: 'A', 0xC0: 'Acomp', 0x4D: 'Match', 0x4E: 'Nested',
     0x1F600: 'Oscaled', 0x1F601: 'Oxy', 0x2B: 'O2x2', 0x30: 'O'}
)

glyphs = {}
pen = TTGlyphPen(None)
pen.moveTo((0, 0)); pen.lineTo((0, 700)); pen.lineTo((500, 700)); pen.lineTo((500, 0)); pen.closePath()
glyphs['.notdef'] = pen.glyph()
glyphs['space'] = TTGlyphPen(None).glyph()

# O: all-off-curve outer contour (implied on-curve points) + quadratic hole with on/off points
pen = TTGlyphPen(None)
pen.qCurveTo((100, 100), (100, 900), (900, 900), (900, 100), None); pen.closePath()
pen.moveTo((500, 300)); pen.qCurveTo((700, 300), (700, 500)); pen.qCurveTo((700, 700), (500, 700))
pen.qCurveTo((300, 700), (300, 500)); pen.qCurveTo((300, 300), (500, 300)); pen.closePath()
glyphs['O'] = pen.glyph()

pen = TTGlyphPen(None)
pen.moveTo((0, -150)); pen.lineTo((350, 750)); pen.lineTo((450, 750)); pen.lineTo((800, -150))
pen.lineTo((650, -150)); pen.lineTo((400, 550)); pen.lineTo((150, -150)); pen.closePath()
pen.moveTo((200, 150)); pen.lineTo((200, 260)); pen.lineTo((600, 260)); pen.lineTo((600, 150)); pen.closePath()
glyphs['A'] = pen.glyph()

def composite(*comps):
    g = Glyph()
    g.numberOfContours = -1
    g.components = list(comps)
    return g

def comp(name, x=0, y=0, transform=None, first=None, second=None):
    c = GlyphComponent()
    c.glyphName = name
    c.flags = 0
    if first is not None:
        c.firstPt, c.secondPt = first, second
    else:
        c.x, c.y = x, y
    if transform is not None:
        c.transform = transform
    return c

glyphs['Acomp'] = composite(comp('A', 100, 300), comp('O', -200, -250))
glyphs['Oscaled'] = composite(comp('O', 250, 100, [[0.5, 0], [0, 0.5]]))
glyphs['Oxy'] = composite(comp('O', 0, 0, [[0.5, 0], [0, 1.25]]))
glyphs['O2x2'] = composite(comp('O', 300, 0, [[0.75, 0.25], [-0.25, 0.75]]))
# point matching: put A's point 0 (0,-150) onto notdef's point 2 (500,700)
glyphs['Match'] = composite(comp('.notdef', 0, 0), comp('A', first=2, second=0))
glyphs['Nested'] = composite(comp('Acomp', 50, -100), comp('Oscaled', 600, 0))
pen = TTGlyphPen(None)
pen.moveTo((100, 100)); pen.lineTo((100, 300)); pen.lineTo((300, 300)); pen.closePath()
glyphs['unmapped'] = pen.glyph()

fb.setupGlyf(glyphs)
glyf = fb.font['glyf']
metrics = {}
for n in names:
    g = glyf[n]
    g.recalcBounds(glyf)
    metrics[n] = (1000 if n != 'space' else 400, getattr(g, 'xMin', 0))
fb.setupHorizontalMetrics(metrics)
fb.setupHorizontalHeader(ascent=850, descent=-250)
fb.setupNameTable({'familyName': 'FT Test', 'styleName': 'Regular', 'copyright': 'none ©'})
fb.setupOS2(sTypoAscender=850, usWinAscent=850, usWinDescent=250)
fb.setupPost(keepGlyphNames=not post3)
fb.save(out)
print('wrote', out)
