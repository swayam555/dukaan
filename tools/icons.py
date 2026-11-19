# Regenerate: python3 tools/icons.py apps/mobile/assets/images  (Pillow)
"""Draws the Dukaan mark: a shop awning over a bill. Geometric only, so no font shaping is needed."""
from PIL import Image, ImageDraw
_orig_draw = ImageDraw.Draw
def _draw(im):
    d = _orig_draw(im); d._image = im; return d
ImageDraw.Draw = _draw
import sys, os
OUT = sys.argv[1]
SAFFRON = (232, 119, 14, 255); DEEP = (184, 90, 5, 255); WHITE = (255, 255, 255, 255); INK = (22, 24, 29, 255)

def glyph(d, cx, cy, s, fg, accent, mono=False):
    """s = glyph width. Awning (4 scallops) on top, receipt below with lines and a tick."""
    w = s; x0 = cx - w / 2
    top = cy - s * 0.48; aw_h = s * 0.26
    # awning: top-rounded band + scallops, drawn as a mask so the stripes stay inside it
    n = 4; r = w / n / 2
    mask = Image.new('L', d.im.size, 0); md = ImageDraw.Draw(mask)
    md.rounded_rectangle([x0, top, x0 + w, top + aw_h], radius=s * 0.06, fill=255, corners=(True, True, False, False))
    for i in range(n):
        ccx = x0 + r + i * 2 * r
        md.pieslice([ccx - r, top + aw_h - r, ccx + r, top + aw_h + r], 0, 180, fill=255)
    layer = Image.new('RGBA', d.im.size, fg); ld = ImageDraw.Draw(layer)
    if not mono:
        for i in range(1, n, 2):
            ld.rectangle([x0 + i * 2 * r, top, x0 + (i + 1) * 2 * r, top + aw_h + r], fill=accent)
    d._image.paste(layer, (0, 0), mask)
    # receipt
    rx0 = cx - s * 0.30; rx1 = cx + s * 0.30; ry0 = top + aw_h + r + s * 0.06; ry1 = cy + s * 0.50
    d.rounded_rectangle([rx0, ry0, rx1, ry1], radius=s * 0.05, fill=fg)
    hole = (0, 0, 0, 0) if mono else (accent if fg == WHITE else (245, 244, 240, 255))
    lw = s * 0.045
    for k, frac in enumerate((0.28, 0.48)):
        y = ry0 + (ry1 - ry0) * frac
        d.rounded_rectangle([rx0 + s * 0.09, y - lw / 2, rx1 - s * (0.09 if k == 0 else 0.2), y + lw / 2], radius=lw / 2, fill=hole)
    # total bar
    y = ry0 + (ry1 - ry0) * 0.74
    d.rounded_rectangle([cx + s * 0.02, y - lw * 0.8, rx1 - s * 0.09, y + lw * 0.8], radius=lw, fill=hole)

def canvas(size, bg):
    return Image.new('RGBA', (size, size), bg)

def save(img, name, size=None):
    if size: img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(OUT, name), optimize=True)

S = 4  # supersample
# App icon (iOS/web): full bleed saffron, OS applies the mask.
im = canvas(1024 * S, SAFFRON); glyph(ImageDraw.Draw(im), 512 * S, 520 * S, 560 * S, WHITE, DEEP); save(im, 'icon.png', 1024)
# Android adaptive: 432 dp-style canvas, glyph inside the 66% safe circle.
im = canvas(512 * S, (0, 0, 0, 0)); glyph(ImageDraw.Draw(im), 256 * S, 260 * S, 230 * S, WHITE, DEEP); save(im, 'android-icon-foreground.png', 512)
save(canvas(512, SAFFRON), 'android-icon-background.png')
im = canvas(432 * S, (0, 0, 0, 0)); glyph(ImageDraw.Draw(im), 216 * S, 219 * S, 194 * S, WHITE, None, mono=True); save(im, 'android-icon-monochrome.png', 432)
# Splash: saffron glyph on the canvas colour (drawn on transparent).
im = canvas(512 * S, (0, 0, 0, 0)); glyph(ImageDraw.Draw(im), 256 * S, 256 * S, 440 * S, SAFFRON, DEEP); save(im, 'splash-icon.png', 512)
# Favicon
im = canvas(48 * S, (0, 0, 0, 0)); d = ImageDraw.Draw(im); d.rounded_rectangle([0, 0, 48 * S, 48 * S], radius=11 * S, fill=SAFFRON); glyph(d, 24 * S, 24.5 * S, 30 * S, WHITE, DEEP); save(im, 'favicon.png', 48)
print('ok')
