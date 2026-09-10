// Copies the on-device model runtimes into extension/public/ so they ship inside
// the extension. MV3's CSP forbids remote code, so tesseract.js / onnxruntime /
// mediapipe cannot pull their wasm+glue from a CDN at runtime — every file they
// importScripts() or import() must be a local extension URL.
//
// Run via `pnpm --filter @sentrylens/extension vendor` (also runs pre-build).
import { createRequire } from "node:module";
import { cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");

// Resolve a package's install dir by name. `from` reaches transitive deps (pnpm
// keeps those only under .pnpm/). Falls back to walking up from the package
// entry when `exports` hides ./package.json.
const pkgDir = (id, from) => {
  const opts = from ? { paths: [from] } : undefined;
  try {
    return dirname(require.resolve(`${id}/package.json`, opts));
  } catch {
    let d = dirname(require.resolve(id, opts));
    const marker = id.startsWith("@") ? id.split("/")[1] : id;
    while (d !== dirname(d) && !d.endsWith(marker)) d = dirname(d);
    return d;
  }
};
const copy = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  console.log(`  ${to.replace(root + "\\", "").replace(root + "/", "")}`);
};

// --- tesseract.js: worker + every core variant (asm .js, .wasm, and the
//     .wasm.js emscripten glue that instantiates the .wasm) + english data ---
console.log("tesseract:");
const tessCore = pkgDir("tesseract.js-core", pkgDir("tesseract.js"));
for (const f of readdirSync(tessCore)) {
  if (/\.(js|wasm)$/.test(f) || f.endsWith(".wasm.js")) copy(join(tessCore, f), join(pub, "tesseract", f));
}
copy(join(pkgDir("tesseract.js"), "dist", "worker.min.js"), join(pub, "tesseract", "worker.min.js"));

// --- onnxruntime-web (as bundled by @huggingface/transformers): the exact
//     jsep .mjs + .wasm that transformers@x loads; version-matched by taking
//     them from the transformers package itself ---
console.log("ort:");
const tfDist = join(pkgDir("@huggingface/transformers"), "dist");
for (const f of readdirSync(tfDist)) {
  if (/^ort-.*\.(mjs|wasm)$/.test(f)) copy(join(tfDist, f), join(pub, "ort", f));
}

// --- mediapipe tasks-vision wasm ---
console.log("mediapipe:");
const mpWasm = join(pkgDir("@mediapipe/tasks-vision"), "wasm");
if (statSync(mpWasm, { throwIfNoEntry: false })?.isDirectory()) {
  for (const f of readdirSync(mpWasm)) copy(join(mpWasm, f), join(pub, "mediapipe", "wasm", f));
}

console.log("done.");
