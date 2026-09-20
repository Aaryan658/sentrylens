import type { BBox, Region } from "@sentrylens/shared";
import { defaultRisk, defaultStyle } from "@sentrylens/shared";
import { iou } from "./geometry.js";
import type { SensitiveRegion } from "./types.js";

export interface ClassifiedRegion extends SensitiveRegion {
  risk: "high" | "medium" | "low";
  style: "blackbox" | "pixelate" | "blur";
  task_necessary: boolean;
}

const STOP = new Set(["the", "a", "an", "to", "of", "and", "for", "on", "in", "my", "please", "then", "with"]);

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
}

function overlapsLoosely(a: BBox, b: BBox): boolean {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const pad = 12;
  return ax < bx + bw + pad && ax + aw + pad > bx && ay < by + bh + pad && ay + ah + pad > by;
}

export function classify(region: SensitiveRegion, task: string, regions: Region[]): ClassifiedRegion {
  // A "heuristic" detection means OCR found nothing readable there but the
  // pixels still look text-structured (see text-likelihood.ts) — we don't
  // know WHAT it is, which is exactly why it must fail closed (high risk,
  // full blackbox) rather than default to OTHER's normally-low risk.
  const risk = region.detected_by.includes("heuristic") ? "high" : defaultRisk(region.category);
  const style = defaultStyle(risk);

  const taskTokens = new Set(tokens(task));
  let task_necessary = false;
  for (const el of regions) {
    if (iou(el.bbox, region.bbox) > 0.3 || overlapsLoosely(el.bbox, region.bbox)) {
      if (tokens(el.name).some((t) => taskTokens.has(t))) { task_necessary = true; break; }
    }
  }
  return { ...region, risk, style, task_necessary };
}
