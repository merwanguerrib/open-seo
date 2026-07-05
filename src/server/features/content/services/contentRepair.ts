/**
 * Weekly GSC self-repair pass. For each published autopilot article with a
 * live URL, snapshot its Search Console performance, then apply the action the
 * metrics call for: rewrite a low-CTR title, refresh a decaying article,
 * strengthen internal links on a page-2 article, or archive a dead one.
 */
import { generateObject } from "ai";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { ContentPlanRepository } from "@/server/features/content/repositories/ContentPlanRepository";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import type { ContentArticleRow } from "@/server/features/content/repositories/ContentRepository";
import type { ContentPlanRow } from "@/server/features/content/repositories/ContentPlanRepository";
import {
  buildTitleRewritePrompt,
  titleRewriteSchema,
} from "@/server/features/content/services/articlePrompts";
import { ContentService } from "@/server/features/content/services/ContentService";
import {
  decideRepairAction,
  type ArticleMetricPoint,
} from "@/server/features/content/services/repairDecision";
import {
  GscNotConnectedError,
  GscService,
} from "@/server/features/gsc/services/GscService";
import { getContentModel } from "@/server/lib/openrouter";

const REPAIR_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function isDueForRepair(lastRepairedAt: string | null, now: number): boolean {
  if (!lastRepairedAt) return true;
  return now - new Date(lastRepairedAt).getTime() >= REPAIR_INTERVAL_MS;
}

/** Pull the article's GSC totals for its live URL and store a daily snapshot. */
async function snapshotArticleMetrics(
  projectId: string,
  article: ContentArticleRow,
  todayIso: string,
): Promise<ArticleMetricPoint[]> {
  if (article.liveUrl) {
    try {
      const performance = await GscService.getPerformance({
        projectId,
        dimensions: ["page"],
        dateRange: "last_28_days",
        filters: [
          {
            dimension: "page",
            operator: "equals",
            expression: article.liveUrl,
          },
        ],
        rowLimit: 1,
      });
      const row = performance.rows[0];
      if (row) {
        await ContentPlanRepository.upsertArticleMetric({
          articleId: article.id,
          date: todayIso,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        });
      }
    } catch (error) {
      if (!(error instanceof GscNotConnectedError)) {
        console.error(
          `[content-repair] GSC snapshot failed for ${article.id}:`,
          error,
        );
      }
    }
  }

  const rows = await ContentPlanRepository.listArticleMetrics(article.id);
  return rows.map((row) => ({
    date: row.date,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  }));
}

async function rewriteTitle(
  article: ContentArticleRow,
): Promise<void> {
  const model = await getContentModel();
  const result = await generateObject({
    model,
    schema: titleRewriteSchema,
    prompt: buildTitleRewritePrompt({
      keyword: article.keyword,
      currentTitle: article.title ?? "",
      currentMeta: article.metaDescription ?? "",
      markdown: article.markdown ?? "",
    }),
  });
  await ContentRepository.applyTitleRewrite(article.id, {
    title: result.object.title,
    metaDescription: result.object.metaDescription,
  });
}

async function repairArticle(input: {
  projectId: string;
  article: ContentArticleRow;
  plan: ContentPlanRow;
  billingCustomer: BillingCustomerContext;
  now: Date;
  todayIso: string;
}): Promise<void> {
  const { article, plan, now } = input;
  const metrics = await snapshotArticleMetrics(
    input.projectId,
    article,
    input.todayIso,
  );

  const action = decideRepairAction({
    publishedAt: article.publishedAt,
    now,
    metrics,
  });

  const reviewWindow =
    plan.autoPublish && plan.reviewWindowHours >= 0
      ? new Date(now.getTime() + plan.reviewWindowHours * 60 * 60 * 1000).toISOString()
      : null;

  switch (action) {
    case "title_rewrite":
      await rewriteTitle(article);
      break;
    case "refresh":
    case "internal_links":
      // Both regenerate the article — a fresh SERP and current cluster links.
      await ContentService.regenerateArticle({
        articleId: article.id,
        billingCustomer: input.billingCustomer,
        autoPublishAt: reviewWindow,
      });
      break;
    case "archive":
      await ContentRepository.archiveArticleById(article.id);
      break;
    case "none":
      await ContentRepository.markRepaired(article.id);
      break;
  }

  if (action !== "none") {
    console.log(`[content-repair] ${action} on ${article.id} (${article.slug})`);
  }
}

/** Runs the repair pass for one project's tracked (autopilot) articles. */
export async function runWeeklyRepair(input: {
  projectId: string;
  plan: ContentPlanRow;
  billingCustomer: BillingCustomerContext;
}): Promise<{ processed: number }> {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const articles = await ContentRepository.getTrackedArticles(input.projectId);

  let processed = 0;
  for (const article of articles) {
    // Only the autopilot's own articles are auto-modified.
    if (article.source !== "autopilot") continue;
    if (!isDueForRepair(article.lastRepairedAt, now.getTime())) continue;
    try {
      await repairArticle({
        projectId: input.projectId,
        article,
        plan: input.plan,
        billingCustomer: input.billingCustomer,
        now,
        todayIso,
      });
      processed += 1;
    } catch (error) {
      console.error(`[content-repair] failed for ${article.id}:`, error);
    }
  }
  return { processed };
}
