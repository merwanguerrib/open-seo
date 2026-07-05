import { env } from "cloudflare:workers";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import type { ContentArticleRow } from "@/server/features/content/repositories/ContentRepository";
import { ContentPlanRepository } from "@/server/features/content/repositories/ContentPlanRepository";
import { generateContentApiKey } from "@/server/features/content/services/apiKeys";
import { dedupeSlug, slugify } from "@/server/features/content/services/slug";
import { AppError } from "@/server/lib/errors";

interface ArticleFaqEntryJson {
  question: string;
  answer: string;
}

/** Parsed `brief` JSON column; fields are optional because older rows may predate additions. */
type StoredArticleBrief = {
  intent?: string;
  angle?: string;
  outline?: Array<{ heading: string; subheadings: string[] }>;
  entities?: string[];
  questions?: string[];
} | null;

/** Article shape returned to the app UI (JSON columns parsed). */
interface ContentArticleView {
  id: string;
  keyword: string;
  locationCode: number;
  languageCode: string;
  status: ContentArticleRow["status"];
  slug: string;
  title: string | null;
  metaDescription: string | null;
  author: string | null;
  markdown: string | null;
  brief: StoredArticleBrief;
  faq: ArticleFaqEntryJson[];
  sourceUrls: string[];
  source: ContentArticleRow["source"];
  clusterId: string | null;
  liveUrl: string | null;
  autoPublishAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

function parseJsonColumn<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toArticleView(row: ContentArticleRow): ContentArticleView {
  return {
    id: row.id,
    keyword: row.keyword,
    locationCode: row.locationCode,
    languageCode: row.languageCode,
    status: row.status,
    slug: row.slug,
    title: row.title,
    metaDescription: row.metaDescription,
    author: row.author,
    markdown: row.markdown,
    brief: parseJsonColumn<StoredArticleBrief>(row.brief, null),
    faq: parseJsonColumn<ArticleFaqEntryJson[]>(row.faq, []),
    sourceUrls: parseJsonColumn<string[]>(row.sourceUrls, []),
    source: row.source,
    clusterId: row.clusterId,
    liveUrl: row.liveUrl,
    autoPublishAt: row.autoPublishAt,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

function buildLiveUrl(
  blogUrlPattern: string | null | undefined,
  slug: string,
): string | null {
  if (!blogUrlPattern) return null;
  return blogUrlPattern.includes("{slug}")
    ? blogUrlPattern.replace("{slug}", slug)
    : `${blogUrlPattern.replace(/\/$/, "")}/${slug}`;
}

async function generateArticle(input: {
  billingCustomer: BillingCustomerContext;
  projectId: string;
  keyword: string;
  locationCode: number;
  languageCode: string;
  // Autopilot fields; omitted for manual generation.
  source?: "manual" | "autopilot";
  clusterId?: string | null;
  blogUrlPattern?: string | null;
  autoPublishAt?: string | null;
}) {
  const articleId = crypto.randomUUID();
  // Workflow instance ids must be unique per run; retries get a fresh one,
  // so the run id is distinct from the article id from the start.
  const workflowRunId = crypto.randomUUID();

  const existingSlugs = await ContentRepository.listSlugsForProject(
    input.projectId,
  );
  const slug = dedupeSlug(slugify(input.keyword), existingSlugs);

  await ContentRepository.createArticle({
    id: articleId,
    projectId: input.projectId,
    keyword: input.keyword.trim(),
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    slug,
    workflowRunId,
    source: input.source ?? "manual",
    clusterId: input.clusterId ?? null,
    liveUrl: buildLiveUrl(input.blogUrlPattern, slug),
    autoPublishAt: input.autoPublishAt ?? null,
  });

  try {
    await startWorkflow(articleId, workflowRunId, input.billingCustomer);
  } catch (error) {
    await ContentRepository.deleteArticleForProject(articleId, input.projectId);
    throw error;
  }

  return { articleId };
}

async function startWorkflow(
  articleId: string,
  workflowRunId: string,
  billingCustomer: BillingCustomerContext,
) {
  await env.ARTICLE_GENERATION_WORKFLOW.create({
    id: workflowRunId,
    params: {
      articleId,
      workflowRunId,
      billingCustomer: {
        userId: billingCustomer.userId,
        userEmail: billingCustomer.userEmail,
        organizationId: billingCustomer.organizationId,
        projectId: billingCustomer.projectId,
      },
    },
  });
}

async function retryArticle(input: {
  billingCustomer: BillingCustomerContext;
  projectId: string;
  articleId: string;
}) {
  const article = await ContentRepository.getArticleForProject(
    input.articleId,
    input.projectId,
  );
  if (!article) throw new AppError("NOT_FOUND");
  if (article.status !== "failed") {
    throw new AppError("INTERNAL_ERROR", "Only failed articles can be retried");
  }

  const workflowRunId = crypto.randomUUID();
  await ContentRepository.resetArticleForRetry(
    input.articleId,
    input.projectId,
    workflowRunId,
  );
  await startWorkflow(input.articleId, workflowRunId, input.billingCustomer);
  return { articleId: input.articleId };
}

async function listArticles(projectId: string) {
  const rows = await ContentRepository.listArticlesForProject(projectId);
  // The list view doesn't need bodies; strip them to keep the payload small.
  return rows.map((row) => {
    const view = toArticleView(row);
    return { ...view, markdown: null, brief: null };
  });
}

async function getArticle(articleId: string, projectId: string) {
  const row = await ContentRepository.getArticleForProject(
    articleId,
    projectId,
  );
  if (!row) throw new AppError("NOT_FOUND");
  return toArticleView(row);
}

/** The article plus its GSC metric history for the journey timeline. */
async function getArticleJourney(articleId: string, projectId: string) {
  const row = await ContentRepository.getArticleForProject(
    articleId,
    projectId,
  );
  if (!row) throw new AppError("NOT_FOUND");
  const metrics = await ContentPlanRepository.listArticleMetrics(articleId);
  const latest = metrics.at(-1) ?? null;

  // Derive the journey stage from status + whether GSC has data yet.
  let stage: "written" | "published" | "gathering" | "monitored";
  if (row.status === "published") {
    stage =
      latest && latest.impressions > 0
        ? "monitored"
        : row.publishedAt
          ? "gathering"
          : "published";
  } else {
    stage = "written";
  }

  return {
    article: toArticleView(row),
    stage,
    lastRepairedAt: row.lastRepairedAt,
    metrics: metrics.map((metric) => ({
      date: metric.date,
      clicks: metric.clicks,
      impressions: metric.impressions,
      ctr: metric.ctr,
      position: metric.position,
    })),
  };
}

async function updateArticle(input: {
  articleId: string;
  projectId: string;
  title?: string;
  metaDescription?: string;
  author?: string | null;
  slug?: string;
  markdown?: string;
  faq?: ArticleFaqEntryJson[];
}) {
  const article = await ContentRepository.getArticleForProject(
    input.articleId,
    input.projectId,
  );
  if (!article) throw new AppError("NOT_FOUND");

  let slug: string | undefined;
  if (input.slug !== undefined && input.slug !== article.slug) {
    const existing = await ContentRepository.listSlugsForProject(
      input.projectId,
    );
    existing.delete(article.slug);
    slug = dedupeSlug(slugify(input.slug), existing);
  }

  await ContentRepository.updateArticleForProject(
    input.articleId,
    input.projectId,
    {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.metaDescription !== undefined && {
        metaDescription: input.metaDescription,
      }),
      ...(input.author !== undefined && { author: input.author }),
      ...(slug !== undefined && { slug }),
      ...(input.markdown !== undefined && { markdown: input.markdown }),
      ...(input.faq !== undefined && { faq: JSON.stringify(input.faq) }),
    },
  );

  return getArticle(input.articleId, input.projectId);
}

async function setArticleStatus(input: {
  articleId: string;
  projectId: string;
  status: "draft" | "published";
}) {
  const article = await ContentRepository.getArticleForProject(
    input.articleId,
    input.projectId,
  );
  if (!article) throw new AppError("NOT_FOUND");
  if (article.status !== "draft" && article.status !== "published") {
    throw new AppError(
      "INTERNAL_ERROR",
      "Only generated articles can be published",
    );
  }

  await ContentRepository.setArticleStatusForProject(
    input.articleId,
    input.projectId,
    input.status,
  );
  return getArticle(input.articleId, input.projectId);
}

/**
 * Regenerate an existing article in place (the weekly refresh action).
 * Re-runs the full generation workflow, which pulls a fresh SERP and the
 * current cluster siblings for internal links. The result lands as a draft
 * with a review window so a human can catch a bad refresh.
 */
async function regenerateArticle(input: {
  articleId: string;
  billingCustomer: BillingCustomerContext;
  autoPublishAt: string | null;
}) {
  const workflowRunId = crypto.randomUUID();
  await ContentRepository.requeueArticle(
    input.articleId,
    workflowRunId,
    input.autoPublishAt,
  );
  await startWorkflow(input.articleId, workflowRunId, input.billingCustomer);
  return { articleId: input.articleId };
}

/** "Keep as draft" — cancels the autopilot review-window auto-publish. */
async function holdArticle(articleId: string, projectId: string) {
  const article = await ContentRepository.getArticleForProject(
    articleId,
    projectId,
  );
  if (!article) throw new AppError("NOT_FOUND");
  await ContentRepository.holdAutoPublishForProject(articleId, projectId);
  return getArticle(articleId, projectId);
}

async function removeArticle(articleId: string, projectId: string) {
  await ContentRepository.deleteArticleForProject(articleId, projectId);
}

// ─── API keys ────────────────────────────────────────────────────────────────

async function createApiKey(input: { projectId: string; label: string }) {
  const { key, keyHash } = await generateContentApiKey();
  const id = crypto.randomUUID();
  await ContentRepository.createApiKey({
    id,
    projectId: input.projectId,
    keyHash,
    label: input.label.trim() || "Default",
  });
  // The plaintext key exists only in this response; store it now or never.
  return { id, key };
}

async function listApiKeys(projectId: string) {
  return ContentRepository.listApiKeysForProject(projectId);
}

async function revokeApiKey(keyId: string, projectId: string) {
  await ContentRepository.revokeApiKeyForProject(keyId, projectId);
}

export const ContentService = {
  generateArticle,
  retryArticle,
  listArticles,
  getArticle,
  getArticleJourney,
  updateArticle,
  setArticleStatus,
  regenerateArticle,
  holdArticle,
  removeArticle,
  createApiKey,
  listApiKeys,
  revokeApiKey,
};
