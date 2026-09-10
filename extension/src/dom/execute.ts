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
      (el as HTMLElement).scrollIntoView?.({ block: "center" });
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
