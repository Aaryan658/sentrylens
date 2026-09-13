# Housekeeping + yolos-tiny Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Commit the already-written, already-tested NER/DOM person-name fix
sitting uncommitted, then turn the yolos-tiny object detector from dead
compute (it runs every step, its output is discarded) into a real signal
that reaches the redaction fuser: bystander phone/laptop/tv screens get
redacted as `BYSTANDER_SCREEN`, and a detected `person` box becomes a
fallback `FACE` region on the rare step where MediaPipe finds zero faces.

**Architecture:** No new modules. Extends the existing fuse pipeline
(`domSensitive` + `faces` + `ocrWords`/`nerSpans` → `fuseRegions` →
`classify` → `buildManifest`) with one more input array, `detectorBoxes`,
threaded from `offscreen/main.ts` (where `runDetector` already runs and is
already called, just unused) through `assemblePerception` into `fuseRegions`.

**Tech Stack:** TypeScript, vitest (node + jsdom environments), pnpm
workspaces (`shared`, `extension`, `server`).

---

## Task 1: Verify and commit the pending NER + DOM person-name fix

This code is already written and already covered by passing tests
(`ner.test.ts`, `walk.test.ts` — confirmed 79/79 passing, clean typecheck in
the 2026-09-13 audit). Nothing to implement here — just verify once more
and split the working tree into two atomic commits by concern, matching this
repo's existing commit style (e.g. `dc26d86 fix(perception): redact person
names from NER`).

**Files:**
- Commit 1: `extension/src/perception/ner.ts`, `extension/src/perception/ner.test.ts` (new)
- Commit 2: `extension/src/dom/walk.ts`, `extension/src/dom/walk.test.ts`

- [ ] **Step 1: Run the full test suite and confirm current pass count**

Run: `pnpm test`
Expected: all files pass, ending in a summary line like
`Test Files  16 passed (16)` / `Tests  79 passed (79)` (16 files because
`ner.test.ts` is currently untracked-but-present). If any test fails, stop
and diagnose before continuing — do not commit on top of a failing suite.

- [ ] **Step 2: Run typecheck across all three packages**

Run: `pnpm typecheck`
Expected: no errors from `shared`, `extension`, or `server`.

- [ ] **Step 3: Commit the NER aggregation fix**

```bash
git add extension/src/perception/ner.ts extension/src/perception/ner.test.ts
git commit -m "$(cat <<'EOF'
fix(perception): fix NER wordpiece aggregation dropping PERSON_NAME spans

transformers.js@3.7.1's TokenClassificationPipeline never implements
aggregation_strategy (start/end are TODOs in its source), so passing it was
a silent no-op: entity_group/start/end were always undefined and
chunk.slice(e.start, e.end) returned the whole chunk for every hit. Real
screen text then either mis-masked huge regions or, once numbers/labels
surrounded a name, tagged everything "O" and produced zero spans — e.g.
"Operator A. Menon" leaked unmasked. mergeNerTokens reconstructs offsets
itself and merges adjacent same-category wordpieces on proximity instead of
trusting BIO prefixes the model doesn't reliably emit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Commit the DOM table-row person-name fallback**

