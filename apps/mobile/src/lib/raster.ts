import { Skia, TextAlign } from '@shopify/react-native-skia';
import { toMono, type Block, type MonoBitmap } from '@dukaan/core';

type RasterBlock = Extract<Block, { kind: 'raster-text' }>;
const ALIGN = { left: TextAlign.Left, center: TextAlign.Center, right: TextAlign.Right } as const;

/**
 * Draws one receipt line with the system font stack (Android ships Noto Sans Devanagari, and
 * SkParagraph does the conjunct/matra shaping) on an offscreen CPU surface, then thresholds it to
 * 1 bpp for `GS v 0`. 24 px ≈ the 12×24 printer font, so Hindi and ASCII lines look the same size.
 */
export function rasteriseLine(b: RasterBlock, widthDots: number): MonoBitmap {
  const size = b.big ? 40 : 24;
  const builder = Skia.ParagraphBuilder.Make({ textAlign: ALIGN[b.align], maxLines: 3, ellipsis: '…' });
  builder.pushStyle({ color: Skia.Color('black'), fontSize: size, fontStyle: { weight: b.bold ? 700 : 400 } });
  builder.addText(b.text);
  const para = builder.build();
  para.layout(widthDots);
  const height = Math.max(Math.ceil(para.getHeight()) + 4, size);
  const surface = Skia.Surface.Make(widthDots, height);
  if (!surface) throw new Error('Could not allocate a raster surface');
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('white'));
  para.paint(canvas, 0, 2);
  surface.flush();
  const pixels = surface.makeImageSnapshot().readPixels();
  if (!(pixels instanceof Uint8Array)) throw new Error('Could not read raster pixels');
  return toMono(pixels, widthDots, height);
}
