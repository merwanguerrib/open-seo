import { describe, it, expect } from "vitest";
import { buildSlugMap, buildGraphifyExportFiles } from "./graphify-export";

describe("buildSlugMap", () => {
  it("slugifies paths deterministically and disambiguates collisions", () => {
    const map = buildSlugMap([
      "https://s.com/blog/hello",
      "https://s.com/",
      "https://s.com/blog%2Fhello", // collides after sanitisation
    ]);
    expect(map.get("https://s.com/")).toBe("index");
    const slugs = [...map.values()];
    expect(new Set(slugs).size).toBe(3); // all unique
    expect(map.get("https://s.com/blog/hello")).toMatch(/^blog-hello/);
  });

  it("is order-independent", () => {
    const urls = ["https://s.com/a", "https://s.com/b"];
    const a = buildSlugMap(urls);
    const b = buildSlugMap([...urls].reverse());
    expect(a).toEqual(b);
  });
});

describe("buildGraphifyExportFiles", () => {
  const files = buildGraphifyExportFiles({
    auditId: "audit-1",
    startUrl: "https://s.com/",
    generatedAt: "2026-07-02T00:00:00.000Z",
    pages: [
      {
        id: "p1",
        url: "https://s.com/",
        title: "Home",
        statusCode: 200,
        text: "Welcome home",
      },
      {
        id: "p2",
        url: "https://s.com/about",
        title: 'About "us"',
        statusCode: 200,
        text: "About text",
      },
      {
        id: "p3",
        url: "https://s.com/no-content",
        title: "Empty",
        statusCode: 200,
        text: null,
      },
    ],
    edges: [
      { fromPageId: "p1", toPageId: "p2", anchorText: "About" },
      { fromPageId: "p1", toPageId: "p3", anchorText: "skipped (no file)" },
      { fromPageId: "p2", toPageId: null, anchorText: "unresolved" },
    ],
  });
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  it("writes one markdown file per content-bearing page with frontmatter", () => {
    const home = byPath.get("pages/index.md");
    expect(home).toContain('url: "https://s.com/"');
    expect(home).toContain('title: "Home"');
    expect(home).toContain("statusCode: 200");
    expect(home).toContain("Welcome home");
    expect(byPath.get("pages/about.md")).toContain('title: "About \\"us\\""');
    expect(byPath.has("pages/no-content.md")).toBe(false);
  });

  it("emits only edges between exported files", () => {
    const edges = JSON.parse(byPath.get("edges.json") ?? "[]");
    expect(edges).toEqual([
      { from: "pages/index.md", to: "pages/about.md", anchor: "About" },
    ]);
  });

  it("emits a manifest with the slug map for content pages", () => {
    const manifest = JSON.parse(byPath.get("manifest.json") ?? "{}");
    expect(manifest.auditId).toBe("audit-1");
    expect(manifest.startUrl).toBe("https://s.com/");
    expect(manifest.pageCount).toBe(2);
    expect(manifest.pages).toEqual([
      { slug: "about", url: "https://s.com/about" },
      { slug: "index", url: "https://s.com/" },
    ]);
  });
});
