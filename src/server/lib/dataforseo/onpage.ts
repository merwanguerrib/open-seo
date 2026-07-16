import { OnPageContentParsingLiveRequestInfo } from "dataforseo-client";
import { onPageApi } from "@/server/lib/dataforseo/core";
import {
  assertOk,
  buildTaskBilling,
  isRecord,
  type DataforseoApiResponse,
} from "@/server/lib/dataforseo/envelope";
import { AppError } from "@/server/lib/errors";

// The content_parsing payload is a deep tree (main_topic → sub_topics →
// primary/secondary_content → { text }) that the SDK deserializes into class
// instances (PageContentInfo etc.), so zod object/record schemas reject it —
// items are walked structurally instead: prefer the ready-made
// `page_as_markdown` (markdown_view: true), falling back to collecting
// `h_title` / `text` leaves in document order.

/** Fields whose string values are page copy worth keeping. */
const TEXT_KEYS = new Set(["h_title", "text"]);
/** Boilerplate sections to skip when flattening. */
const SKIPPED_KEYS = new Set(["header", "footer"]);

function collectText(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(key)) continue;
    if (TEXT_KEYS.has(key) && typeof value === "string" && value.trim()) {
      out.push(value.trim());
      continue;
    }
    collectText(value, out);
  }
}

export function extractParsedPageText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  const chunks: string[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    // markdown_view adds a ready-made markdown rendering when available.
    const markdown = item.page_as_markdown;
    if (typeof markdown === "string" && markdown.trim()) {
      chunks.push(markdown.trim());
      continue;
    }
    collectText(item.page_content, chunks);
  }
  return chunks.join("\n\n");
}

interface ParsedPageContent {
  url: string;
  /** Flattened readable text (headings + paragraphs) of the page's main content. */
  text: string;
}

export async function fetchPageContentParsing(input: {
  url: string;
}): Promise<DataforseoApiResponse<ParsedPageContent>> {
  const response = await onPageApi().contentParsingLive([
    new OnPageContentParsingLiveRequestInfo({
      url: input.url,
      markdown_view: true,
    }),
  ]);
  const task = assertOk(response);

  const first = task.result?.[0];
  const items = isRecord(first) ? (first as { items?: unknown }).items : [];
  const text = extractParsedPageText(items);
  if (!text) {
    throw new AppError(
      "INTERNAL_ERROR",
      `Content parsing returned no readable text for ${input.url}`,
    );
  }

  return {
    data: { url: input.url, text },
    billing: buildTaskBilling(task),
  };
}
