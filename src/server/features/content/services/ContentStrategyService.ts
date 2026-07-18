import type { BillingCustomerContext } from "@/server/billing/subscription";
import {
  analyzeExistingContent,
  getWorkspace,
} from "@/server/features/content/services/contentStrategyAnalysis";
import {
  deleteDocument,
  dismissSuggestedKeywords,
  importKeywords,
  importSuggestedKeywords,
  importUrls,
  launchFromKeywords,
  saveDocument,
} from "@/server/features/content/services/contentStrategyImports";
import { buildPromptContext } from "@/server/features/content/services/contentStrategyPromptContext";
import { ContentPlanRepository } from "@/server/features/content/repositories/ContentPlanRepository";
import { discoverCompetitorKeywords } from "@/server/features/content/services/competitorDiscovery";
import { discoverRelatedKeywords } from "@/server/features/content/services/relatedDiscovery";

async function runCompetitorDiscovery(input: {
  projectId: string;
  projectDomain: string | null;
  billingCustomer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
}) {
  const plan = await ContentPlanRepository.getOrCreatePlan(input.projectId);
  return discoverCompetitorKeywords({
    projectId: input.projectId,
    projectDomain: input.projectDomain,
    billingCustomer: input.billingCustomer,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    plan: {
      minSearchVolume: plan.minSearchVolume,
      maxDifficulty: plan.maxDifficulty,
    },
  });
}

async function runRelatedDiscovery(input: {
  projectId: string;
  billingCustomer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
}) {
  const plan = await ContentPlanRepository.getOrCreatePlan(input.projectId);
  return discoverRelatedKeywords({
    projectId: input.projectId,
    billingCustomer: input.billingCustomer,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    plan: {
      minSearchVolume: plan.minSearchVolume,
      maxDifficulty: plan.maxDifficulty,
    },
  });
}

export const ContentStrategyService = {
  importKeywords,
  saveDocument,
  deleteDocument,
  importUrls,
  launchFromKeywords,
  importSuggestedKeywords,
  dismissSuggestedKeywords,
  analyzeExistingContent,
  getWorkspace,
  buildPromptContext,
  runCompetitorDiscovery,
  runRelatedDiscovery,
};
