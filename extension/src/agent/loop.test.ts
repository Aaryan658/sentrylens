import { describe, it, expect, vi } from "vitest";
import { runAgent, type AgentDeps } from "./loop.js";

const perceiveResult = {
  sanitizedPng: "png", degraded: false,
  manifest: { schema: "sentrylens-redaction/1.0", image: { w: 1, h: 1, dpr: 1 }, regions: [], notes: "n" } as any,
};

function deps(actions: any[]): AgentDeps {
  let i = 0;
  return {
    perceive: vi.fn(async () => perceiveResult),
    askServer: vi.fn(async () => ({ action: actions[Math.min(i++, actions.length - 1)] })),
    resolve: vi.fn(async (a) => a),
    execute: vi.fn(async (a) => ({ ok: true, observation: "obs" })),
    emit: vi.fn(),
  };
}

describe("runAgent", () => {
  it("loops until a done action and returns the history", async () => {
    const d = deps([
      { type: "click", target_id: 1, thought: "" },
      { type: "type", target_id: 2, value: "x", thought: "" },
      { type: "done", answer: "finished", thought: "" },
    ]);
    const res = await runAgent("task", d, { maxSteps: 10 });
    expect(res.status).toBe("done");
    expect(res.history).toHaveLength(3);
    expect(d.perceive).toHaveBeenCalledTimes(3);
  });

  it("stops with fail when the step budget is exceeded", async () => {
    const d = deps([{ type: "scroll", direction: "down", thought: "" }]);
    const res = await runAgent("task", d, { maxSteps: 3 });
    expect(res.status).toBe("fail");
    expect(res.history.at(-1)!.action.type).toBe("fail");
  });

  it("fails after two consecutive 'not found' observations", async () => {
    const d = deps([{ type: "click", target_id: 999, thought: "" }]);
    d.execute = vi.fn(async () => ({ ok: false, observation: "element 999 not found" }));
    const res = await runAgent("task", d, { maxSteps: 10 });
    expect(res.status).toBe("fail");
    expect(res.history.length).toBe(2);
  });
});
