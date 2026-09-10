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
