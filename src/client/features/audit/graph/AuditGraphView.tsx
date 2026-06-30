import { useEffect, useMemo, useRef } from "react";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import {
  buildGraphologyGraph,
  computeGraphMetrics,
} from "@/client/features/audit/graph/graphologyGraph";
import { buildGraphSummary } from "@/client/features/audit/graph/graphSummary";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

export function AuditGraphView({ payload }: { payload: AuditGraphPayload }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graph = useMemo(() => buildGraphologyGraph(payload), [payload]);
  const startId = useMemo(
    () =>
      payload.nodes.find((n) => n.url === payload.meta.startUrl)?.id ??
      payload.nodes[0]?.id ??
      "",
    [payload],
  );
  const metrics = useMemo(
    () => computeGraphMetrics(graph, startId),
    [graph, startId],
  );
  const summary = useMemo(
    () => buildGraphSummary(payload, metrics),
    [payload, metrics],
  );

  useEffect(() => {
    if (!containerRef.current || graph.order === 0) return;
    graph.forEachNode((n) => {
      graph.setNodeAttribute(n, "x", Math.random());
      graph.setNodeAttribute(n, "y", Math.random());
      graph.setNodeAttribute(n, "size", 4);
    });
    forceAtlas2.assign(graph, { iterations: 100 });
    const renderer = new Sigma(graph, containerRef.current);
    return () => renderer.kill();
  }, [graph]);

  return (
    <div className="space-y-3">
      <div className="text-sm text-base-content/70">
        {summary.pagesCrawled} pages &middot; {summary.orphanCount} orphan
        {summary.orphanCount === 1 ? "" : "s"} &middot; {summary.brokenCount}{" "}
        broken internal link{summary.brokenCount === 1 ? "" : "s"}
      </div>
      <div
        ref={containerRef}
        className="h-[600px] w-full rounded-lg border border-base-300"
      />
    </div>
  );
}
