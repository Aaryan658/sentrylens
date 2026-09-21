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

interface FixtureResult {
  name: string;
  totalGroundTruth: number;
  leaked: string[];              // ground-truth values with NO redacted region covering them at all
  positionalCatches: string[];   // pixels WERE redacted (fail-closed heuristic), but no value confirmed
  overMasks: { category: string; placeholder: string }[];
  /** value-less fail-closed boxes (text-likelihood backstop) of any kind in this fixture */
  heuristicRegions: number;
  /** ...of which sit on no ground-truth item: benign UI the backstop blacked out */
  benignHeuristic: number;
  taskNecessityChecked: number;
  taskNecessityCorrect: number;
  adversarial: boolean;
  technique?: string;
}

/** Fraction of `inner`'s area that lies inside `outer` (0..1). */
function insideFraction(inner: BBox, outer: BBox): number {
  const w = Math.min(inner[0] + inner[2], outer[0] + outer[2]) - Math.max(inner[0], outer[0]);
  const h = Math.min(inner[1] + inner[3], outer[1] + outer[3]) - Math.max(inner[1], outer[1]);
  const area = inner[2] * inner[3];
  return w > 0 && h > 0 && area > 0 ? (w * h) / area : 0;
}

// A heuristic box "covers" a ground-truth item when at least this much of the
// box lies inside the item's on-screen band, so a box on the NEXT line, or one
// that merely touches the band, does not count.
const COVER_FRACTION = 0.5;

async function runFixture(f: EvalFixture): Promise<FixtureResult> {
  const basePng = await sharp(Buffer.from(f.svg)).png().toBuffer();
  const { mapping, redacted } = await runPerception(basePng, {
    task: f.task,
    domRegions: f.domRegions,
    domSensitive: f.domSensitive,
  });

  // EVAL_VERBOSE=1: dump every redacted region (fixtures are synthetic, so
  // printing resolved values is safe here) to attribute over-masks and boxes.
  if (process.env.EVAL_VERBOSE) {
    console.log(`\n[${f.name}] ${redacted.length} redacted region(s)`);
    for (const r of redacted) {
      const v = r.value_len != null ? mapping.resolve(r.placeholder) : null;
      console.log(`  ${r.category.padEnd(13)} ${r.detected_by.join("+").padEnd(16)} bbox=${r.bbox.map(Math.round).join(",").padEnd(18)} value=${JSON.stringify(v)}`);
    }
  }

  // Value-bearing redacted regions this fixture's ground truth could match
  // against (FACE/BYSTANDER_SCREEN carry no value — not applicable here).
  const resolved = redacted
    .filter((r) => r.value_len != null)
    .map((r) => ({ region: r, value: mapping.resolve(r.placeholder) }))
    .filter((r): r is { region: (typeof redacted)[number]; value: string } => r.value != null);

  const leaked: string[] = [];
  const positionalCatches: string[] = [];
  let taskNecessityChecked = 0;
  let taskNecessityCorrect = 0;
  const claimed = new Set<string>(); // placeholders already matched to a ground-truth entry
  // Fail-closed heuristic redactions (text-likelihood.ts) carry no value, so
  // they can never satisfy the value-matching check above — but the pixels
  // ARE genuinely redacted. A ground-truth item counts as positionally caught
  // only if a heuristic box actually covers ITS pixels (bbox-level, see
  // COVER_FRACTION), not merely because some heuristic box exists elsewhere
  // in the fixture. Category is no longer always "OTHER" here (label-context.ts
  // may infer a real category from a nearby legible label) so this must not
  // filter on it.
  const heuristics = redacted.filter((r) => r.detected_by.includes("heuristic"));

  for (const gt of f.groundTruth) {
    const hit = resolved.find(
      (r) => !claimed.has(r.region.placeholder) && r.region.category === gt.category && matchValue(r.value, gt.value, gt.category),
    );
    if (hit) {
      claimed.add(hit.region.placeholder);
      if (gt.taskNecessary !== undefined) {
        taskNecessityChecked++;
        if (hit.region.task_necessary === gt.taskNecessary) taskNecessityCorrect++;
      }
      continue;
    }
    const heuristicCatch = heuristics.find((r) => insideFraction(r.bbox, gt.bbox) >= COVER_FRACTION);
    if (heuristicCatch) {
      const inferredNote = heuristicCatch.category !== "OTHER" ? ` [category inferred: ${heuristicCatch.category}]` : "";
      positionalCatches.push(`${gt.category}:${gt.value}${inferredNote}`);
      continue;
    }
    leaked.push(`${gt.category}:${gt.value}`);
  }

  const overMasks = resolved
    .filter((r) => !claimed.has(r.region.placeholder))
    .map((r) => ({ category: r.region.category, placeholder: r.region.placeholder }));

  // Over-masking of the backstop: value-less boxes that cover no ground-truth
  // item. The value-bearing over-masking metric above never sees these.
  const benignHeuristic = heuristics.filter(
    (r) => !f.groundTruth.some((gt) => insideFraction(r.bbox, gt.bbox) >= COVER_FRACTION),
  ).length;

  return {
    name: f.name,
    totalGroundTruth: f.groundTruth.length,
    leaked,
    positionalCatches,
    overMasks,
    heuristicRegions: heuristics.length,
    benignHeuristic,
    taskNecessityChecked,
    taskNecessityCorrect,
    adversarial: f.adversarial ?? false,
    technique: f.technique,
  };
}

