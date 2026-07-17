import { ContentPlanRepository } from "@/server/features/content/repositories/ContentPlanRepository";
import {
  ContentStrategyRepository,
  type ContentKeywordRow,
} from "@/server/features/content/repositories/ContentStrategyRepository";
import {
  extractMasterPlanEntries,
  inferContentType,
  normalizeContentUrl,
  normalizeKeyword,
  parseKeywordInput,
  type ContentAssetType,
} from "@/server/features/content/services/contentStrategyParsing";
import {
  assetKeywordMap,
  type DocumentFormat,
  type DocumentKind,
} from "@/server/features/content/services/contentStrategyShared";
import { AppError } from "@/server/lib/errors";

export async function queueKeywords(rows: ContentKeywordRow[]): Promise<number> {
  const planned = rows.filter((row) => row.status === "planned");
  const first = planned[0];
  if (!first) return 0;

  const projectId = first.projectId;
  const existingKeywords =
    await ContentPlanRepository.getExistingKeywords(projectId);
  const clusterIds = new Map<string, string>();
  const topics: Parameters<typeof ContentPlanRepository.insertTopics>[0] = [];

  for (const keyword of planned) {
    if (existingKeywords.has(keyword.normalizedKeyword)) continue;

    let clusterId: string | null = null;
    if (keyword.clusterName) {
      clusterId = clusterIds.get(keyword.clusterName) ?? null;
      if (!clusterId) {
        clusterId = await ContentPlanRepository.getOrCreateCluster({
          projectId,
          name: keyword.clusterName,
        });
        clusterIds.set(keyword.clusterName, clusterId);
      }
    }

    topics.push({
      projectId,
      clusterId,
      contentKeywordId: keyword.id,
      keyword: keyword.keyword,
      source: keyword.source === "master_plan" ? "master_plan" : "keyword",
      role: keyword.role === "pillar" ? "pillar" : "satellite",
      searchVolume: keyword.searchVolume,
      difficulty: keyword.difficulty,
    });
    existingKeywords.add(keyword.normalizedKeyword);
  }

  await ContentPlanRepository.insertTopics(topics);
  return topics.length;
}

export async function launchFromKeywords(input: {
  projectId: string;
  sourceName: "Saved Keywords" | "Rank Tracking";
  keywords: Array<{ keyword: string; searchVolume: number | null }>;
}): Promise<{ imported: number; queued: number }> {
  if (input.keywords.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Select at least one keyword.");
  }

  const pillar =
    input.keywords.length > 1
      ? input.keywords.reduce((max, entry) =>
          (entry.searchVolume ?? 0) > (max.searchVolume ?? 0) ? entry : max,
        )
      : null;
  const clusterName = pillar?.keyword ?? null;

  const existingByKeyword = new Map(
    (await ContentStrategyRepository.listKeywords(input.projectId)).map(
      (keyword) => [keyword.normalizedKeyword, keyword],
    ),
  );

  const rows = await ContentStrategyRepository.upsertKeywords(
    input.keywords.map((entry) => {
      const normalizedKeyword = normalizeKeyword(entry.keyword);
      const existing = existingByKeyword.get(normalizedKeyword);
      const isPillar = pillar !== null && entry.keyword === pillar.keyword;
      return {
        projectId: input.projectId,
        keyword: entry.keyword,
        normalizedKeyword,
        source: "manual" as const,
        sourceName: input.sourceName,
        role:
          pillar === null
            ? ("standalone" as const)
            : isPillar
              ? ("pillar" as const)
              : ("satellite" as const),
        clusterName,
        targetUrl: existing?.targetUrl ?? null,
        title: existing?.title ?? null,
        intent: existing?.intent ?? null,
        priority: existing?.priority ?? null,
        searchVolume: entry.searchVolume ?? existing?.searchVolume ?? null,
        difficulty: existing?.difficulty ?? null,
      };
    }),
  );

  // A keyword may already exist with a non-"planned" status (e.g. a
  // discovery "suggested" row the user never reviewed) — launching it is a
  // deliberate action, so force it into the queueable state regardless.
  await ContentStrategyRepository.markKeywordsPlanned(rows.map((row) => row.id));
  const queued = await queueKeywords(
    rows.map((row) => ({ ...row, status: "planned" as const })),
  );
  return { imported: rows.length, queued };
}

function mergeKeywordRole(
  existing: ContentKeywordRow | undefined,
  incoming: ContentKeywordRow["role"],
): ContentKeywordRow["role"] {
  if (existing?.role === "pillar" || incoming === "pillar") return "pillar";
  if (existing?.role === "satellite" || incoming === "satellite") {
    return "satellite";
  }
  return "standalone";
}

