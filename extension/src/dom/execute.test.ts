// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { executeAction, __setRegionResolver } from "./execute.js";

describe("executeAction", () => {
  it("clicks the element mapped from target_id", async () => {
    document.body.innerHTML = `<button id="b">Go</button>`;
    const btn = document.getElementById("b")!;
    const spy = vi.fn();
    btn.addEventListener("click", spy);
    __setRegionResolver((id) => (id === 7 ? btn : null));
    const r = await executeAction({ type: "click", target_id: 7, thought: "" });
    expect(spy).toHaveBeenCalledOnce();
    expect(r.ok).toBe(true);
  });

  it("types a value into an input and fires input+change", async () => {
    document.body.innerHTML = `<input id="i" />`;
    const input = document.getElementById("i") as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));
    __setRegionResolver(() => input);
    await executeAction({ type: "type", target_id: 1, value: "ops@vssc.test", thought: "" });
    expect(input.value).toBe("ops@vssc.test");
    expect(events).toEqual(["input", "change"]);
  });

  it("returns ok:false with an observation when the element is missing", async () => {
    __setRegionResolver(() => null);
    const r = await executeAction({ type: "click", target_id: 99, thought: "" });
    expect(r.ok).toBe(false);
    expect(r.observation).toContain("99");
  });

  it("done/fail actions are no-ops that report the answer/reason", async () => {
    expect((await executeAction({ type: "done", answer: "42", thought: "" })).observation).toContain("42");
    expect((await executeAction({ type: "fail", reason: "stuck", thought: "" })).observation).toContain("stuck");
  });
});
