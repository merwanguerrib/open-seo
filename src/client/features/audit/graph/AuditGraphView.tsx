import { useEffect, useMemo, useRef } from "react";
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
    // Sigma + the WebGL layout reference browser-only globals
    // (WebGL2RenderingContext), so load them lazily on the client only —
    // a static import would be evaluated during SSR and crash the worker.
    let renderer: { kill: () => void } | null = null;
    let cancelled = false;
    void (async () => {
      const [{ default: Sigma }, { default: forceAtlas2 }] = await Promise.all([
        import("sigma"),
        import("graphology-layout-forceatlas2"),
      ]);
      if (cancelled || !containerRef.current) return;
      graph.forEachNode((n) => {
        graph.setNodeAttribute(n, "x", Math.random());
        graph.setNodeAttribute(n, "y", Math.random());
        graph.setNodeAttribute(n, "size", 4);
      });
      forceAtlas2.assign(graph, { iterations: 100 });
      renderer = new Sigma(graph, containerRef.current);
    })();
    return () => {
      cancelled = true;
      renderer?.kill();
    };
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
