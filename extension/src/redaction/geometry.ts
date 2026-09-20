import type { BBox } from "@sentrylens/shared";

export function iou(a: BBox, b: BBox): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx), y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw), y2 = Math.min(ay + ah, by + bh);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = aw * ah + bw * bh - inter;
  return union <= 0 ? 0 : inter / union;
}

export function unionBox(boxes: BBox[]): BBox {
  const x1 = Math.min(...boxes.map((b) => b[0]));
  const y1 = Math.min(...boxes.map((b) => b[1]));
  const x2 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y2 = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x1, y1, x2 - x1, y2 - y1];
}

// DOM bboxes are CSS px; the screenshot is device px. Multiply by dpr before
// masking and before writing bboxes into the manifest.
export function viewportToImage(bbox: BBox, dpr: number): BBox {
  return [bbox[0] * dpr, bbox[1] * dpr, bbox[2] * dpr, bbox[3] * dpr];
}

// Gap small enough to bridge word-to-word spacing within one field's text,
// large enough to not bridge distinct fields/columns in a typical form UI
// (which tend to sit 40+px apart). Deliberately conservative, not derived
// from any single fixture's exact pixel gaps.
const MAX_ROW_GAP = 20;

/**
 * text-likelihood.ts's connected-components step fragments a low-contrast
 * or tiny-font text line into several small blobs a few pixels apart —
 * anti-aliased glyph edges on near-invisible text aren't always pixel-
 * contiguous — rather than one unified line box (confirmed empirically:
 * see docs/EVAL_RESULTS.md). Two callers depend on this producing the
 * IDENTICAL merged boxes from the identical input: fuse.ts's fail-closed
 * heuristic loop, and ocr-rescue.ts's second-pass crop orchestration — if
 * they ever merged differently, a rescued region's bbox could fail to
 * line up (IoU) with fuse.ts's own heuristic region for the same blind
 * spot, silently dropping the "heuristic" forced-high-risk safety tag on
 * merge. Kept here (not in ocr-rescue.ts) so both import one definition.
 */
export function mergeRowBoxes(boxes: BBox[], maxGap = MAX_ROW_GAP): BBox[] {
  if (boxes.length === 0) return [];
  const sorted = [...boxes].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  const sameRow = (a: BBox, b: BBox): boolean => {
    const aTop = a[1], aBot = a[1] + a[3];
    const bTop = b[1], bBot = b[1] + b[3];
    const overlap = Math.min(aBot, bBot) - Math.max(aTop, bTop);
    return overlap > 0.4 * Math.min(a[3], b[3]);
  };

  const rows: BBox[][] = [];
  for (const box of sorted) {
    const row = rows.find((r) => sameRow(r[0]!, box));
    if (row) row.push(box); else rows.push([box]);
  }

  const merged: BBox[] = [];
  for (const row of rows) {
    row.sort((a, b) => a[0] - b[0]);
    let cluster: BBox[] = [row[0]!];
    const flush = () => {
      const x1 = Math.min(...cluster.map((b) => b[0]));
      const y1 = Math.min(...cluster.map((b) => b[1]));
      const x2 = Math.max(...cluster.map((b) => b[0] + b[2]));
      const y2 = Math.max(...cluster.map((b) => b[1] + b[3]));
      merged.push([x1, y1, x2 - x1, y2 - y1]);
    };
    for (let i = 1; i < row.length; i++) {
      const prev = cluster[cluster.length - 1]!;
      const cur = row[i]!;
      const gap = cur[0] - (prev[0] + prev[2]);
      if (gap <= maxGap) cluster.push(cur);
      else { flush(); cluster = [cur]; }
    }
    flush();
  }
  return merged;
}
