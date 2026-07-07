import { z } from "zod";

export const getContentPlanSchema = z.object({
  projectId: z.string().min(1),
});

export const updateContentPlanSchema = z.object({
  projectId: z.string().min(1),
  enabled: z.boolean().optional(),
  cadencePerWeek: z.number().int().min(1).max(21).optional(),
  reviewWindowHours: z.number().int().min(0).max(720).optional(),
  autoPublish: z.boolean().optional(),
  minSearchVolume: z.number().int().min(0).max(1_000_000).optional(),
  maxDifficulty: z.number().int().min(0).max(100).optional(),
  blogUrlPattern: z.string().max(2048).nullable().optional(),
});

export const runDiscoverySchema = z.object({
  projectId: z.string().min(1),
});

export const listCalendarSchema = z.object({
  projectId: z.string().min(1),
});

export const dismissTopicSchema = z.object({
  projectId: z.string().min(1),
  topicId: z.string().min(1),
});

export const generateTopicNowSchema = z.object({
  projectId: z.string().min(1),
  topicId: z.string().min(1),
});

export const getArticleJourneySchema = z.object({
  projectId: z.string().min(1),
  articleId: z.string().min(1),
});

export const holdArticleSchema = z.object({
  projectId: z.string().min(1),
  articleId: z.string().min(1),
});
