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

type ElementRegion = Extract<ServerRequest["manifest"]["regions"][number], { kind: "element" }>;

/**
 * Offline stand-in for a vision model. It walks a realistic login flow so the
 * demo shows the whole privacy round-trip — most importantly typing a redacted
 * field, where the server only ever sees the placeholder (`PASSWORD#1`) and the
 * extension substitutes the real value locally before it hits the page. State is
 * derived from `history`, so it is deterministic and needs no memory.
 */
export function mockRespond(req: ServerRequest): AgentAction {
  const els = req.manifest.regions.filter(
    (r): r is ElementRegion => r.kind === "element" && r.interactable,
  );
  if (els.length === 0) return { type: "fail", reason: "no interactable elements", thought: "mock" };

  const typedInto = (id: number) =>
    req.history.some((h) => h.action.type === "type" && h.action.target_id === id);
  const clicked = (id: number) =>
    req.history.some((h) => h.action.type === "click" && h.action.target_id === id);

  const field = (re: RegExp) => els.find((e) => e.role !== "button" && re.test(e.text));
  const userField = field(/\b(operator|user(name)?|email|login|account|id)\b/i);
  const passField = field(/pass(word|phrase)?|\bpin\b/i);
  const submitBtn =
    els.find((e) => e.role === "button" && /sign\s?in|log\s?in|submit|continue|enter/i.test(e.text)) ??
    els.find((e) => e.role === "button");
  const redacted = req.manifest.regions.find((r) => r.kind === "redacted");

  // 1 — fill the login form, then submit it.
  if (userField && !typedInto(userField.id))
    return { type: "type", target_id: userField.id, value: "operator-42", thought: "mock: enter operator id" };
  if (passField && !typedInto(passField.id))
    return {
      type: "type",
      target_id: passField.id,
      value: redacted?.kind === "redacted" ? redacted.placeholder : "••••••",
      thought: "mock: enter password via its redacted placeholder — server never sees the value",
    };
  if (submitBtn && !clicked(submitBtn.id))
    return { type: "click", target_id: submitBtn.id, thought: `mock: click ${submitBtn.text}` };

  // 2 — post-login: chase whatever best matches the task, once. Skip the form
  // controls we already handled.
  const handled = new Set([userField?.id, passField?.id, submitBtn?.id]);
  const target = [...els]
    .filter((e) => !clicked(e.id) && !handled.has(e.id))
    .sort((a, b) => score(b.text, req.task) - score(a.text, req.task))[0];
  if (target && score(target.text, req.task) > 0 && req.history.length < 8)
    return { type: "click", target_id: target.id, thought: `mock: open ${target.text}` };

  return { type: "done", answer: "mock: signed in and opened the requested report", thought: "mock stop" };
}
