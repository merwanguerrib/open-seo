import { z } from "zod";
import { OnPageContentParsingLiveRequestInfo } from "dataforseo-client";
import { onPageApi } from "@/server/lib/dataforseo/core";
import {
  assertOk,
  buildTaskBilling,
  isRecord,
  type DataforseoApiResponse,
} from "@/server/lib/dataforseo/envelope";

// The content_parsing payload is a deep tree (main_topic → sub_topics →
// primary/secondary_content → { text }) whose SDK types are mostly untyped
// index signatures. We only need readable page text for LLM grounding, so
// items are validated as passthrough records and flattened by walking the
// tree for `h_title` / `text` leaves in document order.
const contentParsingItemSchema = z
  .object({
    type: z.string().optional(),
    page_content: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .passthrough();

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
  const parsed = z.array(contentParsingItemSchema).safeParse(items ?? []);

  const chunks: string[] = [];
  if (parsed.success) {
    for (const item of parsed.data) {
      // markdown_view adds a ready-made markdown rendering when available.
      const markdown = (item as Record<string, unknown>).page_as_markdown;
      if (typeof markdown === "string" && markdown.trim()) {
        chunks.push(markdown.trim());
        continue;
      }
      collectText(item.page_content, chunks);
    }
  }

  return {
    data: { url: input.url, text: chunks.join("\n\n") },
    billing: buildTaskBilling(task),
  };
}
