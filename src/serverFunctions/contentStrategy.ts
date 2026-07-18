import { createServerFn } from "@tanstack/react-start";
import { ContentStrategyService } from "@/server/features/content/services/ContentStrategyService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  analyzeExistingContentSchema,
  deleteContentDocumentSchema,
  getContentStrategyWorkspaceSchema,
  importContentKeywordsSchema,
  importContentUrlsSchema,
  launchArticlesFromKeywordsSchema,
  runCompetitorDiscoverySchema,
  runRelatedDiscoverySchema,
  saveContentDocumentSchema,
} from "@/types/schemas/contentStrategy";

export const getContentStrategyWorkspace = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) =>
    getContentStrategyWorkspaceSchema.parse(data),
  )
  .handler(async ({ context }) => {
    return ContentStrategyService.getWorkspace(context.projectId);
  });

export const importContentKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => importContentKeywordsSchema.parse(data))
  .handler(async ({ data, context }) => {
    return ContentStrategyService.importKeywords({
      projectId: context.projectId,
      content: data.content,
      sourceName: data.sourceName,
    });
  });

export const saveContentDocument = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => saveContentDocumentSchema.parse(data))
  .handler(async ({ data, context }) => {
    return ContentStrategyService.saveDocument({
      projectId: context.projectId,
      projectDomain: context.project.domain,
      kind: data.kind,
      name: data.name,
      format: data.format,
      content: data.content,
    });
  });

export const deleteContentDocument = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => deleteContentDocumentSchema.parse(data))
  .handler(async ({ data, context }) => {
    return ContentStrategyService.deleteDocument(
      data.documentId,
      context.projectId,
    );
  });

export const importContentUrls = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => importContentUrlsSchema.parse(data))
  .handler(async ({ data, context }) => {
    return ContentStrategyService.importUrls({
      projectId: context.projectId,
      projectDomain: context.project.domain,
      contentType: data.contentType,
      content: data.content,
    });
  });

export const analyzeExistingContent = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => analyzeExistingContentSchema.parse(data))
  .handler(async ({ context }) => {
    return ContentStrategyService.analyzeExistingContent({
      projectId: context.projectId,
      projectDomain: context.project.domain,
    });
  });

export const launchArticlesFromKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) =>
    launchArticlesFromKeywordsSchema.parse(data),
  )
  .handler(async ({ data, context }) => {
    return ContentStrategyService.launchFromKeywords({
      projectId: context.projectId,
      sourceName: data.sourceName,
      keywords: data.keywords,
    });
  });

export const runCompetitorDiscovery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => runCompetitorDiscoverySchema.parse(data))
  .handler(async ({ context }) => {
    return ContentStrategyService.runCompetitorDiscovery({
      projectId: context.projectId,
      projectDomain: context.project.domain,
      billingCustomer: context,
      locationCode: context.project.locationCode,
      languageCode: context.project.languageCode,
    });
  });

export const runRelatedDiscovery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => runRelatedDiscoverySchema.parse(data))
  .handler(async ({ context }) => {
    return ContentStrategyService.runRelatedDiscovery({
      projectId: context.projectId,
      billingCustomer: context,
      locationCode: context.project.locationCode,
      languageCode: context.project.languageCode,
    });
  });
