# SentryLens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working MV3 browser extension + thin server that lets an AI agent complete a multi-step web task while all screen perception and PII redaction happen on-device (WebGPU), so only an anonymised screenshot + typed redaction manifest ever reach the remote open-weight VLM.

**Architecture:** pnpm monorepo with three packages. `shared/` holds zod contracts used by both sides. `extension/` (WXT + TS + React) runs a DOM walk in the content script, WebGPU/WASM perception models in an offscreen document, a redaction engine that fuses DOM + vision + OCR + NER signals into masked pixels plus a manifest (keeping a value↔placeholder table that never leaves the device), and an agent loop in the background service worker. `server/` (Express + TS) is a provider-agnostic proxy that injects a redaction-aware system prompt, calls an OpenAI-compatible VLM (default OpenRouter Qwen2.5-VL, `MOCK=1` for offline), and returns one validated `AgentAction` per step.

**Tech Stack:** pnpm workspaces, TypeScript, zod, vitest; WXT, React 18; `@huggingface/transformers` v4, `onnxruntime-web`, `tesseract.js`, `@mediapipe/tasks-vision`; Express, `tsx`.

**Reference docs:** [design spec](../specs/2026-09-09-sentrylens-design.md) · [deep research report](../../../SIH26171_Deep_Research_Report.md)

**Conventions for every task:** work from repo root `D:\SIH 2026`. Run commands in Git Bash. TDD where logic is pure; for browser-integration tasks the "test" is a concrete manual verification with expected output. Commit after every task with the message shown. Never use `--no-verify`.

---

## Task 0: Monorepo scaffold

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.npmrc`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "shared"
  - "extension"
  - "server"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "sentrylens",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev:ext": "pnpm --filter @sentrylens/extension dev",
    "build:ext": "pnpm --filter @sentrylens/extension build",
    "dev:server": "pnpm --filter @sentrylens/server dev",
    "typecheck": "tsc -b --pretty"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "vitest": "2.1.8",
    "@types/node": "22.10.2"
  },
  "packageManager": "pnpm@11.5.1"
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "composite": true
  }
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "extension/src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Create `.npmrc`**

```
auto-install-peers=true
```

- [ ] **Step 6: Install and verify**

Run: `pnpm install`
Expected: completes with a lockfile written, no `ERR_PNPM` errors.

Run: `pnpm test`
Expected: `No test files found` (exit 0 or 1 is fine — confirms vitest resolves).

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json vitest.config.ts .npmrc pnpm-lock.yaml
git commit -m "chore: scaffold pnpm monorepo (typescript, vitest)"
```

---

## Task 1: `shared` package — zod contracts

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/categories.ts`
- Create: `shared/src/contracts.ts`
- Create: `shared/src/index.ts`
- Test: `shared/src/contracts.test.ts`

- [ ] **Step 1: Create `shared/package.json`**

```json
{
  "name": "@sentrylens/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "3.24.1" }
}
```

- [ ] **Step 2: Create `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `shared/src/categories.ts`**

```ts
export const PII_CATEGORIES = [
  "PERSON_NAME", "EMAIL", "PHONE_NUMBER", "ADDRESS", "DOB",
  "CREDIT_CARD", "AADHAAR", "PAN", "IFSC", "BANK_ACCOUNT", "PASSWORD",
  "API_KEY", "IP_ADDRESS", "FACE", "GOV_ID", "OTHER",
] as const;

export type PiiCategory = (typeof PII_CATEGORIES)[number];

export type Risk = "high" | "medium" | "low";

const HIGH: PiiCategory[] = ["PASSWORD", "CREDIT_CARD", "AADHAAR", "PAN", "GOV_ID", "API_KEY"];
const MEDIUM: PiiCategory[] = [
  "PERSON_NAME", "EMAIL", "PHONE_NUMBER", "ADDRESS", "DOB", "BANK_ACCOUNT", "FACE", "IFSC",
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

- [ ] **Step 4: Write the failing test `shared/src/contracts.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  RegionListSchema, RedactionManifestSchema, AgentActionSchema,
  ServerRequestSchema, ServerResponseSchema,
} from "./contracts.js";

describe("contracts", () => {
  it("accepts a valid RegionList", () => {
    const v = {
      url: "https://x.test/", viewport: { w: 1280, h: 800, dpr: 1 },
      regions: [{ id: 1, bbox: [0, 0, 10, 10], source: "dom", role: "button", name: "Login", interactable: true }],
    };
    expect(RegionListSchema.parse(v).regions[0].name).toBe("Login");
  });

  it("rejects a RegionList with a 3-tuple bbox", () => {
    const v = { url: "u", viewport: { w: 1, h: 1, dpr: 1 }, regions: [{ id: 1, bbox: [0, 0, 10], source: "dom", role: "b", name: "n", interactable: true }] };
    expect(() => RegionListSchema.parse(v)).toThrow();
  });

  it("parses each AgentAction variant and rejects an unknown type", () => {
    expect(AgentActionSchema.parse({ type: "click", target_id: 3, thought: "t" }).type).toBe("click");
    expect(AgentActionSchema.parse({ type: "type", target_id: 3, value: "PHONE_NUMBER#a1b2c", thought: "t" }).type).toBe("type");
    expect(AgentActionSchema.parse({ type: "done", answer: "ok", thought: "t" }).type).toBe("done");
    expect(() => AgentActionSchema.parse({ type: "teleport", thought: "t" })).toThrow();
  });

  it("requires manifest.notes and a literal schema tag", () => {
    const m = { schema: "sentrylens-redaction/1.0", image: { w: 10, h: 10, dpr: 1 }, regions: [], notes: "n" };
    expect(RedactionManifestSchema.parse(m).schema).toBe("sentrylens-redaction/1.0");
    expect(() => RedactionManifestSchema.parse({ ...m, schema: "wrong" })).toThrow();
    expect(() => RedactionManifestSchema.parse({ ...m, notes: undefined })).toThrow();
  });

  it("ServerRequest/Response round-trip", () => {
    const req = { task: "do x", image_b64: "AAAA", manifest: { schema: "sentrylens-redaction/1.0", image: { w: 1, h: 1, dpr: 1 }, regions: [], notes: "n" }, history: [] };
    expect(ServerRequestSchema.parse(req).task).toBe("do x");
    expect(ServerResponseSchema.parse({ action: { type: "done", answer: "a", thought: "t" } }).action.type).toBe("done");
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm vitest run shared/src/contracts.test.ts`
Expected: FAIL — `Cannot find module './contracts.js'`.

- [ ] **Step 6: Create `shared/src/contracts.ts`**

```ts
import { z } from "zod";
import { PII_CATEGORIES } from "./categories.js";

export const BBoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type BBox = z.infer<typeof BBoxSchema>;

export const ViewportSchema = z.object({ w: z.number(), h: z.number(), dpr: z.number() });

export const RegionSchema = z.object({
  id: z.number().int(),
  bbox: BBoxSchema,
  source: z.enum(["dom", "detector"]),
  role: z.string(),
  name: z.string(),
  domType: z.string().optional(),
  interactable: z.boolean(),
});
export type Region = z.infer<typeof RegionSchema>;

export const RegionListSchema = z.object({
  url: z.string(),
  viewport: ViewportSchema,
  regions: z.array(RegionSchema),
  screenSummary: z.string().optional(),
});
export type RegionList = z.infer<typeof RegionListSchema>;

export const PiiCategorySchema = z.enum(PII_CATEGORIES);

export const ElementRegionSchema = z.object({
  id: z.number().int(),
  bbox: BBoxSchema,
  kind: z.literal("element"),
  role: z.string(),
  text: z.string(),
  interactable: z.boolean(),
});

export const RedactedRegionSchema = z.object({
  id: z.number().int(),
  bbox: BBoxSchema,
  kind: z.literal("redacted"),
  category: PiiCategorySchema,
  placeholder: z.string(),
  value_len: z.number().int().nullable(),
  risk: z.enum(["high", "medium", "low"]),
  style: z.enum(["blackbox", "pixelate", "blur"]),
  task_necessary: z.boolean(),
  detected_by: z.array(z.enum(["dom", "ocr+ner", "regex", "face"])),
});
export type RedactedRegion = z.infer<typeof RedactedRegionSchema>;

export const ManifestRegionSchema = z.discriminatedUnion("kind", [
  ElementRegionSchema,
  RedactedRegionSchema,
]);

export const RedactionManifestSchema = z.object({
  schema: z.literal("sentrylens-redaction/1.0"),
  image: z.object({ w: z.number(), h: z.number(), dpr: z.number() }),
  regions: z.array(ManifestRegionSchema),
  notes: z.string(),
});
export type RedactionManifest = z.infer<typeof RedactionManifestSchema>;

export const AgentActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), target_id: z.number().int(), thought: z.string() }),
  z.object({ type: z.literal("type"), target_id: z.number().int(), value: z.string(), thought: z.string() }),
  z.object({ type: z.literal("scroll"), direction: z.enum(["up", "down"]), amount: z.number().optional(), thought: z.string() }),
  z.object({ type: z.literal("wait"), ms: z.number(), thought: z.string() }),
  z.object({ type: z.literal("done"), answer: z.string(), thought: z.string() }),
  z.object({ type: z.literal("fail"), reason: z.string(), thought: z.string() }),
]);
export type AgentAction = z.infer<typeof AgentActionSchema>;

export const StepRecordSchema = z.object({ action: AgentActionSchema, observation: z.string() });
export type StepRecord = z.infer<typeof StepRecordSchema>;

export const ServerRequestSchema = z.object({
  task: z.string(),
  image_b64: z.string(),
  manifest: RedactionManifestSchema,
  history: z.array(StepRecordSchema),
});
export type ServerRequest = z.infer<typeof ServerRequestSchema>;

export const ServerResponseSchema = z.object({
  action: AgentActionSchema,
  raw: z.string().optional(),
});
export type ServerResponse = z.infer<typeof ServerResponseSchema>;
```

- [ ] **Step 7: Create `shared/src/index.ts`**

```ts
export * from "./categories.js";
export * from "./contracts.js";
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run shared/src/contracts.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 9: Commit**

```bash
git add shared vitest.config.ts pnpm-lock.yaml
git commit -m "feat(shared): zod contracts and PII category tables"
```

---

## Task 2: Redaction validators (Luhn, Verhoeff, regex)

**Files:**
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`
- Create: `extension/src/redaction/validators.ts`
- Test: `extension/src/redaction/validators.test.ts`

- [ ] **Step 1: Create `extension/package.json`**

```json
{
  "name": "@sentrylens/extension",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build"
  },
  "dependencies": {
    "@sentrylens/shared": "workspace:*",
    "@huggingface/transformers": "3.7.1",
    "onnxruntime-web": "1.20.1",
    "tesseract.js": "5.1.1",
    "@mediapipe/tasks-vision": "0.10.20",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "zod": "3.24.1"
  },
  "devDependencies": {
    "wxt": "0.19.13",
    "@wxt-dev/module-react": "1.1.3",
    "@types/react": "18.3.12",
    "@types/react-dom": "18.3.1",
    "@types/chrome": "0.0.287"
  }
}
```

- [ ] **Step 2: Create `extension/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["chrome", "node"],
    "composite": false
  },
  "include": ["src", "entrypoints", "wxt.config.ts"]
}
```

- [ ] **Step 3: Write the failing test `extension/src/redaction/validators.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { luhnValid, verhoeffValid, findStructuredPii } from "./validators.js";

describe("luhnValid", () => {
  it("accepts a known-good test card", () => expect(luhnValid("4111111111111111")).toBe(true));
  it("accepts a card with spaces", () => expect(luhnValid("4111 1111 1111 1111")).toBe(true));
  it("rejects a bad checksum", () => expect(luhnValid("4111111111111112")).toBe(false));
  it("rejects a random 16-digit order id", () => expect(luhnValid("1234567890123456")).toBe(false));
});

describe("verhoeffValid", () => {
  // 234123412346 is a Verhoeff-valid 12-digit string (checksum digit 6).
  it("accepts a valid 12-digit Aadhaar-shaped number", () => expect(verhoeffValid("234123412346")).toBe(true));
  it("rejects a wrong check digit", () => expect(verhoeffValid("234123412340")).toBe(false));
  it("rejects non-12-digit input", () => expect(verhoeffValid("12345")).toBe(false));
});

