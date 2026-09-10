// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { walkDom } from "./walk.js";

function stubRects() {
  for (const el of document.querySelectorAll("*")) {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ x: 5, y: 6, width: 40, height: 12, top: 6, left: 5, right: 45, bottom: 18, toJSON() {} }) as DOMRect;
  }
}

describe("walkDom", () => {
  it("collects interactable elements with ids, roles, names and bboxes", () => {
    document.body.innerHTML = `
      <button id="b1">Login</button>
      <input id="i1" type="text" aria-label="Username" />
      <a href="#">Reports</a>
      <p>ignored paragraph text that is long enough to look like a real block</p>`;
    stubRects();
    const list = walkDom("https://x.test/", { w: 1280, h: 800, dpr: 1 });
    const names = list.regions.map((r) => r.name).sort();
    expect(names).toContain("Login");
    expect(names).toContain("Username");
    expect(names).toContain("Reports");
    expect(list.regions.every((r) => Array.isArray(r.bbox) && r.bbox.length === 4)).toBe(true);
    expect(list.regions.every((r) => typeof r.id === "number")).toBe(true);
  });

  it("reports a password input's domType", () => {
    document.body.innerHTML = `<input id="p" type="password" />`;
    stubRects();
    const list = walkDom("u", { w: 1, h: 1, dpr: 1 });
    expect(list.regions.find((r) => r.domType === "password")).toBeTruthy();
  });
});