```bash
git add extension/src/dom/walk.ts extension/src/dom/walk.test.ts
git commit -m "$(cat <<'EOF'
feat(perception): flag table-row person names via DOM label heuristic

The on-device NER model is unreliable on OCR'd "label value" text — a name
next to a field label like "Operator" with no punctuation between them is
exactly the pattern it misses, because that's how a table row reads once OCR
flattens it to plain text. DOM structure still has the label/value boundary
the pixels lost, so for known person-labels (Operator, Patient, Employee,
...) in a table row, flag the value cell as PERSON_NAME deterministically —
a fallback net alongside NER, not a replacement for it. Also flags
autocomplete="username" inputs as PERSON_NAME regardless of typed value.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Confirm clean state for these files**

Run: `git status`
Expected: `ner.ts`, `ner.test.ts`, `walk.ts`, `walk.test.ts` no longer listed
as modified/untracked. `.gitignore`, `README.md`, `demo/demo-dashboard.html`,
`docs/DEMO.md`, and the two `.pptx`/`docs/SIH-IDEA-PPT-content.md` files
remain — they're a separate concern (demo-page PII hardening + deck
content), left untouched by this plan.

---

## Task 2: Add `BYSTANDER_SCREEN` category and `"detector"` provenance to the shared contract

**Files:**
- Modify: `shared/src/categories.ts`
- Modify: `shared/src/contracts.ts:49` (the `detected_by` enum)
- Test: `shared/src/contracts.test.ts`

- [ ] **Step 1: Read the current contracts test file to match its style**

Run: `cat "shared/src/contracts.test.ts"` (or open it) — confirm how existing
schema tests are structured before adding to it.

- [ ] **Step 2: Write the failing test for the new category and provenance value**

Add to `shared/src/contracts.test.ts` (append a new `describe` block; keep
existing `import`s):

```typescript
describe("RedactedRegionSchema", () => {
  it("accepts BYSTANDER_SCREEN category and detector provenance", () => {
    const region = {
      id: 10001,
      bbox: [0, 0, 100, 100] as const,
      kind: "redacted" as const,
      category: "BYSTANDER_SCREEN",
      placeholder: "BYSTANDER_SCREEN#1",
      value_len: null,
      risk: "medium" as const,
      style: "blackbox" as const,
      task_necessary: false,
      detected_by: ["detector"],
    };
    expect(RedactedRegionSchema.safeParse(region).success).toBe(true);
  });
});
```

Make sure `RedactedRegionSchema` is imported at the top of the file (add it
to the existing `import { ... } from "./contracts.js"` line if it isn't
already there).

- [ ] **Step 3: Run the test to confirm it fails**

Run: `pnpm test -- contracts.test.ts`
Expected: FAIL — `category` and `detected_by` value rejected by the zod enum
(neither `"BYSTANDER_SCREEN"` nor `"detector"` are valid members yet).

- [ ] **Step 4: Add the category and its risk default**

Edit `shared/src/categories.ts`:

```typescript
export const PII_CATEGORIES = [
  "PERSON_NAME", "EMAIL", "PHONE_NUMBER", "ADDRESS", "DOB",
  "CREDIT_CARD", "AADHAAR", "PAN", "IFSC", "BANK_ACCOUNT", "PASSWORD",
  "API_KEY", "IP_ADDRESS", "FACE", "GOV_ID", "BYSTANDER_SCREEN", "OTHER",
] as const;

export type PiiCategory = (typeof PII_CATEGORIES)[number];

export type Risk = "high" | "medium" | "low";

const HIGH: PiiCategory[] = ["PASSWORD", "CREDIT_CARD", "AADHAAR", "PAN", "GOV_ID", "API_KEY"];
const MEDIUM: PiiCategory[] = [
  "PERSON_NAME", "EMAIL", "PHONE_NUMBER", "ADDRESS", "DOB", "BANK_ACCOUNT",
  "FACE", "IFSC", "BYSTANDER_SCREEN",
];

export function defaultRisk(category: PiiCategory): Risk {
  if (HIGH.includes(category)) return "high";
  if (MEDIUM.includes(category)) return "medium";
  return "low";
}

export function defaultStyle(risk: Risk): "blackbox" | "pixelate" | "blur" {
  return risk === "low" ? "pixelate" : "blackbox";
}
```

(Only the `PII_CATEGORIES` array and `MEDIUM` array actually change —
`"BYSTANDER_SCREEN"` added to both. Shown in full so the diff is unambiguous.)

- [ ] **Step 5: Add `"detector"` to the provenance enum**

Edit `shared/src/contracts.ts:49` — change:

```typescript
  detected_by: z.array(z.enum(["dom", "ocr+ner", "regex", "face"])),
```

to:

```typescript
  detected_by: z.array(z.enum(["dom", "ocr+ner", "regex", "face", "detector"])),
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `pnpm test -- contracts.test.ts`
Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors. (This will surface any other place in `extension` that
exhaustively switches over `PiiCategory` or the `detected_by` union and needs
a new case — none currently do, per the codebase read during planning, but
verify.)

- [ ] **Step 8: Commit**

