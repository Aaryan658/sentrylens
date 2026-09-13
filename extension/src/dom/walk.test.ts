// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { walkDom, domSensitiveRegions } from "./walk.js";

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

describe("domSensitiveRegions", () => {
  it("flags a table row's value cell as PERSON_NAME when the label cell is a known person-label", () => {
    document.body.innerHTML = `
      <table>
        <tr><td>Operator</td><td>A. Menon</td></tr>
        <tr><td>Phone</td><td>9000000000</td></tr>
      </table>`;
    stubRects();
    const hits = domSensitiveRegions();
    const names = hits.filter((h) => h.category === "PERSON_NAME");
    expect(names).toHaveLength(1);
    expect(names[0]!.bbox).toEqual([5, 6, 40, 12]);
  });

  it("matches labels case-insensitively and with a trailing colon", () => {
    document.body.innerHTML = `<table><tr><td>operator:</td><td>A. Menon</td></tr></table>`;
    stubRects();
    expect(domSensitiveRegions().filter((h) => h.category === "PERSON_NAME")).toHaveLength(1);
  });

  it("does not flag a row whose label isn't a known person-label", () => {
    document.body.innerHTML = `<table><tr><td>Station</td><td>VSSC-03</td></tr></table>`;
    stubRects();
    expect(domSensitiveRegions().filter((h) => h.category === "PERSON_NAME")).toHaveLength(0);
  });

  it("ignores a row with fewer than two cells", () => {
    document.body.innerHTML = `<table><tr><th colspan="2">Operator</th></tr></table>`;
    stubRects();
    expect(domSensitiveRegions().filter((h) => h.category === "PERSON_NAME")).toHaveLength(0);
  });

  it("still reports password/email/tel inputs alongside table-row names", () => {
    document.body.innerHTML = `
      <input type="password" />
      <table><tr><td>Employee Name</td><td>Anita Rao</td></tr></table>`;
    stubRects();
    const cats = domSensitiveRegions().map((h) => h.category).sort();
    expect(cats).toEqual(["PASSWORD", "PERSON_NAME"]);
  });

  it("flags a username-autocomplete input as PERSON_NAME regardless of its typed value", () => {
    document.body.innerHTML = `<input id="username" autocomplete="username" />`;
    stubRects();
    const doc = document.getElementById("username") as HTMLInputElement;
    doc.value = "operator-42";
    const hits = domSensitiveRegions();
    expect(hits).toEqual([{ bbox: [5, 6, 40, 12], category: "PERSON_NAME" }]);
  });

  it("does not flag a plain text input with no autocomplete hint", () => {
    document.body.innerHTML = `<input id="notes" type="text" />`;
    stubRects();
    expect(domSensitiveRegions()).toEqual([]);
  });
});
