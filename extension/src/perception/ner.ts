import { pipeline } from "@huggingface/transformers";
import type { PiiCategory } from "@sentrylens/shared";

let ner: any = null;

const LABEL_MAP: Record<string, PiiCategory> = {
  PER: "PERSON_NAME", PERSON: "PERSON_NAME", NAME: "PERSON_NAME",
  EMAIL: "EMAIL", PHONE: "PHONE_NUMBER", TEL: "PHONE_NUMBER",
  ADDRESS: "ADDRESS", LOC: "ADDRESS", DATE: "DOB", ORG: "OTHER",
};

export type NerDevice = "webgpu" | "wasm" | "cpu";

export async function initNer(device: NerDevice): Promise<void> {
  if (ner) return;
  ner = await pipeline("token-classification", "onnx-community/multilang-pii-ner-ONNX", {
    device, dtype: device === "webgpu" ? "q4" : "q8",
  });
}

export async function disposeNer(): Promise<void> {
  await ner?.dispose?.();
  ner = null;
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