```bash
git add shared/src/categories.ts shared/src/contracts.ts shared/src/contracts.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): add BYSTANDER_SCREEN category and detector provenance

Prepares the redaction contract for yolos-tiny detector output: a phone/
laptop/tv detected in frame (someone else's device, possibly showing their
own screen) redacts as BYSTANDER_SCREEN (medium risk, blackbox); regions can
now be attributed to detected_by: "detector".

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire detector boxes into `fuseRegions`

**Files:**
- Modify: `extension/src/redaction/types.ts`
- Modify: `extension/src/redaction/fuse.ts`
- Test: `extension/src/redaction/fuse.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `extension/src/redaction/fuse.test.ts` (inside the existing
`describe("fuseRegions", ...)` block, as two more `it`s — keep the existing
`empty` fixture and its spread pattern):

```typescript
  it("redacts a detected cell phone / laptop / tv as BYSTANDER_SCREEN", () => {
    const inp: PerceptionInputs = {
      ...empty,
      detectorBoxes: [
        { label: "cell phone", bbox: [400, 40, 60, 100], score: 0.8 },
        { label: "laptop", bbox: [10, 200, 120, 80], score: 0.7 },
        { label: "chair", bbox: [0, 0, 20, 20], score: 0.9 }, // irrelevant label, ignored
      ],
    };
    const out = fuseRegions(inp);
    const bystander = out.filter((r) => r.category === "BYSTANDER_SCREEN");
    expect(bystander).toHaveLength(2);
    expect(bystander.every((r) => r.detected_by.includes("detector"))).toBe(true);
  });

  it("drops a low-confidence detector box", () => {
    const inp: PerceptionInputs = {
      ...empty,
      detectorBoxes: [{ label: "cell phone", bbox: [0, 0, 10, 10], score: 0.4 }],
    };
    expect(fuseRegions(inp).filter((r) => r.category === "BYSTANDER_SCREEN")).toHaveLength(0);
  });

  it("uses a detected person as a fallback FACE region only when MediaPipe found none", () => {
    const withFallback = fuseRegions({
      ...empty,
      faces: [],
      detectorBoxes: [{ label: "person", bbox: [50, 50, 80, 120], score: 0.7 }],
    });
    expect(withFallback.filter((r) => r.category === "FACE")).toHaveLength(1);
    expect(withFallback[0]!.detected_by).toEqual(["detector"]);

    const withoutFallback = fuseRegions({
      ...empty,
      faces: [[50, 50, 40, 40]],
      detectorBoxes: [{ label: "person", bbox: [50, 50, 80, 120], score: 0.7 }],
    });
    // one real MediaPipe face, no extra region from the redundant person box
    expect(withoutFallback.filter((r) => r.category === "FACE")).toHaveLength(1);
    expect(withoutFallback[0]!.detected_by).toEqual(["face"]);
  });

  it("ignores a person box when no faces and no detector boxes are given (default empty array)", () => {
    expect(fuseRegions(empty).filter((r) => r.category === "FACE")).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm test -- fuse.test.ts`
Expected: FAIL — `detectorBoxes` doesn't exist on `PerceptionInputs` yet
(TypeScript error surfaced as a test-file load failure), and even once typed,
`fuseRegions` doesn't read it.

- [ ] **Step 3: Add `detectorBoxes` to `PerceptionInputs`**

Edit `extension/src/redaction/types.ts` — add one field and widen
`DetectedBy`:

```typescript
import type { BBox, PiiCategory, Region } from "@sentrylens/shared";

export type DetectedBy = "dom" | "ocr+ner" | "regex" | "face" | "detector";

export interface SensitiveRegion {
  bbox: BBox;
  category: PiiCategory;
  value: string | null;          // null for FACE
  confidence: number;            // 0..1
  detected_by: DetectedBy[];
}

export interface DetectorBox {
  label: string;
  bbox: BBox;
  score: number;
}

export interface PerceptionInputs {
  regions: Region[];             // from the DOM walk
  domSensitive: SensitiveRegion[];
  faces: BBox[];
  ocrWords: { text: string; bbox: BBox }[];
  nerSpans: { category: PiiCategory; value: string; start: number; end: number }[];
  ocrJoined: string;             // ocrWords joined by " " (offsets align to nerSpans)
  ocrOffsets: number[];          // start offset of each word in ocrJoined
  pageSensitive: boolean;
  detectorBoxes?: DetectorBox[]; // yolos-tiny COCO boxes, image px; optional, defaults to []
}
```

`DetectorBox` is a minimal local shape (not imported from
`perception/detector.ts`) so `fuse.ts` stays decoupled from the ONNX runtime
module — matches how this file already treats `ocrWords`/`nerSpans` as
plain data, not imports from the model modules that produce them.

