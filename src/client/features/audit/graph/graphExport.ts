import type Graph from "graphology";
import { deriveCategory } from "@/client/features/audit/graph/pageCategories";
import type { AuditGraphPayload } from "@/server/lib/audit/types";
import type { CsvValue } from "@/client/lib/csv";

export interface GraphExportMetrics {
  depthByNode: Map<string, number>;
  pagerank: Record<string, number>;
}

export const GRAPH_EXPORT_HEADERS = [
  "URL",
  "Title",
  "Category",
  "Status",
  "Indexable",
  "Inbound internal links",
  "Outbound internal links",
  "External links",
  "H1 count",
  "Click depth",
  "Internal PageRank",
  "Canonical",
];

function inboundOf(graph: Graph, nodeId: string): number {
  return graph.hasNode(nodeId) ? graph.inDegree(nodeId) : 0;
}

/** Flat one-row-per-page table for CSV export. */
export function buildGraphExportRows(
  payload: AuditGraphPayload,
  graph: Graph,
  metrics: GraphExportMetrics,
): { headers: string[]; rows: CsvValue[][] } {
  const rows: CsvValue[][] = payload.nodes.map((node) => [
    node.url,
    node.title ?? "",
    deriveCategory(node.url),
    node.statusCode,
    node.isIndexable ? "Yes" : "No",
    inboundOf(graph, node.id),
    node.internalLinkCount,
    node.externalLinkCount,
    node.h1Count,
    metrics.depthByNode.get(node.id) ?? "",
    metrics.pagerank[node.id] ?? 0,
    node.canonicalUrl ?? "",
  ]);
  return { headers: GRAPH_EXPORT_HEADERS, rows };
}

export interface GraphExportNode {
  id: string;
  url: string;
  title: string | null;
  category: string;
  statusCode: number | null;
  isIndexable: boolean;
  inbound: number;
  outboundInternal: number;
  externalLinks: number;
  h1Count: number;
  clickDepth: number | null;
  pagerank: number;
  canonicalUrl: string | null;
}

export interface GraphExportJson {
  meta: AuditGraphPayload["meta"];
  nodes: GraphExportNode[];
  edges: AuditGraphPayload["edges"];
}

/** Structured nodes + edges for JSON export. */
export function buildGraphExportJson(
  payload: AuditGraphPayload,
  graph: Graph,
  metrics: GraphExportMetrics,
): GraphExportJson {
  return {
    meta: payload.meta,
    nodes: payload.nodes.map((node) => ({
      id: node.id,
      url: node.url,
      title: node.title,
      category: deriveCategory(node.url),
      statusCode: node.statusCode,
      isIndexable: node.isIndexable,
      inbound: inboundOf(graph, node.id),
      outboundInternal: node.internalLinkCount,
      externalLinks: node.externalLinkCount,
      h1Count: node.h1Count,
      clickDepth: metrics.depthByNode.get(node.id) ?? null,
      pagerank: metrics.pagerank[node.id] ?? 0,
      canonicalUrl: node.canonicalUrl,
    })),
    edges: payload.edges,
  };
}
