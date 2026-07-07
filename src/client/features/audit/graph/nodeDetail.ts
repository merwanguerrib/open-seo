import type Graph from "graphology";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

export interface NodeDetail {
  url: string;
  title: string | null;
  statusCode: number | null;
  isIndexable: boolean;
  inbound: number;
  outboundInternal: number;
  externalLinks: number;
  h1Count: number;
  canonicalUrl: string | null;
  clickDepth: number | null;
  pagerank: number;
}

export function buildNodeDetail(
  payload: AuditGraphPayload,
  graph: Graph,
  metrics: { depthByNode: Map<string, number>; pagerank: Record<string, number> },
  nodeId: string,
): NodeDetail | null {
  const node = payload.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  return {
    url: node.url,
    title: node.title,
    statusCode: node.statusCode,
    isIndexable: node.isIndexable,
    inbound: graph.hasNode(nodeId) ? graph.inDegree(nodeId) : 0,
    outboundInternal: node.internalLinkCount,
    externalLinks: node.externalLinkCount,
    h1Count: node.h1Count,
    canonicalUrl: node.canonicalUrl,
    clickDepth: metrics.depthByNode.get(nodeId) ?? null,
    pagerank: metrics.pagerank[nodeId] ?? 0,
  };
}
