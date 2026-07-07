import { z } from "zod";

// ─── Server function input schemas ──────────────────────────────────────────

export const generateArticleSchema = z.object({
  projectId: z.string().min(1),
  keyword: z.string().min(1).max(200),
  locationCode: z.number().int().optional(),
  languageCode: z.string().min(2).max(10).optional(),
});

export const listArticlesSchema = z.object({
  projectId: z.string().min(1),
});

export const getArticleSchema = z.object({
  projectId: z.string().min(1),
  articleId: z.string().min(1),
});

export const updateArticleSchema = z.object({
  projectId: z.string().min(1),
  articleId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  metaDescription: z.string().max(300).optional(),
  author: z.string().max(120).nullable().optional(),
  slug: z.string().min(1).max(120).optional(),
  markdown: z.string().max(200_000).optional(),
  faq: z
    .array(
      z.object({
        question: z.string().min(1).max(500),
        answer: z.string().min(1).max(5_000),
      }),
    )
    .optional(),
});

export const setArticleStatusSchema = z.object({
  projectId: z.string().min(1),
  articleId: z.string().min(1),
  status: z.enum(["draft", "published"]),
});

export const retryArticleSchema = z.object({
  projectId: z.string().min(1),
  articleId: z.string().min(1),
});

export const deleteArticleSchema = z.object({
  projectId: z.string().min(1),
  articleId: z.string().min(1),
});

export const createContentApiKeySchema = z.object({
  projectId: z.string().min(1),
  label: z.string().min(1).max(80),
});

export const listContentApiKeysSchema = z.object({
  projectId: z.string().min(1),
});

export const revokeContentApiKeySchema = z.object({
  projectId: z.string().min(1),
  keyId: z.string().min(1),
});
