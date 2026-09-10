import type { RedactedRegion } from "@sentrylens/shared";

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

  for (const r of regions) {
    const [x, y, w, h] = r.bbox;
    if (r.style === "blur" || r.style === "pixelate") {
      pixelate(ctx, x, y, w, h, r.style === "blur" ? 8 : 12);
    } else {
      ctx.fillStyle = "#0A0A0A";
      ctx.fillRect(x, y, w, h);
    }
    drawLabel(ctx, r.placeholder, x, y, w, h);
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
  if (w < 2 || h < 2) { ctx.fillStyle = "#0A0A0A"; ctx.fillRect(x, y, w, h); return; }
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
