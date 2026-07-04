import { z } from "zod";
import type { SerpContext } from "@/server/features/content/services/serpContext";

/**
 * Prompt assembly for the two LLM steps of article generation. Pure string
 * building so it stays unit-testable; the workflow owns the model calls.
 */

// Bound competitor text so a handful of long pages can't blow the context
// window (~5 pages * 8k chars ≈ 10k tokens of grounding).
const MAX_COMPETITOR_CHARS = 8_000;

export const briefSchema = z.object({
  intent: z.enum([
    "informational",
    "commercial",
    "transactional",
    "navigational",
  ]),
  angle: z
    .string()
    .describe("The editorial angle that can outrank the current results"),
  outline: z.array(
    z.object({
      heading: z.string().describe("H2 heading"),
      subheadings: z.array(z.string()).describe("H3 headings under this H2"),
    }),
  ),
  entities: z
    .array(z.string())
    .describe("Concepts, tools, and terms the article must cover"),
  questions: z
    .array(z.string())
    .describe("Questions to answer, drawn from PAA and the AI Overview"),
});

export type ArticleBrief = z.infer<typeof briefSchema>;

export const generatedArticleSchema = z.object({
  title: z.string().describe("SEO title, <= 60 characters when possible"),
  metaDescription: z.string().describe("Meta description, 140-160 characters"),
  markdown: z
    .string()
    .describe("Full article body in markdown, without the H1 title"),
  faq: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
    }),
  ),
});

export type GeneratedArticle = z.infer<typeof generatedArticleSchema>;

export interface CompetitorPage {
  url: string;
  text: string;
}

function formatCompetitors(competitors: CompetitorPage[]): string {
  return competitors
    .map(
      (page, index) =>
        `### Competitor ${index + 1} — ${page.url}\n${page.text.slice(0, MAX_COMPETITOR_CHARS)}`,
    )
    .join("\n\n");
}

function formatSerpContext(serp: SerpContext): string {
  const lines = [
    "### Current top Google results",
    ...serp.topOrganic.map(
      (result, index) =>
        `${index + 1}. ${result.title ?? "(no title)"} — ${result.url}\n   ${result.description ?? ""}`,
    ),
  ];
  if (serp.paaQuestions.length) {
    lines.push("", "### People Also Ask", ...serp.paaQuestions.map((q) => `- ${q}`));
  }
  if (serp.aiOverview) {
    lines.push("", "### Google AI Overview for this query", serp.aiOverview);
  }
  return lines.join("\n");
}

export function buildBriefPrompt(input: {
  keyword: string;
  languageCode: string;
  serpContext: SerpContext;
  competitors: CompetitorPage[];
}): string {
  return [
    `You are an SEO content strategist. Build a content brief for an article targeting the keyword "${input.keyword}" (language: ${input.languageCode}).`,
    "",
    "Study what already ranks and design a brief that matches the search intent while finding an angle and depth that can beat these pages.",
    "",
    formatSerpContext(input.serpContext),
    "",
    "## Content of the top-ranking pages",
    formatCompetitors(input.competitors),
    "",
    "Return the intent, the winning angle, an H2/H3 outline, the entities the article must cover, and the questions it must answer.",
  ].join("\n");
}

export function buildArticlePrompt(input: {
  keyword: string;
  languageCode: string;
  brief: ArticleBrief;
  competitors: CompetitorPage[];
  siteDomain: string | null;
}): string {
  return [
    `You are an expert SEO writer. Write a complete article targeting the keyword "${input.keyword}", entirely in the language with code "${input.languageCode}".`,
    input.siteDomain
      ? `The article will be published on ${input.siteDomain}; write as that site's editorial voice (first-person plural is fine), but never fabricate facts about the company.`
      : null,
    "",
    "## Brief",
    `Intent: ${input.brief.intent}`,
    `Angle: ${input.brief.angle}`,
    "Outline:",
    ...input.brief.outline.map(
      (section) =>
        `- ${section.heading}${section.subheadings.length ? ` (${section.subheadings.join("; ")})` : ""}`,
    ),
    `Entities to cover: ${input.brief.entities.join(", ")}`,
    `Questions to answer: ${input.brief.questions.join(" | ")}`,
    "",
    "## Hard requirements",
    "- Open the article with a 40-60 word paragraph that directly and completely answers the query (featured-snippet style), before any heading.",
    "- Follow the outline with H2 (##) and H3 (###) headings. Do not include an H1; the title is returned separately.",
    "- Cite independent sources inline as markdown links where claims need backing. Only link to real URLs taken from the reference pages below — never invent URLs.",
    "- End with a FAQ section answering the brief's questions concisely; also return the same Q/A pairs in the structured faq field.",
    "- Natural, on-brand prose. No filler, no generic AI phrasing, no keyword stuffing.",
    "",
    "## Reference pages (for facts and linkable sources)",
    formatCompetitors(input.competitors),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
