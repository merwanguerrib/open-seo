import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildGraphologyGraph,
  computeGraphMetrics,
} from "@/client/features/audit/graph/graphologyGraph";
import { buildGraphSummary } from "@/client/features/audit/graph/graphSummary";
import { computeAuditInsights } from "@/client/features/audit/graph/auditInsights";
import { nodeHighlightReducer } from "@/client/features/audit/graph/graphHighlight";
import { AuditInsightsPanel } from "@/client/features/audit/graph/AuditInsightsPanel";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

export function AuditGraphView({ payload }: { payload: AuditGraphPayload }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<{ refresh: () => void; kill: () => void } | null>(
    null,
  );
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(
    null,
  );

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
  const insights = useMemo(
    () => computeAuditInsights({ payload, graph, metrics }),
    [payload, graph, metrics],
  );
  const highlightedIds = useMemo(() => {
    const selected = insights.find((i) => i.id === selectedInsightId);
    return new Set(selected?.nodeIds ?? []);
  }, [insights, selectedInsightId]);

  // Keep a ref the Sigma nodeReducer reads, so highlight changes don't
  // require recreating the renderer.
  const highlightRef = useRef<Set<string>>(highlightedIds);
  highlightRef.current = highlightedIds;

  useEffect(() => {
    if (!containerRef.current || graph.order === 0) return;
    let renderer: { refresh: () => void; kill: () => void } | null = null;
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
      renderer = new Sigma(graph, containerRef.current, {
        zIndex: true,
        nodeReducer: (node: string, data: Record<string, unknown>) => {
          const h = highlightRef.current;
          return {
            ...data,
            ...nodeHighlightReducer(h.has(node), h.size > 0),
          };
        },
      });
      rendererRef.current = renderer;
    })();
    return () => {
      cancelled = true;
      renderer?.kill();
      rendererRef.current = null;
    };
  }, [graph]);

  // Re-render the graph when the highlighted set changes.
  useEffect(() => {
    rendererRef.current?.refresh();
  }, [highlightedIds]);

  return (
    <div className="space-y-3">
      <div className="text-sm text-base-content/70">
        {summary.pagesCrawled} pages &middot; {summary.orphanCount} orphan
        {summary.orphanCount === 1 ? "" : "s"} &middot; {summary.brokenCount}{" "}
        broken internal link{summary.brokenCount === 1 ? "" : "s"}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <div className="max-h-[600px] overflow-y-auto">
          <AuditInsightsPanel
            insights={insights}
            selectedId={selectedInsightId}
            onSelect={setSelectedInsightId}
          />
        </div>
        <div
          ref={containerRef}
          className="h-[600px] w-full rounded-lg border border-base-300"
        />
      </div>
    </div>
  );
}
