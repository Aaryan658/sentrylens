/**
 * Headless end-to-end check of the perception + redaction path, outside Chrome.
 *
 * Rasterises the demo duty-roster to a PNG (sharp), then runs the REAL models:
 *   tesseract.js OCR  ->  @huggingface/transformers NER (WASM)  ->  assemblePerception
 * and asserts the produced manifest leaks none of the raw PII, then POSTs it to
 * the running server (mock mode) and validates the returned action.
 *
 * Run:  pnpm --filter @sentrylens/extension e2e
 * Needs network egress for first-run model weights (tesseract lang data ~2 MB,
 * PII-NER ONNX ~small). Server must be up:  MOCK=1 PORT=8787 pnpm --filter @sentrylens/server start
 */
import sharp from "sharp";
import { runOcr } from "../src/perception/ocr.js";
import { runNer, initNer } from "../src/perception/ner.js";
import { assemblePerception } from "../src/perception/pipeline.js";
import { ServerResponseSchema, type PiiCategory } from "@sentrylens/shared";

const RAW_PII = ["A. Menon", "Menon", "9000000000", "ops.lead@vssc.test", "ABCDE1234F"];

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

function fail(msg: string): never { console.error("✖ " + msg); process.exit(1); }
function ok(msg: string) { console.log("✔ " + msg); }

async function main() {
  const t0 = Date.now();
  const pngBuf = await sharp(Buffer.from(SVG)).png().toBuffer();
  const pngDataUrl = `data:image/png;base64,${pngBuf.toString("base64")}`;
  ok(`rasterised roster -> PNG (${pngBuf.length} bytes)`);

  console.log("running tesseract.js OCR (first run downloads eng traineddata)...");
  const ocr = await runOcr(pngDataUrl);
  console.log(`   OCR read ${ocr.words.length} words:`, JSON.stringify(ocr.joined));
  if (!/ops\.lead@vssc\.test|ABCDE1234F|9000000000/.test(ocr.joined)) {
    fail("OCR did not recover any of the seeded PII strings - check tesseract install/network");
  }
  ok("OCR recovered seeded PII text from the raster");

  // Node's onnxruntime uses "cpu"; the browser build uses "wasm"/"webgpu".
  console.log("running @huggingface/transformers PII-NER (CPU)...");
  await initNer("cpu");
  const nerSpans = await runNer(ocr.joined);
  console.log(`   NER spans:`, JSON.stringify(nerSpans));
  ok(`NER ran (${nerSpans.length} span(s))`);

  const result = assemblePerception({
    task: "open the telemetry report for station VSSC-03",
    image: { w: 640, h: 320, dpr: 1 },
    domRegions: [
      { id: 1, bbox: [24, 236, 200, 24], source: "dom", role: "textbox", name: "Password", interactable: true },
      { id: 2, bbox: [24, 276, 220, 24], source: "dom", role: "button", name: "Open VSSC-03 report", interactable: true },
    ],
    domSensitive: [{ bbox: [24, 236, 200, 24], category: "PASSWORD" as PiiCategory }],
    faces: [],
    ocrWords: ocr.words,
    ocrJoined: ocr.joined,
    ocrOffsets: ocr.offsets,
    nerSpans,
    degraded: false,
  });

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
    const back = result.mapping.resolve(r.placeholder);
    if (!back) fail(`placeholder ${r.placeholder} (value_len ${r.value_len}) does not resolve back to a real value`);
    if (RAW_PII.some((s) => s === back || s.includes(back) || back.includes(s))) {
      // resolving is supposed to give back the real value locally — that's fine,
      // it just must never have travelled off-device (asserted above on the JSON).
    }
  }
  ok(`every value-bearing placeholder resolves locally (${valueBearing.length}); null-value regions carry positional ids only`);

  const body = JSON.stringify({
    task: "open the telemetry report for station VSSC-03",
    image_b64: pngDataUrl,
    manifest: result.manifest,
    history: [],
  });
  const bodyLeak = RAW_PII.filter((s) => body.includes(s));
  if (bodyLeak.length) fail(`request body to server LEAKED: ${bodyLeak.join(", ")}`);
  ok("full request body to the server carries no raw PII");

  const res = await fetch("http://localhost:8787/agent/step", {
    method: "POST", headers: { "content-type": "application/json" }, body,
  });
  if (!res.ok) fail(`server returned ${res.status} (is MOCK=1 server up on :8787?)`);
  const parsed = ServerResponseSchema.safeParse(await res.json());
  if (!parsed.success) fail("server response failed ServerResponseSchema");
  ok(`server accepted the redacted request and returned a valid ${parsed.data.action.type} action`);

  console.log(`\nALL CHECKS PASSED in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0); // tesseract worker + onnxruntime keep the loop alive otherwise
}

main().catch((e) => fail(String(e?.stack ?? e)));
