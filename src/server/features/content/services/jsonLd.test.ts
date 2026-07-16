import { describe, expect, it } from "vitest";
import { buildArticleJsonLd } from "./jsonLd";

describe("buildArticleJsonLd", () => {
  it("builds a BlogPosting with all fields", () => {
    const [blogPosting] = buildArticleJsonLd({
      title: "How to choose PM software",
      metaDescription: "A practical guide.",
      author: "Jane Doe",
      publishedAt: "2026-07-04 10:00:00",
      updatedAt: "2026-07-05 10:00:00",
      faq: [],
    });

    expect(blogPosting).toMatchObject({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: "How to choose PM software",
      description: "A practical guide.",
      author: { "@type": "Person", name: "Jane Doe" },
      datePublished: "2026-07-04 10:00:00",
      dateModified: "2026-07-05 10:00:00",
    });
  });

  it("omits empty fields and skips FAQPage without faq entries", () => {
    const objects = buildArticleJsonLd({
      title: "T",
      metaDescription: null,
      author: null,
      publishedAt: null,
      updatedAt: null,
      faq: [],
    });
    expect(objects).toHaveLength(1);
    expect(objects[0]).not.toHaveProperty("description");
    expect(objects[0]).not.toHaveProperty("author");
  });

  it("adds a FAQPage when faq entries exist", () => {
    const objects = buildArticleJsonLd({
      title: "T",
      metaDescription: null,
      author: null,
      publishedAt: null,
      updatedAt: null,
      faq: [{ question: "Q1?", answer: "A1." }],
    });
    expect(objects).toHaveLength(2);
    expect(objects[1]).toMatchObject({
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Q1?",
          acceptedAnswer: { "@type": "Answer", text: "A1." },
        },
      ],
    });
  });
});