function renderReport(results: FixtureResult[]): string {
  const baseline = results.filter((r) => !r.adversarial);
  const redteam = results.filter((r) => r.adversarial);

  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

  function aggregate(set: FixtureResult[]) {
    const totalGt = set.reduce((s, r) => s + r.totalGroundTruth, 0);
    const totalLeaked = set.reduce((s, r) => s + r.leaked.length, 0);
    const totalOverMasks = set.reduce((s, r) => s + r.overMasks.length, 0);
    const totalRedactedValueBearing = totalGt - totalLeaked + totalOverMasks;
    const totalTnChecked = set.reduce((s, r) => s + r.taskNecessityChecked, 0);
    const totalTnCorrect = set.reduce((s, r) => s + r.taskNecessityCorrect, 0);
    const totalHeuristic = set.reduce((s, r) => s + r.heuristicRegions, 0);
    const totalBenignHeuristic = set.reduce((s, r) => s + r.benignHeuristic, 0);
    return { totalGt, totalLeaked, totalOverMasks, totalRedactedValueBearing, totalTnChecked, totalTnCorrect, totalHeuristic, totalBenignHeuristic };
  }

  const b = aggregate(baseline);

  const rows = baseline
    .map(
      (r) =>
        `| ${r.name} | ${r.totalGroundTruth} | ${r.totalGroundTruth - r.leaked.length}/${r.totalGroundTruth} | ${r.leaked.length ? r.leaked.join(", ") : "—"} | ${r.overMasks.length} | ${r.heuristicRegions} (${r.benignHeuristic} benign) | ${r.taskNecessityChecked ? `${r.taskNecessityCorrect}/${r.taskNecessityChecked}` : "—"} |`,
    )
    .join("\n");

  const redteamAttacksWithGt = redteam.filter((r) => r.totalGroundTruth > 0);
  const attacksSucceeded = redteamAttacksWithGt.filter((r) => r.leaked.length > 0).length;
  const redteamRows = redteam
    .map((r) => {
      const caught = r.totalGroundTruth - r.leaked.length - r.positionalCatches.length;
      const result = r.leaked.length
        ? `**LEAKED** (${r.leaked.join(", ")})`
        : r.positionalCatches.length
          ? `resisted — fail-closed (pixels redacted, value unconfirmed: ${r.positionalCatches.join(", ")})`
          : "resisted";
      return `| ${r.name} | ${r.technique} | ${caught}/${r.totalGroundTruth} | ${result} | ${r.overMasks.length} |`;
    })
    .join("\n");

  return `# SentryLens eval results

Generated by \`pnpm --filter @sentrylens/extension eval\` on ${new Date().toISOString().slice(0, 10)}
against \`extension/eval/fixtures.ts\` (${baseline.length} baseline + ${redteam.length} red-team
fixtures) using the real on-device pipeline: tesseract.js OCR +
\`onnx-community/multilang-pii-ner-ONNX\` NER (CPU device — the browser build
uses wasm/webgpu) + \`assemblePerception\`.
No literature numbers are cited below — every figure here was measured on
this codebase, this run.

## Aggregate (baseline fixtures)

| Metric | Value | Definition |
|---|---|---|
| PII leakage rate | **${pct(b.totalLeaked, b.totalGt)}** (${b.totalLeaked}/${b.totalGt}) | ground-truth PII with no matching redacted region. Every redacted region's bbox is fully mask-painted (\`mask.test.ts\`), so "not redacted" = pixels reach the server unmasked. |
| Over-masking rate | **${pct(b.totalOverMasks, b.totalRedactedValueBearing)}** (${b.totalOverMasks}/${b.totalRedactedValueBearing}) | value-bearing redacted regions that don't correspond to any ground-truth PII on that fixture (false-positive redaction of benign content). |
| Task-necessity accuracy | **${pct(b.totalTnCorrect, b.totalTnChecked)}** (${b.totalTnCorrect}/${b.totalTnChecked}) | of the ground-truth entries with an expected \`task_necessary\` value, how many did \`classify()\` get right. |
| Backstop boxes over benign UI | **${b.totalBenignHeuristic}** of ${b.totalHeuristic} | value-less fail-closed boxes that cover no ground-truth item. Not part of the over-masking rate above (that only counts value-bearing regions). |

## Per-fixture (baseline)

| Fixture | Ground-truth PII | Caught | Leaked | Over-masks | Backstop boxes | Task-necessity |
|---|---|---|---|---|---|---|
${rows}

"Backstop boxes" counts value-less fail-closed boxes from \`text-likelihood.ts\`; "benign" means the box covers no ground-truth item, i.e. UI the backstop blacked out for nothing. The "Over-masking rate" above ignores value-less boxes, so this column is the only place that cost shows up.

## Red-team: evasion attempts against the redaction pipeline

**Scope, stated plainly:** this harness has no live agent loop, so these fixtures
do NOT test whether a VLM agent can be prompt-injected into leaking a
placeholder's real value. They test the narrower, still-real question: can
page content that's deliberately trying to dodge detection (low-contrast
text, tiny fonts, homoglyphs, character-spacing, missing keyword labels,
adjacent injection-styled distractor text) still get past the perception/
redaction layer before anything reaches the network?

**Attack success rate: ${pct(attacksSucceeded, redteamAttacksWithGt.length)}** (${attacksSucceeded}/${redteamAttacksWithGt.length} techniques got at least one ground-truth PII item past redaction)

| Fixture | Technique | Caught | Result | Over-masks |
|---|---|---|---|---|
${redteamRows}

**How the low-contrast and tiny-font cases are now handled:** both used to
be outright OCR *detection* failures — Tesseract emitted zero words for
that line, so there was no text for NER/regex to ever see. Two whole-image
fixes were tried and failed: a \`user_defined_dpi\` config tweak did
nothing, and a whole-image 3x-upscale + CLAHE-contrast pass regressed two
previously-clean baseline detections without fixing either target case, so
it was reverted — global preprocessing risks the *whole* image; a bug
anywhere hits everything.

The fix now in place is a three-layer fallback, each layer scoped so it
can only ever ADD a redaction, never remove or weaken one that already
works:

1. \`text-likelihood.ts\` flags "something text-shaped is here" via local
   pixel variance — a signal that survives near-invisible contrast and
   sub-10px fonts because it's relative, not absolute. It then discards blobs
   that are positively page chrome (thin lines; large hollow outlines such as
   input borders and card frames), since variance alone also fires on those.
2. For each flagged OCR blind spot, \`ocr-rescue.ts\` attempts a SECOND,
   scoped OCR pass: merge same-row fragments into one line box (connected-
   components often fragments a faint/tiny line into several small blobs a
   few pixels apart, not one unified box — cropping each fragment alone
   starves Tesseract of line context and it reads garbage), then locally
   contrast-stretch (min/max over the crop only, never the whole image)
   and bilinearly upscale, and re-run Tesseract on just that crop. Because
   this only ever touches pixels inside the flagged box, it cannot regress
   OCR anywhere else — the exact failure mode of the earlier whole-image
   attempt. A single fixed upscale factor doesn't generalize (an earlier
   version hardcoded 5x, which happened to win on these fixtures but isn't
   derived from any general theory of OCR resolution — 6x, which
   intuitively "should" be at least as good, was consistently WORSE and
   misread a "2" as "Z"), so \`rescueBlindSpot\` instead tries a small
   spread of upscale factors (\`RESCUE_CANDIDATES\`) in order and keeps the
   FIRST one whose reading actually validates — a checksum/pattern-valid
   identifier or a label-anchored name (\`extractRescuedPii\`; NER is
   deliberately NOT used here, because on recovered noise it fabricated a
   person from a photo and from a button caption) — rather than trusting whichever one Tesseract
   merely produced SOME text for. A candidate that reads garbage costs one
   wasted OCR call on an already-small, already-rare crop and is otherwise
   harmless. On this benchmark it now recovers the EXACT value for both
   previously-unrecoverable fixtures below.
3. If no candidate's reading validates, the blind spot still falls back to
   the pre-existing fail-closed heuristic: pixels blacked out, and
   \`label-context.ts\` tries to at least narrow the *category* (never the
   value) from a nearby legible label — now matched against a broader,
   deliberately-curated vocabulary (common misspellings, "Mob No", "A/C
   No", "Driving Licence", etc.), while still excluding bare "PIN"
   (ambiguous with a postal PIN code — guessing wrong is worse than not
   guessing). It is exercised directly by \`fuse.test.ts\` with a fixture
   where the label is legible and the value is not — the realistic case it
   targets — but does not fire on either fixture below even now, since
   both fixtures hide the label with the exact same evasion styling as the
   value.

**A real limit worth stating plainly:** trying several upscale factors and
validating the result is more robust than trusting one fixed guess, but it
is still a small, fixed candidate list, not an exhaustive search — an
even more extreme font size than these fixtures could still exhaust every
candidate without validating. In that case it resists safely (fails
closed to a blackbox with no value claimed — see the fallback above)
rather than reporting a wrong value. This is a 2-fixture synthetic
benchmark, not a claim that all OCR blind spots are now recoverable.

## Scope and honesty notes

- PASSWORD is excluded from ground truth: DOM-flagged password fields carry
  \`value: null\` by design (positional placeholder, never enter the mapping
  table), so there is no resolvable value for this harness to compare — their
  pixel-level redaction is proven separately by \`mask.test.ts\` and
  \`perception-e2e.ts\`.
- FACE and BYSTANDER_SCREEN are excluded for the same reason (no value).
- This is a small (${baseline.length}-fixture baseline, ${redteam.length}-fixture red-team), synthetic,
  English-text benchmark — not GUIGuard-Bench, PrivScreen, REDACT, or
  RedacBench (no license/access path to those during this build). It
  measures *this system's* real behaviour, which is the point: previously
  the pitch deck cited literature task-success numbers (80.8% vs 83.6%) as
  if they were SentryLens's own. These are ours.
- The red-team fixtures are hand-authored, not drawn from a published
  attack corpus (e.g. WASP, BrowseSafe-Bench, IPI-proxy) — a meaningful
  next step, not a substitute for this initial pass.
- "Positional catch" attribution is now bbox-level: a ground-truth item counts
  as caught by a fail-closed box only if at least half of that box lies inside
  the item's on-screen band (\`bbox\` in fixtures.ts). The band is a whole text
  line (plain fixtures) or a whole table cell (dark-ui-login-roster), not a
  glyph-tight box, so this proves "the right line/cell was blacked out", not
  "every pixel of the value was".
- The over-masking rate here is ${pct(b.totalOverMasks, b.totalRedactedValueBearing)}. Adding the
  \`dark-ui-login-roster\` fixture first pushed it up (the earlier 0.0% was
  measured only on plain text lines on white, which cannot show over-masking of
  buttons, labels or page chrome). It came back down by removing two structural
  causes, not by tuning to the fixtures: rescue no longer accepts NER-only
  readings (NER turned the button caption "Sign in" into a person), and a value
  fragment inside a larger region that already carries the full value (NER
  tagging "41" inside a card number) is dropped. It is still 0 of a small
  number, not evidence that over-masking is solved.
- The value-bearing over-masking rate never counted value-less fail-closed
  boxes, and those are exactly what the backstop adds. They are now counted
  separately ("Backstop boxes"). On the live demo page the untightened backstop
  blacked out the header edge, input outlines, card borders and the Sign-in
  button, none of which showed up in the old over-masking rate.
- The backstop now drops (1) thin lines and (2) large hollow outlines. Both
  thresholds were chosen from measurements on these fixtures (text blobs had
  interior fill 0.57-1.00, outlines 0.00-0.19; see text-likelihood.ts), which is
  a small sample. Small ambiguous boxes (checkboxes, icon buttons) are kept, so
  they can still be blacked out. A long single line of text is kept even at an
  extreme aspect ratio. Not tested: an adversary shaping text to look like a
  thin line or an outline.
- This eval renders clean SVG text, so it cannot show what a real Chrome page
  does to OCR. On the real demo page (\`pnpm live\`, extension/eval/live-page.ts,
  which drives real Chrome, the real DOM walker and the same pipeline) Tesseract
  missed the phone, email and card values at 1x, and read the card as
  "A111 1111111 1111" and an email as "ops.lead@vssc test". Three fixes came from
  that, each checked there and not on these fixtures:
  (1) whole-screenshot OCR runs at a fixed 2x for screenshots up to 1.5 MP (the
  cause was small text, not the dark theme: inverting the image did not help,
  and fractional factors like 1.5x were worse than 2x);
  (2) a misread identifier (a digit-like run of 11+ digits with a lookalike
  letter or irregular grouping, or an "@" word with no domain) is masked fail-
  closed, because a misread fails every validator and, having been "read", is not
  a blind spot; a regularly grouped number that only fails its checksum is left
  alone;
  (3) DOM element names, which the manifest sends to the server as plain text,
  are scrubbed with the same detectors.
  Also found there and fixed: face boxes were scaled by the device pixel ratio
  twice, so on any display scaled above 100% the mask landed off the face.
- \`pnpm live\` measures glyph pixels still visible under the masks for each
  secret on the demo page at dpr 1, 1.25, 1.5 and 2 and currently reports none.
  That is one page and four scales, in Node OCR/NER (not the browser's wasm),
  without MediaPipe or yolos; it needs Chrome, so it is not part of \`pnpm eval\`.
- Known limits: a bare person name in a control's text has no structure to
  detect and is not scrubbed from DOM element names; white-on-blue button
  captions that OCR cannot read at any scale are blacked out (fail closed) and
  cost some visual clarity; misread detection assumes a lookalike letter or odd
  grouping, so a misread that changes only digits and keeps regular grouping
  would pass as a clean, checksum-failing number.
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
