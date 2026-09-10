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
