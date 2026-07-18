import type { getContentStrategyWorkspace } from "@/serverFunctions/contentStrategy";

export type Workspace = Awaited<ReturnType<typeof getContentStrategyWorkspace>>;
export type WorkspaceTab = "inventory" | "keywords" | "knowledge";
export type DocumentKind =
  | "master_plan"
  | "editorial_guidelines"
  | "agent_instructions"
  | "quality_rubric"
  | "reference";
export type DocumentFormat = "markdown" | "json" | "text";
export type ContentType = "blog" | "pillar" | "product" | "other";

export function parseContentType(value: string): ContentType | null {
  if (
    value === "blog" ||
    value === "pillar" ||
    value === "product" ||
    value === "other"
  ) {
    return value;
  }
  return null;
}

export function parseDocumentKind(value: string): DocumentKind | null {
  if (
    value === "master_plan" ||
    value === "editorial_guidelines" ||
    value === "agent_instructions" ||
    value === "quality_rubric" ||
    value === "reference"
  ) {
    return value;
  }
  return null;
}

export function parseDocumentFormat(value: string): DocumentFormat | null {
  if (value === "markdown" || value === "json" || value === "text") {
    return value;
  }
  return null;
}
