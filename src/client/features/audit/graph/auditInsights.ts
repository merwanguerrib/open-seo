import type Graph from "graphology";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

export interface AuditInsight {
  id: string;
  title: string;
  description: string;
  severity: "warning" | "info";
  nodeIds: string[];
  csvHeaders: string[];
  csvRows: (string | number | null)[][];
}

interface InsightInput {
  payload: AuditGraphPayload;
  graph: Graph;
  metrics: {
    orphans: string[];
    depthByNode: Map<string, number>;
    pagerank: Record<string, number>;
  };
  depthThreshold?: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))];
}

export function computeAuditInsights(input: InsightInput): AuditInsight[] {
  const { payload, graph, metrics } = input;
  const depthThreshold = input.depthThreshold ?? 3;
  const nodeById = new Map(payload.nodes.map((n) => [n.id, n]));
  const url = (id: string) => nodeById.get(id)?.url ?? id;
  const insights: AuditInsight[] = [];

  // Orphan pages: no inbound internal links (excluding the start node).
  if (metrics.orphans.length > 0) {
    insights.push({
      id: "orphans",
      title: "Orphan pages",
      description: `${metrics.orphans.length} page(s) with no inbound internal links, unreachable through the site's link graph.`,
      severity: "warning",
      nodeIds: metrics.orphans,
      csvHeaders: ["URL", "Title"],
      csvRows: metrics.orphans.map((id) => [
        url(id),
        nodeById.get(id)?.title ?? "",
      ]),
    });
  }

  // Pages deeper than the click-depth threshold from the start page.
  const deep = [...metrics.depthByNode.entries()].filter(
    ([, depth]) => depth > depthThreshold,
  );
  if (deep.length > 0) {
    insights.push({
      id: "deep-pages",
      title: `Pages deeper than ${depthThreshold} clicks`,
      description: `${deep.length} page(s) are more than ${depthThreshold} clicks from the start page.`,
      severity: "warning",
      nodeIds: deep.map(([id]) => id),
      csvHeaders: ["URL", "Click depth"],
      csvRows: deep.map(([id, depth]) => [url(id), depth]),
    });
  }

  // Broken internal links (target crawled with a 4xx/5xx status).
  const brokenEdges = payload.edges.filter((e) => e.isBroken);
  if (brokenEdges.length > 0) {
    const nodeIds = [...new Set(brokenEdges.flatMap((e) => [e.from, e.to]))];
    insights.push({
      id: "broken-internal-links",
      title: "Broken internal links",
      description: `${brokenEdges.length} internal link(s) point to a page that returned an error.`,
      severity: "warning",
      nodeIds,
      csvHeaders: ["From URL", "To URL", "Anchor"],
      csvRows: brokenEdges.map((e) => [url(e.from), url(e.to), e.anchorText]),
    });
  }

  // Under-linked rich pages: top-quartile word count but bottom-quartile PageRank,
  // restricted to indexable 200-status pages.
  const candidates = payload.nodes.filter(
    (n) => n.isIndexable && n.statusCode === 200,
  );
  if (candidates.length > 0) {
    const words = candidates.map((n) => n.wordCount);
    const prs = candidates.map((n) => metrics.pagerank[n.id] ?? 0);
    const p75Words = percentile(words, 0.75);
    const p25Pr = percentile(prs, 0.25);
    const underLinked = candidates.filter(
      (n) => n.wordCount > p75Words && (metrics.pagerank[n.id] ?? 0) < p25Pr,
    );
    if (underLinked.length > 0) {
      insights.push({
        id: "under-linked-rich-pages",
        title: "Under-linked content pages",
        description: `${underLinked.length} content-heavy page(s) receive little internal link equity - consider linking to them more.`,
        severity: "info",
        nodeIds: underLinked.map((n) => n.id),
        csvHeaders: ["URL", "Word count", "PageRank"],
        csvRows: underLinked.map((n) => [
          n.url,
          n.wordCount,
          metrics.pagerank[n.id] ?? 0,
        ]),
      });
    }
  }

  // Hub pages: most inbound internal links (top 5).
  const hubs = payload.nodes
    .map((n) => ({ id: n.id, url: n.url, inDegree: graph.inDegree(n.id) }))
    .filter((n) => n.inDegree > 0)
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, 5);
  if (hubs.length > 0) {
    insights.push({
      id: "hub-pages",
      title: "Hub pages",
      description: `Top ${hubs.length} page(s) by inbound internal links: key pages to preserve.`,
      severity: "info",
      nodeIds: hubs.map((h) => h.id),
      csvHeaders: ["URL", "Inbound internal links"],
      csvRows: hubs.map((h) => [h.url, h.inDegree]),
    });
  }

  return insights;
}