- [ ] **Step 4: Implement the fusion logic**

Edit `extension/src/redaction/fuse.ts`. Add the label set as a top-level
const (near `PREC`), add `"BYSTANDER_SCREEN"` to the `PREC` precedence array
right after `"FACE"`, and add the detector loop inside `fuseRegions` right
after the existing `faces` loop:

```typescript
import type { PiiCategory } from "@sentrylens/shared";
import { iou, unionBox } from "./geometry.js";
import { findStructuredPii } from "./validators.js";
import type { PerceptionInputs, SensitiveRegion } from "./types.js";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9@.]/g, "");

function wordsForSpan(inp: PerceptionInputs, start: number, end: number, value?: string) {
  const boxes = [];
  for (let i = 0; i < inp.ocrWords.length; i++) {
    const wStart = inp.ocrOffsets[i]!;
    const wEnd = wStart + inp.ocrWords[i]!.text.length;
    if (wStart < end && wEnd > start) boxes.push(inp.ocrWords[i]!.bbox);
  }
  if (boxes.length === 0 && value) {
    const want = value.split(/\s+/).map(norm).filter((t) => t.length > 1);
    if (want.length) {
      for (const w of inp.ocrWords) if (want.includes(norm(w.text))) boxes.push(w.bbox);
    }
  }
  return boxes;
}

const PREC: PiiCategory[] = [
  "PASSWORD", "AADHAAR", "CREDIT_CARD", "PAN", "API_KEY", "GOV_ID", "IFSC",
  "BANK_ACCOUNT", "EMAIL", "PHONE_NUMBER", "DOB", "ADDRESS", "PERSON_NAME",
  "IP_ADDRESS", "FACE", "BYSTANDER_SCREEN", "OTHER",
];
const prec = (c: PiiCategory) => { const i = PREC.indexOf(c); return i < 0 ? PREC.length : i; };

// COCO classes yolos-tiny can report that indicate someone else's device
// (and possibly their own screen) is visible in frame — not PII itself, but
// a privacy-relevant redaction the DOM/OCR/face signals can't catch.
const BYSTANDER_LABELS = new Set(["cell phone", "laptop", "tv"]);
const DETECTOR_MIN_SCORE = 0.5;

export function fuseRegions(inp: PerceptionInputs): SensitiveRegion[] {
  const raw: SensitiveRegion[] = [];

  for (const d of inp.domSensitive) raw.push(d);

  for (const f of inp.faces) {
    raw.push({ bbox: f, category: "FACE", value: null, confidence: inp.pageSensitive ? 0.95 : 0.8, detected_by: ["face"] });
  }

  // yolos-tiny is supplementary: bystander devices are never a PII source of
  // truth (no value to redact, positional-only), and a detected person only
  // fills in when MediaPipe found zero faces — it must never double-count a
  // face MediaPipe already caught.
  for (const d of inp.detectorBoxes ?? []) {
    if (d.score < DETECTOR_MIN_SCORE) continue;
    if (BYSTANDER_LABELS.has(d.label)) {
      raw.push({ bbox: d.bbox, category: "BYSTANDER_SCREEN", value: null, confidence: d.score, detected_by: ["detector"] });
    } else if (d.label === "person" && inp.faces.length === 0) {
      raw.push({ bbox: d.bbox, category: "FACE", value: null, confidence: Math.min(0.6, d.score), detected_by: ["detector"] });
    }
  }

  for (const span of inp.nerSpans) {
    const boxes = wordsForSpan(inp, span.start, span.end, span.value);
    if (boxes.length === 0) continue;
    raw.push({ bbox: unionBox(boxes), category: span.category, value: span.value, confidence: 0.75, detected_by: ["ocr+ner"] });
  }

  for (const hit of findStructuredPii(inp.ocrJoined)) {
    const boxes = wordsForSpan(inp, hit.start, hit.end);
    if (boxes.length === 0) continue;
    raw.push({ bbox: unionBox(boxes), category: hit.category, value: hit.value, confidence: 0.9, detected_by: ["regex"] });
  }

  const out: SensitiveRegion[] = [];
  for (const r of raw) {
    const hit = out.find((o) => iou(o.bbox, r.bbox) > 0.6);
    if (!hit) { out.push({ ...r, detected_by: [...r.detected_by] }); continue; }
    for (const s of r.detected_by) if (!hit.detected_by.includes(s)) hit.detected_by.push(s);
    hit.confidence = Math.max(hit.confidence, r.confidence);
    if (prec(r.category) < prec(hit.category)) { hit.category = r.category; hit.value = r.value; }
  }
  return out;
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm test -- fuse.test.ts`
Expected: PASS, all cases including the 4 new ones.

