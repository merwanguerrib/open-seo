/**
 * Autopilot cron: runs on the shared 15-minute schedule. Two independent
 * passes:
 *   1. Auto-publish autopilot drafts whose review window has expired.
 *   2. For each due content plan: discover topics, fill the calendar, and
 *      generate today's scheduled topics.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { customerHasPaidPlan } from "@/server/billing/subscription";
import { ContentPlanRepository } from "@/server/features/content/repositories/ContentPlanRepository";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { ContentPlanService } from "@/server/features/content/services/ContentPlanService";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";

const HOURS = 60 * 60 * 1000;
// How often to revisit an enabled plan (discovery + top-up). Generation itself
// is gated by each topic's calendar date, not this heartbeat.
const PLAN_HEARTBEAT_HOURS = 6;
// Keep the suggestion pipeline full: discover when fewer than this remain.
const MIN_SUGGESTED_BEFORE_DISCOVERY = 5;

function systemBillingContext(
  organizationId: string,
  projectId: string,
): BillingCustomerContext {
  return {
    userId: "system",
    userEmail: "system@openseo.so",
    organizationId,
    projectId,
  };
}

/** Publish autopilot drafts whose review window elapsed with no user action. */
async function autoPublishDueDrafts(nowIso: string): Promise<void> {
  const due = await ContentRepository.getDraftsDueForAutoPublish(nowIso);
  for (const article of due) {
    try {
      await ContentRepository.publishArticleById(article.id);
      console.log(`[content-cron] auto-published ${article.id} (${article.slug})`);
    } catch (error) {
      console.error(`[content-cron] auto-publish failed for ${article.id}:`, error);
    }
  }
}

async function processPlan(input: {
  projectId: string;
  organizationId: string;
  locationCode: number;
  languageCode: string;
  isHosted: boolean;
  todayIso: string;
}): Promise<void> {
  const { projectId, organizationId, isHosted } = input;

  if (isHosted && !(await customerHasPaidPlan(organizationId))) {
    // Advance the heartbeat so a lapsed org doesn't stay perpetually due.
    await ContentPlanRepository.updatePlan(projectId, {
      nextRunAt: new Date(Date.now() + PLAN_HEARTBEAT_HOURS * HOURS).toISOString(),
    });
    return;
  }

  const billingCustomer = systemBillingContext(organizationId, projectId);

  // 1. Top up the suggestion pipeline.
  const suggested = await ContentPlanRepository.listTopics(projectId, [
    "suggested",
  ]);
  if (suggested.length < MIN_SUGGESTED_BEFORE_DISCOVERY) {
    try {
      await ContentPlanService.runDiscovery({
        projectId,
        billingCustomer,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
      });
    } catch (error) {
      console.error(`[content-cron] discovery failed for ${projectId}:`, error);
    }
  }

  // 2. Fill the calendar.
  await ContentPlanService.scheduleTopics(projectId);

  // 3. Generate today's due topics.
  const plan = await ContentPlanRepository.getOrCreatePlan(projectId);
  const dueTopics = await ContentPlanRepository.getDueScheduledTopics(
    projectId,
    input.todayIso,
  );
  for (const topic of dueTopics) {
    try {
      await ContentPlanService.generateFromTopic({
        topic,
        plan,
        projectId,
        billingCustomer,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
      });
      console.log(
        `[content-cron] generating "${topic.keyword}" for project ${projectId}`,
      );
    } catch (error) {
      console.error(
        `[content-cron] generation failed for topic ${topic.id}:`,
        error,
      );
    }
  }

  // 4. Advance the heartbeat.
  await ContentPlanRepository.updatePlan(projectId, {
    nextRunAt: new Date(Date.now() + PLAN_HEARTBEAT_HOURS * HOURS).toISOString(),
  });
}

export async function processContentPlans(): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const todayIso = nowIso.slice(0, 10);

  await autoPublishDueDrafts(nowIso);

  const isHosted = await isHostedServerAuthMode();
  const duePlans = await ContentPlanRepository.getDuePlans(nowIso);

  for (const plan of duePlans) {
    try {
      const projectRows = await db
        .select({
          organizationId: projects.organizationId,
          locationCode: projects.locationCode,
          languageCode: projects.languageCode,
          archivedAt: projects.archivedAt,
        })
        .from(projects)
        .where(eq(projects.id, plan.projectId))
        .limit(1);
      const project = projectRows[0];
      if (!project || project.archivedAt) continue;

      await processPlan({
        projectId: plan.projectId,
        organizationId: project.organizationId,
        locationCode: project.locationCode,
        languageCode: project.languageCode,
        isHosted,
        todayIso,
      });
    } catch (error) {
      console.error(
        `[content-cron] error processing plan for project ${plan.projectId}:`,
        error,
      );
    }
  }
}
