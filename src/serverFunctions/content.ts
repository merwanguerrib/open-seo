import { createServerFn } from "@tanstack/react-start";
import { waitUntil } from "cloudflare:workers";
import { ContentService } from "@/server/features/content/services/ContentService";
import { captureServerEvent } from "@/server/lib/posthog";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  createContentApiKeySchema,
  deleteArticleSchema,
  generateArticleSchema,
  getArticleSchema,
  listArticlesSchema,
  listContentApiKeysSchema,
  retryArticleSchema,
  revokeContentApiKeySchema,
  setArticleStatusSchema,
  updateArticleSchema,
} from "@/types/schemas/content";

export const generateArticle = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => generateArticleSchema.parse(data))
  .handler(async ({ data, context }) => {
    const result = await ContentService.generateArticle({
      billingCustomer: context,
      projectId: context.projectId,
      keyword: data.keyword,
      locationCode: data.locationCode ?? context.project.locationCode,
      languageCode: data.languageCode ?? context.project.languageCode,
    });

    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "content:generate_article",
        organizationId: context.organizationId,
        properties: {
          project_id: context.projectId,
          keyword: data.keyword,
        },
      }),
    );

    return result;
  });

export const listArticles = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => listArticlesSchema.parse(data))
  .handler(async ({ context }) => {
    return ContentService.listArticles(context.projectId);
  });

export const getArticle = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => getArticleSchema.parse(data))
  .handler(async ({ data, context }) => {
    return ContentService.getArticle(data.articleId, context.projectId);
  });

export const updateArticle = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => updateArticleSchema.parse(data))
  .handler(async ({ data, context }) => {
    return ContentService.updateArticle({
      ...data,
      projectId: context.projectId,
    });
  });

export const setArticleStatus = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => setArticleStatusSchema.parse(data))
  .handler(async ({ data, context }) => {
    return ContentService.setArticleStatus({
      articleId: data.articleId,
      projectId: context.projectId,
      status: data.status,
    });
  });

export const retryArticle = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => retryArticleSchema.parse(data))
  .handler(async ({ data, context }) => {
    return ContentService.retryArticle({
      billingCustomer: context,
      projectId: context.projectId,
      articleId: data.articleId,
    });
  });

export const deleteArticle = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => deleteArticleSchema.parse(data))
  .handler(async ({ data, context }) => {
    await ContentService.removeArticle(data.articleId, context.projectId);
    return { success: true };
  });

export const createContentApiKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => createContentApiKeySchema.parse(data))
  .handler(async ({ data, context }) => {
    return ContentService.createApiKey({
      projectId: context.projectId,
      label: data.label,
    });
  });

export const listContentApiKeys = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => listContentApiKeysSchema.parse(data))
  .handler(async ({ context }) => {
    return ContentService.listApiKeys(context.projectId);
  });

export const revokeContentApiKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => revokeContentApiKeySchema.parse(data))
  .handler(async ({ data, context }) => {
    await ContentService.revokeApiKey(data.keyId, context.projectId);
    return { success: true };
  });
