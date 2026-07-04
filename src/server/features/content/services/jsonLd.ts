/**
 * Ready-to-embed Schema.org structured data for the headless API. The
 * consuming site drops these objects into <script type="application/ld+json">
 * to be rich-result eligible without extra work. URLs are the consumer's
 * concern, so none are emitted here.
 */

export interface ArticleFaqEntry {
  question: string;
  answer: string;
}

export interface ArticleJsonLdInput {
  title: string;
  metaDescription: string | null;
  author: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  faq: ArticleFaqEntry[];
}

export type JsonLdObject = Record<string, unknown>;

export function buildArticleJsonLd(input: ArticleJsonLdInput): JsonLdObject[] {
  const blogPosting: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.title,
  };
  if (input.metaDescription) blogPosting.description = input.metaDescription;
  if (input.author) {
    blogPosting.author = { "@type": "Person", name: input.author };
  }
  if (input.publishedAt) blogPosting.datePublished = input.publishedAt;
  if (input.updatedAt) blogPosting.dateModified = input.updatedAt;

  const objects: JsonLdObject[] = [blogPosting];

  if (input.faq.length > 0) {
    objects.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: input.faq.map((entry) => ({
        "@type": "Question",
        name: entry.question,
        acceptedAnswer: { "@type": "Answer", text: entry.answer },
      })),
    });
  }

  return objects;
}
