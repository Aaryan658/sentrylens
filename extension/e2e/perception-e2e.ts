/**
 * Headless end-to-end check of the perception + redaction path, outside Chrome.
 *
 * Rasterises the demo duty-roster to a PNG (sharp), then runs the REAL models:
 *   tesseract.js OCR  ->  @huggingface/transformers NER  ->  assemblePerception
 *   ->  planMasks + real pixel compositing (sharp)  ->  server round-trip
 * and asserts that no raw PII survives into the manifest, the request body, or
 * the sanitised image pixels.
 *
 * Run:  pnpm --filter @sentrylens/extension e2e
 * Server must be up on :8787.  Mock:  MOCK=1 PORT=8787 pnpm --filter @sentrylens/server start
 * Real VLM: set E2E_VLM=1 and run the server with MOCK=0 + a real API key.
 * First run downloads model weights (tesseract eng ~2 MB, PII-NER ONNX small).
 */
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { disposeOcr } from "../src/perception/ocr.js";
import { initNer, disposeNer } from "../src/perception/ner.js";
import { runFaces } from "../src/perception/faces.js";
import { planMasks, MASK_COLOR } from "../src/redaction/mask.js";
import { runPerception } from "../eval/harness.js";
import { ServerResponseSchema, type PiiCategory } from "@sentrylens/shared";

const RAW_PII = ["A. Menon", "Menon", "9000000000", "ops.lead@vssc.test", "ABCDE1234F", "hunter2seed"];
const SERVER = "http://localhost:8787";

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <g font-family="DejaVu Sans, Arial, sans-serif" font-size="22" fill="#111111">
    <text x="24" y="44">Duty roster - station VSSC-03</text>
    <text x="24" y="96">Operator    A. Menon</text>
    <text x="24" y="136">Phone       9000000000</text>
    <text x="24" y="176">Email       ops.lead@vssc.test</text>
    <text x="24" y="216">PAN         ABCDE1234F</text>
    <text x="24" y="256">Password    hunter2seed</text>
  </g>
