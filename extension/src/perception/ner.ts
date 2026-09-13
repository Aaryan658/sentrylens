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

export interface RawNerToken {
  entity?: string;
  entity_group?: string;
  score: number;
  word: string;
  start?: number;
  end?: number;
}

// The PII-NER model has a bounded context (~512 tokens). A whole screen's worth
// of OCR text overflows it and throws, which would flag the run as degraded — so
// window the text and isolate each chunk's failure.
const NER_WINDOW = 1500;

// transformers.js@3.7.1's TokenClassificationPipeline does not implement
// aggregation_strategy (start/end are literally TODOs in its source) — it
// returns one raw, unmerged prediction per wordpiece with no offsets. Passing
// aggregation_strategy was therefore a silent no-op: entity_group/start/end
// were always undefined, so `chunk.slice(e.start, e.end)` returned the WHOLE
// chunk for every hit. That inflated span then either mis-masked huge regions
// or — since the model also tags most tokens "O" once real screen text has
// mixed numbers/labels around a name — produced zero spans entirely, e.g.
// "Operator A. Menon" in real screen text yielded no NER hits at all and the
// name leaked unmasked. This reconstructs offsets ourselves and merges
// adjacent same-category wordpieces (the model's B-/I- tagging is unreliable
// here, so we merge on proximity + matching category rather than trusting
// BIO prefixes).
const MERGE_GAP = 3;

export function mergeNerTokens(tokens: RawNerToken[], chunk: string, base: number): NerSpan[] {
  const spans: NerSpan[] = [];
  let cursor = 0;
  let current: { category: PiiCategory; start: number; end: number } | null = null;

  const flush = () => {
    if (current) {
      spans.push({ category: current.category, value: chunk.slice(current.start, current.end), start: base + current.start, end: base + current.end });
      current = null;
    }
  };

  for (const t of tokens) {
    let tokenStart: number, tokenEnd: number;
    if (typeof t.start === "number" && typeof t.end === "number") {
      tokenStart = t.start;
      tokenEnd = t.end;
    } else {
      const word = (t.word ?? "").trim();
      if (!word) continue;
      let idx = chunk.indexOf(word, cursor);
      if (idx === -1) idx = chunk.toLowerCase().indexOf(word.toLowerCase(), cursor);
      if (idx === -1) continue; // can't place this wordpiece — drop rather than risk a bogus span
      tokenStart = idx;
      tokenEnd = idx + word.length;
    }
    cursor = Math.max(cursor, tokenEnd);

    const key = (t.entity_group ?? t.entity ?? "").toUpperCase().replace(/^[BI]-/, "").replace(/[^A-Z0-9]/g, "");
    const category = LABEL_MAP[key];

    if (!category || t.score < 0.5) { flush(); continue; }

    if (current && current.category === category && tokenStart - current.end <= MERGE_GAP) {
      current.end = tokenEnd;
    } else {
      flush();
      current = { category, start: tokenStart, end: tokenEnd };
    }
  }
  flush();
  return spans;
}

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
    let out: RawNerToken[];
    try {
      out = await ner(chunk);
    } catch (e) {
      console.warn("[sentrylens] ner chunk failed:", e);
      continue;
    }
    spans.push(...mergeNerTokens(out, chunk, base));
  }
  return spans;
}
