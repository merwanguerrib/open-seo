import { createServerFn } from "@tanstack/react-start";
import { waitUntil } from "cloudflare:workers";
import { ContentPlanService } from "@/server/features/content/services/ContentPlanService";
import { ContentService } from "@/server/features/content/services/ContentService";
import { captureServerEvent } from "@/server/lib/posthog";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  dismissTopicSchema,
  generateTopicNowSchema,
  getArticleJourneySchema,
  getContentPlanSchema,
  holdArticleSchema,
  listCalendarSchema,
  runDiscoverySchema,
  updateContentPlanSchema,
} from "@/types/schemas/contentPlan";

export const getContentPlan = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => getContentPlanSchema.parse(data))
  .handler(async ({ context }) => {
    return ContentPlanService.getPlan(context.projectId);
  });

export const updateContentPlan = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => updateContentPlanSchema.parse(data))
  .handler(async ({ data, context }) => {
    const result = await ContentPlanService.updatePlan({
      ...data,
      projectId: context.projectId,
    });
    if (data.enabled === true) {
      waitUntil(
        captureServerEvent({
          distinctId: context.userId,
          event: "content:autopilot_enabled",
          organizationId: context.organizationId,
          properties: { project_id: context.projectId },
        }),
      );
    }
    return result;
  });

export const runContentDiscovery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => runDiscoverySchema.parse(data))
  .handler(async ({ context }) => {
    const result = await ContentPlanService.runDiscovery({
      projectId: context.projectId,
      billingCustomer: context,
      locationCode: context.project.locationCode,
      languageCode: context.project.languageCode,
    });
    // Fill the calendar with whatever was discovered.
    await ContentPlanService.scheduleTopics(context.projectId);
    return result;
  });

export const listContentCalendar = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => listCalendarSchema.parse(data))
  .handler(async ({ context }) => {
    return ContentPlanService.listCalendar(context.projectId);
  });

export const dismissContentTopic = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => dismissTopicSchema.parse(data))
  .handler(async ({ data, context }) => {
    await ContentPlanService.dismissTopic(data.topicId, context.projectId);
    return { success: true };
  });

export const generateContentTopicNow = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => generateTopicNowSchema.parse(data))
  .handler(async ({ data, context }) => {
    return ContentPlanService.generateTopicNow({
      topicId: data.topicId,
      projectId: context.projectId,
      billingCustomer: context,
      locationCode: context.project.locationCode,
      languageCode: context.project.languageCode,
    });
  });

export const getArticleJourney = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => getArticleJourneySchema.parse(data))
  .handler(async ({ data, context }) => {
    return ContentService.getArticleJourney(data.articleId, context.projectId);
  });

export const holdArticle = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => holdArticleSchema.parse(data))
  .handler(async ({ data, context }) => {
    return ContentService.holdArticle(data.articleId, context.projectId);
  });
