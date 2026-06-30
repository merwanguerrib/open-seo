import Graph from "graphology";
import pagerank from "graphology-metrics/centrality/pagerank";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

export function buildGraphologyGraph(payload: AuditGraphPayload): Graph {
  const graph = new Graph({ type: "directed", multi: false });
  for (const node of payload.nodes) {
    graph.addNode(node.id, {
      url: node.url,
      label: node.title ?? node.url,
      statusCode: node.statusCode,
      wordCount: node.wordCount,
      isIndexable: node.isIndexable,
    });
  }
  for (const edge of payload.edges) {
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue;
    if (graph.hasEdge(edge.from, edge.to)) continue;
    graph.addEdge(edge.from, edge.to, {
      anchorText: edge.anchorText,
      isBroken: edge.isBroken,
    });
  }
  return graph;
}

export function computeGraphMetrics(graph: Graph, startNodeId: string) {
  const orphans = graph
    .nodes()
    .filter((n) => n !== startNodeId && graph.inDegree(n) === 0);

  // BFS depth from the start node over outbound edges
  const depthByNode = new Map<string, number>();
  if (graph.hasNode(startNodeId)) {
    depthByNode.set(startNodeId, 0);
    const queue = [startNodeId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      const depth = depthByNode.get(current) ?? 0;
      graph.forEachOutNeighbor(current, (neighbor) => {
        if (!depthByNode.has(neighbor)) {
          depthByNode.set(neighbor, depth + 1);
          queue.push(neighbor);
        }
      });
    }
  }

  const pr = graph.order > 0 ? pagerank(graph) : {};
  return { orphans, depthByNode, pagerank: pr as Record<string, number> };
}
