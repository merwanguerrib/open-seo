import type {
  ContentDocumentRow,
  ContentKeywordRow,
} from "@/server/features/content/repositories/ContentStrategyRepository";

export type DocumentKind = ContentDocumentRow["kind"];
export type DocumentFormat = ContentDocumentRow["format"];

export function documentLabel(kind: DocumentKind): string {
  switch (kind) {
    case "master_plan":
      return "Master plan";
    case "editorial_guidelines":
      return "Editorial guidelines";
    case "agent_instructions":
      return "Agent instructions";
    case "quality_rubric":
      return "Quality rubric";
    case "reference":
      return "Reference";
  }
}

export function assetKeywordMap(keywords: ContentKeywordRow[]) {
  const byId = new Map(keywords.map((keyword) => [keyword.id, keyword]));
  const byTargetUrl = new Map(
    keywords
      .filter((keyword): keyword is ContentKeywordRow & { targetUrl: string } =>
        Boolean(keyword.targetUrl),
      )
      .map((keyword) => [keyword.targetUrl, keyword]),
  );
  return { byId, byTargetUrl };
}