async function upsertPlannedAssets(
  projectId: string,
  keywords: ContentKeywordRow[],
  contentTypes: Map<string, ContentAssetType>,
): Promise<void> {
  const existingAssets = await ContentStrategyRepository.listAssets(projectId);
  const existingByUrl = new Map(
    existingAssets.map((asset) => [asset.url, asset]),
  );
  const rows: Parameters<typeof ContentStrategyRepository.upsertAssets>[0] = [];

  for (const keyword of keywords) {
    if (!keyword.targetUrl) continue;
    const existing = existingByUrl.get(keyword.targetUrl);
    const importedType = contentTypes.get(keyword.normalizedKeyword);
    rows.push({
      projectId,
      contentKeywordId: keyword.id,
      url: keyword.targetUrl,
      contentType:
        importedType && importedType !== "other"
          ? importedType
          : (existing?.contentType ??
            importedType ??
            inferContentType(keyword.targetUrl, keyword.role)),
      state: existing?.state ?? "planned",
      source: existing?.source ?? "master_plan",
      title: existing?.title ?? keyword.title,
      metaDescription: existing?.metaDescription ?? null,
      statusCode: existing?.statusCode ?? null,
      wordCount: existing?.wordCount ?? null,
      h1Count: existing?.h1Count ?? null,
      internalLinkCount: existing?.internalLinkCount ?? null,
      crawlDepth: existing?.crawlDepth ?? null,
      hasStructuredData: existing?.hasStructuredData ?? null,
      isIndexable: existing?.isIndexable ?? null,
      lastAnalyzedAt: existing?.lastAnalyzedAt ?? null,
    });
  }

  await ContentStrategyRepository.upsertAssets(rows);
}

export async function importKeywords(input: {
  projectId: string;
  content: string;
  sourceName?: string | null;
}) {
  const parsed = parseKeywordInput(input.content);
  if (parsed.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "No usable keywords were found in this input.",
    );
  }

  const existingByKeyword = new Map(
    (await ContentStrategyRepository.listKeywords(input.projectId)).map(
      (keyword) => [keyword.normalizedKeyword, keyword],
    ),
  );
  const rows = await ContentStrategyRepository.upsertKeywords(
    parsed.map((keyword) => {
      const normalizedKeyword = normalizeKeyword(keyword);
      const existing = existingByKeyword.get(normalizedKeyword);
      const preservesMasterPlan = existing?.source === "master_plan";
      return {
        projectId: input.projectId,
        keyword,
        normalizedKeyword,
        source: preservesMasterPlan
          ? ("master_plan" as const)
          : input.sourceName
            ? ("file" as const)
            : ("manual" as const),
        sourceName: preservesMasterPlan
          ? existing.sourceName
          : input.sourceName?.trim() || null,
        role: existing?.role ?? ("standalone" as const),
        clusterName: existing?.clusterName ?? null,
        targetUrl: existing?.targetUrl ?? null,
        title: existing?.title ?? null,
        intent: existing?.intent ?? null,
        priority: existing?.priority ?? null,
        searchVolume: existing?.searchVolume ?? null,
        difficulty: existing?.difficulty ?? null,
      };
    }),
  );
  const queued = await queueKeywords(rows);
  return { imported: rows.length, queued };
}

