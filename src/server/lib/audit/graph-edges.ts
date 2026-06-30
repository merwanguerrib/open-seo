import type { AuditGraphNode, AuditGraphPayload, StepPageResult } from "./types";

export interface EdgeRow {
  id: string;
  auditId: string;
  fromPageId: string;
  toUrl: string;
  anchorText: string | null;
}

export function buildEdgeRows(
  auditId: string,
  pages: Pick<StepPageResult, "id" | "internalLinkDetails">[],
): EdgeRow[] {
  const rows: EdgeRow[] = [];
  for (const page of pages) {
    const seen = new Set<string>();
    for (const link of page.internalLinkDetails) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      rows.push({
        id: `audit_page_links:${page.id}:${link.url}`,
        auditId,
        fromPageId: page.id,
        toUrl: link.url,
        anchorText: link.anchorText,
      });
    }
  }
  return rows;
}

export function buildAuditGraphPayload(input: {
  auditId: string;
  startUrl: string;
  pages: AuditGraphNode[];
  edges: Array<{
    fromPageId: string;
    toPageId: string | null;
    anchorText: string | null;
    isBroken: boolean;
  }>;
}): AuditGraphPayload {
  return {
    nodes: input.pages,
    edges: input.edges
      .filter((e) => e.toPageId !== null)
      .map((e) => ({
        from: e.fromPageId,
        to: e.toPageId as string,
        anchorText: e.anchorText,
        isBroken: e.isBroken,
      })),
    meta: {
      auditId: input.auditId,
      startUrl: input.startUrl,
      pagesCrawled: input.pages.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

export function resolveEdges(
  edges: Array<{ id: string; toUrl: string }>,
  pages: Array<{ id: string; url: string; statusCode: number | null }>,
): Array<{ id: string; toPageId: string | null; isBroken: boolean }> {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  return edges.map((edge) => {
    const target = byUrl.get(edge.toUrl) ?? null;
    const isBroken =
      target?.statusCode != null && target.statusCode >= 400;
    return {
      id: edge.id,
      toPageId: target?.id ?? null,
      isBroken: Boolean(isBroken),
    };
  });
}