</svg>`;

const VERDICT = new URL("./.verdict", import.meta.url);
function fail(msg: string): never { console.error("✖ " + msg); writeFileSync(VERDICT, "FAIL " + msg); process.exit(1); }
function ok(msg: string) { console.log("✔ " + msg); }
function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function main() {
  const t0 = Date.now();
  const basePng = await sharp(Buffer.from(SVG)).png().toBuffer();
  ok(`rasterised roster -> PNG (${basePng.length} bytes)`);

  // Node's onnxruntime uses "cpu"; the browser build uses "wasm"/"webgpu".
  console.log("running the real perception path: tesseract.js OCR (first run downloads eng traineddata), PII-NER (CPU), backstop, rescue...");
  await initNer("cpu");
  const run = await runPerception(basePng, {
    task: "open the telemetry report for station VSSC-03",
    domRegions: [
      { id: 1, bbox: [24, 236, 220, 26], source: "dom", role: "textbox", name: "Password", interactable: true },
      { id: 2, bbox: [24, 286, 240, 26], source: "dom", role: "button", name: "Open VSSC-03 report", interactable: true },
    ],
    domSensitive: [{ bbox: [24, 236, 220, 26], category: "PASSWORD" as PiiCategory }],
  });
  const ocr = run.ocr;
  console.log(`   OCR read ${ocr.words.length} words:`, JSON.stringify(ocr.joined));
  if (!/ops\.lead@vssc\.test|ABCDE1234F|9000000000/.test(ocr.joined)) {
    fail("OCR did not recover any seeded PII - check tesseract install/network");
  }
  ok("OCR recovered seeded PII text from the raster");
  ok(`text-likelihood backstop ran (${run.textLikelihoodBoxes.length} text-like box(es), ${run.rescueAttempts} rescue attempt(s))`);

  // Best-effort real mediapipe face detection. It is a browser API; in Node it
  // usually cannot initialise. We report which happened rather than failing.
  let facesRan = false;
  try {
    const { data, info } = await sharp(basePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const imageData = { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
    const faces = await runFaces(imageData as unknown as ImageBitmap);
    facesRan = true;
    ok(`mediapipe FaceDetector ran in Node (${faces.length} face(s) - the roster has none, 0 is correct)`);
  } catch (e) {
    console.log(`   mediapipe FaceDetector did not run headless: ${(e as Error).message.split("\n")[0]}`);
    console.log("   (expected - it is a browser API; the face path is covered by fuse.test.ts + verified in Chrome)");
  }

  const result = { manifest: run.manifest, mapping: run.mapping };

  const manifestJson = JSON.stringify(result.manifest);
  const leaked = RAW_PII.filter((s) => manifestJson.includes(s));
  if (leaked.length) fail(`manifest LEAKED raw PII: ${leaked.join(", ")}`);
  ok("manifest contains none of the raw PII strings");

  const redacted = result.manifest.regions.filter((r) => r.kind === "redacted") as any[];
  console.log(`   redacted regions: ${redacted.length}`,
    redacted.map((r) => `${r.category}=${r.placeholder}(len=${r.value_len})`).join(" "));
  const valueBearing = redacted.filter((r) => r.value_len != null);
  if (valueBearing.length === 0) fail("no value-bearing redacted region was produced");
  for (const r of valueBearing) {
    if (!result.mapping.resolve(r.placeholder)) fail(`placeholder ${r.placeholder} does not resolve locally`);
  }
  ok(`every value-bearing placeholder resolves locally (${valueBearing.length}); null-value regions carry positional ids only`);

  // Real pixel masking: composite opaque MASK_COLOR rects over every planned op,
  // then read back one redacted region and prove the pixels there are the mask
  // colour (i.e. whatever text was underneath is destroyed in the sent image).
  const ops = planMasks(redacted as any);
  const composited = await sharp(basePng).composite(
    ops.map((op) => ({
      input: { create: { width: Math.max(1, Math.round(op.bbox[2])), height: Math.max(1, Math.round(op.bbox[3])), channels: 4 as const, background: MASK_COLOR } },
      left: Math.max(0, Math.round(op.bbox[0])),
      top: Math.max(0, Math.round(op.bbox[1])),
    })),
  ).png().toBuffer();
  const emailOp = ops[redacted.findIndex((r) => r.category === "EMAIL")]!;
  const probe = await sharp(composited)
    .extract({ left: Math.round(emailOp.bbox[0]) + 4, top: Math.round(emailOp.bbox[1]) + 4, width: 8, height: 6 })
    .removeAlpha().raw().toBuffer();
  const [mr, mg, mb] = hexToRgb(MASK_COLOR);
  for (let i = 0; i < probe.length; i += 3) {
    if (Math.abs(probe[i]! - mr) > 6 || Math.abs(probe[i + 1]! - mg) > 6 || Math.abs(probe[i + 2]! - mb) > 6) {
      fail(`sanitised image still shows non-mask pixels inside the EMAIL region at byte ${i} (rgb ${probe[i]},${probe[i+1]},${probe[i+2]})`);
    }
  }
  ok(`sanitised image pixels inside a redacted region are the mask colour ${MASK_COLOR} - underlying text destroyed`);
  const sanitisedDataUrl = `data:image/png;base64,${composited.toString("base64")}`;

  const body = JSON.stringify({
    task: "open the telemetry report for station VSSC-03",
    image_b64: sanitisedDataUrl,
    manifest: result.manifest,
    history: [],
  });
  const bodyLeak = RAW_PII.filter((s) => body.includes(s));
  if (bodyLeak.length) fail(`request body to server LEAKED: ${bodyLeak.join(", ")}`);
  ok("full request body to the server (masked image + manifest) carries no raw PII");

  const realVlm = process.env.E2E_VLM === "1";
  const health = await fetch(`${SERVER}/health`).then((r) => r.json() as Promise<{ mock: boolean }>).catch(() => null);
  if (!health) fail(`no server on :8787 - start it first (${realVlm ? "MOCK=0 + API key" : "MOCK=1"})`);
  if (realVlm && health.mock) fail("E2E_VLM=1 but the server is in mock mode - restart it with MOCK=0 and a real key");
  console.log(`   server: ${health.mock ? "MOCK" : "REAL provider"}`);

  const res = await fetch(`${SERVER}/agent/step`, {
    method: "POST", headers: { "content-type": "application/json" }, body,
  });
  if (!res.ok) fail(`server returned ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const parsed = ServerResponseSchema.safeParse(json);
  if (!parsed.success) fail(`server response failed ServerResponseSchema: ${JSON.stringify(json)}`);
  console.log(`   action:`, JSON.stringify(parsed.data.action));
  ok(`server accepted the redacted request and returned a valid ${parsed.data.action.type} action`);

  console.log(`\nALL CHECKS PASSED in ${((Date.now() - t0) / 1000).toFixed(1)}s` +
    `  [OCR:real  NER:real  faces:${facesRan ? "real" : "browser-only"}  mask:real-pixels  VLM:${health.mock ? "mock" : "real"}]`);
  writeFileSync(VERDICT, "PASS");
  await Promise.allSettled([disposeOcr(), disposeNer()]);
  // onnxruntime-node can assert during interpreter teardown on Windows; the
  // .verdict file written above is the authoritative result. Exit hard.
  setImmediate(() => process.exit(0));
}

main().catch((e) => fail(String((e as Error)?.stack ?? e)));
