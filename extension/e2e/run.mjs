// Cross-shell runner for the perception E2E. onnxruntime-node can assert during
// interpreter teardown on Windows and corrupt the child exit code, so the child
// writes an authoritative e2e/.verdict file and this wrapper reads that.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const verdict = new URL("./.verdict", import.meta.url);
const script = fileURLToPath(new URL("./perception-e2e.ts", import.meta.url));

rmSync(verdict, { force: true });
spawnSync(process.execPath, ["--import", "tsx", script], { stdio: "inherit" });

let v = "";
try { v = readFileSync(verdict, "utf8").trim(); } catch { /* missing */ }
console.log(`\n[e2e] verdict: ${v || "MISSING (child crashed before writing it)"}`);
process.exit(v === "PASS" ? 0 : 1);
