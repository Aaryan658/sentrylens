/**
 * Quantitative privacy-utility eval harness — runs the REAL perception +
 * redaction pipeline (tesseract.js OCR, @huggingface/transformers NER,
 * assemblePerception) over a small local synthetic benchmark (fixtures.ts)
 * and reports three numbers:
 *
 *   - leakage rate: ground-truth PII with no matching redacted region. Since
 *     mask.ts's planMasks guarantees every redacted region's bbox is fully
 *     painted over (proven by mask.test.ts + perception-e2e.ts's pixel
 *     check), "not redacted" is equivalent to "pixels reach the server
 *     unmasked" — this is the real privacy-failure measurement, not just a
 *     manifest-JSON string search (the manifest never carries raw OCR text
 *     regardless of detection success, so that check alone would be
 *     trivially always-true and prove nothing).
 *   - over-masking rate: redacted regions that don't correspond to any
 *     ground-truth PII (false-positive redactions of benign content).
 *   - task-necessity accuracy: for ground-truth entries with an expected
 *     taskNecessary value, does classify() agree?
 *
 * Run:  pnpm --filter @sentrylens/extension eval
 * First run downloads model weights (same as the e2e harness).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import { runOcr, disposeOcr } from "../src/perception/ocr.js";
import { runNer, initNer, disposeNer } from "../src/perception/ner.js";
import { assemblePerception } from "../src/perception/pipeline.js";
import { FIXTURES, type EvalFixture } from "./fixtures.js";
import { matchValue } from "./match.js";

interface FixtureResult {
  name: string;
  totalGroundTruth: number;
  leaked: string[];              // ground-truth values with no matching redacted region
  overMasks: { category: string; placeholder: string }[];
  taskNecessityChecked: number;
  taskNecessityCorrect: number;
}

async function runFixture(f: EvalFixture): Promise<FixtureResult> {
  const basePng = await sharp(Buffer.from(f.svg)).png().toBuffer();
  const pngDataUrl = `data:image/png;base64,${basePng.toString("base64")}`;

  const ocr = await runOcr(pngDataUrl);
  const nerSpans = await runNer(ocr.joined);

  const meta = await sharp(basePng).metadata();
  const { manifest, mapping } = assemblePerception({
    task: f.task,
    image: { w: meta.width ?? 640, h: meta.height ?? 320, dpr: 1 },
    domRegions: f.domRegions,
    domSensitive: f.domSensitive,
    faces: [],
    ocrWords: ocr.words,
    ocrJoined: ocr.joined,
    ocrOffsets: ocr.offsets,
    nerSpans,
    degraded: false,
  });

  const redacted = manifest.regions.filter((r) => r.kind === "redacted") as Extract<
    (typeof manifest.regions)[number],
    { kind: "redacted" }
  >[];

  // Value-bearing redacted regions this fixture's ground truth could match
  // against (FACE/BYSTANDER_SCREEN carry no value — not applicable here).
  const resolved = redacted
    .filter((r) => r.value_len != null)
    .map((r) => ({ region: r, value: mapping.resolve(r.placeholder) }))
    .filter((r): r is { region: (typeof redacted)[number]; value: string } => r.value != null);

  const leaked: string[] = [];
  let taskNecessityChecked = 0;
  let taskNecessityCorrect = 0;
  const claimed = new Set<string>(); // placeholders already matched to a ground-truth entry

  for (const gt of f.groundTruth) {
    const hit = resolved.find(
      (r) => !claimed.has(r.region.placeholder) && r.region.category === gt.category && matchValue(r.value, gt.value, gt.category),
    );
    if (!hit) { leaked.push(`${gt.category}:${gt.value}`); continue; }
    claimed.add(hit.region.placeholder);
    if (gt.taskNecessary !== undefined) {
      taskNecessityChecked++;
      if (hit.region.task_necessary === gt.taskNecessary) taskNecessityCorrect++;
    }
  }

  const overMasks = resolved
    .filter((r) => !claimed.has(r.region.placeholder))
    .map((r) => ({ category: r.region.category, placeholder: r.region.placeholder }));

  return { name: f.name, totalGroundTruth: f.groundTruth.length, leaked, overMasks, taskNecessityChecked, taskNecessityCorrect };
}

function renderReport(results: FixtureResult[]): string {
  const totalGt = results.reduce((s, r) => s + r.totalGroundTruth, 0);
  const totalLeaked = results.reduce((s, r) => s + r.leaked.length, 0);
  const totalOverMasks = results.reduce((s, r) => s + r.overMasks.length, 0);
  const totalRedactedValueBearing = totalGt - totalLeaked + totalOverMasks; // caught-correct + false-positive
  const totalTnChecked = results.reduce((s, r) => s + r.taskNecessityChecked, 0);
  const totalTnCorrect = results.reduce((s, r) => s + r.taskNecessityCorrect, 0);

  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

  const rows = results
    .map(
      (r) =>
        `| ${r.name} | ${r.totalGroundTruth} | ${r.totalGroundTruth - r.leaked.length}/${r.totalGroundTruth} | ${r.leaked.length ? r.leaked.join(", ") : "—"} | ${r.overMasks.length} | ${r.taskNecessityChecked ? `${r.taskNecessityCorrect}/${r.taskNecessityChecked}` : "—"} |`,
    )
    .join("\n");

  return `# SentryLens eval results

Generated by \`pnpm --filter @sentrylens/extension eval\` on ${new Date().toISOString().slice(0, 10)}
against \`extension/eval/fixtures.ts\` (${results.length} synthetic fixtures) using the
real on-device pipeline: tesseract.js OCR + \`onnx-community/multilang-pii-ner-ONNX\`
NER (CPU device — the browser build uses wasm/webgpu) + \`assemblePerception\`.
No literature numbers are cited below — every figure here was measured on
this codebase, this run.

## Aggregate

| Metric | Value | Definition |
|---|---|---|
| PII leakage rate | **${pct(totalLeaked, totalGt)}** (${totalLeaked}/${totalGt}) | ground-truth PII with no matching redacted region. Every redacted region's bbox is fully mask-painted (\`mask.test.ts\`), so "not redacted" = pixels reach the server unmasked. |
| Over-masking rate | **${pct(totalOverMasks, totalRedactedValueBearing)}** (${totalOverMasks}/${totalRedactedValueBearing}) | value-bearing redacted regions that don't correspond to any ground-truth PII on that fixture (false-positive redaction of benign content). |
| Task-necessity accuracy | **${pct(totalTnCorrect, totalTnChecked)}** (${totalTnCorrect}/${totalTnChecked}) | of the ground-truth entries with an expected \`task_necessary\` value, how many did \`classify()\` get right. |

## Per-fixture

| Fixture | Ground-truth PII | Caught | Leaked | Over-masks | Task-necessity |
|---|---|---|---|---|---|
${rows}

## Scope and honesty notes

- PASSWORD is excluded from ground truth: DOM-flagged password fields carry
  \`value: null\` by design (positional placeholder, never enter the mapping
  table), so there is no resolvable value for this harness to compare — their
  pixel-level redaction is proven separately by \`mask.test.ts\` and
  \`perception-e2e.ts\`.
- FACE and BYSTANDER_SCREEN are excluded for the same reason (no value).
- This is a small (${results.length}-fixture), synthetic, English-text benchmark —
  not GUIGuard-Bench or PrivScreen (no license/access path to those during
  this build). It measures *this system's* real behaviour, which is the
  point: previously the pitch deck cited literature task-success numbers
  (80.8% vs 83.6%) as if they were SentryLens's own. These are ours.
`;
}

async function main() {
  const results: FixtureResult[] = [];
  console.log(`running ${FIXTURES.length} fixtures through the real perception pipeline...`);
  await initNer("cpu");
  for (const f of FIXTURES) {
    console.log(`  - ${f.name}`);
    results.push(await runFixture(f));
  }
  await Promise.allSettled([disposeOcr(), disposeNer()]);

  const report = renderReport(results);
  const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/EVAL_RESULTS.md");
  writeFileSync(outPath, report, "utf8");
  console.log(`\nwrote ${outPath}`);
  console.log(report);
  writeFileSync(new URL("./.done", import.meta.url), "DONE");
  setImmediate(() => process.exit(0));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