- [ ] **Step 6: Run the full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all green — confirms nothing else assumed `detected_by` was
exhaustively 4 values.

- [ ] **Step 7: Commit**

```bash
git add extension/src/redaction/types.ts extension/src/redaction/fuse.ts extension/src/redaction/fuse.test.ts
git commit -m "$(cat <<'EOF'
feat(redaction): fuse yolos-tiny detector boxes into sensitive regions

Detected cell phone/laptop/tv boxes redact as BYSTANDER_SCREEN (someone
else's device, possibly showing their own screen, visible in frame — a
signal neither DOM nor OCR/NER can see). A detected person box becomes a
fallback FACE region, but only on steps where MediaPipe found zero faces,
so it can never duplicate a real face hit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Thread `detectorBoxes` through `assemblePerception`

**Files:**
- Modify: `extension/src/perception/pipeline.ts`
- Test: `extension/src/perception/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `extension/src/perception/pipeline.test.ts` (new `it` inside the
existing `describe` block):

```typescript
  it("passes detectorBoxes through to fusion as BYSTANDER_SCREEN", () => {
    const result = assemblePerception({
      task: "open the report",
      image: { w: 200, h: 200, dpr: 1 },
      domRegions: [],
      domSensitive: [],
      faces: [],
      ocrWords: [],
      ocrJoined: "",
      ocrOffsets: [],
      nerSpans: [],
      degraded: false,
      detectorBoxes: [{ label: "laptop", bbox: [10, 10, 50, 40], score: 0.9 }],
    });
    const cats = result.classified.map((r) => r.category);
    expect(cats).toEqual(["BYSTANDER_SCREEN"]);
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm test -- pipeline.test.ts`
Expected: FAIL — `detectorBoxes` is not a recognised property of
`AssembleArgs` (TypeScript compile error at test load).

- [ ] **Step 3: Add `detectorBoxes` to `AssembleArgs` and pass it through**

Edit `extension/src/perception/pipeline.ts`:

```typescript
import type { Region, RedactionManifest, PiiCategory } from "@sentrylens/shared";
import { fuseRegions } from "../redaction/fuse.js";
import { classify, type ClassifiedRegion } from "../redaction/classify.js";
import { buildManifest, type ElementInput } from "../redaction/manifest.js";
import { MappingTable } from "../redaction/mapping.js";
import { viewportToImage } from "../redaction/geometry.js";
import type { DetectorBox } from "../redaction/types.js";

export interface AssembleArgs {
  task: string;
  image: { w: number; h: number; dpr: number };
  domRegions: Region[];
  domSensitive: { bbox: [number, number, number, number]; category: PiiCategory }[];
  faces: [number, number, number, number][];
  ocrWords: { text: string; bbox: [number, number, number, number] }[];
  ocrJoined: string;
  ocrOffsets: number[];
  nerSpans: { category: PiiCategory; value: string; start: number; end: number }[];
  degraded: boolean;
  mapping?: MappingTable;
  detectorBoxes?: DetectorBox[];
}

export interface AssembleResult {
  classified: ClassifiedRegion[];
  manifest: RedactionManifest;
  mapping: MappingTable;
}

export function assemblePerception(args: AssembleArgs): AssembleResult {
  const mapping = args.mapping ?? new MappingTable();
  const dpr = args.image.dpr;

  // DOM/face bboxes are CSS px; OCR/detector bboxes are already image px.
  const domRegionsImg: Region[] = args.domRegions.map((r) => ({ ...r, bbox: viewportToImage(r.bbox, dpr) }));
  const domSensitiveImg = args.domSensitive.map((d) => ({
    bbox: viewportToImage(d.bbox, dpr), category: d.category, value: null, confidence: 1, detected_by: ["dom" as const],
  }));
  const facesImg = args.faces.map((f) => viewportToImage(f, dpr));

  const fused = fuseRegions({
    regions: domRegionsImg,
    domSensitive: domSensitiveImg,
    faces: facesImg,
    ocrWords: args.ocrWords,
    nerSpans: args.nerSpans,
    ocrJoined: args.ocrJoined,
    ocrOffsets: args.ocrOffsets,
    pageSensitive: args.domSensitive.some((d) => d.category === "PASSWORD"),
    detectorBoxes: args.detectorBoxes,
  });

  const classified = fused.map((r) => classify(r, args.task, domRegionsImg));

  const elements: ElementInput[] = domRegionsImg.map((r) => ({
    id: r.id, bbox: r.bbox, role: r.role, text: r.name, interactable: r.interactable,
  }));

  const manifest = buildManifest({ image: args.image, elements, redacted: classified, mapping, degraded: args.degraded });
  return { classified, manifest, mapping };
}
```

