import { z } from "zod";

export const contentDocumentKindSchema = z.enum([
  "master_plan",
  "editorial_guidelines",
  "agent_instructions",
  "quality_rubric",
  "reference",
]);

export const contentDocumentFormatSchema = z.enum(["markdown", "json", "text"]);

export const contentAssetTypeSchema = z.enum([
  "blog",
  "pillar",
  "product",
  "other",
]);

export const getContentStrategyWorkspaceSchema = z.object({
  projectId: z.string().min(1),
});

export const importContentKeywordsSchema = z.object({
  projectId: z.string().min(1),
  content: z.string().min(1).max(200_000),
  sourceName: z.string().max(200).nullable().optional(),
});

export const saveContentDocumentSchema = z.object({
  projectId: z.string().min(1),
  kind: contentDocumentKindSchema,
  name: z.string().min(1).max(200),
  format: contentDocumentFormatSchema,
  content: z.string().min(1).max(1_000_000),
});

export const deleteContentDocumentSchema = z.object({
  projectId: z.string().min(1),
  documentId: z.string().min(1),
});

export const importContentUrlsSchema = z.object({
  projectId: z.string().min(1),
  contentType: contentAssetTypeSchema,
  content: z.string().min(1).max(200_000),
});

export const analyzeExistingContentSchema = z.object({
  projectId: z.string().min(1),
});

export const launchArticlesFromKeywordsSchema = z.object({
  projectId: z.string().min(1),
  sourceName: z.enum(["Saved Keywords", "Rank Tracking"]),
  keywords: z
    .array(
      z.object({
        keyword: z.string().min(1).max(200),
        searchVolume: z.number().int().nonnegative().nullable(),
      }),
    )
    .min(1)
    .max(50),
});

export const runCompetitorDiscoverySchema = z.object({
  projectId: z.string().min(1),
});

export const runRelatedDiscoverySchema = z.object({
  projectId: z.string().min(1),
});
