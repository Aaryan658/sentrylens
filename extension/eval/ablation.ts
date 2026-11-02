/**
 * Layer ablation: how much does each protection add against the red-team
 * fixtures? Runs every fixture through the REAL perception pipeline three
 * times, with layers switched on cumulatively:
 *
 *   A  OCR + NER + validators + DOM           (backstop:false)
 *   B  A + fail-closed text-likelihood backstop (backstop:true, rescue:false)
 *   C  B + scoped OCR rescue = full pipeline    (default)
 *
 * The leak definition is identical to run-eval.ts: a ground-truth item is
 * caught if a redacted region carries its value, blacked out if a value-less
 * backstop box covers its band, and leaked otherwise.
 *
 * Run (from extension/):  node --import tsx eval/ablation.ts
 * Writes docs/ABLATION_RESULTS.md. Synthetic fixtures only.
 */
import type { BBox } from "@sentrylens/shared";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import { disposeOcr } from "../src/perception/ocr.js";
import { initNer, disposeNer } from "../src/perception/ner.js";
import { runPerception } from "./harness.js";
import { FIXTURES, type EvalFixture } from "./fixtures.js";
import { matchValue } from "./match.js";

const COVER_FRACTION = 0.5;

function insideFraction(inner: BBox, outer: BBox): number {
  const w = Math.min(inner[0] + inner[2], outer[0] + outer[2]) - Math.max(inner[0], outer[0]);
  const h = Math.min(inner[1] + inner[3], outer[1] + outer[3]) - Math.max(inner[1], outer[1]);
  const area = inner[2] * inner[3];
  return w > 0 && h > 0 && area > 0 ? (w * h) / area : 0;
}

interface Config { id: "A" | "B" | "C"; label: string; opts: { backstop?: boolean; rescue?: boolean } }
const CONFIGS: Config[] = [
  { id: "A", label: "OCR + NER + validators + DOM", opts: { backstop: false } },
  { id: "B", label: "+ fail-closed backstop", opts: { backstop: true, rescue: false } },
  { id: "C", label: "+ scoped OCR rescue (full pipeline)", opts: {} },
];

type ItemState = "recovered" | "blacked-out" | "LEAKED";
interface Outcome { items: { label: string; state: ItemState }[]; benignBoxes: number }

async function runOne(f: EvalFixture, opts: Config["opts"]): Promise<Outcome> {
  const basePng = await sharp(Buffer.from(f.svg)).png().toBuffer();
  const { mapping, redacted } = await runPerception(basePng, {
    task: f.task, domRegions: f.domRegions, domSensitive: f.domSensitive, ...opts,
  });
  const resolved = redacted
    .filter((r) => r.value_len != null)
    .map((r) => ({ region: r, value: mapping.resolve(r.placeholder) }))
    .filter((r): r is { region: (typeof redacted)[number]; value: string } => r.value != null);
  const heuristics = redacted.filter((r) => r.detected_by.includes("heuristic"));
  const claimed = new Set<string>();
  const items: Outcome["items"] = [];
  for (const gt of f.groundTruth) {
    const label = `${gt.category}`;
    const hit = resolved.find(
      (r) => !claimed.has(r.region.placeholder) && r.region.category === gt.category && matchValue(r.value, gt.value, gt.category),
    );
    if (hit) { claimed.add(hit.region.placeholder); items.push({ label, state: "recovered" }); continue; }
    if (heuristics.some((r) => insideFraction(r.bbox, gt.bbox) >= COVER_FRACTION)) { items.push({ label, state: "blacked-out" }); continue; }
    items.push({ label, state: "LEAKED" });
  }
  const benignBoxes = heuristics.filter((r) => !f.groundTruth.some((gt) => insideFraction(r.bbox, gt.bbox) >= COVER_FRACTION)).length;
  return { items, benignBoxes };
}

const count = (o: Outcome[], s: ItemState) => o.reduce((n, x) => n + x.items.filter((i) => i.state === s).length, 0);