Detector boxes are already image px (produced from the raw screenshot, same
as OCR words), so no `viewportToImage` transform is applied — matches the
existing comment on that line.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test -- pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add extension/src/perception/pipeline.ts extension/src/perception/pipeline.test.ts
git commit -m "$(cat <<'EOF'
feat(perception): thread detectorBoxes through assemblePerception

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Capture detector output in the offscreen document

**Files:**
- Modify: `extension/entrypoints/offscreen/main.ts`

No unit test here — this file is Chrome-API-heavy (offscreen document
messaging) and untested today by design (verified via the live Chrome demo
per `docs/DEMO.md`, same pattern as the rest of this file). Verify by
typecheck + the manual smoke check in Step 3.

- [ ] **Step 1: Capture and pass through the detector result**

Edit `extension/entrypoints/offscreen/main.ts`. Two changes: declare a
`detections` variable alongside the other perception outputs, and capture
`runDetector`'s return value instead of discarding it. Full relevant section
(everything else in the file is unchanged):

```typescript
      let degraded = false;
      let ocr = { words: [] as { text: string; bbox: [number, number, number, number] }[], joined: "", offsets: [] as number[] };
      let nerSpans: { category: PiiCategory; value: string; start: number; end: number }[] = [];
      let faces: [number, number, number, number][] = [];
      let detections: { label: string; bbox: [number, number, number, number]; score: number }[] = [];
      let screenSummaryText = "";
```

and:

```typescript
      // yolos-tiny is a generic COCO detector, not a PII signal on its own —
      // supplementary, and its transformers.js API keeps shifting. Never let
      // it degrade the privacy result; its output only adds BYSTANDER_SCREEN
      // regions and a fallback FACE box (see fuse.ts), it never removes one.
      await tryStep("detector", async () => { await initDetector(device); detections = await runDetector(png); }, { optional: true });
```

Then pass it into `assemblePerception`'s call (the `const { manifest } =
assemblePerception({...})` block) by adding one line:

```typescript
      const { manifest } = assemblePerception({
        task,
        image: {
          w: regionList.viewport.w * regionList.viewport.dpr,
          h: regionList.viewport.h * regionList.viewport.dpr,
          dpr: regionList.viewport.dpr,
        },
        domRegions: regionList.regions,
        domSensitive: domSensitive.map((d: { bbox: [number, number, number, number]; category: string }) => ({ bbox: d.bbox, category: d.category as PiiCategory })),
        faces,
        ocrWords: ocr.words,
        ocrJoined: ocr.joined,
        ocrOffsets: ocr.offsets,
        nerSpans,
        degraded,
        mapping: session,
        detectorBoxes: detections,
      });
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Manual smoke check in the live Chrome demo**

Follow `docs/DEMO.md`'s steps to run the extension against
`demo/demo-dashboard.html` (server in `MOCK=1`, extension loaded unpacked).
After a run, expand a step's manifest JSON in the side panel and confirm:
- no `BYSTANDER_SCREEN` region appears (the demo roster page has no
  phone/laptop/tv/person imagery) — a non-result here is the expected,
  correct result, it proves the detector ran without introducing false
  positives on a page with nothing for it to catch.
- the console log line `[sentrylens] detector ok` (or `detector failed:` on
  a slow machine — it's `optional: true`, so a failure must not set
  `degraded`) appears in the offscreen document's DevTools console.

