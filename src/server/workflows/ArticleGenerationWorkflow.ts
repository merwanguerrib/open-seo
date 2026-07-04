/**
 * Cloudflare Workflow generating one SEO article, grounded in the live SERP
 * for its keyword:
 *
 *   fetch-serp → parse-competitors → build-brief → write-article → save-draft
 *
 * Each step is durable and retried by the Workflows runtime; a step that
 * exhausts its retries marks the article `failed` with a readable error.
 * All DB writes are keyed by (articleId, workflowRunId) so a superseded run
 * can never clobber a newer retry.
 */
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { generateObject } from "ai";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import {
  briefSchema,
  buildArticlePrompt,
  buildBriefPrompt,
  generatedArticleSchema,
  type ArticleBrief,
  type CompetitorPage,
} from "@/server/features/content/services/articlePrompts";
import {
  buildSerpContext,
  type SerpContext,
} from "@/server/features/content/services/serpContext";
import { dedupeSlug, slugify } from "@/server/features/content/services/slug";
import { db } from "@/db";
import { contentArticles, projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createDataforseoClient } from "@/server/lib/dataforseo/client";
import { getContentModel } from "@/server/lib/openrouter";

interface ArticleGenerationParams {
  articleId: string;
  workflowRunId: string;
  billingCustomer: BillingCustomerContext;
}

/** How many top organic pages to read for grounding. */
const MAX_COMPETITOR_PAGES = 4;

const STEP_CONFIG = {
  retries: {
    limit: 2,
    delay: "10 seconds" as const,
    backoff: "exponential" as const,
  },
  timeout: "5 minutes" as const,
};

// LLM steps are slower and pricier; retry once, with a longer timeout for
// long-form generation.
const LLM_STEP_CONFIG = {
  retries: {
    limit: 1,
    delay: "15 seconds" as const,
    backoff: "constant" as const,
  },
  timeout: "10 minutes" as const,
};

const SINGLE_ATTEMPT_STEP_CONFIG = {
  retries: { limit: 0, delay: "1 second" as const },
  timeout: "1 minute" as const,
};

export class ArticleGenerationWorkflow extends WorkflowEntrypoint<
  Env,
  ArticleGenerationParams
> {
  async run(event: WorkflowEvent<ArticleGenerationParams>, step: WorkflowStep) {
    const { articleId, workflowRunId, billingCustomer } = event.payload;

    const article = await step.do("load-article", STEP_CONFIG, async () => {
      const rows = await db
        .select()
        .from(contentArticles)
        .where(eq(contentArticles.id, articleId))
        .limit(1);
      const row = rows[0];
      if (!row || row.workflowRunId !== workflowRunId) {
        throw new Error("Article workflow context mismatch");
      }
      await ContentRepository.updateArticleFromWorkflow(
        articleId,
        workflowRunId,
        { status: "generating" },
      );
      const projectRows = await db
        .select({ domain: projects.domain })
        .from(projects)
        .where(eq(projects.id, row.projectId))
        .limit(1);
      return {
        projectId: row.projectId,
        keyword: row.keyword,
        locationCode: row.locationCode,
        languageCode: row.languageCode,
        siteDomain: projectRows[0]?.domain ?? null,
      };
    });

    const dataforseo = createDataforseoClient(billingCustomer);

    try {
      const serpContext = await step.do(
        "fetch-serp",
        STEP_CONFIG,
        async (): Promise<SerpContext> => {
          const items = await dataforseo.serp.live({
            keyword: article.keyword,
            locationCode: article.locationCode,
            languageCode: article.languageCode,
            creditFeature: "content",
          });
          const context = buildSerpContext(items);
          if (context.topOrganic.length === 0) {
            throw new Error(
              `No organic results found for "${article.keyword}"`,
            );
          }
          await ContentRepository.updateArticleFromWorkflow(
            articleId,
            workflowRunId,
            {
              sourceUrls: JSON.stringify(
                context.topOrganic.map((result) => result.url),
              ),
            },
          );
          return context;
        },
      );

      const competitors = await step.do(
        "parse-competitors",
        STEP_CONFIG,
        async (): Promise<CompetitorPage[]> => {
          const targets = serpContext.topOrganic.slice(0, MAX_COMPETITOR_PAGES);
          // Individual pages may block crawlers or time out; tolerate
          // failures as long as at least one page parses.
          const settled = await Promise.allSettled(
            targets.map((result) =>
              dataforseo.onPage.contentParsing({ url: result.url }),
            ),
          );
          const pages: CompetitorPage[] = [];
          for (const outcome of settled) {
            if (outcome.status !== "fulfilled") continue;
            if (!outcome.value.text.trim()) continue;
            pages.push({ url: outcome.value.url, text: outcome.value.text });
          }
          if (pages.length === 0) {
            throw new Error(
              "Could not read any of the top-ranking pages for grounding",
            );
          }
          return pages;
        },
      );

      const brief = await step.do(
        "build-brief",
        LLM_STEP_CONFIG,
        async (): Promise<ArticleBrief> => {
          const model = await getContentModel();
          const result = await generateObject({
            model,
            schema: briefSchema,
            prompt: buildBriefPrompt({
              keyword: article.keyword,
              languageCode: article.languageCode,
              serpContext,
              competitors,
            }),
          });
          await ContentRepository.updateArticleFromWorkflow(
            articleId,
            workflowRunId,
            {
              brief: JSON.stringify({ ...result.object, usage: result.usage }),
            },
          );
          return result.object;
        },
      );

      await step.do("write-article", LLM_STEP_CONFIG, async () => {
        const model = await getContentModel();
        const result = await generateObject({
          model,
          schema: generatedArticleSchema,
          prompt: buildArticlePrompt({
            keyword: article.keyword,
            languageCode: article.languageCode,
            brief,
            competitors,
            siteDomain: article.siteDomain,
          }),
        });

        const existingSlugs = await ContentRepository.listSlugsForProject(
          article.projectId,
        );
        const rows = await db
          .select({ slug: contentArticles.slug })
          .from(contentArticles)
          .where(eq(contentArticles.id, articleId))
          .limit(1);
        // The article's own placeholder slug is free to reuse.
        if (rows[0]) existingSlugs.delete(rows[0].slug);

        await ContentRepository.updateArticleFromWorkflow(
          articleId,
          workflowRunId,
          {
            title: result.object.title,
            metaDescription: result.object.metaDescription,
            markdown: result.object.markdown,
            faq: JSON.stringify(result.object.faq),
            slug: dedupeSlug(slugify(result.object.title), existingSlugs),
          },
        );
      });

      await step.do("save-draft", SINGLE_ATTEMPT_STEP_CONFIG, async () => {
        await ContentRepository.updateArticleFromWorkflow(
          articleId,
          workflowRunId,
          { status: "draft", error: null },
        );
      });
    } catch (error) {
      console.error(`Article generation ${articleId} failed:`, error);
      await step.do("mark-failed", SINGLE_ATTEMPT_STEP_CONFIG, async () => {
        await ContentRepository.updateArticleFromWorkflow(
          articleId,
          workflowRunId,
          {
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "Article generation failed",
          },
        );
      });
      throw error;
    }
  }
}