async function main() {
  console.log(`ablation: ${FIXTURES.length} fixtures x ${CONFIGS.length} configs through the real pipeline...`);
  await initNer("cpu");
  const results = new Map<string, Map<string, Outcome>>(); // config -> fixture -> outcome
  for (const c of CONFIGS) {
    const m = new Map<string, Outcome>();
    for (const f of FIXTURES) {
      console.log(`  [${c.id}] ${f.name}`);
      m.set(f.name, await runOne(f, c.opts));
    }
    results.set(c.id, m);
  }
  await Promise.allSettled([disposeOcr(), disposeNer()]);

  const base = FIXTURES.filter((f) => !f.adversarial);
  const red = FIXTURES.filter((f) => f.adversarial && f.groundTruth.length > 0);
  const pick = (id: string, set: EvalFixture[]) => set.map((f) => results.get(id)!.get(f.name)!);

  const summary = CONFIGS.map((c) => {
    const b = pick(c.id, base), r = pick(c.id, red);
    return {
      id: c.id, label: c.label,
      baselineItems: base.reduce((n, f) => n + f.groundTruth.length, 0),
      baselineLeaked: count(b, "LEAKED"),
      redteamAttacks: red.length,
      attacksSucceeded: r.filter((o) => o.items.some((i) => i.state === "LEAKED")).length,
      redteamItems: red.reduce((n, f) => n + f.groundTruth.length, 0),
      redteamLeaked: count(r, "LEAKED"),
      redteamRecovered: count(r, "recovered"),
      redteamBlackedOut: count(r, "blacked-out"),
      baselineBenignBoxes: b.reduce((n, o) => n + o.benignBoxes, 0),
    };
  });

  const perAttack = red.map((f) => ({
    name: f.name, technique: f.technique,
    byConfig: Object.fromEntries(CONFIGS.map((c) => [c.id, results.get(c.id)!.get(f.name)!.items.map((i) => i.state)])),
  }));

  const cell = (states: ItemState[]) => (states.includes("LEAKED") ? "**LEAKED**" : states.every((s) => s === "recovered") ? "recovered" : "blacked out");
  const md = `# SentryLens layer ablation

Generated by \`node --import tsx eval/ablation.ts\` on ${new Date().toISOString().slice(0, 10)} against
\`extension/eval/fixtures.ts\` (${base.length} baseline + ${red.length} red-team fixtures with ground truth),
real pipeline, Node OCR/NER (CPU). Layers are switched on cumulatively; every number is measured.

| Config | Layers | Baseline items leaked | Red-team attacks that got PII through | Red-team items leaked | Recovered exactly | Blacked out, value unconfirmed | Benign backstop boxes (baseline) |
|---|---|---|---|---|---|---|---|
${summary.map((s) => `| ${s.id} | ${s.label} | ${s.baselineLeaked}/${s.baselineItems} | ${s.attacksSucceeded}/${s.redteamAttacks} | ${s.redteamLeaked}/${s.redteamItems} | ${s.redteamRecovered} | ${s.redteamBlackedOut} | ${s.baselineBenignBoxes} |`).join("\n")}

## Per attack

| Fixture | Technique | A | B | C |
|---|---|---|---|---|
${perAttack.map((p) => `| ${p.name} | ${p.technique} | ${cell(p.byConfig.A as ItemState[])} | ${cell(p.byConfig.B as ItemState[])} | ${cell(p.byConfig.C as ItemState[])} |`).join("\n")}

Scope: hand-built, synthetic, English fixtures; Node OCR (not the browser's wasm). "Blacked out" means the
pixels were masked by the fail-closed backstop but no value was confirmed; it is not a leak. A leak is a
ground-truth item with no redaction over its pixels. This is not a live prompt-injection test.
`;
  const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/ABLATION_RESULTS.md");
  writeFileSync(outPath, md, "utf8");
  console.log(`\nwrote ${outPath}\n`);
  console.log("ABLATION_JSON_START");
  console.log(JSON.stringify({ summary, perAttack }, null, 2));
  console.log("ABLATION_JSON_END");
  setImmediate(() => process.exit(0));
}

main().catch((e) => { console.error(e); process.exit(1); });