export async function saveDocument(input: {
  projectId: string;
  projectDomain: string | null;
  kind: DocumentKind;
  name: string;
  format: DocumentFormat;
  content: string;
}) {
  let parsedPlan: unknown = null;
  if (input.format === "json") {
    try {
      parsedPlan = JSON.parse(input.content);
    } catch {
      throw new AppError("VALIDATION_ERROR", "The JSON document is invalid.");
    }
  }

  await ContentStrategyRepository.upsertDocument({
    projectId: input.projectId,
    kind: input.kind,
    name: input.name.trim(),
    format: input.format,
    content: input.content,
  });

  if (input.kind !== "master_plan" || input.format !== "json") {
    return { importedKeywords: 0, queued: 0, plannedUrls: 0 };
  }

  const entries = extractMasterPlanEntries(parsedPlan, input.projectDomain);
  if (entries.length === 0) {
    return { importedKeywords: 0, queued: 0, plannedUrls: 0 };
  }

  const existingByKeyword = new Map(
    (await ContentStrategyRepository.listKeywords(input.projectId)).map(
      (keyword) => [keyword.normalizedKeyword, keyword],
    ),
  );
  const keywords = await ContentStrategyRepository.upsertKeywords(
    entries.map((entry) => {
      const existing = existingByKeyword.get(entry.normalizedKeyword);
      return {
        projectId: input.projectId,
        keyword: entry.keyword,
        normalizedKeyword: entry.normalizedKeyword,
        source: "master_plan" as const,
        sourceName: input.name.trim(),
        role: mergeKeywordRole(existing, entry.role),
        clusterName: entry.clusterName ?? existing?.clusterName ?? null,
        targetUrl: entry.targetUrl ?? existing?.targetUrl ?? null,
        title: entry.title ?? existing?.title ?? null,
        intent: entry.intent ?? existing?.intent ?? null,
        priority: entry.priority ?? existing?.priority ?? null,
        searchVolume: entry.searchVolume ?? existing?.searchVolume ?? null,
        difficulty: entry.difficulty ?? existing?.difficulty ?? null,
      };
    }),
  );
  await upsertPlannedAssets(
    input.projectId,
    keywords,
    new Map(
      entries.map((entry) => [entry.normalizedKeyword, entry.contentType]),
    ),
  );

  const existingUrls = new Set(
    (await ContentStrategyRepository.listAssets(input.projectId))
      .filter((asset) => asset.state === "existing")
      .map((asset) => asset.url),
  );
  const withTargetUrl = keywords.filter(
    (keyword): keyword is ContentKeywordRow & { targetUrl: string } =>
      keyword.targetUrl !== null,
  );
  const coveredIds = withTargetUrl
    .filter((keyword) => existingUrls.has(keyword.targetUrl))
    .map((keyword) => keyword.id);
  await ContentStrategyRepository.markKeywordsCovered(coveredIds);
  await ContentPlanRepository.dismissTopicsForKeywords(coveredIds);

  const refreshedKeywords = await ContentStrategyRepository.listKeywords(
    input.projectId,
  );
  const importedIds = new Set(keywords.map((keyword) => keyword.id));
  const queued = await queueKeywords(
    refreshedKeywords.filter((keyword) => importedIds.has(keyword.id)),
  );

  return {
    importedKeywords: keywords.length,
    queued,
    plannedUrls: withTargetUrl.length,
  };
}

export async function deleteDocument(documentId: string, projectId: string) {
  await ContentStrategyRepository.deleteDocument(documentId, projectId);
  return { success: true };
}

export async function importUrls(input: {
  projectId: string;
  projectDomain: string | null;
  contentType: ContentAssetType;
  content: string;
}) {
  const urls = [
    ...new Set(
      input.content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => normalizeContentUrl(line, input.projectDomain))
        .filter((url): url is string => Boolean(url)),
    ),
  ];
  if (urls.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "No valid URLs were found in this input.",
    );
  }

  const [keywords, existingAssets] = await Promise.all([
    ContentStrategyRepository.listKeywords(input.projectId),
    ContentStrategyRepository.listAssets(input.projectId),
  ]);
  const { byTargetUrl } = assetKeywordMap(keywords);
  const existingByUrl = new Map(
    existingAssets.map((asset) => [asset.url, asset]),
  );

  await ContentStrategyRepository.upsertAssets(
    urls.map((url) => {
      const existing = existingByUrl.get(url);
      const keyword = byTargetUrl.get(url);
      return {
        projectId: input.projectId,
        contentKeywordId: keyword?.id ?? existing?.contentKeywordId ?? null,
        url,
        contentType: input.contentType,
        state: "existing" as const,
        source: "manual" as const,
        title: existing?.title ?? keyword?.title ?? null,
        metaDescription: existing?.metaDescription ?? null,
        statusCode: existing?.statusCode ?? null,
        wordCount: existing?.wordCount ?? null,
        h1Count: existing?.h1Count ?? null,
        internalLinkCount: existing?.internalLinkCount ?? null,
        crawlDepth: existing?.crawlDepth ?? null,
        hasStructuredData: existing?.hasStructuredData ?? null,
        isIndexable: existing?.isIndexable ?? null,
        lastAnalyzedAt: existing?.lastAnalyzedAt ?? null,
      };
    }),
  );

  const coveredIds = urls
    .map((url) => byTargetUrl.get(url)?.id)
    .filter((id): id is string => Boolean(id));
  await ContentStrategyRepository.markKeywordsCovered(coveredIds);
  await ContentPlanRepository.dismissTopicsForKeywords(coveredIds);
  return { imported: urls.length };
}
