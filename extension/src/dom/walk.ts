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
  category: "PASSWORD" | "EMAIL" | "PHONE_NUMBER" | "CREDIT_CARD" | "PERSON_NAME" | "OTHER";
}

// The on-device NER model is unreliable on OCR'd "label value" text — a
// person's name right next to a field label like "Operator" (no punctuation
// between them) is exactly the pattern it misses most, because that's how a
// table row reads once OCR flattens it to plain text. DOM structure still
// has the label/value boundary the pixels lost, so for this narrow, common
// "profile/roster table" shape we flag the value deterministically instead
// of depending on vision. This is a fallback net, not a replacement for NER —
// it only fires for table rows whose first cell is a known person-label.
const PERSON_LABELS = new Set([
  "operator", "name", "full name", "employee", "employee name", "patient",
  "patient name", "owner", "contact", "contact name", "signed by",
  "authorized by", "reported by", "assigned to", "customer", "customer name",
  "user", "account holder", "cardholder", "cardholder name", "passenger",
  "applicant", "student", "student name", "next of kin",
]);

function isPersonLabel(text: string): boolean {
  return PERSON_LABELS.has(text.trim().toLowerCase().replace(/:\s*$/, ""));
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
    else if (ac === "username") push(el, "PERSON_NAME");
  }
  for (const el of Array.from(document.querySelectorAll("[data-sensitive]"))) push(el, "OTHER");
  for (const row of Array.from(document.querySelectorAll("tr"))) {
    const cells = Array.from(row.querySelectorAll("td,th"));
    if (cells.length < 2) continue;
    if (isPersonLabel(cells[0]!.textContent ?? "")) push(cells[1]!, "PERSON_NAME");
  }
  return hits;
}
