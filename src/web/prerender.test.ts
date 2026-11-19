import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prerender } from "./prerender.js";

const template = readFileSync(new URL("./index.html", import.meta.url), "utf8");

describe("prerender", () => {
  it("puts the loading page inside the root of index.html", () => {
    const html = prerender(template);

    expect(html).toMatch(/<div id="root"><div class="page">.*<h1>AInakupo<\/h1>/s);
    expect(html).toMatch(/role="status"[^>]*>Loading…</);
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("<title>AInakupo</title>");
  });

  it("adds no inline script or style, which the CSP would block", () => {
    const html = prerender(template);

    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toContain("style=");
    expect(html).not.toContain("<style");
  });

  it("refuses a template without an empty root", () => {
    expect(() => prerender("<html><body></body></html>")).toThrow(/root/);
  });
});