This is the honest verification available without a screenshot that actually
contains a phone/laptop/tv/person — full end-to-end proof of the
`BYSTANDER_SCREEN` path is exercised by `fuse.test.ts` (Task 3) at the unit
level; wiring it into a demo fixture is optional future work, not required
for this plan to be complete (the fixture page's job is to demonstrate PII
redaction, not object detection).

- [ ] **Step 4: Commit**

```bash
git add extension/entrypoints/offscreen/main.ts
git commit -m "$(cat <<'EOF'
feat(extension): capture yolos-tiny output instead of discarding it

Closes the gap found in the 2026-09-13 audit: the detector ran every step
but its result was never assigned to a variable, so it had zero effect on
redaction despite being listed as part of the perception stack. Now feeds
assemblePerception via the detectorBoxes param added in the previous commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update the test-count docs to match reality

**Files:**
- Modify: `README.md:61`
- Modify: `docs/DEMO.md` (if it cites a count — verify first)

- [ ] **Step 1: Get the true current test count**

Run: `pnpm test 2>&1 | tail -5`
Read the `Tests  N passed (N)` line for the real number (was 79 before this
plan added 8 more test cases across Tasks 2–4: 1 contracts + 4 fuse +
1 pipeline = 6 new tests, so expect ~85 — use the actual printed number, not
this estimate).

- [ ] **Step 2: Update README.md**

Edit `README.md:61` — replace the `63 unit tests` count (already stale
before this plan — the true pre-plan count was 79) with the number from
Step 1, keeping the rest of the line's wording unchanged:

```markdown
| `pnpm test` | N unit tests — contracts, Luhn/Verhoeff, mapping determinism + OCR-noise tolerance, signal fusion, manifest no-leak, mask planning, server parse/mock/endpoint, DOM walk, executor, agent loop, firewall rules |
```

(`N` = the real number from Step 1.)

- [ ] **Step 3: Commit the doc fix together with the pre-existing demo-hardening diff**

This repo already has an uncommitted, unrelated-to-this-plan diff touching
`.gitignore`, `demo/demo-dashboard.html`, and `docs/DEMO.md` (adds
Aadhaar/payroll-card rows and a real photo asset to the demo page — visible
in `git status` at the start of this plan). Fold the README count fix in
with that pre-existing group, since both are doc/demo housekeeping unrelated
to the code changes in Tasks 1–5:

```bash
git add README.md .gitignore demo/demo-dashboard.html docs/DEMO.md
git commit -m "$(cat <<'EOF'
chore(demo): harden demo page PII coverage, fix stale test count in README

Demo dashboard now includes Aadhaar and payroll-card rows and a real photo
(gitignored local asset, never published) alongside the existing
name/phone/email/PAN fields, so the live-Chrome leak check in docs/DEMO.md
exercises every high-risk category. README's test count was stale (cited 63,
already 79 before this plan's own additions).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Final verification**

Run: `pnpm test && pnpm typecheck && git status`
Expected: all tests pass, typecheck clean, `git status` shows a clean tree
except for the two untracked `.pptx` files and `docs/SIH-IDEA-PPT-content.md`
(out of scope for this plan — covered by the "make the pitch deck honest"
subsystem in the roadmap).

---

## Self-Review Notes

**Spec coverage:** commit pending NER fix (Task 1) done; wire yolos-tiny into
redaction (Tasks 2–5) done; keep docs truthful about test count (Task 6)
done. Deciding "wire up, don't remove" yolos-tiny (per the roadmap's framing
of the user's "wire up or remove" priority) is justified by giving it a real
signal (bystander screens) rather than deleting a working, if previously
disconnected, model integration.

**Placeholder scan:** no TBD/TODO markers; every step has complete code or an
exact command with expected output.

**Type consistency:** `DetectorBox` defined once in
`extension/src/redaction/types.ts` (Task 3) and imported (not redefined) in
`pipeline.ts` (Task 4) and referenced structurally (not imported, to avoid a
cross-boundary type dependency into the offscreen entrypoint) in Task 5's
inline `detections` type, which matches `DetectorBox`'s shape exactly
(`{label: string; bbox: [number,number,number,number]; score: number}`) —
consistent field names throughout (`label`, `bbox`, `score`; `detected_by`
not `detectedBy`, matching the existing snake_case-in-array convention seen
in `SensitiveRegion`).
