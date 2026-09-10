import { describe, it, expect } from "vitest";
import { mockRespond } from "./mock.js";
import type { ServerRequest } from "@sentrylens/shared";

const base: ServerRequest = {
  task: "log in as the operator",
  image_b64: "x",
  manifest: {
    schema: "sentrylens-redaction/1.0",
    image: { w: 100, h: 100, dpr: 1 },
    regions: [
      { id: 1, kind: "element", role: "textbox", text: "Username", interactable: true, bbox: [0, 0, 10, 10] },
      { id: 2, kind: "element", role: "button", text: "Login", interactable: true, bbox: [0, 20, 10, 10] },
    ],
  } as any,
  history: [],
};

describe("mockRespond", () => {
  it("clicks the element whose text best matches the task on the first step", () => {
    const a = mockRespond(base);
    expect(a.type).toBe("click");
    expect((a as any).target_id).toBe(2); // "Login" matches "log in"
  });
  it("returns done once history has >= 3 steps", () => {
    const a = mockRespond({ ...base, history: [1, 2, 3].map(() => ({ action: { type: "click", target_id: 2, thought: "" }, observation: "ok" })) as any });
    expect(a.type).toBe("done");
  });
});
