import { describe, it, expect, beforeAll } from "vitest";
import type { AddressInfo } from "node:net";

let base: string;

beforeAll(async () => {
  process.env.MOCK = "1";
  const { app } = await import("./index.js");
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

const body = {
  task: "log in",
  image_b64: "AAAA",
  manifest: {
    schema: "sentrylens-redaction/1.0",
    image: { w: 10, h: 10, dpr: 1 },
    regions: [{ id: 1, kind: "element", role: "button", text: "Login", interactable: true, bbox: [0, 0, 5, 5] }],
    notes: "n",
  },
  history: [],
};

describe("POST /agent/step (mock mode)", () => {
  it("returns a valid AgentAction referencing a real element id", async () => {
    const r = await fetch(`${base}/agent/step`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.action.type).toBe("click");
    expect(j.action.target_id).toBe(1);
  });

  it("400s on a malformed body", async () => {
    const r = await fetch(`${base}/agent/step`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nope: true }) });
    expect(r.status).toBe(400);
  });
});