describe("findStructuredPii", () => {
  it("finds an email", () => {
    const hits = findStructuredPii("contact ops.lead@vssc.test now");
    expect(hits).toContainEqual(expect.objectContaining({ category: "EMAIL", value: "ops.lead@vssc.test" }));
  });
  it("finds a PAN", () => {
    const hits = findStructuredPii("PAN ABCDE1234F on file");
    expect(hits).toContainEqual(expect.objectContaining({ category: "PAN", value: "ABCDE1234F" }));
  });
  it("finds an IFSC", () => {
    expect(findStructuredPii("SBIN0001234")).toContainEqual(expect.objectContaining({ category: "IFSC", value: "SBIN0001234" }));
  });
  it("only flags a 16-digit run as CREDIT_CARD when Luhn passes", () => {
    expect(findStructuredPii("id 1234567890123456").some((h) => h.category === "CREDIT_CARD")).toBe(false);
    expect(findStructuredPii("card 4111 1111 1111 1111").some((h) => h.category === "CREDIT_CARD")).toBe(true);
  });
  it("only flags a 12-digit run as AADHAAR when Verhoeff passes", () => {
    expect(findStructuredPii("num 234123412340").some((h) => h.category === "AADHAAR")).toBe(false);
    expect(findStructuredPii("uid 2341 2341 2346").some((h) => h.category === "AADHAAR")).toBe(true);
  });
  it("returns char offsets", () => {
    const [hit] = findStructuredPii("x a@b.co");
    expect(hit.start).toBe(2);
    expect(hit.end).toBe(8);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run extension/src/redaction/validators.test.ts`
Expected: FAIL — `Cannot find module './validators.js'`.

- [ ] **Step 5: Create `extension/src/redaction/validators.ts`**

```ts
import type { PiiCategory } from "@sentrylens/shared";

export interface StructuredHit {
  category: PiiCategory;
  value: string;
  start: number;
  end: number;
}

export function luhnValid(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

// Verhoeff checksum (used by Aadhaar). Tables per the standard.
const D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];
const P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
];

export function verhoeffValid(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  if (digits.length !== 12) return false;
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = D[c]![P[i % 8]![Number(reversed[i])]!]!;
  }
  return c === 0;
}

interface Rule { category: PiiCategory; re: RegExp; check?: (m: string) => boolean }

const RULES: Rule[] = [
  { category: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { category: "PAN", re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
  { category: "IFSC", re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  { category: "IP_ADDRESS", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { category: "CREDIT_CARD", re: /\b(?:\d[ -]?){13,19}\b/g, check: luhnValid },
  { category: "AADHAAR", re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, check: verhoeffValid },
  { category: "PHONE_NUMBER", re: /(?:\+91[- ]?)?\b[6-9]\d{9}\b|\+\d{1,3}[- ]?\d{6,12}/g },
  { category: "API_KEY", re: /\b(?:sk|pk|ghp|xox[bp])[-_][A-Za-z0-9]{16,}\b/g },
];

export function findStructuredPii(text: string): StructuredHit[] {
  const hits: StructuredHit[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      const value = m[0];
      if (rule.check && !rule.check(value)) continue;
      hits.push({ category: rule.category, value, start: m.index, end: m.index + value.length });
    }
  }
  return hits;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run extension/src/redaction/validators.test.ts`
Expected: PASS. If the Verhoeff sample fails, compute a correct 12-digit sample with `verhoeffValid` in a scratch script and update the test literal — do not weaken the algorithm.

- [ ] **Step 7: Commit**

```bash
git add extension/package.json extension/tsconfig.json extension/src/redaction/validators.ts extension/src/redaction/validators.test.ts pnpm-lock.yaml
git commit -m "feat(redaction): Luhn/Verhoeff checksums and structured PII regex"
```

---

## Task 3: Placeholder mapping table

**Files:**
- Create: `extension/src/redaction/mapping.ts`
- Test: `extension/src/redaction/mapping.test.ts`

- [ ] **Step 1: Write the failing test `extension/src/redaction/mapping.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { MappingTable } from "./mapping.js";

describe("MappingTable", () => {
  it("returns the same placeholder for the same value", () => {
    const t = new MappingTable();
    const a = t.placeholderFor("PHONE_NUMBER", "9000000000");
    const b = t.placeholderFor("PHONE_NUMBER", "9000000000");
    expect(a).toBe(b);
    expect(a).toMatch(/^PHONE_NUMBER#[a-z0-9]{5}$/);
  });

  it("normalises whitespace/case for names before hashing", () => {
    const t = new MappingTable();
    expect(t.placeholderFor("PERSON_NAME", "  Anita   Rao ")).toBe(t.placeholderFor("PERSON_NAME", "anita rao"));
  });

  it("normalises to digits for numeric categories", () => {
    const t = new MappingTable();
    expect(t.placeholderFor("AADHAAR", "2341 2341 2346")).toBe(t.placeholderFor("AADHAAR", "234123412346"));
  });

  it("reuses a placeholder for an OCR-noisy near-match (Levenshtein <= 2)", () => {
    const t = new MappingTable();
    const p = t.placeholderFor("PERSON_NAME", "anita rao");
    expect(t.placeholderFor("PERSON_NAME", "an1ta rao")).toBe(p);
  });

  it("resolves a placeholder back to the real value", () => {
    const t = new MappingTable();
    const p = t.placeholderFor("EMAIL", "ops@vssc.test");
    expect(t.resolve(p)).toBe("ops@vssc.test");
    expect(t.resolveAll(`login ${p} now`)).toBe("login ops@vssc.test now");
  });

  it("two tables with different session keys produce different placeholders", () => {
    expect(new MappingTable().placeholderFor("EMAIL", "a@b.co"))
      .not.toBe(new MappingTable().placeholderFor("EMAIL", "a@b.co"));
  });

  it("clear() drops all entries", () => {
    const t = new MappingTable();
    const p = t.placeholderFor("EMAIL", "a@b.co");
    t.clear();
    expect(t.resolve(p)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run extension/src/redaction/mapping.test.ts`
Expected: FAIL — `Cannot find module './mapping.js'`.

- [ ] **Step 3: Create `extension/src/redaction/mapping.ts`**

```ts
import type { PiiCategory } from "@sentrylens/shared";

const NUMERIC: PiiCategory[] = ["PHONE_NUMBER", "AADHAAR", "CREDIT_CARD", "BANK_ACCOUNT", "IP_ADDRESS", "GOV_ID"];

function normalise(category: PiiCategory, value: string): string {
  if (NUMERIC.includes(category)) return value.replace(/\D/g, "");
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[m]![n]!;
}

function b32(bytes: Uint8Array, len: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let out = "", bits = 0, val = 0;
  for (const byte of bytes) {
    val = (val << 8) | byte; bits += 8;
    while (bits >= 5) { out += alphabet[(val >>> (bits - 5)) & 31]; bits -= 5; }
    if (out.length >= len) break;
  }
  return out.slice(0, len);
}

/**
 * Session-scoped, deterministic-within-session mapping between real values and
 * anonymised placeholders. Keyed by random session bytes so placeholders are
 * unlinkable across runs. Uses a fast non-crypto keyed hash: the goal is
 * cross-session unlinkability, not resistance to an attacker who already owns
 * the device (they can read the table itself). The table never leaves the
 * offscreen document.
 */
export class MappingTable {
  private readonly seed = crypto.getRandomValues(new Uint32Array(4));
  private readonly byPlaceholder = new Map<string, string>();      // placeholder -> value
  private readonly byNorm = new Map<string, string>();             // normValue  -> placeholder

  private hash5(category: PiiCategory, norm: string): string {
    let h0 = this.seed[0]! ^ 0x9e3779b9, h1 = this.seed[1]! ^ 0x85ebca6b;
    const s = `${category}:${norm}`;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h0 = Math.imul(h0 ^ c, 2654435761) >>> 0;
      h1 = Math.imul(h1 ^ c, 1597334677) >>> 0;
    }
    const bytes = new Uint8Array([h0 & 255, (h0 >>> 8) & 255, (h0 >>> 16) & 255, h1 & 255, (h1 >>> 8) & 255, (h1 >>> 16) & 255]);
    return b32(bytes, 5);
  }

  placeholderFor(category: PiiCategory, value: string): string {
    const norm = normalise(category, value);
    const existing = this.byNorm.get(norm);
    if (existing) return existing;
    for (const [k, p] of this.byNorm) {
      if (Math.abs(k.length - norm.length) <= 2 && levenshtein(k, norm) <= 2 && p.startsWith(category + "#")) {
        this.byNorm.set(norm, p);
        return p;
      }
    }
    const placeholder = `${category}#${this.hash5(category, norm)}`;
    this.byNorm.set(norm, placeholder);
    this.byPlaceholder.set(placeholder, value.trim());
    return placeholder;
  }

  resolve(placeholder: string): string | undefined {
    return this.byPlaceholder.get(placeholder);
  }

  resolveAll(text: string): string {
    return text.replace(/[A-Z_]+#[a-z0-9]{5}/g, (m) => this.byPlaceholder.get(m) ?? m);
  }

  clear(): void {
    this.byPlaceholder.clear();
    this.byNorm.clear();
  }
}
```

> Reviewer note: `crypto.getRandomValues` exists in the offscreen document and in vitest's node environment (Node 24 exposes `globalThis.crypto`). No polyfill needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run extension/src/redaction/mapping.test.ts`
Expected: PASS — 7 tests. The `b32` alphabet is `[a-z2-7]`, a subset of `[a-z0-9]`, so the regex `^PHONE_NUMBER#[a-z0-9]{5}$` matches.

- [ ] **Step 5: Commit**

```bash
git add extension/src/redaction/mapping.ts extension/src/redaction/mapping.test.ts
git commit -m "feat(redaction): session-scoped value<->placeholder mapping table"
```

---

## Task 4: Region fusion + classification

**Files:**
- Create: `extension/src/redaction/types.ts`
- Create: `extension/src/redaction/geometry.ts`
- Create: `extension/src/redaction/fuse.ts`
- Create: `extension/src/redaction/classify.ts`
- Test: `extension/src/redaction/fuse.test.ts`

- [ ] **Step 1: Create `extension/src/redaction/types.ts`**

```ts
import type { BBox, PiiCategory, Region } from "@sentrylens/shared";

export type DetectedBy = "dom" | "ocr+ner" | "regex" | "face";

export interface SensitiveRegion {
  bbox: BBox;
  category: PiiCategory;
  value: string | null;          // null for FACE
  confidence: number;            // 0..1
  detected_by: DetectedBy[];
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
}
```

- [ ] **Step 2: Create `extension/src/redaction/geometry.ts`**

```ts
import type { BBox } from "@sentrylens/shared";

export function iou(a: BBox, b: BBox): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx), y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw), y2 = Math.min(ay + ah, by + bh);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = aw * ah + bw * bh - inter;
  return union <= 0 ? 0 : inter / union;
}

export function unionBox(boxes: BBox[]): BBox {
  const x1 = Math.min(...boxes.map((b) => b[0]));
  const y1 = Math.min(...boxes.map((b) => b[1]));
  const x2 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y2 = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x1, y1, x2 - x1, y2 - y1];
}

// DOM bboxes are CSS px; the screenshot is device px. Multiply by dpr before
// masking and before writing bboxes into the manifest.
export function viewportToImage(bbox: BBox, dpr: number): BBox {
  return [bbox[0] * dpr, bbox[1] * dpr, bbox[2] * dpr, bbox[3] * dpr];
}
```

- [ ] **Step 3: Write the failing test `extension/src/redaction/fuse.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fuseRegions } from "./fuse.js";
import { classify } from "./classify.js";
import type { PerceptionInputs } from "./types.js";

const empty: PerceptionInputs = {
  regions: [], domSensitive: [], faces: [], ocrWords: [], nerSpans: [],
  ocrJoined: "", ocrOffsets: [], pageSensitive: false,
};

describe("fuseRegions", () => {
  it("keeps a DOM password and an NER name and a face as three regions", () => {
    const inp: PerceptionInputs = {
      ...empty,
      domSensitive: [{ bbox: [10, 10, 100, 20], category: "PASSWORD", value: null, confidence: 1, detected_by: ["dom"] }],
      faces: [[300, 40, 60, 60]],
      ocrWords: [{ text: "Anita", bbox: [10, 80, 40, 16] }, { text: "Rao", bbox: [52, 80, 30, 16] }],
      ocrJoined: "Anita Rao",
      ocrOffsets: [0, 6],
      nerSpans: [{ category: "PERSON_NAME", value: "Anita Rao", start: 0, end: 9 }],
    };
    const out = fuseRegions(inp);
    const cats = out.map((r) => r.category).sort();
    expect(cats).toEqual(["FACE", "PASSWORD", "PERSON_NAME"]);
    const name = out.find((r) => r.category === "PERSON_NAME")!;
    expect(name.bbox).toEqual([10, 80, 72, 16]); // union of the two words
  });

  it("dedupes an NER hit and a regex hit on the same email (IoU>0.6) into one region with both sources", () => {
    const inp: PerceptionInputs = {
      ...empty,
      ocrWords: [{ text: "ops@vssc.test", bbox: [10, 10, 120, 16] }],
      ocrJoined: "ops@vssc.test",
      ocrOffsets: [0],
      nerSpans: [{ category: "EMAIL", value: "ops@vssc.test", start: 0, end: 13 }],
    };
    const out = fuseRegions(inp);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("EMAIL");
    expect(out[0].detected_by.sort()).toEqual(["ocr+ner", "regex"]);
  });

  it("promotes a face to high confidence when the page is sensitive", () => {
    const out = fuseRegions({ ...empty, faces: [[0, 0, 10, 10]], pageSensitive: true });
    expect(out[0].confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe("classify", () => {
  it("marks PASSWORD as high risk regardless of task", () => {
    const r = classify({ bbox: [0, 0, 1, 1], category: "PASSWORD", value: null, confidence: 1, detected_by: ["dom"] }, "browse news", []);
    expect(r.risk).toBe("high");
  });

  it("sets task_necessary when the task text overlaps a nearby element name", () => {
    const r = classify(
      { bbox: [10, 10, 50, 10], category: "PHONE_NUMBER", value: "9000000000", confidence: 1, detected_by: ["regex"] },
      "call the duty officer",
      [{ id: 1, bbox: [10, 8, 60, 14], source: "dom", role: "textbox", name: "duty officer phone", interactable: true }],
    );
    expect(r.task_necessary).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run extension/src/redaction/fuse.test.ts`
Expected: FAIL — `Cannot find module './fuse.js'`.

- [ ] **Step 5: Create `extension/src/redaction/fuse.ts`**

```ts
import type { PiiCategory } from "@sentrylens/shared";
import { iou, unionBox } from "./geometry.js";
import { findStructuredPii } from "./validators.js";
import type { PerceptionInputs, SensitiveRegion } from "./types.js";

function wordsForSpan(inp: PerceptionInputs, start: number, end: number) {
  const boxes = [];
  for (let i = 0; i < inp.ocrWords.length; i++) {
    const wStart = inp.ocrOffsets[i]!;
    const wEnd = wStart + inp.ocrWords[i]!.text.length;
    if (wStart < end && wEnd > start) boxes.push(inp.ocrWords[i]!.bbox);
  }
  return boxes;
}

const PREC: PiiCategory[] = [
  "PASSWORD", "AADHAAR", "CREDIT_CARD", "PAN", "API_KEY", "GOV_ID", "IFSC",
  "BANK_ACCOUNT", "EMAIL", "PHONE_NUMBER", "DOB", "ADDRESS", "PERSON_NAME",
  "IP_ADDRESS", "FACE", "OTHER",
];
const prec = (c: PiiCategory) => { const i = PREC.indexOf(c); return i < 0 ? PREC.length : i; };

export function fuseRegions(inp: PerceptionInputs): SensitiveRegion[] {
  const raw: SensitiveRegion[] = [];

  for (const d of inp.domSensitive) raw.push(d);

  for (const f of inp.faces) {
    raw.push({ bbox: f, category: "FACE", value: null, confidence: inp.pageSensitive ? 0.95 : 0.8, detected_by: ["face"] });
  }

  for (const span of inp.nerSpans) {
    const boxes = wordsForSpan(inp, span.start, span.end);
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

- [ ] **Step 6: Create `extension/src/redaction/classify.ts`**

```ts
import type { Region } from "@sentrylens/shared";
import { defaultRisk, defaultStyle } from "@sentrylens/shared";
import { iou } from "./geometry.js";
import type { SensitiveRegion } from "./types.js";

export interface ClassifiedRegion extends SensitiveRegion {
  risk: "high" | "medium" | "low";
  style: "blackbox" | "pixelate" | "blur";
  task_necessary: boolean;
}

const STOP = new Set(["the", "a", "an", "to", "of", "and", "for", "on", "in", "my", "please", "then", "with"]);

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
}

function overlapsLoosely(a: readonly number[], b: readonly number[]): boolean {
  const [ax, ay, aw, ah] = a as number[];
  const [bx, by, bw, bh] = b as number[];
  const pad = 12;
  return ax < bx + bw + pad && ax + aw + pad > bx && ay < by + bh + pad && ay + ah + pad > by;
}

export function classify(region: SensitiveRegion, task: string, regions: Region[]): ClassifiedRegion {
  const risk = defaultRisk(region.category);
  const style = defaultStyle(risk);

  const taskTokens = new Set(tokens(task));
  let task_necessary = false;
  for (const el of regions) {
    if (iou(el.bbox, region.bbox) > 0.3 || overlapsLoosely(el.bbox, region.bbox)) {
      if (tokens(el.name).some((t) => taskTokens.has(t))) { task_necessary = true; break; }
    }
  }
  return { ...region, risk, style, task_necessary };
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run extension/src/redaction/fuse.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 8: Commit**

```bash
git add extension/src/redaction/types.ts extension/src/redaction/geometry.ts extension/src/redaction/fuse.ts extension/src/redaction/classify.ts extension/src/redaction/fuse.test.ts
git commit -m "feat(redaction): fuse DOM/vision/OCR/NER signals and classify risk"
```

---

## Task 5: Manifest builder + masking

**Files:**
- Create: `extension/src/redaction/manifest.ts`
- Create: `extension/src/redaction/mask.ts`
- Test: `extension/src/redaction/manifest.test.ts`

- [ ] **Step 1: Write the failing test `extension/src/redaction/manifest.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildManifest } from "./manifest.js";
import { MappingTable } from "./mapping.js";
import type { ClassifiedRegion } from "./classify.js";
import { RedactionManifestSchema } from "@sentrylens/shared";

const region = (over: Partial<ClassifiedRegion> = {}): ClassifiedRegion => ({
  bbox: [10, 10, 80, 16], category: "PHONE_NUMBER", value: "9000000000",
  confidence: 0.9, detected_by: ["regex"], risk: "medium", style: "blackbox",
  task_necessary: true, ...over,
});

describe("buildManifest", () => {
  it("produces a schema-valid manifest with element + redacted regions", () => {
    const t = new MappingTable();
    const m = buildManifest({
      image: { w: 1280, h: 800, dpr: 1 },
      elements: [{ id: 1, bbox: [0, 0, 60, 20], role: "button", text: "Login", interactable: true }],
      redacted: [region()],
      mapping: t,
      degraded: false,
    });
    expect(() => RedactionManifestSchema.parse(m)).not.toThrow();
    expect(m.regions.filter((r) => r.kind === "redacted")).toHaveLength(1);
  });

  it("never leaks a raw value and registers every value in the mapping table", () => {
    const t = new MappingTable();
    const m = buildManifest({ image: { w: 10, h: 10, dpr: 1 }, elements: [], redacted: [region()], mapping: t, degraded: false });
    const json = JSON.stringify(m);
    expect(json).not.toContain("9000000000");
    const ph = (m.regions[0] as any).placeholder as string;
    expect(t.resolve(ph)).toBe("9000000000");
    expect((m.regions[0] as any).value_len).toBe(10);
  });

  it("FACE regions get a null value_len and a FACE#n placeholder", () => {
    const t = new MappingTable();
    const m = buildManifest({ image: { w: 10, h: 10, dpr: 1 }, elements: [], redacted: [region({ category: "FACE", value: null })], mapping: t, degraded: false });
    const r = m.regions[0] as any;
    expect(r.value_len).toBeNull();
    expect(r.placeholder).toMatch(/^FACE#/);
  });

  it("adds a degraded note when degraded=true", () => {
    const t = new MappingTable();
    const m = buildManifest({ image: { w: 10, h: 10, dpr: 1 }, elements: [], redacted: [], mapping: t, degraded: true });
    expect(m.notes).toContain("degraded");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run extension/src/redaction/manifest.test.ts`
Expected: FAIL — `Cannot find module './manifest.js'`.

- [ ] **Step 3: Create `extension/src/redaction/manifest.ts`**

```ts
import type { RedactionManifest, RedactedRegion } from "@sentrylens/shared";
import type { ClassifiedRegion } from "./classify.js";
import type { MappingTable } from "./mapping.js";

export interface ElementInput {
  id: number; bbox: [number, number, number, number];
  role: string; text: string; interactable: boolean;
}

export interface BuildManifestArgs {
  image: { w: number; h: number; dpr: number };
  elements: ElementInput[];
  redacted: ClassifiedRegion[];
  mapping: MappingTable;
  degraded: boolean;
}

const CONTRACT =
  "Regions with kind=redacted are anonymised PII. You see category, position and value length, not the value. " +
  "Refer to elements by numeric id. Emit exactly one JSON action (click|type|scroll|wait|done|fail). " +
  "For type, if a value is a redacted item output its placeholder verbatim; the client substitutes the real value locally. Never guess a redacted value.";

export function buildManifest(args: BuildManifestArgs): RedactionManifest {
  const { image, elements, redacted, mapping, degraded } = args;
  let faceCounter = 0;

  const elementRegions = elements.map((e) => ({
    id: e.id, bbox: e.bbox, kind: "element" as const,
    role: e.role, text: e.text, interactable: e.interactable,
  }));

  const redactedRegions: RedactedRegion[] = redacted.map((r, i) => {
    const placeholder =
      r.category === "FACE" ? `FACE#${++faceCounter}` : mapping.placeholderFor(r.category, r.value ?? "");
    return {
      id: 10_000 + i,
      bbox: r.bbox,
      kind: "redacted",
      category: r.category,
      placeholder,
      value_len: r.value ? r.value.length : null,
      risk: r.risk,
      style: r.style,
      task_necessary: r.task_necessary,
      detected_by: r.detected_by,
    };
  });

  return {
    schema: "sentrylens-redaction/1.0",
    image,
    regions: [...elementRegions, ...redactedRegions],
    notes: degraded ? `${CONTRACT} (degraded: structural redaction only)` : CONTRACT,
  };
}
```

- [ ] **Step 4: Create `extension/src/redaction/mask.ts`** (browser-only; no unit test — verified in Task 14)

```ts
import type { RedactedRegion } from "@sentrylens/shared";

/**
 * Paints opaque masks over each redacted region on a copy of the source bitmap
 * and returns a PNG data URL. Runs in the offscreen document (has DOM + canvas).
 * `regions` bboxes MUST already be in image (device) pixels.
 */
export async function maskImage(pngDataUrl: string, regions: RedactedRegion[]): Promise<string> {
  const img = await loadImage(pngDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  for (const r of regions) {
    const [x, y, w, h] = r.bbox;
    if (r.style === "blur" || r.style === "pixelate") {
      pixelate(ctx, x, y, w, h, r.style === "blur" ? 8 : 12);
    } else {
      ctx.fillStyle = "#0A0A0A";
      ctx.fillRect(x, y, w, h);
    }
    drawLabel(ctx, r.placeholder, x, y, w, h);
  }
  return canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

function pixelate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, block: number) {
  if (w < 2 || h < 2) { ctx.fillStyle = "#0A0A0A"; ctx.fillRect(x, y, w, h); return; }
  const tmp = document.createElement("canvas");
  tmp.width = Math.max(1, Math.floor(w / block));
  tmp.height = Math.max(1, Math.floor(h / block));
  const tctx = tmp.getContext("2d")!;
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, tmp.width, tmp.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number) {
  const fontPx = Math.max(9, Math.min(14, Math.floor(h * 0.6)));
  ctx.font = `${fontPx}px monospace`;
  const label = ctx.measureText(text).width <= w - 4 ? text : text.split("#")[0]!;
  ctx.fillStyle = "#F5F5F5";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 2, y + h / 2, Math.max(0, w - 4));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run extension/src/redaction/manifest.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add extension/src/redaction/manifest.ts extension/src/redaction/mask.ts extension/src/redaction/manifest.test.ts
git commit -m "feat(redaction): manifest builder and canvas masking"
```

---

## Task 6: Server — mock provider, prompt, parser

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/prompt.ts`
- Create: `server/src/parse.ts`
- Create: `server/src/providers/mock.ts`
- Test: `server/src/parse.test.ts`
- Test: `server/src/providers/mock.test.ts`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "@sentrylens/server",
  "version": "0.0.0",
  "type": "module",
  "scripts": { "dev": "tsx watch src/index.ts", "start": "tsx src/index.ts" },
  "dependencies": {
    "@sentrylens/shared": "workspace:*",
    "express": "4.21.2",
    "zod": "3.24.1"
  },
  "devDependencies": { "tsx": "4.19.2", "@types/express": "4.17.21" }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"], "composite": false },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the failing test `server/src/parse.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseAction } from "./parse.js";

describe("parseAction", () => {
  it("parses a bare JSON object", () => {
    expect(parseAction('{"type":"click","target_id":3,"thought":"go"}')).toEqual({ ok: true, action: { type: "click", target_id: 3, thought: "go" } });
  });
  it("parses a fenced JSON block inside prose", () => {
    const raw = "Sure.\n```json\n{ \"type\": \"done\", \"answer\": \"42\", \"thought\": \"found\" }\n```\n";
    expect(parseAction(raw)).toEqual({ ok: true, action: { type: "done", answer: "42", thought: "found" } });
  });
  it("returns needsRepair on invalid shape", () => {
    expect(parseAction('{"type":"click"}')).toEqual({ ok: false, needsRepair: true });
  });
  it("returns needsRepair on non-JSON", () => {
    expect(parseAction("I cannot help with that")).toEqual({ ok: false, needsRepair: true });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run server/src/parse.test.ts`
Expected: FAIL — `Cannot find module './parse.js'`.

- [ ] **Step 5: Create `server/src/parse.ts`**

```ts
import { AgentActionSchema, type AgentAction } from "@sentrylens/shared";

export type ParseResult =
  | { ok: true; action: AgentAction }
  | { ok: false; needsRepair: true };

function extractJson(raw: string): string | null {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1]!.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return null;
}

export function parseAction(raw: string): ParseResult {
  const json = extractJson(raw);
  if (!json) return { ok: false, needsRepair: true };
  try {
    const parsed = AgentActionSchema.safeParse(JSON.parse(json));
    return parsed.success ? { ok: true, action: parsed.data } : { ok: false, needsRepair: true };
  } catch {
    return { ok: false, needsRepair: true };
  }
}
```

- [ ] **Step 6: Create `server/src/prompt.ts`**

```ts
import type { RedactionManifest, StepRecord } from "@sentrylens/shared";

export const SYSTEM_PROMPT =
  "You are SentryLens, a web agent operating on an ANONYMISED screenshot plus a JSON manifest. " +
  "Regions with kind=redacted are PII: you see category, position and value length, not the value. " +
  "Elements (kind=element) have a numeric id. Respond with EXACTLY ONE JSON object and nothing else, one of:\n" +
  '{"type":"click","target_id":<id>,"thought":"..."}\n' +
  '{"type":"type","target_id":<id>,"value":"<text or PLACEHOLDER>","thought":"..."}\n' +
  '{"type":"scroll","direction":"up|down","thought":"..."}\n' +
  '{"type":"done","answer":"...","thought":"..."}\n' +
  '{"type":"fail","reason":"...","thought":"..."}\n' +
  "For type actions, if the value should be a redacted item, output its placeholder verbatim " +
  "(e.g. PHONE_NUMBER#a1b2c). NEVER guess a redacted value.";

export function buildUserPrompt(task: string, manifest: RedactionManifest, history: StepRecord[]): string {
  const hist = history
    .map((h, i) => `#${i + 1} ${JSON.stringify(h.action)} -> ${h.observation}`)
    .join("\n") || "(none)";
  return [
    `TASK: ${task}`,
    `MANIFEST: ${JSON.stringify(manifest)}`,
    `HISTORY:\n${hist}`,
    "Return one JSON action now.",
  ].join("\n\n");
}
```

- [ ] **Step 7: Write the failing test `server/src/providers/mock.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mockRespond } from "./mock.js";
import type { ServerRequest } from "@sentrylens/shared";

const base: ServerRequest = {
  task: "log in as the operator",
  image_b64: "x",
  manifest: {
    schema: "sentrylens-redaction/1.0",
    image: { w: 100, h: 100, dpr: 1 },
    regions: [
      { id: 1, kind: "element", role: "textbox", text: "Username", interactable: true, bbox: [0, 0, 10, 10] },
      { id: 2, kind: "element", role: "button", text: "Login", interactable: true, bbox: [0, 20, 10, 10] },
    ],
  } as any,
  history: [],
};

describe("mockRespond", () => {
  it("clicks the element whose text best matches the task on the first step", () => {
    const a = mockRespond(base);
    expect(a.type).toBe("click");
    expect((a as any).target_id).toBe(2); // "Login" matches "log in"
  });
  it("returns done once history has >= 3 steps", () => {
    const a = mockRespond({ ...base, history: [1, 2, 3].map(() => ({ action: { type: "click", target_id: 2, thought: "" }, observation: "ok" })) as any });
    expect(a.type).toBe("done");
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `pnpm vitest run server/src/providers/mock.test.ts`
Expected: FAIL — `Cannot find module './mock.js'`.

- [ ] **Step 9: Create `server/src/providers/mock.ts`**

```ts
import type { AgentAction, ServerRequest } from "@sentrylens/shared";

function score(text: string, task: string): number {
  const t = new Set(task.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => t.has(w)).length;
}

export function mockRespond(req: ServerRequest): AgentAction {
  if (req.history.length >= 3) {
    return { type: "done", answer: "mock: task assumed complete after 3 steps", thought: "mock stop" };
  }
  const elements = req.manifest.regions.filter(
    (r): r is Extract<typeof r, { kind: "element" }> => r.kind === "element" && r.interactable,
  );
  if (elements.length === 0) return { type: "fail", reason: "no interactable elements", thought: "mock" };
  const best = [...elements].sort((a, b) => score(b.text, req.task) - score(a.text, req.task))[0]!;
  const redactedNearby = req.manifest.regions.find((r) => r.kind === "redacted");
  if (best.role === "textbox" && redactedNearby && redactedNearby.kind === "redacted") {
    return { type: "type", target_id: best.id, value: redactedNearby.placeholder, thought: "mock: fill field with placeholder" };
  }
  return { type: "click", target_id: best.id, thought: `mock: click ${best.text}` };
}
```

- [ ] **Step 10: Run both server tests**

Run: `pnpm vitest run server/src`
Expected: PASS — 6 tests total.

- [ ] **Step 11: Commit**

```bash
git add server/package.json server/tsconfig.json server/src/prompt.ts server/src/parse.ts server/src/providers/mock.ts server/src/parse.test.ts server/src/providers/mock.test.ts pnpm-lock.yaml
git commit -m "feat(server): redaction-aware prompt, action parser, mock provider"
```

---

## Task 7: Server — OpenAI-compatible provider + Express endpoint

**Files:**
- Create: `server/src/providers/openai-compatible.ts`
- Create: `server/src/index.ts`
- Create: `server/.env.example`
- Test: `server/src/index.test.ts`

- [ ] **Step 1: Create `server/src/providers/openai-compatible.ts`**

```ts
export interface ChatArgs {
  system: string;
  user: string;
  imageB64: string; // raw base64 (no data: prefix) or a data URL
  model: string;
  baseUrl: string;
  apiKey: string;
}

export async function chatVision(a: ChatArgs): Promise<string> {
  const imageUrl = a.imageB64.startsWith("data:") ? a.imageB64 : `data:image/png;base64,${a.imageB64}`;
  const res = await fetch(`${a.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${a.apiKey}`,
      "http-referer": "https://sentrylens.local",
      "x-title": "SentryLens",
    },
    body: JSON.stringify({
      model: a.model,
      temperature: 0,
      messages: [
        { role: "system", content: a.system },
        { role: "user", content: [
          { type: "text", text: a.user },
          { type: "image_url", image_url: { url: imageUrl } },
        ] },
      ],
    }),
  });
  if (!res.ok) throw new Error(`provider ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return json.choices[0]?.message?.content ?? "";
}
```

- [ ] **Step 2: Create `server/.env.example`**

```
PORT=8787
MOCK=1
PROVIDER=openrouter
MODEL=qwen/qwen2.5-vl-32b-instruct:free
BASE_URL=https://openrouter.ai/api/v1
API_KEY=
```

- [ ] **Step 3: Create `server/src/index.ts`**

```ts
import express from "express";
import { ServerRequestSchema, type ServerResponse } from "@sentrylens/shared";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { parseAction } from "./parse.js";
import { mockRespond } from "./providers/mock.js";
import { chatVision } from "./providers/openai-compatible.js";

const app = express();
app.use(express.json({ limit: "25mb" }));

const MOCK = process.env.MOCK === "1";

app.get("/health", (_req, res) => res.json({ ok: true, mock: MOCK }));

app.post("/agent/step", async (req, res) => {
  const parsed = ServerRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const request = parsed.data;

  if (MOCK) {
    const response: ServerResponse = { action: mockRespond(request), raw: "mock" };
    return res.json(response);
  }

  const user = buildUserPrompt(request.task, request.manifest, request.history);
  const cfg = {
    model: process.env.MODEL!, baseUrl: process.env.BASE_URL!, apiKey: process.env.API_KEY!,
  };
  try {
    let raw = await chatVision({ system: SYSTEM_PROMPT, user, imageB64: request.image_b64, ...cfg });
    let parsedAction = parseAction(raw);
    if (!parsedAction.ok) {
      raw = await chatVision({
        system: SYSTEM_PROMPT,
        user: `${user}\n\nYour previous reply was not a single valid JSON action. Resend ONLY the JSON object.`,
        imageB64: request.image_b64, ...cfg,
      });
      parsedAction = parseAction(raw);
    }
    const action = parsedAction.ok
      ? parsedAction.action
      : { type: "fail" as const, reason: "unparseable model output", thought: "server give-up" };
    const response: ServerResponse = { action, raw };
    res.json(response);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`sentrylens server on :${port} (mock=${MOCK})`));

export { app };
```

- [ ] **Step 4: Write the failing test `server/src/index.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import type { AddressInfo } from "node:net";

let base: string;

beforeAll(async () => {
  process.env.MOCK = "1";
  const { app } = await import("./index.js");
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

const body = {
  task: "log in",
  image_b64: "AAAA",
  manifest: {
    schema: "sentrylens-redaction/1.0",
    image: { w: 10, h: 10, dpr: 1 },
    regions: [{ id: 1, kind: "element", role: "button", text: "Login", interactable: true, bbox: [0, 0, 5, 5] }],
  },
  history: [],
};

describe("POST /agent/step (mock mode)", () => {
  it("returns a valid AgentAction referencing a real element id", async () => {
    const r = await fetch(`${base}/agent/step`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.action.type).toBe("click");
    expect(j.action.target_id).toBe(1);
  });

  it("400s on a malformed body", async () => {
    const r = await fetch(`${base}/agent/step`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nope: true }) });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run server/src/index.test.ts`
Expected: PASS — 2 tests (the `index.ts` file already exists from Step 3).

- [ ] **Step 6: Manual smoke**

Run: `cd server && MOCK=1 pnpm start` then in another shell `curl -s localhost:8787/health`
Expected: `{"ok":true,"mock":true}`. Stop the server (Ctrl-C).

- [ ] **Step 7: Commit**

```bash
git add server/src/providers/openai-compatible.ts server/src/index.ts server/.env.example server/src/index.test.ts pnpm-lock.yaml
git commit -m "feat(server): OpenAI-compatible vision provider and /agent/step endpoint"
```

---

## Task 8: Extension shell — WXT config, messaging, background router, content DOM walk

**Files:**
- Create: `extension/wxt.config.ts`
- Create: `extension/src/messaging.ts`
- Create: `extension/entrypoints/background.ts`
- Create: `extension/entrypoints/content.ts`
- Create: `extension/src/dom/walk.ts`
- Test: `extension/src/dom/walk.test.ts`

- [ ] **Step 1: Create `extension/wxt.config.ts`**

```ts
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "SentryLens",
    description: "On-device visual perception for privacy-preserving browser agents",
    permissions: ["offscreen", "tabs", "scripting", "storage", "activeTab", "sidePanel", "declarativeNetRequest"],
    host_permissions: ["<all_urls>"],
    side_panel: { default_path: "sidepanel.html" },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
});
```

- [ ] **Step 2: Create `extension/src/messaging.ts`**

```ts
import { z } from "zod";
import { RegionListSchema, RedactionManifestSchema, AgentActionSchema } from "@sentrylens/shared";

export const Msg = {
  COLLECT_REGIONS: "COLLECT_REGIONS",
  RUN_PERCEPTION: "RUN_PERCEPTION",
  RESOLVE_ACTION: "RESOLVE_ACTION",
  EXECUTE_ACTION: "EXECUTE_ACTION",
  AGENT_START: "AGENT_START",
  AGENT_EVENT: "AGENT_EVENT",
  SET_FIREWALL: "SET_FIREWALL",
} as const;

export const CollectRegionsResult = z.object({
  regionList: RegionListSchema,
  domSensitive: z.array(z.object({ bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), category: z.string() })),
});
export const RunPerceptionResult = z.object({
  sanitizedPng: z.string(),
  manifest: RedactionManifestSchema,
  screenSummary: z.string().optional(),
  degraded: z.boolean(),
});
export const ResolveActionArgs = z.object({ action: AgentActionSchema });
export const ExecuteActionArgs = z.object({ action: AgentActionSchema });
export const ExecuteActionResult = z.object({ ok: z.boolean(), observation: z.string() });
```

- [ ] **Step 3: Write the failing test `extension/src/dom/walk.test.ts`**

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { walkDom } from "./walk.js";

function stubRects() {
  for (const el of document.querySelectorAll("*")) {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ x: 5, y: 6, width: 40, height: 12, top: 6, left: 5, right: 45, bottom: 18, toJSON() {} }) as DOMRect;
  }
}

describe("walkDom", () => {
  it("collects interactable elements with ids, roles, names and bboxes", () => {
    document.body.innerHTML = `
      <button id="b1">Login</button>
      <input id="i1" type="text" aria-label="Username" />
      <a href="#">Reports</a>
      <p>ignored paragraph text that is long enough to look like a real block</p>`;
    stubRects();
    const list = walkDom("https://x.test/", { w: 1280, h: 800, dpr: 1 });
    const names = list.regions.map((r) => r.name).sort();
    expect(names).toContain("Login");
    expect(names).toContain("Username");
    expect(names).toContain("Reports");
    expect(list.regions.every((r) => Array.isArray(r.bbox) && r.bbox.length === 4)).toBe(true);
    expect(list.regions.every((r) => typeof r.id === "number")).toBe(true);
  });

  it("reports a password input's domType", () => {
    document.body.innerHTML = `<input id="p" type="password" />`;
    stubRects();
    const list = walkDom("u", { w: 1, h: 1, dpr: 1 });
    expect(list.regions.find((r) => r.domType === "password")).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm add -D -w jsdom && pnpm vitest run extension/src/dom/walk.test.ts`
Expected: FAIL — `Cannot find module './walk.js'`.

- [ ] **Step 5: Create `extension/src/dom/walk.ts`**

```ts
import type { RegionList, Region } from "@sentrylens/shared";

export const INTERACTABLE_SELECTOR =
  "a[href],button,input,select,textarea,[role=button],[role=link],[role=textbox],[contenteditable=true]";

function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const labelled = el.getAttribute("aria-labelledby");
  if (labelled) {
    const t = labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
    if (t) return t;
  }
  if (el instanceof HTMLInputElement && el.labels && el.labels.length) return el.labels[0]!.textContent!.trim();
  const text = (el as HTMLElement).innerText?.trim() ?? el.textContent?.trim() ?? "";
  if (text) return text.slice(0, 120);
  return el.getAttribute("placeholder")?.trim() ?? el.getAttribute("name")?.trim() ?? "";
}

function roleOf(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "input") return (el as HTMLInputElement).type === "password" ? "textbox" : (el as HTMLInputElement).type || "textbox";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  return "generic";
}

export function collectInteractableElements(): Element[] {
  return Array.from(document.querySelectorAll(INTERACTABLE_SELECTOR)).filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const style = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
    return !style || (style.visibility !== "hidden" && style.display !== "none");
  });
}

export function walkDom(url: string, viewport: { w: number; h: number; dpr: number }): RegionList {
  const regions: Region[] = [];
  let id = 1;
  for (const el of collectInteractableElements()) {
    const rect = el.getBoundingClientRect();
    const input = el instanceof HTMLInputElement ? el : null;
    regions.push({
      id: id++,
      bbox: [rect.left, rect.top, rect.width, rect.height],
      source: "dom",
      role: roleOf(el),
      name: accessibleName(el),
      domType: input ? input.type : el.tagName.toLowerCase(),
      interactable: true,
    });
  }
  return { url, viewport, regions };
}

export interface DomSensitiveHit {
  bbox: [number, number, number, number];
  category: "PASSWORD" | "EMAIL" | "PHONE_NUMBER" | "CREDIT_CARD" | "OTHER";
}

export function domSensitiveRegions(): DomSensitiveHit[] {
  const hits: DomSensitiveHit[] = [];
  const push = (el: Element, category: DomSensitiveHit["category"]) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) hits.push({ bbox: [r.left, r.top, r.width, r.height], category });
  };
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement>("input"))) {
    const ac = (el.getAttribute("autocomplete") ?? "").toLowerCase();
    if (el.type === "password") push(el, "PASSWORD");
    else if (el.type === "email" || ac === "email") push(el, "EMAIL");
    else if (el.type === "tel" || ac === "tel") push(el, "PHONE_NUMBER");
    else if (ac.startsWith("cc-")) push(el, "CREDIT_CARD");
  }
  for (const el of Array.from(document.querySelectorAll("[data-sensitive]"))) push(el, "OTHER");
  return hits;
}
```

- [ ] **Step 6: Create `extension/entrypoints/content.ts`**

```ts
import { walkDom, domSensitiveRegions, collectInteractableElements } from "../src/dom/walk";
import { executeAction } from "../src/dom/execute";
import { Msg } from "../src/messaging";

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === Msg.COLLECT_REGIONS) {
        const vp = { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio };
        const map = new Map<number, Element>();
        collectInteractableElements().forEach((el, i) => map.set(i + 1, el));
        (window as any).__sentrylensRegions = map;
        sendResponse({ regionList: walkDom(location.href, vp), domSensitive: domSensitiveRegions() });
        return true;
      }
      if (msg?.type === Msg.EXECUTE_ACTION) {
        executeAction(msg.payload.action).then(sendResponse);
        return true;
      }
      return false;
    });
  },
});
```

- [ ] **Step 7: Create `extension/entrypoints/background.ts`** (router skeleton; agent loop added in Task 11)

```ts
import { Msg } from "../src/messaging";
import { setFirewall } from "../src/firewall";

const OFFSCREEN_PATH = "offscreen.html";
let creating: Promise<void> | null = null;

export async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType] });
  if (existing.length) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["WORKERS" as chrome.offscreen.Reason, "DOM_SCRAPING" as chrome.offscreen.Reason],
        justification: "Run WebGPU perception + OCR/NER models and canvas redaction off the main thread.",
      })
      .then(() => { creating = null; });
  }
  await creating;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === Msg.SET_FIREWALL) {
    setFirewall(!!msg.payload.on).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
```

- [ ] **Step 8: Run the walk test**

Run: `pnpm vitest run extension/src/dom/walk.test.ts`
Expected: PASS — 2 tests. (`extension/src/dom/execute.ts` and `extension/src/firewall.ts` do not exist yet — that is fine, we are not running `wxt build` in this task.)

- [ ] **Step 9: Commit**

```bash
git add extension/wxt.config.ts extension/src/messaging.ts extension/entrypoints/background.ts extension/entrypoints/content.ts extension/src/dom/walk.ts extension/src/dom/walk.test.ts pnpm-lock.yaml
git commit -m "feat(extension): WXT config, typed messaging, background router, DOM walk"
```

---

## Task 9: Offscreen perception registry + pure assemble pipeline

**Files:**
- Create: `extension/entrypoints/offscreen/index.html`
- Create: `extension/entrypoints/offscreen/main.ts`
- Create: `extension/src/perception/ocr.ts`
- Create: `extension/src/perception/ner.ts`
- Create: `extension/src/perception/faces.ts`
- Create: `extension/src/perception/detector.ts`
- Create: `extension/src/perception/pipeline.ts`
- Test: `extension/src/perception/pipeline.test.ts`

- [ ] **Step 1: Create `extension/entrypoints/offscreen/index.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8" /></head>
<body><script type="module" src="./main.ts"></script></body></html>
```

- [ ] **Step 2: Create `extension/src/perception/ocr.ts`**

```ts
import { createWorker, type Worker } from "tesseract.js";

let worker: Worker | null = null;

export interface OcrWord { text: string; bbox: [number, number, number, number] }

export async function initOcr(): Promise<void> {
  if (worker) return;
  worker = await createWorker("eng");
}

export async function runOcr(pngDataUrl: string): Promise<{ words: OcrWord[]; joined: string; offsets: number[] }> {
  if (!worker) await initOcr();
  const { data } = await worker!.recognize(pngDataUrl);
  const words: OcrWord[] = [];
  const offsets: number[] = [];
  let joined = "";
  for (const w of (data.words ?? []) as Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>) {
    const text = w.text.trim();
    if (!text) continue;
    if (joined.length) joined += " ";
    offsets.push(joined.length);
    joined += text;
    words.push({ text, bbox: [w.bbox.x0, w.bbox.y0, w.bbox.x1 - w.bbox.x0, w.bbox.y1 - w.bbox.y0] });
  }
  return { words, joined, offsets };
}
```

- [ ] **Step 3: Create `extension/src/perception/ner.ts`**

```ts
import { pipeline } from "@huggingface/transformers";
import type { PiiCategory } from "@sentrylens/shared";

let ner: any = null;

const LABEL_MAP: Record<string, PiiCategory> = {
  PER: "PERSON_NAME", PERSON: "PERSON_NAME", NAME: "PERSON_NAME",
  EMAIL: "EMAIL", PHONE: "PHONE_NUMBER", TEL: "PHONE_NUMBER",
  ADDRESS: "ADDRESS", LOC: "ADDRESS", DATE: "DOB", ORG: "OTHER",
};

export async function initNer(device: "webgpu" | "wasm"): Promise<void> {
  if (ner) return;
  ner = await pipeline("token-classification", "onnx-community/multilang-pii-ner-ONNX", {
    device, dtype: device === "webgpu" ? "q4" : "q8",
  });
}

export interface NerSpan { category: PiiCategory; value: string; start: number; end: number }

export async function runNer(text: string): Promise<NerSpan[]> {
  if (!ner || !text.trim()) return [];
  const out = (await ner(text, { aggregation_strategy: "simple" })) as Array<{
    entity_group?: string; entity?: string; start: number; end: number; score: number;
  }>;
  const spans: NerSpan[] = [];
  for (const e of out) {
    if (e.score < 0.5) continue;
    const key = (e.entity_group ?? e.entity ?? "").toUpperCase().replace(/^[BI]-/, "");
    const category = LABEL_MAP[key];
    if (!category) continue;
    spans.push({ category, value: text.slice(e.start, e.end), start: e.start, end: e.end });
  }
  return spans;
}
```

- [ ] **Step 4: Create `extension/src/perception/faces.ts`**

```ts
import { FilesetResolver, FaceDetector } from "@mediapipe/tasks-vision";

let detector: FaceDetector | null = null;

export async function initFaces(): Promise<void> {
  if (detector) return;
  const files = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm",
  );
  detector = await FaceDetector.createFromOptions(files, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
    },
    runningMode: "IMAGE",
  });
}

export async function runFaces(bitmap: ImageBitmap): Promise<[number, number, number, number][]> {
  if (!detector) await initFaces();
  const res = detector!.detect(bitmap);
  return res.detections.map((d) => {
    const b = d.boundingBox!;
    return [b.originX, b.originY, b.width, b.height] as [number, number, number, number];
  });
}
```

- [ ] **Step 5: Create `extension/src/perception/detector.ts`**

```ts
import { AutoModel, AutoProcessor, RawImage } from "@huggingface/transformers";

let model: any = null;
let processor: any = null;

export async function initDetector(device: "webgpu" | "wasm"): Promise<void> {
  if (model) return;
  processor = await AutoProcessor.from_pretrained("Xenova/yolos-tiny");
  model = await AutoModel.from_pretrained("Xenova/yolos-tiny", { device, dtype: "q8" });
}

export interface DetBox { label: string; bbox: [number, number, number, number]; score: number }

export async function runDetector(pngDataUrl: string): Promise<DetBox[]> {
  if (!model) return [];
  const image = await RawImage.fromURL(pngDataUrl);
  const inputs = await processor(image);
  const outputs = await model(inputs);
  const processed = processor.post_process_object_detection(outputs, 0.5, [[image.height, image.width]])[0];
  return processed.boxes.map((box: number[], i: number) => ({
    label: model.config.id2label[processed.classes[i]],
    bbox: [box[0], box[1], box[2] - box[0], box[3] - box[1]] as [number, number, number, number],
    score: processed.scores[i],
  }));
}
```

- [ ] **Step 6: Write the failing test `extension/src/perception/pipeline.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { assemblePerception } from "./pipeline.js";

describe("assemblePerception", () => {
  it("wires DOM/vision/OCR/NER into a classified manifest without leaking values", () => {
    const result = assemblePerception({
      task: "open the report",
      image: { w: 200, h: 200, dpr: 1 },
      domRegions: [{ id: 1, bbox: [0, 0, 50, 20], source: "dom", role: "button", name: "Open report", interactable: true }],
      domSensitive: [{ bbox: [0, 100, 80, 16], category: "PASSWORD" }],
      faces: [[120, 10, 40, 40]],
      ocrWords: [{ text: "ops@vssc.test", bbox: [0, 40, 100, 14] }],
      ocrJoined: "ops@vssc.test",
      ocrOffsets: [0],
      nerSpans: [],
      degraded: false,
    });
    const cats = result.classified.map((r) => r.category).sort();
    expect(cats).toEqual(["EMAIL", "FACE", "PASSWORD"]);
    expect(result.manifest.regions.some((r) => r.kind === "element")).toBe(true);
    expect(JSON.stringify(result.manifest)).not.toContain("ops@vssc.test");
    const emailRegion = result.manifest.regions.find((r) => r.kind === "redacted" && r.category === "EMAIL") as any;
    expect(result.mapping.resolve(emailRegion.placeholder)).toBe("ops@vssc.test");
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm vitest run extension/src/perception/pipeline.test.ts`
Expected: FAIL — `Cannot find module './pipeline.js'`.

- [ ] **Step 8: Create `extension/src/perception/pipeline.ts`** (pure orchestration — no model calls, unit-testable)

```ts
import type { Region, RedactionManifest, PiiCategory } from "@sentrylens/shared";
import { fuseRegions } from "../redaction/fuse.js";
import { classify, type ClassifiedRegion } from "../redaction/classify.js";
import { buildManifest, type ElementInput } from "../redaction/manifest.js";
import { MappingTable } from "../redaction/mapping.js";
import { viewportToImage } from "../redaction/geometry.js";

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
  });

  const classified = fused.map((r) => classify(r, args.task, domRegionsImg));

  const elements: ElementInput[] = domRegionsImg.map((r) => ({
    id: r.id, bbox: r.bbox, role: r.role, text: r.name, interactable: r.interactable,
  }));

  const manifest = buildManifest({ image: args.image, elements, redacted: classified, mapping, degraded: args.degraded });
  return { classified, manifest, mapping };
}
```

- [ ] **Step 9: Create `extension/entrypoints/offscreen/main.ts`**

```ts
import { Msg } from "../../src/messaging";
import { runOcr } from "../../src/perception/ocr";
import { runNer, initNer } from "../../src/perception/ner";
import { runFaces } from "../../src/perception/faces";
import { runDetector, initDetector } from "../../src/perception/detector";
import { assemblePerception } from "../../src/perception/pipeline";
import { maskImage } from "../../src/redaction/mask";
import { MappingTable } from "../../src/redaction/mapping";
import type { AgentAction, PiiCategory } from "@sentrylens/shared";

let session = new MappingTable();

async function hasWebGpu(): Promise<boolean> {
  try { return !!(await (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter()); }
  catch { return false; }
}

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.target !== "offscreen") return false;

  if (msg.type === Msg.RUN_PERCEPTION) {
    (async () => {
      const { png, regionList, domSensitive, task, newSession } = msg.payload;
      if (newSession) { session.clear(); session = new MappingTable(); }
      const device: "webgpu" | "wasm" = (await hasWebGpu()) ? "webgpu" : "wasm";

      let degraded = false;
      let ocr = { words: [] as { text: string; bbox: [number, number, number, number] }[], joined: "", offsets: [] as number[] };
      let nerSpans: { category: PiiCategory; value: string; start: number; end: number }[] = [];
      let faces: [number, number, number, number][] = [];

      try {
        ocr = await runOcr(png);
        await initNer(device);
        nerSpans = await runNer(ocr.joined);
        const bmp = await createImageBitmap(await (await fetch(png)).blob());
        faces = await runFaces(bmp);
        await initDetector(device);
        await runDetector(png); // informational for MVP
      } catch (e) {
        degraded = true;
        console.warn("perception degraded:", e);
      }

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
      });

      const redacted = manifest.regions.filter((r) => r.kind === "redacted");
      const sanitizedPng = await maskImage(png, redacted as never);
      sendResponse({ sanitizedPng, manifest, degraded });
    })();
    return true;
  }

  if (msg.type === Msg.RESOLVE_ACTION) {
    const action = msg.payload.action as AgentAction;
    if (action.type === "type") sendResponse({ action: { ...action, value: session.resolveAll(action.value) } });
    else sendResponse({ action });
    return true;
  }
  return false;
});
```

- [ ] **Step 10: Run the pipeline test**

Run: `pnpm vitest run extension/src/perception/pipeline.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 11: Commit**

```bash
git add extension/entrypoints/offscreen extension/src/perception pnpm-lock.yaml
git commit -m "feat(perception): offscreen model registry and pure assemble pipeline"
```

---

## Task 10: Content-script action executor

**Files:**
- Create: `extension/src/dom/execute.ts`
- Test: `extension/src/dom/execute.test.ts`

- [ ] **Step 1: Write the failing test `extension/src/dom/execute.test.ts`**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { executeAction, __setRegionResolver } from "./execute.js";

describe("executeAction", () => {
  it("clicks the element mapped from target_id", async () => {
    document.body.innerHTML = `<button id="b">Go</button>`;
    const btn = document.getElementById("b")!;
    const spy = vi.fn();
    btn.addEventListener("click", spy);
    __setRegionResolver((id) => (id === 7 ? btn : null));
    const r = await executeAction({ type: "click", target_id: 7, thought: "" });
    expect(spy).toHaveBeenCalledOnce();
    expect(r.ok).toBe(true);
  });

  it("types a value into an input and fires input+change", async () => {
    document.body.innerHTML = `<input id="i" />`;
    const input = document.getElementById("i") as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));
    __setRegionResolver(() => input);
    await executeAction({ type: "type", target_id: 1, value: "ops@vssc.test", thought: "" });
    expect(input.value).toBe("ops@vssc.test");
    expect(events).toEqual(["input", "change"]);
  });

  it("returns ok:false with an observation when the element is missing", async () => {
    __setRegionResolver(() => null);
    const r = await executeAction({ type: "click", target_id: 99, thought: "" });
    expect(r.ok).toBe(false);
    expect(r.observation).toContain("99");
  });

  it("done/fail actions are no-ops that report the answer/reason", async () => {
    expect((await executeAction({ type: "done", answer: "42", thought: "" })).observation).toContain("42");
    expect((await executeAction({ type: "fail", reason: "stuck", thought: "" })).observation).toContain("stuck");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run extension/src/dom/execute.test.ts`
Expected: FAIL — `Cannot find module './execute.js'`.

- [ ] **Step 3: Create `extension/src/dom/execute.ts`**

```ts
import type { AgentAction } from "@sentrylens/shared";

type Resolver = (targetId: number) => Element | null;

let resolver: Resolver = (id) =>
  ((window as unknown as { __sentrylensRegions?: Map<number, Element> }).__sentrylensRegions?.get(id)) ?? null;

export function __setRegionResolver(r: Resolver) { resolver = r; }

export interface ExecResult { ok: boolean; observation: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}`;

export async function executeAction(action: AgentAction): Promise<ExecResult> {
  switch (action.type) {
    case "done": return { ok: true, observation: `done: ${action.answer}` };
    case "fail": return { ok: true, observation: `fail: ${action.reason}` };
    case "wait": await sleep(action.ms); return { ok: true, observation: `waited ${action.ms}ms` };
    case "scroll": {
      window.scrollBy(0, (action.direction === "down" ? 1 : -1) * (action.amount ?? window.innerHeight * 0.8));
      await sleep(150);
      return { ok: true, observation: `scrolled ${action.direction}` };
    }
    case "click": {
      const el = resolver(action.target_id);
      if (!el) return { ok: false, observation: `element ${action.target_id} not found` };
      (el as HTMLElement).scrollIntoView({ block: "center" });
      (el as HTMLElement).click();
      await sleep(200);
      return { ok: true, observation: `clicked ${describe(el)}` };
    }
    case "type": {
      const el = resolver(action.target_id);
      if (!el || !("value" in el)) return { ok: false, observation: `input ${action.target_id} not found` };
      const input = el as HTMLInputElement;
      input.focus();
      input.value = action.value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(120);
      return { ok: true, observation: `typed into ${describe(el)}` };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run extension/src/dom/execute.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add extension/src/dom/execute.ts extension/src/dom/execute.test.ts
git commit -m "feat(extension): content-script action executor (click/type/scroll)"
```

---

## Task 11: Agent loop + side panel UI + background orchestration

**Files:**
- Create: `extension/src/config.ts`
- Create: `extension/src/agent/loop.ts`
- Create: `extension/entrypoints/sidepanel/index.html`
- Create: `extension/entrypoints/sidepanel/main.tsx`
- Create: `extension/entrypoints/sidepanel/App.tsx`
- Modify: `extension/entrypoints/background.ts`
- Test: `extension/src/agent/loop.test.ts`

- [ ] **Step 1: Create `extension/src/config.ts`**

```ts
export const CFG = {
  serverUrl: "http://localhost:8787",
  maxSteps: 12,
};
```

- [ ] **Step 2: Write the failing test `extension/src/agent/loop.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { runAgent, type AgentDeps } from "./loop.js";

const perceiveResult = {
  sanitizedPng: "png", degraded: false,
  manifest: { schema: "sentrylens-redaction/1.0", image: { w: 1, h: 1, dpr: 1 }, regions: [], notes: "n" } as any,
};

function deps(actions: any[]): AgentDeps {
  let i = 0;
  return {
    perceive: vi.fn(async () => perceiveResult),
    askServer: vi.fn(async () => ({ action: actions[Math.min(i++, actions.length - 1)] })),
    resolve: vi.fn(async (a) => a),
    execute: vi.fn(async (a) => ({ ok: true, observation: "obs" })),
    emit: vi.fn(),
  };
}

describe("runAgent", () => {
  it("loops until a done action and returns the history", async () => {
    const d = deps([
      { type: "click", target_id: 1, thought: "" },
      { type: "type", target_id: 2, value: "x", thought: "" },
      { type: "done", answer: "finished", thought: "" },
    ]);
    const res = await runAgent("task", d, { maxSteps: 10 });
    expect(res.status).toBe("done");
    expect(res.history).toHaveLength(3);
    expect(d.perceive).toHaveBeenCalledTimes(3);
  });

  it("stops with fail when the step budget is exceeded", async () => {
    const d = deps([{ type: "scroll", direction: "down", thought: "" }]);
    const res = await runAgent("task", d, { maxSteps: 3 });
    expect(res.status).toBe("fail");
    expect(res.history.at(-1)!.action.type).toBe("fail");
  });

  it("fails after two consecutive 'not found' observations", async () => {
    const d = deps([{ type: "click", target_id: 999, thought: "" }]);
    d.execute = vi.fn(async () => ({ ok: false, observation: "element 999 not found" }));
    const res = await runAgent("task", d, { maxSteps: 10 });
    expect(res.status).toBe("fail");
    expect(res.history.length).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run extension/src/agent/loop.test.ts`
Expected: FAIL — `Cannot find module './loop.js'`.

- [ ] **Step 4: Create `extension/src/agent/loop.ts`**

```ts
import type { AgentAction, RedactionManifest, StepRecord } from "@sentrylens/shared";

export interface PerceiveResult {
  sanitizedPng: string; manifest: RedactionManifest; degraded: boolean; screenSummary?: string;
}

export interface AgentDeps {
  perceive: (newSession: boolean) => Promise<PerceiveResult>;
  askServer: (task: string, p: PerceiveResult, history: StepRecord[]) => Promise<{ action: AgentAction }>;
  resolve: (a: AgentAction) => Promise<AgentAction>;
  execute: (a: AgentAction) => Promise<{ ok: boolean; observation: string }>;
  emit: (evt: { step: number; action: AgentAction; observation: string; perceive: PerceiveResult }) => void;
}

export interface AgentResult { status: "done" | "fail"; history: StepRecord[] }

export async function runAgent(task: string, deps: AgentDeps, opts: { maxSteps: number }): Promise<AgentResult> {
  const history: StepRecord[] = [];
  let notFoundStreak = 0;

  for (let step = 1; step <= opts.maxSteps; step++) {
    const perceive = await deps.perceive(step === 1);
    const { action: rawAction } = await deps.askServer(task, perceive, history);
    const action = await deps.resolve(rawAction);
    const { ok, observation } = await deps.execute(action);

    history.push({ action: rawAction, observation });
    deps.emit({ step, action: rawAction, observation, perceive });

    if (action.type === "done") return { status: "done", history };
    if (action.type === "fail") return { status: "fail", history };

    notFoundStreak = !ok && /not found/.test(observation) ? notFoundStreak + 1 : 0;
    if (notFoundStreak >= 2) return { status: "fail", history };
  }
  history.push({ action: { type: "fail", reason: "step budget exceeded", thought: "" }, observation: "budget" });
  return { status: "fail", history };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run extension/src/agent/loop.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Create `extension/entrypoints/sidepanel/index.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8" /><title>SentryLens</title></head>
<body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>
```

- [ ] **Step 7: Create `extension/entrypoints/sidepanel/main.tsx`**

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";
createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 8: Create `extension/entrypoints/sidepanel/App.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Msg } from "../../src/messaging";

interface StepView { step: number; thought: string; action: string; observation: string; sanitizedPng: string; manifest: unknown; summary?: string }
interface NetRow { host: string; bytes: number; blocked?: boolean }

export function App() {
  const [task, setTask] = useState("log in as the operator and open the telemetry report for station VSSC-03");
  const [steps, setSteps] = useState<StepView[]>([]);
  const [net, setNet] = useState<NetRow[]>([]);
  const [running, setRunning] = useState(false);
  const [firewall, setFw] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const handler = (m: any) => {
      if (m?.type !== Msg.AGENT_EVENT) return;
      if (m.payload.kind === "step") setSteps((s) => [...s, m.payload.step as StepView]);
      if (m.payload.kind === "net") setNet((n) => [...n, m.payload as NetRow]);
      if (m.payload.kind === "end") { setRunning(false); setStatus(m.payload.status); }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  async function toggleFirewall(on: boolean) {
    setFw(on);
    await chrome.runtime.sendMessage({ type: Msg.SET_FIREWALL, payload: { on } });
  }

  async function start() {
    setSteps([]); setNet([]); setStatus(""); setRunning(true);
    await chrome.runtime.sendMessage({ type: Msg.AGENT_START, payload: { task } });
  }

  return (
    <div style={{ font: "13px system-ui", padding: 12, display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0 }}>SentryLens</h3>
      <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={3} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button disabled={running} onClick={start}>{running ? "Running…" : "Run task"}</button>
        <label><input type="checkbox" checked={firewall} onChange={(e) => toggleFirewall(e.target.checked)} /> Network firewall</label>
        {status && <b>{status}</b>}
      </div>

      {net.length > 0 && (
        <details open>
          <summary>Network ({net.length})</summary>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {net.map((n, i) => <li key={i} style={{ color: n.blocked ? "#b00" : "#333" }}>{n.host} — {n.bytes} B {n.blocked ? "(blocked)" : ""}</li>)}
          </ul>
        </details>
      )}

      {steps.map((s) => (
        <div key={s.step} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8 }}>
          <div><b>Step {s.step}</b> — {s.action}</div>
          {s.summary && <div style={{ color: "#268" }}>👁 {s.summary}</div>}
          <div style={{ color: "#555" }}>{s.thought}</div>
          <div style={{ color: "#777" }}>→ {s.observation}</div>
          <details>
            <summary>What the server saw</summary>
            <img src={s.sanitizedPng} style={{ maxWidth: "100%", border: "1px solid #ccc" }} />
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{JSON.stringify(s.manifest, null, 2)}</pre>
          </details>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 9: Replace `extension/entrypoints/background.ts`** with the full router + loop wiring

```ts
import { Msg } from "../src/messaging";
import { setFirewall } from "../src/firewall";
import { runAgent } from "../src/agent/loop";
import { CFG } from "../src/config";

const OFFSCREEN_PATH = "offscreen.html";
let creating: Promise<void> | null = null;

export async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType] });
  if (existing.length) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["WORKERS" as chrome.offscreen.Reason, "DOM_SCRAPING" as chrome.offscreen.Reason],
        justification: "Run WebGPU perception + OCR/NER models and canvas redaction off the main thread.",
      })
      .then(() => { creating = null; });
  }
  await creating;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab!.id!;
}

function emit(kind: string, payload: Record<string, unknown>) {
  chrome.runtime.sendMessage({ type: Msg.AGENT_EVENT, payload: { kind, ...payload } }).catch(() => {});
}

async function postStep(url: string, body: string) {
  emit("net", { host: new URL(url).host, bytes: body.length });
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  return r.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === Msg.SET_FIREWALL) {
    setFirewall(!!msg.payload.on).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === Msg.AGENT_START) {
    (async () => {
      await ensureOffscreen();
      const tabId = await activeTabId();

      const res = await runAgent(msg.payload.task, {
        perceive: async (newSession) => {
          const png = await chrome.tabs.captureVisibleTab({ format: "png" });
          const collected = await chrome.tabs.sendMessage(tabId, { type: Msg.COLLECT_REGIONS });
          return chrome.runtime.sendMessage({
            target: "offscreen", type: Msg.RUN_PERCEPTION,
            payload: { png, regionList: collected.regionList, domSensitive: collected.domSensitive, task: msg.payload.task, newSession },
          });
        },
        askServer: (task, p, history) =>
          postStep(`${CFG.serverUrl}/agent/step`, JSON.stringify({ task, image_b64: p.sanitizedPng, manifest: p.manifest, history })),
        resolve: async (action) =>
          (await chrome.runtime.sendMessage({ target: "offscreen", type: Msg.RESOLVE_ACTION, payload: { action } })).action,
        execute: (action) => chrome.tabs.sendMessage(tabId, { type: Msg.EXECUTE_ACTION, payload: { action } }),
        emit: ({ step, action, observation, perceive }) =>
          emit("step", { step: { step, thought: action.thought, action: JSON.stringify(action), observation, sanitizedPng: perceive.sanitizedPng, manifest: perceive.manifest, summary: perceive.screenSummary } }),
      }, { maxSteps: CFG.maxSteps });

      emit("end", { status: res.status });
      sendResponse({ ok: true });
    })();
    return true;
  }
  return false;
});
```

- [ ] **Step 10: Full unit-test run**

Run: `pnpm test`
Expected: every suite green (contracts, validators, mapping, fuse, manifest, parse, mock, server index, walk, execute, pipeline, loop).

- [ ] **Step 11: Commit**

```bash
git add extension/src/config.ts extension/src/agent extension/entrypoints/sidepanel extension/entrypoints/background.ts extension/src/agent/loop.test.ts
git commit -m "feat(extension): agent loop, side panel UI, background orchestration"
```

---

## Task 12: Network firewall (declarativeNetRequest)

**Files:**
- Create: `extension/src/firewall.ts`
- Test: `extension/src/firewall.test.ts`

- [ ] **Step 1: Write the failing test `extension/src/firewall.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildBlockRules, ALLOWLIST } from "./firewall.js";

describe("buildBlockRules", () => {
  it("produces one block-all rule plus an allow rule per allowlisted host", () => {
    const rules = buildBlockRules();
    const allow = rules.filter((r) => r.action.type === "allow");
    const block = rules.filter((r) => r.action.type === "block");
    expect(block).toHaveLength(1);
    expect(allow.map((r) => r.condition.requestDomains?.[0]).sort()).toEqual([...ALLOWLIST].sort());
  });

  it("allow rules outrank the block rule", () => {
    const rules = buildBlockRules();
    const block = rules.find((r) => r.action.type === "block")!;
    const allow = rules.find((r) => r.action.type === "allow")!;
    expect(allow.priority).toBeGreaterThan(block.priority);
  });

  it("every rule id is unique", () => {
    const ids = buildBlockRules().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run extension/src/firewall.test.ts`
Expected: FAIL — `Cannot find module './firewall.js'`.

- [ ] **Step 3: Create `extension/src/firewall.ts`**

```ts
export const ALLOWLIST = [
  "huggingface.co", "cdn-lfs.huggingface.co", "cdn-lfs-us-1.huggingface.co",
  "cdn.jsdelivr.net", "storage.googleapis.com", "unpkg.com", "localhost",
] as const;

type Rule = chrome.declarativeNetRequest.Rule;

export function buildBlockRules(): Rule[] {
  const block = {
    id: 1,
    priority: 1,
    action: { type: "block" },
    condition: { urlFilter: "*" },
  } as unknown as Rule;
  const allow: Rule[] = ALLOWLIST.map((host, i) => ({
    id: 100 + i,
    priority: 10,
    action: { type: "allow" },
    condition: { requestDomains: [host] },
  }) as unknown as Rule);
  return [block, ...allow];
}

export async function setFirewall(on: boolean): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: on ? buildBlockRules() : [],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run extension/src/firewall.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add extension/src/firewall.ts extension/src/firewall.test.ts
git commit -m "feat(extension): declarativeNetRequest network firewall with allowlist"
```

---

## Task 13: Demo page + docs

**Files:**
- Create: `demo/demo-dashboard.html`
- Create: `demo/README.md`

- [ ] **Step 1: Create `demo/demo-dashboard.html`**

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>ISRO Ops Console (demo)</title>
<style>
  body{font:14px system-ui;margin:0;background:#0b1a2b;color:#e8eef5}
  header{background:#12263f;padding:12px 20px;font-weight:600}
  main{padding:20px;max-width:760px}
  .card{background:#12263f;border:1px solid #26415f;border-radius:8px;padding:16px;margin-bottom:16px}
  label{display:block;margin:8px 0 4px}
  input{padding:8px;width:260px;border-radius:6px;border:1px solid #375d84;background:#0b1a2b;color:#e8eef5}
  button{margin-top:12px;padding:8px 14px;border:0;border-radius:6px;background:#2e73c7;color:#fff;cursor:pointer}
  table{border-collapse:collapse;width:100%}
  td,th{border:1px solid #26415f;padding:8px;text-align:left}
  .avatar{width:48px;height:48px;border-radius:50%;background:#8899aa;display:inline-block}
  [hidden]{display:none}
</style></head>
<body>
<header>ISRO Operations Console — DEMO (synthetic data)</header>
<main>
  <section class="card" id="login">
    <h3>Operator sign-in</h3>
    <label for="username">Operator ID</label>
    <input id="username" autocomplete="username" />
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" />
    <button id="login-btn">Sign in</button>
  </section>

  <section class="card" id="telemetry" hidden>
    <h3>Duty roster</h3>
    <table>
      <tr><th>Field</th><th>Value</th></tr>
      <tr><td>Operator</td><td>A. Menon</td></tr>
      <tr><td>Phone</td><td>9000000000</td></tr>
      <tr><td>Email</td><td>ops.lead@vssc.test</td></tr>
      <tr><td>PAN</td><td>ABCDE1234F</td></tr>
      <tr><td>Photo</td><td><span class="avatar" data-sensitive></span></td></tr>
    </table>
    <button id="open-report">Open VSSC-03 report</button>
  </section>

  <section class="card" id="report" hidden>
    <h3>Telemetry report — station VSSC-03</h3>
    <p>Downlink nominal. Last packet 12:04:37 IST. Battery bus 28.1 V. No anomalies flagged.</p>
  </section>
</main>
<script>
  document.getElementById("login-btn").addEventListener("click", () => {
    document.getElementById("telemetry").hidden = false;
  });
  document.getElementById("open-report").addEventListener("click", () => {
    document.getElementById("report").hidden = false;
  });
</script>
</body></html>
```

- [ ] **Step 2: Create `demo/README.md`**

```md
# Demo target

Serve this folder (`npx serve demo`) and open the printed `http://localhost:xxxx`
URL so the content script injects. All data is synthetic.

Task to try:

> log in as the operator and open the telemetry report for station VSSC-03

Expected: the agent types a placeholder into the password field, the server never
receives "A. Menon" / "9000000000" / "ABCDE1234F" / "ops.lead@vssc.test", and the
report block becomes visible.
```

- [ ] **Step 3: Commit**

```bash
git add demo
git commit -m "test: synthetic ISRO ops-console demo page"
```

---

## Task 14: End-to-end wiring pass (mock mode)

**Files:**
- Create: `docs/DEMO.md`
- Modify: any files where `wxt build` surfaces type errors (expected: `chrome` enum casts already applied in Tasks 8/11/12)

- [ ] **Step 1: Build the extension**

Run: `pnpm --filter @sentrylens/extension build`
Expected: `.output/chrome-mv3/` produced. Fix any TypeScript errors surfaced (most likely candidates and their fixes: `chrome.runtime.ContextType` — keep the `as` cast shown; `@huggingface/transformers` deep types — the `any`-typed model handles in `detector.ts`/`ner.ts` are intentional; missing `@types/dom-webcodecs` for `ImageBitmap` — add `"lib": ["ES2022","DOM","DOM.Iterable"]` already in base). Re-run until clean.

- [ ] **Step 2: Start the server in mock mode**

Run: `cd server && MOCK=1 pnpm start`
Expected: `sentrylens server on :8787 (mock=true)`.

- [ ] **Step 3: Serve the demo and load the extension**

Run (new shell): `npx serve "D:/SIH 2026/demo"` → note the URL (e.g. `http://localhost:3000`).
Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `extension/.output/chrome-mv3`. Pin it. Open the demo URL. Click the SentryLens toolbar icon to open the side panel.

- [ ] **Step 4: Run a task**

Keep the default task, click **Run task**.
Expected:
- Step cards appear; mock mode ends `done` after 3 steps.
- Each card's "What the server saw" shows a masked screenshot and manifest JSON containing `PASSWORD#…`, `PERSON_NAME#…` or `PHONE_NUMBER#…`, `PAN#…`, `EMAIL#…`, `FACE#1` — and no raw values.
- The "Network" list shows only `localhost:8787` rows.

- [ ] **Step 5: Leak check**

Expand every step's manifest; browser-find for `Menon`, `9000000000`, `ABCDE1234F`, `ops.lead@vssc.test` → zero matches. Open offscreen devtools (`chrome://extensions` → SentryLens → "Inspect views: offscreen.html") → no uncaught errors. If a bbox mask is visibly offset from the text, add/verify `viewportToImage` is applied to DOM + face bboxes in `pipeline.ts` (it is, in Task 9 Step 8) and that OCR bboxes are left in image px.

- [ ] **Step 6: Write `docs/DEMO.md`**

```md
# SentryLens demo walkthrough

## Prereqs
- Chrome/Edge 113+ (WebGPU). `chrome://gpu` should show "WebGPU: Hardware accelerated".
- Node 24, pnpm 11.

## Run
1. `pnpm install`
2. `cd server && cp .env.example .env` (leave `MOCK=1` for the first run) → `pnpm start`
3. `pnpm --filter @sentrylens/extension build`
4. `chrome://extensions` → Developer mode → Load unpacked → `extension/.output/chrome-mv3`
5. `npx serve demo` → open the printed URL
6. Open the SentryLens side panel → Run task

## What to show the evaluators
- The split "What the server saw": redacted screenshot + manifest JSON, no raw PII.
- The Network list: only `localhost:8787`.
- Toggle **Network firewall ON**, re-run: perception + redaction still work from cache.
- (Real model) set `MOCK=0` + OpenRouter key in `server/.env`, restart, re-run.

## Troubleshooting
- First run downloads OCR/NER/face/VLM models (30–60 s). Wait; subsequent runs are instant.
- No WebGPU: perception falls back to WASM; SmolVLM summary is skipped (a notice shows). Everything else still works.
- Side panel shows nothing: reload the extension, then reload the demo tab so the content script re-injects.
```

- [ ] **Step 7: Commit**

```bash
git add docs/DEMO.md
git commit -m "docs: end-to-end demo walkthrough (mock mode verified)"
```

---

## Task 15: Real provider (OpenRouter) + multi-step run

**Files:**
- Create (local, gitignored): `server/.env`
- Modify: `docs/DEMO.md`

- [ ] **Step 1: Configure a real provider**

Create `server/.env`:

```
PORT=8787
MOCK=0
PROVIDER=openrouter
MODEL=qwen/qwen2.5-vl-32b-instruct:free
BASE_URL=https://openrouter.ai/api/v1
API_KEY=<your OpenRouter key>
```

- [ ] **Step 2: Restart the server and re-run the task**

Run: `cd server && pnpm start` (no `MOCK=1`).
Run the same task from the side panel.
Expected: the VLM issues real actions — types the operator id, types a value into the password field (a placeholder if the demo password were PII; since it is a literal in the demo, the model may type a literal — acceptable for the MVP), clicks **Sign in**, clicks **Open VSSC-03 report**, then emits `done` once the report text is visible.
If it loops or misgrounds: lower `CFG.maxSteps`, add one worked example to `SYSTEM_PROMPT`, or switch `MODEL` to `qwen/qwen2.5-vl-72b-instruct:free`.

- [ ] **Step 3: Append to `docs/DEMO.md`**

```md
## Offline deployment (the "final" story)
Run an open-weight VLM locally instead of OpenRouter:
`ollama pull qwen2.5-vl` then in `server/.env`:
`MOCK=0` `PROVIDER=ollama` `BASE_URL=http://localhost:11434/v1` `MODEL=qwen2.5-vl` `API_KEY=ollama`
The client and redaction pipeline are unchanged — only the server's upstream differs.
```

- [ ] **Step 4: Commit**

```bash
git add docs/DEMO.md
git commit -m "docs: real-provider (OpenRouter) and local Ollama instructions"
```

---

## Task 16: SmolVLM screen summary + firewall proof + README

**Files:**
- Create: `extension/src/perception/vlm.ts`
- Modify: `extension/entrypoints/offscreen/main.ts`
- Create: `README.md`

- [ ] **Step 1: Create `extension/src/perception/vlm.ts`**

```ts
import { AutoProcessor, AutoModelForVision2Seq, RawImage } from "@huggingface/transformers";

let processor: any = null;
let model: any = null;

export async function initVlm(): Promise<void> {
  if (model) return;
  processor = await AutoProcessor.from_pretrained("HuggingFaceTB/SmolVLM-256M-Instruct");
  model = await AutoModelForVision2Seq.from_pretrained("HuggingFaceTB/SmolVLM-256M-Instruct", {
    dtype: "q4f16", device: "webgpu",
  });
}

export async function screenSummary(pngDataUrl: string): Promise<string> {
  if (!model) return "";
  const image = await RawImage.fromURL(pngDataUrl);
  const messages = [
    { role: "user", content: [{ type: "image" }, { type: "text", text: "In one sentence, what screen is this and what can the user do here?" }] },
  ];
  const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await processor(prompt, [image]);
  const ids = await model.generate({ ...inputs, max_new_tokens: 48, do_sample: false });
  const text = processor.batch_decode(ids, { skip_special_tokens: true })[0] as string;
  return text.split("Assistant:").pop()!.trim().slice(0, 200);
}
```

- [ ] **Step 2: Call it from `offscreen/main.ts`** — inside the perception `try` block, after `runOcr`, add:

```ts
let screenSummaryText = "";
try { await initVlm(); screenSummaryText = await screenSummary(png); } catch { /* WebGPU/VLM optional */ }
```

and change the success `sendResponse` to `sendResponse({ sanitizedPng, manifest, degraded, screenSummary: screenSummaryText });`
Add the import: `import { initVlm, screenSummary } from "../../src/perception/vlm";`

- [ ] **Step 3: Manual firewall proof**

- Warm caches: run one full task with **firewall OFF** (models download; watch the offscreen console).
- Toggle **Network firewall ON** in the side panel (optionally disable Wi-Fi).
- Run the task again.
Expected: perception + redaction still run (models from cache); the side panel Network list shows only `localhost:8787`; the offscreen DevTools Network tab shows no successful `huggingface.co` / `jsdelivr` requests (all served from cache).

- [ ] **Step 4: Create `README.md`**

```md
# SentryLens

On-device visual perception for privacy-preserving browser agents — SIH26171 (ISRO).

A Chrome/Edge MV3 extension + thin server. Screen perception and PII redaction run
entirely on-device via WebGPU; only an anonymised screenshot + a typed redaction
manifest reach the remote open-weight VLM. The VLM reasons over the manifest and
returns actions; the client resolves anonymised placeholders locally and executes
them. A session value↔placeholder table never leaves the browser.

## Deliverable mapping (PS SIH26171)
| PS ask | Where |
|---|---|
| Local vision processing (WebGPU) | `extension/src/perception/*` (YOLOS detector, SmolVLM summary, OCR, NER, faces) |
| Privacy-preserving filter | `extension/src/redaction/*` (fuse, validators, classify, mask, mapping) |
| Server-side integration | `server/` (`/agent/step`, OpenAI-compatible provider) |
| Redaction-aware server | `server/src/prompt.ts` + `RedactionManifest` contract in `shared/` |
| Working prototype (popular browsers) | Chrome/Edge MV3, `demo/demo-dashboard.html` |

## Quickstart
```
pnpm install
cd server && cp .env.example .env && pnpm start      # MOCK=1 by default
pnpm --filter @sentrylens/extension build
# chrome://extensions -> Load unpacked -> extension/.output/chrome-mv3
npx serve demo                                        # open the printed URL
```
See `docs/DEMO.md` for the full walkthrough and `SIH26171_Deep_Research_Report.md`
for the research and design rationale.

## Tests
`pnpm test` — contracts, validators (Luhn/Verhoeff), mapping determinism,
signal fusion, manifest no-leak, server parse/mock, DOM walk, executor, agent loop, firewall rules.
```

- [ ] **Step 5: Full test + build**

Run: `pnpm test && pnpm --filter @sentrylens/extension build`
Expected: all vitest suites green; extension builds clean.

- [ ] **Step 6: Commit**

```bash
git add extension/src/perception/vlm.ts extension/entrypoints/offscreen/main.ts README.md
git commit -m "feat: SmolVLM screen summary; docs: README and firewall proof"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §1 criterion 1 (E2E agentic loop) | 8–11, 14, 15 |
| §1 criterion 2 (no raw PII in payload) | 5 test, 9 test, 14 step 5 |
| §1 criterion 3 (firewall proof) | 12, 16 step 3 |
| §1 criterion 4 (WebGPU→WASM, VLM skip) | 9 (`hasWebGpu`, `degraded`), 16 |
| §1 criterion 5 (fixture PII fully masked + mapped) | 5, 9 tests; 13 fixtures; 14 step 5 |
| §2 stack (WXT/TS/React, transformers.js, tesseract, GLiNER-style NER, mediapipe, Express, OpenRouter) | 0, 2, 6, 7, 8, 9, 16 |
| §3 repo layout | every task creates the listed files (`shared/`, `extension/{entrypoints,src}`, `server/src`, `demo/`) |
| §4 contracts + invariants (deterministic placeholder, table never leaves device, only `type` carries placeholders, mask pixels ↔ manifest bbox) | 1, 3, 5 (no-leak test), 9 (`RESOLVE_ACTION` only touches `type`), 5+14 (mask↔bbox) |
| §5 per-step data flow | 11 (`runAgent` + background wiring step 9) |
| §6 redaction engine (fuse / classify / mask / mapping / degraded / dpr) | 2, 3, 4, 5, 9 (`viewportToImage`) |
| §7 server (prompt / providers / parse / mock) | 6, 7 |
| §8 firewall (allowlist, dNR, outbound log) | 12, 11 step 9 (`emit("net")`), 16 |
| §9 error-handling table | 6 (parse repair), 7 (400/502 + repair), 9 (`degraded`), 10 (missing element observation), 11 (`notFoundStreak`, budget fail) |
| §10 testing (unit + integration + manual E2E + synthetic fixtures) | every task's tests; 13; 14; 16 |
| §11 build order | Tasks 0→16 follow it: validators/mapping before fuse; server before the extension loop; SmolVLM last |
| §12 A2 (`viewportToImage`) | promoted to `geometry.ts` in Task 4 step 2, applied in Task 9 step 8, verified in Task 14 step 5 |

No spec requirement is left without a task.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases/add validation" anywhere. Every code step contains complete code. Task 15 step 2's "acceptable for the MVP" is a runtime-tuning note about model behaviour, not missing implementation.

**3. Type consistency check:**
- `MappingTable` — methods `placeholderFor`, `resolve`, `resolveAll`, `clear` used identically in Tasks 3 (def), 5, 9.
- `AgentAction` discriminated union — identical shape in Tasks 1 (def), 6, 7, 10, 11.
- `Msg.*` — defined once in Task 8, imported in 9, 10, 11, 12.
- `assemblePerception(args: AssembleArgs)` — signature identical in Task 9 test and impl; `image.dpr` consumed.
- `buildManifest(args: BuildManifestArgs)` — identical field set (`image`, `elements`, `redacted`, `mapping`, `degraded`) in Tasks 5 (def) and 9 (call).
- `runAgent(task, deps, {maxSteps})` / `AgentDeps` — identical between Task 11 test, impl, and background wiring (step 9).
- `RUN_PERCEPTION` response shape (`sanitizedPng`, `manifest`, `degraded`, `screenSummary?`) — produced in Task 9 step 9, extended in Task 16 step 2, consumed in Task 11 (`PerceiveResult`).
- `buildBlockRules` / `ALLOWLIST` — Task 12 def and test agree; `setFirewall` referenced by `background.ts` in Tasks 8 & 11.
- `collectInteractableElements` — defined in Task 8 step 5, reused by `content.ts` (step 6) for the resolver map and by `walkDom`; the executor's default resolver (Task 10) reads the same `window.__sentrylensRegions` the content script sets.

One naming note fixed inline: Task 8's `content.ts` builds `window.__sentrylensRegions` from `collectInteractableElements()` (same filter as `walkDom`), so the ids the executor resolves match the ids in the `RegionList` the server sees. Kept consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-09-sentrylens-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
