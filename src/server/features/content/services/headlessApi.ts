/**
 * Public headless content API: bearer-key auth and article serialization.
 * Only `published` articles are ever visible through this surface.
 */
import { marked } from "marked";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import type { ContentArticleRow } from "@/server/features/content/repositories/ContentRepository";
import {
  CONTENT_API_KEY_PREFIX,
  hashContentApiKey,
} from "@/server/features/content/services/apiKeys";
import { buildArticleJsonLd } from "@/server/features/content/services/jsonLd";
import type { ArticleFaqEntry } from "@/server/features/content/services/jsonLd";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

/** Resolves the projectId for a `Authorization: Bearer osk_…` header, or null. */
export async function resolveProjectFromBearer(
  authorizationHeader: string | null,
): Promise<string | null> {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const key = authorizationHeader.slice("Bearer ".length).trim();
  if (!key.startsWith(CONTENT_API_KEY_PREFIX)) return null;

  const keyHash = await hashContentApiKey(key);
  const apiKey = await ContentRepository.resolveActiveApiKeyByHash(keyHash);
  return apiKey?.projectId ?? null;
}

function parseFaq(raw: string | null): ArticleFaqEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is ArticleFaqEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as ArticleFaqEntry).question === "string" &&
        typeof (entry as ArticleFaqEntry).answer === "string",
    );
  } catch {
    return [];
  }
}

function toListItem(row: ContentArticleRow) {
  return {
    slug: row.slug,
    title: row.title,
    metaDescription: row.metaDescription,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  };
}

async function toFullArticle(row: ContentArticleRow) {
  const faq = parseFaq(row.faq);
  const markdown = row.markdown ?? "";
  return {
    ...toListItem(row),
    keyword: row.keyword,
    author: row.author,
    markdown,
    html: await marked.parse(markdown),
    faq,
    jsonLd: buildArticleJsonLd({
      title: row.title ?? row.keyword,
      metaDescription: row.metaDescription,
      author: row.author,
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
      faq,
    }),
  };
}

export function clampListLimit(rawLimit: string | null): number {
  const parsed = rawLimit ? Number.parseInt(rawLimit, 10) : NaN;
  if (Number.isNaN(parsed)) return DEFAULT_LIST_LIMIT;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, parsed));
}

export async function listPublishedArticlesResponse(
  projectId: string,
  limit: number,
) {
  const rows = await ContentRepository.listPublishedArticles(projectId, limit);
  return { articles: rows.map(toListItem) };
}

export async function getPublishedArticleResponse(
  projectId: string,
  slug: string,
) {
  const row = await ContentRepository.getPublishedArticleBySlug(
    projectId,
    slug,
  );
  if (!row) return null;
  return toFullArticle(row);
}
