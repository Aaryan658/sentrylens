/**
 * Generates a real before/after pair headlessly: the same OCR + NER +
 * text-likelihood + assemblePerception path the extension uses, then paints
 * masks the way mask.ts's maskImage does (opaque MASK_COLOR + placeholder
 * label). Outputs to docs/demo/. MediaPipe face detection is browser-only, so
 * the demo screen deliberately has no face.
 *
 * Run from extension/:  node --import tsx eval/before-after.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import type { Region } from "@sentrylens/shared";
import { disposeOcr } from "../src/perception/ocr.js";
import { initNer, disposeNer } from "../src/perception/ner.js";
import { planMasks, planLabelDraw, MASK_COLOR } from "../src/redaction/mask.js";
import { runPerception } from "./harness.js";

const W = 1000;
const H = 620;
const TASK = "open the telemetry report for station VSSC-03";

const dots = Array.from({ length: 9 }, (_, i) => `<circle cx="${274 + i * 24}" cy="430" r="5" fill="#0B1F3A"/>`).join("");
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="#F3F6FA"/>
  <rect width="${W}" height="64" fill="#0B1F3A"/>
  <text x="32" y="42" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="bold" fill="#FFFFFF">VSSC Ground Operations Console</text>
  <rect x="40" y="100" width="920" height="470" rx="12" fill="#FFFFFF" stroke="#C9D6EA" stroke-width="2"/>
  <g font-family="DejaVu Sans, Arial, sans-serif">
    <text x="72" y="152" font-size="26" font-weight="bold" fill="#0B1F3A">Duty roster: station VSSC-03</text>
    <g font-size="22" fill="#5A6472">
      <text x="72" y="212">Operator</text>
      <text x="72" y="268">Phone</text>
      <text x="72" y="324">Email</text>
      <text x="72" y="380">PAN</text>
      <text x="72" y="436">Password</text>
    </g>
    <g font-size="24" fill="#0B1F3A">
      <text x="260" y="212">A. Menon</text>
      <text x="260" y="268">9123456780</text>
      <text x="260" y="324">a.menon@vssc.test</text>
      <text x="260" y="380">BNZAA2318K</text>
    </g>
    <rect x="250" y="410" width="300" height="40" rx="6" fill="#FFFFFF" stroke="#8A93A0" stroke-width="2"/>
    ${dots}
    <rect x="72" y="496" width="320" height="52" rx="8" fill="#1F5FBF"/>
    <text x="232" y="530" text-anchor="middle" font-size="22" fill="#FFFFFF">Open telemetry report</text>
    <text x="40" y="602" font-size="20" fill="#5A6472">Maintenance window Saturday 0200 to 0400 IST</text>
  </g>
</svg>`;

const domRegions: Region[] = [
  { id: 1, bbox: [250, 410, 300, 40], source: "dom", role: "textbox", name: "Password", interactable: true },
  { id: 2, bbox: [72, 496, 320, 52], source: "dom", role: "button", name: "Open telemetry report", interactable: true },
];
const domSensitive = [{ bbox: [250, 410, 300, 40] as [number, number, number, number], category: "PASSWORD" as const }];

async function paint(basePng: Buffer, regions: unknown[]): Promise<Buffer> {
  const ops = planMasks(regions as never);
  const drawLabel = planLabelDraw(ops);
  const layers = ops.map((op, i) => {
    const [x, y, bw, bh] = op.bbox;
    const left = Math.max(0, Math.round(x));
    const top = Math.max(0, Math.round(y));
    const width = Math.max(1, Math.min(Math.round(bw), W - left));
    const height = Math.max(1, Math.min(Math.round(bh), H - top));
    const fontPx = Math.max(9, Math.min(14, Math.floor(height * 0.6)));
    const label = op.label.length * fontPx * 0.6 <= width - 4 ? op.label : op.label.split("#")[0]!;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${MASK_COLOR}"/>${drawLabel[i] ? `<text x="2" y="${height / 2}" dominant-baseline="middle" font-family="monospace" font-size="${fontPx}" fill="#F5F5F5">${label}</text>` : ""}</svg>`;
    return { input: Buffer.from(svg), left, top };
  });
  return sharp(basePng).composite(layers).png().toBuffer();
}

async function main() {
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/demo");
  mkdirSync(outDir, { recursive: true });

  const basePng = await sharp(Buffer.from(SVG)).png().toBuffer();
  writeFileSync(resolve(outDir, "before.png"), basePng);

  await initNer("cpu");
  let ocrRead = "";

  // The same pipeline the extension runs (2x OCR, backstop, rescue, scrubbing).
  for (const [name, backstop] of [["after", true], ["_after-without-backstop", false]] as const) {
    const run = await runPerception(basePng, { task: TASK, domRegions, domSensitive, backstop });
    ocrRead = run.ocr.joined;
    const redacted = run.redacted as unknown as Array<{
      category: string; placeholder: string; value_len: number | null; risk: string; task_necessary: boolean;
      detected_by: string[]; bbox: [number, number, number, number];
    }>;
    writeFileSync(resolve(outDir, `${name}.png`), await paint(basePng, redacted));
    const heuristic = redacted.filter((r) => r.detected_by.includes("heuristic"));
    console.log(`\n[${name}] ${redacted.length} redacted region(s), ${heuristic.length} from the text-likelihood backstop`);
    for (const r of redacted) {
      console.log(`  ${r.category.padEnd(13)} ${r.placeholder.padEnd(18)} ${r.detected_by.join("+").padEnd(10)} bbox=${r.bbox.map(Math.round).join(",")}`);
    }
    if (name === "after") {
      writeFileSync(
        resolve(outDir, "manifest-excerpt.json"),
        JSON.stringify(
          { task: TASK, redacted: redacted.map(({ category, placeholder, value_len, risk, task_necessary }) => ({ category, placeholder, value_len, risk, task_necessary })) },
          null,
          2,
        ),
      );
    }
  }

  console.log(`\nOCR read: ${JSON.stringify(ocrRead)}`);
  await Promise.allSettled([disposeOcr(), disposeNer()]);
  console.log("DONE");
  setImmediate(() => process.exit(0));
}

main().catch((e) => { console.error(e); process.exit(1); });
