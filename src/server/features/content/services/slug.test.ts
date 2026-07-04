import { describe, expect, it } from "vitest";
import { dedupeSlug, slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("How to Choose Project Management Software")).toBe(
      "how-to-choose-project-management-software",
    );
  });

  it("strips diacritics and punctuation", () => {
    expect(slugify("Élément clé : l'audit SEO !")).toBe(
      "element-cle-l-audit-seo",
    );
  });

  it("falls back when nothing survives", () => {
    expect(slugify("!!!")).toBe("article");
  });

  it("caps length without trailing hyphen", () => {
    const slug = slugify("a".repeat(70) + " " + "b".repeat(30));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("dedupeSlug", () => {
  it("returns the base when free", () => {
    expect(dedupeSlug("my-article", new Set())).toBe("my-article");
  });

  it("suffixes sequentially on collisions", () => {
    const existing = new Set(["my-article", "my-article-2"]);
    expect(dedupeSlug("my-article", existing)).toBe("my-article-3");
  });
});
