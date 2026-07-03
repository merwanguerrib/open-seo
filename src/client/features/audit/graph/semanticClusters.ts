import type { AuditGraphPayload } from "@/server/lib/audit/types";
import {
  CATEGORY_PALETTE,
  type CategoryLegendEntry,
} from "@/client/features/audit/graph/pageCategories";

const UNCLUSTERED = "(unclustered)";
const UNCLUSTERED_COLOR = "#9ca3af"; // gray-400

export function computeSemanticClusters(payload: AuditGraphPayload): {
  legend: CategoryLegendEntry[];
  colorByNodeId: Map<string, string>;
} {
  const hasAny = payload.nodes.some((n) => n.semanticCluster != null);
  if (!hasAny) return { legend: [], colorByNodeId: new Map() };

  const counts = new Map<string, number>();
  const clusterByNode = new Map<string, string>();
  for (const node of payload.nodes) {
    const cluster = node.semanticCluster ?? UNCLUSTERED;
    clusterByNode.set(node.id, cluster);
    counts.set(cluster, (counts.get(cluster) ?? 0) + 1);
  }

  const named = [...counts.entries()]
    .filter(([cluster]) => cluster !== UNCLUSTERED)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count], index) => ({
      category,
      count,
      color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
    }));
  const legend: CategoryLegendEntry[] = counts.has(UNCLUSTERED)
    ? [
        ...named,
        {
          category: UNCLUSTERED,
          count: counts.get(UNCLUSTERED) ?? 0,
          color: UNCLUSTERED_COLOR,
        },
      ]
    : named;

  const colorByCluster = new Map(legend.map((e) => [e.category, e.color]));
  const colorByNodeId = new Map<string, string>();
  for (const [nodeId, cluster] of clusterByNode) {
    colorByNodeId.set(
      nodeId,
      colorByCluster.get(cluster) ?? UNCLUSTERED_COLOR,
    );
  }
  return { legend, colorByNodeId };
}
