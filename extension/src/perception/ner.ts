import { configureTransformers } from "./env.js";
import { pipeline } from "@huggingface/transformers";
import type { PiiCategory } from "@sentrylens/shared";

let ner: any = null;

// Keys are normalised (uppercase, alphanumerics only) before lookup, so this
// covers both classic CoNLL labels (PER/LOC/ORG) and the ai4privacy-style PII
// vocabulary the multilang-pii-ner model actually emits (FIRSTNAME, LASTNAME…).
const LABEL_MAP: Record<string, PiiCategory> = {
  PER: "PERSON_NAME", PERSON: "PERSON_NAME", NAME: "PERSON_NAME",
  FIRSTNAME: "PERSON_NAME", LASTNAME: "PERSON_NAME", MIDDLENAME: "PERSON_NAME",
  GIVENNAME: "PERSON_NAME", SURNAME: "PERSON_NAME", FULLNAME: "PERSON_NAME",
  USERNAME: "PERSON_NAME",
  EMAIL: "EMAIL", EMAILADDRESS: "EMAIL",
  PHONE: "PHONE_NUMBER", TEL: "PHONE_NUMBER", PHONENUMBER: "PHONE_NUMBER",
  ADDRESS: "ADDRESS", STREETADDRESS: "ADDRESS", LOC: "ADDRESS", CITY: "ADDRESS",
  DATE: "DOB", DOB: "DOB", DATEOFBIRTH: "DOB",
  SSN: "GOV_ID", SOCIALNUMBER: "GOV_ID", IDCARDNUMBER: "GOV_ID", PASSPORTNUMBER: "GOV_ID",
  CREDITCARDNUMBER: "CREDIT_CARD",
  IP: "IP_ADDRESS", IPV4: "IP_ADDRESS", IPV6: "IP_ADDRESS", IPADDRESS: "IP_ADDRESS",
  ORG: "OTHER", COMPANYNAME: "OTHER",
};

export type NerDevice = "webgpu" | "wasm" | "cpu";

export async function initNer(device: NerDevice): Promise<void> {
  if (ner) return;
  configureTransformers();
  ner = await pipeline("token-classification", "onnx-community/multilang-pii-ner-ONNX", {
    device, dtype: device === "webgpu" ? "q4" : "q8",
  });
}

export async function disposeNer(): Promise<void> {
  await ner?.dispose?.();
  ner = null;
}

export interface NerSpan { category: PiiCategory; value: string; start: number; end: number }

// The PII-NER model has a bounded context (~512 tokens). A whole screen's worth
// of OCR text overflows it and throws, which would flag the run as degraded — so
// window the text and isolate each chunk's failure.
const NER_WINDOW = 1500;

export async function runNer(text: string): Promise<NerSpan[]> {
  if (!ner || !text.trim()) return [];

  const bounds: number[] = [0];
  while (bounds[bounds.length - 1]! + NER_WINDOW < text.length) {
    const from = bounds[bounds.length - 1]! + NER_WINDOW;
    const ws = text.lastIndexOf(" ", from);
    bounds.push(ws > (bounds[bounds.length - 1] ?? 0) ? ws + 1 : from);
  }
  bounds.push(text.length);

  const spans: NerSpan[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const base = bounds[i]!;
    const chunk = text.slice(base, bounds[i + 1]!);
    if (!chunk.trim()) continue;
    let out: Array<{ entity_group?: string; entity?: string; start: number; end: number; score: number }>;
    try {
      out = await ner(chunk, { aggregation_strategy: "simple" });
    } catch (e) {
      console.warn("[sentrylens] ner chunk failed:", e);
      continue;
    }
    for (const e of out) {
      if (e.score < 0.5) continue;
      const key = (e.entity_group ?? e.entity ?? "").toUpperCase().replace(/^[BI]-/, "").replace(/[^A-Z0-9]/g, "");
      const category = LABEL_MAP[key];
      if (!category) continue;
      spans.push({ category, value: chunk.slice(e.start, e.end), start: base + e.start, end: base + e.end });
    }
  }
  return spans;
}
