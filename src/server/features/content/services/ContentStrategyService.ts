import {
  analyzeExistingContent,
  getWorkspace,
} from "@/server/features/content/services/contentStrategyAnalysis";
import {
  deleteDocument,
  importKeywords,
  importUrls,
  launchFromKeywords,
  saveDocument,
} from "@/server/features/content/services/contentStrategyImports";
import { buildPromptContext } from "@/server/features/content/services/contentStrategyPromptContext";

export const ContentStrategyService = {
  importKeywords,
  saveDocument,
  deleteDocument,
  importUrls,
  launchFromKeywords,
  analyzeExistingContent,
  getWorkspace,
  buildPromptContext,
};
