/**
 * Shared types for the site audit system.
 */

import { z } from "zod";
import { jsonCodec } from "@/shared/json";

export type LighthouseStrategy = "auto" | "all" | "manual" | "none";

export interface AuditConfig {
  maxPages: number;
  lighthouseStrategy: LighthouseStrategy;
  captureContent: boolean;
}

const auditConfigSchema = z.object({
  maxPages: z.number().int().min(10).max(10_000),
  lighthouseStrategy: z.enum(["auto", "all", "manual", "none"]),
  captureContent: z.boolean().default(false),
});

const auditConfigCodec = jsonCodec(auditConfigSchema);

export function parseAuditConfig(configRaw: string | null): AuditConfig | null {
  if (!configRaw) return null;
  const result = auditConfigCodec.safeParse(configRaw);
  return result.success ? result.data : null;
}

/** Data extracted from a single page via cheerio. */
export interface PageAnalysis {
  url: string;
  statusCode: number;
  redirectUrl: string | null;
  responseTimeMs: number;

  // Head metadata
  title: string;
  metaDescription: string;
  canonical: string | null;
  robotsMeta: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;

  // Headings
  h1s: string[];
  headingOrder: number[];

  // Content
  wordCount: number;

  // Images
  images: Array<{ src: string | null; alt: string | null }>;

  // Links (raw href values from the HTML)
  internalLinks: string[];
  externalLinks: string[];

  // Internal links with anchor text, for the page graph
  internalLinkDetails: Array<{ url: string; anchorText: string | null }>;
  // Cleaned visible body text (for optional R2 storage / Graphify)
  cleanedText: string;

  // Structured data
  hasStructuredData: boolean;

  // Hreflang
  hreflangTags: string[];
}

/** Lighthouse result for a single URL+strategy. */
export interface LighthouseResult {
  url: string;
  pageId: string;
  strategy: "mobile" | "desktop";
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
  ttfbMs: number | null;
  errorMessage?: string | null;
  r2Key?: string | null;
  payloadSizeBytes?: number | null;
}

export interface AuditGraphNode {
  id: string;
  url: string;
  title: string | null;
  statusCode: number | null;
  wordCount: number;
  internalLinkCount: number;
  isIndexable: boolean;
}
export interface AuditGraphEdge {
  from: string;
  to: string;
  anchorText: string | null;
  isBroken: boolean;
}
export interface AuditGraphPayload {
  nodes: AuditGraphNode[];
  edges: AuditGraphEdge[];
  meta: {
    auditId: string;
    startUrl: string;
    pagesCrawled: number;
    generatedAt: string;
  };
}

export interface StepPageResult {
  id: string;
  url: string;
  statusCode: number;
  redirectUrl: string | null;
  title: string;
  metaDescription: string;
  canonicalUrl: string | null;
  robotsMeta: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  h4Count: number;
  h5Count: number;
  h6Count: number;
  headingOrder: number[];
  wordCount: number;
  imagesTotal: number;
  imagesMissingAlt: number;
  images: Array<{ src: string | null; alt: string | null }>;
  internalLinks: string[];
  externalLinks: string[];
  internalLinkDetails: Array<{ url: string; anchorText: string | null }>;
  cleanedText: string;
  hasStructuredData: boolean;
  hreflangTags: string[];
  isIndexable: boolean;
  responseTimeMs: number;
  contentR2Key?: string | null;
}
