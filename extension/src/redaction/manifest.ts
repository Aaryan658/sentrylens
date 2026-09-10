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
  const counters: Record<string, number> = {};

  const elementRegions = elements.map((e) => ({
    id: e.id, bbox: e.bbox, kind: "element" as const,
    role: e.role, text: e.text, interactable: e.interactable,
  }));

  const redactedRegions: RedactedRegion[] = redacted.map((r, i) => {
    // A region whose value is unknown (FACE, or a DOM-detected field we cannot
    // read) gets a positional placeholder and NO mapping-table entry — there is
    // nothing to resolve it back to. Only value-bearing regions are registered.
    const placeholder =
      r.value == null
        ? `${r.category}#${(counters[r.category] = (counters[r.category] ?? 0) + 1)}`
        : mapping.placeholderFor(r.category, r.value);
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
