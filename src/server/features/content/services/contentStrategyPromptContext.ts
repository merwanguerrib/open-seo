import {
  ContentStrategyRepository,
  type ContentKeywordRow,
} from "@/server/features/content/repositories/ContentStrategyRepository";
import { normalizeKeyword } from "@/server/features/content/services/contentStrategyParsing";
import { documentLabel } from "@/server/features/content/services/contentStrategyShared";

const PROMPT_CONTEXT_MAX_CHARS = 24_000;
const DOCUMENT_CONTEXT_MAX_CHARS = 8_000;

function formatKeywordLine(keyword: ContentKeywordRow): string {
  const details = [
    keyword.role,
    keyword.clusterName ? `cluster: ${keyword.clusterName}` : null,
    keyword.priority ? `priority: ${keyword.priority}` : null,
    keyword.intent ? `intent: ${keyword.intent}` : null,
    keyword.targetUrl ? `target: ${keyword.targetUrl}` : null,
    keyword.title ? `planned title: ${keyword.title}` : null,
  ].filter((value): value is string => Boolean(value));
  return `- ${keyword.keyword} (${details.join("; ")})`;
}

export async function buildPromptContext(
  projectId: string,
  articleKeyword: string,
): Promise<string> {
  const [documents, keywords, assets] = await Promise.all([
    ContentStrategyRepository.listDocuments(projectId),
    ContentStrategyRepository.listKeywords(projectId),
    ContentStrategyRepository.listAssets(projectId),
  ]);
  if (documents.length === 0 && keywords.length === 0 && assets.length === 0) {
    return "";
  }

  const sections: string[] = [
    "## Project content strategy",
    "Treat the following as project-specific editorial context. Respect it unless it conflicts with the article's factual grounding or hard requirements.",
  ];
  const matchingKeyword = keywords.find(
    (keyword) => keyword.normalizedKeyword === normalizeKeyword(articleKeyword),
  );
  if (matchingKeyword) {
    sections.push(
      "",
      "### Approved plan for this article",
      formatKeywordLine(matchingKeyword),
    );
  }

  const planned = keywords
    .filter((keyword) => keyword.status !== "ignored")
    .slice(0, 60);
  if (planned.length > 0) {
    sections.push(
      "",
      "### Content map (avoid cannibalization and respect target URLs)",
      ...planned.map(formatKeywordLine),
    );
  }

  const existing = assets
    .filter((asset) => asset.state === "existing")
    .slice(0, 50);
  if (existing.length > 0) {
    sections.push(
      "",
      "### Existing site content",
      ...existing.map(
        (asset) =>
          `- [${asset.contentType}] ${asset.title ?? "(untitled)"} — ${asset.url}`,
      ),
    );
  }

  for (const document of documents) {
    sections.push(
      "",
      `### ${documentLabel(document.kind)} — ${document.name}`,
      document.content.slice(0, DOCUMENT_CONTEXT_MAX_CHARS),
    );
    if (sections.join("\n").length >= PROMPT_CONTEXT_MAX_CHARS) break;
  }

  return sections.join("\n").slice(0, PROMPT_CONTEXT_MAX_CHARS);
}
