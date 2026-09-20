import type { RedactedRegion } from "@sentrylens/shared";

export type MaskFill = "solid" | "pixelate";

export interface MaskOp {
  /** bbox in image (device) pixels: [x, y, w, h] */
  bbox: [number, number, number, number];
  fill: MaskFill;
  /** pixelation block size in px; only meaningful when fill === "pixelate" */
  block: number;
  /** text drawn over the mask; the "#id" tail is dropped if it will not fit */
  label: string;
}

export const MASK_COLOR = "#0A0A0A";

/**
 * Each mask is grown by this many px on every side. OCR and DOM boxes hug the
 * text, so anti-aliased glyph edges and descenders just outside the box would
 * otherwise show as slivers under or beside a mask.
 */
export const MASK_PAD = 3;

/**
 * Pure planning step: decide, for each redacted region, what gets painted.
 * Every redacted region yields exactly one MaskOp that fully covers its bbox,
 * so nothing behind a redacted region can survive into the sanitised image.
 * Kept separate from any canvas so it is unit-testable outside a browser.
 */
export function planMasks(regions: RedactedRegion[]): MaskOp[] {
  return regions.map((r) => {
    const soft = r.style === "blur" || r.style === "pixelate";
    const [x, y, w, h] = r.bbox;
    // Clamp at the top/left edge while still covering the original right/bottom
    // edge; the canvas clips anything past the bottom/right on its own.
    const left = Math.max(0, x - MASK_PAD);
    const top = Math.max(0, y - MASK_PAD);
    return {
      bbox: [left, top, x + w + MASK_PAD - left, y + h + MASK_PAD - top],
      fill: soft ? "pixelate" : "solid",
      block: r.style === "blur" ? 8 : 12,
      label: r.placeholder,
    } satisfies MaskOp;
  });
}

/**
 * Paints opaque masks over each redacted region on a copy of the source bitmap
 * and returns a PNG data URL. Runs in the offscreen document (has DOM + canvas).
 * `regions` bboxes MUST already be in image (device) pixels.
 */
export async function maskImage(pngDataUrl: string, regions: RedactedRegion[]): Promise<string> {
  const img = await loadImage(pngDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  for (const op of planMasks(regions)) {
    const [x, y, w, h] = op.bbox;
    if (op.fill === "pixelate") {
      pixelate(ctx, x, y, w, h, op.block);
    } else {
      ctx.fillStyle = MASK_COLOR;
      ctx.fillRect(x, y, w, h);
    }
    drawLabel(ctx, op.label, x, y, w, h);
  }
  return canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

function pixelate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, block: number) {
  if (w < 2 || h < 2) { ctx.fillStyle = MASK_COLOR; ctx.fillRect(x, y, w, h); return; }
  const tmp = document.createElement("canvas");
  tmp.width = Math.max(1, Math.floor(w / block));
  tmp.height = Math.max(1, Math.floor(h / block));
  const tctx = tmp.getContext("2d")!;
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, tmp.width, tmp.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number) {
  const fontPx = Math.max(9, Math.min(14, Math.floor(h * 0.6)));
  ctx.font = `${fontPx}px monospace`;
  const label = ctx.measureText(text).width <= w - 4 ? text : text.split("#")[0]!;
  ctx.fillStyle = "#F5F5F5";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 2, y + h / 2, Math.max(0, w - 4));
}
