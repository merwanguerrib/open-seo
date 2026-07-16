import { describe, it, expect } from "vitest";
import { analyzeHtml } from "./page-analyzer";

describe("analyzeHtml internalLinkDetails", () => {
  it("captures anchor text for internal links and cleaned body text", () => {
    const html = `<html><body>
      <a href="/about">About us</a>
      <a href="https://other.com/x">External</a>
      <p>Hello   world</p>
      <script>ignored()</script>
    </body></html>`;
    const result = analyzeHtml(html, "https://site.com/", 200, 10);

    expect(result.internalLinkDetails).toEqual([
      { url: "https://site.com/about", anchorText: "About us" },
    ]);
    expect(result.cleanedText).toContain("Hello world");
    expect(result.cleanedText).not.toContain("ignored");
  });
});
