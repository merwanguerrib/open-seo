import type Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { AuditGraphPayload } from "@/server/lib/audit/types";
import { CATEGORY_PALETTE } from "@/client/features/audit/graph/pageCategories";

export interface StructuralCluster {
  id: string;
  name: string;
  size: number;
  color: string;
  pivotNodeId: string;
  pivotUrl: string;
  nodeIds: string[];
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "your", "our", "page", "home",
  "index", "www", "com", "http", "https", "html",
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function nameCluster(
  nodes: Array<{ url: string; title: string | null }>,
): string | null {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    let path = "";
    try {
      path = new URL(node.url).pathname;
    } catch {
      // keep empty path for unparseable URLs
    }
    for (const term of terms(`${node.title ?? ""} ${path}`)) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  const best = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];
  return best ? best[0] : null;
}

export function computeStructuralClusters(
  payload: AuditGraphPayload,
  graph: Graph,
  pagerank: Record<string, number>,
): { clusters: StructuralCluster[]; colorByNodeId: Map<string, string> } {
  if (graph.order === 0) {
    return { clusters: [], colorByNodeId: new Map() };
  }

  // Louvain throws on an edgeless graph; treat that case as one community.
  const communityByNode: Record<string, number> =
    graph.size === 0
      ? Object.fromEntries(graph.nodes().map((n) => [n, 0]))
      : louvain(graph);

  const nodeById = new Map(payload.nodes.map((n) => [n.id, n]));
  const membersByCommunity = new Map<string, string[]>();
  for (const [nodeId, community] of Object.entries(communityByNode)) {
    const key = String(community);
    const members = membersByCommunity.get(key) ?? [];
    members.push(nodeId);
    membersByCommunity.set(key, members);
  }

  const clusters: StructuralCluster[] = [...membersByCommunity.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([id, nodeIds], index) => {
      const members = nodeIds
        .map((nid) => nodeById.get(nid))
        .filter((n): n is NonNullable<typeof n> => n != null);
      const pivotNodeId = nodeIds.reduce((best, nid) =>
        (pagerank[nid] ?? 0) > (pagerank[best] ?? 0) ? nid : best,
      );
      return {
        id,
        name: nameCluster(members) ?? `Cluster ${index + 1}`,
        size: nodeIds.length,
        color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
        pivotNodeId,
        pivotUrl: nodeById.get(pivotNodeId)?.url ?? pivotNodeId,
        nodeIds,
      };
    });

  const colorByNodeId = new Map<string, string>();
  for (const cluster of clusters) {
    for (const nodeId of cluster.nodeIds) {
      colorByNodeId.set(nodeId, cluster.color);
    }
  }
  return { clusters, colorByNodeId };
}
