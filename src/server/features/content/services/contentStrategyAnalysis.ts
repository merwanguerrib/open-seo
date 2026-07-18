import { ContentAuditRepository } from "@/server/features/content/repositories/ContentAuditRepository";
import { ContentPlanRepository } from "@/server/features/content/repositories/ContentPlanRepository";
import {
  ContentStrategyRepository,
  type ContentAssetRow,
  type ContentKeywordRow,
} from "@/server/features/content/repositories/ContentStrategyRepository";
import {
  assessContentHealth,
  inferContentType,
  normalizeContentUrl,
  type ContentAssetType,
} from "@/server/features/content/services/contentStrategyParsing";
import { assetKeywordMap } from "@/server/features/content/services/contentStrategyShared";

function matchesBlogPattern(url: string, pattern: string | null): boolean {
  if (!pattern) return false;
  const normalizedPattern = pattern.replace("{slug}", "").replace(/\/+$/, "");
  return url === normalizedPattern || url.startsWith(`${normalizedPattern}/`);
}

function classifyAuditPage(input: {
  url: string;
  keyword: ContentKeywordRow | undefined;
  existing: ContentAssetRow | undefined;
  blogUrlPattern: string | null;
}): ContentAssetType {
  if (input.existing?.source === "manual") return input.existing.contentType;
  if (input.keyword) {
    return inferContentType(input.url, input.keyword.role);
  }
  if (matchesBlogPattern(input.url, input.blogUrlPattern)) return "blog";
  return inferContentType(input.url);
}

export async function analyzeExistingContent(input: {
  projectId: string;
  projectDomain: string | null;
}) {
  const snapshot =
    await ContentAuditRepository.getLatestCompletedContentSnapshot(
      input.projectId,
    );
  if (!snapshot) {
    return {
      status: "no_audit" as const,
      analyzed: 0,
      coveredKeywords: 0,
      auditId: null,
      analyzedAt: null,
    };
  }

  const [keywords, existingAssets, plan] = await Promise.all([
    ContentStrategyRepository.listKeywords(input.projectId),
    ContentStrategyRepository.listAssets(input.projectId),
    ContentPlanRepository.getOrCreatePlan(input.projectId),
  ]);
  const { byTargetUrl } = assetKeywordMap(keywords);
  const existingByUrl = new Map(
    existingAssets.map((asset) => [asset.url, asset]),
  );
  const analyzedAt = new Date().toISOString();
  const coveredIds = new Set<string>();

  await ContentStrategyRepository.upsertAssets(
    snapshot.pages.map((page) => {
      const url =
        normalizeContentUrl(page.url, input.projectDomain) ?? page.url;
      const keyword = byTargetUrl.get(url);
      const existing = existingByUrl.get(url);
      if (keyword) coveredIds.add(keyword.id);
      return {
        projectId: input.projectId,
        contentKeywordId: keyword?.id ?? existing?.contentKeywordId ?? null,
        url,
        contentType: classifyAuditPage({
          url,
          keyword,
          existing,
          blogUrlPattern: plan.blogUrlPattern,
        }),
        state: "existing" as const,
        source:
          existing?.source === "manual"
            ? ("manual" as const)
            : ("audit" as const),
        title: page.title,
        metaDescription: page.metaDescription,
        statusCode: page.statusCode,
        wordCount: page.wordCount,
        h1Count: page.h1Count,
        internalLinkCount: page.internalLinkCount,
        crawlDepth: page.crawlDepth,
        hasStructuredData: page.hasStructuredData,
        isIndexable: page.isIndexable,
        lastAnalyzedAt: analyzedAt,
      };
    }),
  );

  const coveredKeywordIds = [...coveredIds];
  await ContentStrategyRepository.markKeywordsCovered(coveredKeywordIds);
  await ContentPlanRepository.dismissTopicsForKeywords(coveredKeywordIds);
  return {
    status: "analyzed" as const,
    analyzed: snapshot.pages.length,
    coveredKeywords: coveredKeywordIds.length,
    auditId: snapshot.audit.id,
    analyzedAt,
  };
}

export async function getWorkspace(projectId: string) {
  const [documents, keywords, assets] = await Promise.all([
    ContentStrategyRepository.listDocuments(projectId),
    ContentStrategyRepository.listKeywords(projectId),
    ContentStrategyRepository.listAssets(projectId),
  ]);
  const { byId } = assetKeywordMap(keywords);
  const assetViews = assets.map((asset) => ({
    id: asset.id,
    url: asset.url,
    contentType: asset.contentType,
    state: asset.state,
    source: asset.source,
    title: asset.title,
    targetKeyword: asset.contentKeywordId
      ? (byId.get(asset.contentKeywordId)?.keyword ?? null)
      : null,
    wordCount: asset.wordCount,
    lastAnalyzedAt: asset.lastAnalyzedAt,
    health: assessContentHealth(asset),
  }));

  return {
    summary: {
      documents: documents.length,
      keywords: keywords.length,
      plannedKeywords: keywords.filter(
        (keyword) => keyword.status === "planned",
      ).length,
      coveredKeywords: keywords.filter(
        (keyword) => keyword.status === "covered",
      ).length,
      suggestedKeywords: keywords.filter(
        (keyword) => keyword.status === "suggested",
      ).length,
      existingUrls: assets.filter((asset) => asset.state === "existing").length,
      plannedUrls: assets.filter((asset) => asset.state === "planned").length,
      blogUrls: assets.filter((asset) => asset.contentType === "blog").length,
      pillarUrls: assets.filter((asset) => asset.contentType === "pillar")
        .length,
      needsAttention: assetViews.filter(
        (asset) =>
          asset.health.status === "critical" ||
          asset.health.status === "needs_attention",
      ).length,
    },
    documents: documents.map((document) => ({
      id: document.id,
      kind: document.kind,
      name: document.name,
      format: document.format,
      size: document.content.length,
      preview: document.content.slice(0, 240),
      updatedAt: document.updatedAt,
    })),
    keywords: keywords.map((keyword) => ({
      id: keyword.id,
      keyword: keyword.keyword,
      source: keyword.source,
      sourceName: keyword.sourceName,
      status: keyword.status,
      role: keyword.role,
      clusterName: keyword.clusterName,
      targetUrl: keyword.targetUrl,
      title: keyword.title,
      intent: keyword.intent,
      priority: keyword.priority,
      searchVolume: keyword.searchVolume,
      difficulty: keyword.difficulty,
    })),
    assets: assetViews,
  };
}
