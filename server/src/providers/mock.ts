import type { AgentAction, ServerRequest } from "@sentrylens/shared";

function score(text: string, task: string): number {
  const taskTokens = task.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const textTokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let hits = 0;
  for (const w of textTokens) {
    for (const q of taskTokens) {
      if (w === q || (q.length >= 2 && w.startsWith(q)) || (w.length >= 2 && q.startsWith(w))) {
        hits++;
        break;
      }
    }
  }
  return hits;
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
