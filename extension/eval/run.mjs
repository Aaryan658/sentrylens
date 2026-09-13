// Cross-shell runner for the eval harness, mirroring e2e/run.mjs: the NER
// model's onnxruntime-node backend can assert during interpreter teardown on
// Windows and corrupt the child exit code, so the child writes an
// authoritative .done marker and this wrapper checks for that instead of
// trusting the raw exit code.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const marker = new URL("./.done", import.meta.url);
const script = fileURLToPath(new URL("./run-eval.ts", import.meta.url));

rmSync(marker, { force: true });
spawnSync(process.execPath, ["--import", "tsx", script], { stdio: "inherit" });

const done = existsSync(marker);
console.log(`\n[eval] ${done ? "report generated" : "FAILED — child crashed before finishing"}`);
process.exit(done ? 0 : 1);
