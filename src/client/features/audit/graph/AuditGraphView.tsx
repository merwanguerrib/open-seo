import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildGraphologyGraph,
  computeGraphMetrics,
} from "@/client/features/audit/graph/graphologyGraph";
import { buildGraphSummary } from "@/client/features/audit/graph/graphSummary";
import { computeAuditInsights } from "@/client/features/audit/graph/auditInsights";
import { nodeHighlightReducer } from "@/client/features/audit/graph/graphHighlight";
import {
  computeCategories,
  deriveCategory,
} from "@/client/features/audit/graph/pageCategories";
import { buildNodeDetail } from "@/client/features/audit/graph/nodeDetail";
import { computeStructuralClusters } from "@/client/features/audit/graph/structuralClusters";
import { AuditClustersPanel } from "@/client/features/audit/graph/AuditClustersPanel";
import { AuditInsightsPanel } from "@/client/features/audit/graph/AuditInsightsPanel";
import { AuditCategoryLegend } from "@/client/features/audit/graph/AuditCategoryLegend";
import { AuditNodeDetailPanel } from "@/client/features/audit/graph/AuditNodeDetailPanel";
import {
  buildGraphExportRows,
  buildGraphExportJson,
} from "@/client/features/audit/graph/graphExport";
import { buildCsv, downloadCsv, downloadJson } from "@/client/lib/csv";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

type Selection =
  | { kind: "insight" | "category" | "cluster"; id: string }
  | null;
type ColorMode = "category" | "community";

export function AuditGraphView({ payload }: { payload: AuditGraphPayload }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<{ refresh: () => void; kill: () => void } | null>(
    null,
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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
  const categories = useMemo(() => computeCategories(payload), [payload]);
  const [colorMode, setColorMode] = useState<ColorMode>("category");
  const structural = useMemo(
    () => computeStructuralClusters(payload, graph, metrics.pagerank),
    [payload, graph, metrics],
  );

  const highlightedIds = useMemo(() => {
    if (!selection) return new Set<string>();
    if (selection.kind === "insight") {
      const selected = insights.find((i) => i.id === selection.id);
      return new Set(selected?.nodeIds ?? []);
    }
    if (selection.kind === "cluster") {
      const cluster = structural.clusters.find((c) => c.id === selection.id);
      return new Set(cluster?.nodeIds ?? []);
    }
    return new Set(
      payload.nodes
        .filter((n) => deriveCategory(n.url) === selection.id)
        .map((n) => n.id),
    );
  }, [selection, insights, structural, payload]);

  const nodeDetail = useMemo(
    () =>
      selectedNodeId
        ? buildNodeDetail(payload, graph, metrics, selectedNodeId)
        : null,
    [selectedNodeId, payload, graph, metrics],
  );

  const highlightRef = useRef<Set<string>>(highlightedIds);
  highlightRef.current = highlightedIds;
  const activeColors =
    colorMode === "community"
      ? structural.colorByNodeId
      : categories.colorByNodeId;
  const colorsRef = useRef(activeColors);
  colorsRef.current = activeColors;

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
        graph.setNodeAttribute(n, "color", colorsRef.current.get(n) ?? "#999999");
      });
      forceAtlas2.assign(graph, {
        iterations: 300,
        settings: {
          barnesHutOptimize: true,
          scalingRatio: 20,
          gravity: 1.5,
          adjustSizes: true,
        },
      });
      const sigmaInstance = new Sigma(graph, containerRef.current, {
        zIndex: true,
        nodeReducer: (node: string, data: Record<string, unknown>) => {
          const h = highlightRef.current;
          return { ...data, ...nodeHighlightReducer(h.has(node), h.size > 0) };
        },
      });
      sigmaInstance.on("clickNode", ({ node }) => setSelectedNodeId(node));
      sigmaInstance.on("clickStage", () => setSelectedNodeId(null));
      renderer = sigmaInstance;
      rendererRef.current = sigmaInstance;
    })();
    return () => {
      cancelled = true;
      renderer?.kill();
      rendererRef.current = null;
    };
  }, [graph]);

  useEffect(() => {
    rendererRef.current?.refresh();
  }, [highlightedIds]);

  useEffect(() => {
    graph.forEachNode((n) => {
      graph.setNodeAttribute(n, "color", colorsRef.current.get(n) ?? "#999999");
    });
    rendererRef.current?.refresh();
  }, [activeColors, graph]);

  useEffect(() => {
    setSelection(null);
    setSelectedNodeId(null);
    setColorMode("category");
  }, [payload]);

  const selectedCategory =
    selection?.kind === "category" ? selection.id : null;
  const selectedInsightId =
    selection?.kind === "insight" ? selection.id : null;

  const exportCsv = () => {
    const { headers, rows } = buildGraphExportRows(payload, graph, metrics);
    downloadCsv("audit-graph.csv", buildCsv(headers, rows));
  };
  const exportJson = () => {
    downloadJson("audit-graph.json", buildGraphExportJson(payload, graph, metrics));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-base-content/70">
          {summary.pagesCrawled} pages &middot; {summary.orphanCount} orphan
          {summary.orphanCount === 1 ? "" : "s"} &middot; {summary.brokenCount}{" "}
          broken internal link{summary.brokenCount === 1 ? "" : "s"}
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn btn-ghost btn-xs" onClick={exportCsv}>
            Export CSV
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={exportJson}>
            Export JSON
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        <div className="max-h-[600px] space-y-4 overflow-y-auto">
          <div className="join w-full">
            <button
              type="button"
              className={`btn join-item btn-xs flex-1 ${colorMode === "category" ? "btn-active" : ""}`}
              onClick={() => setColorMode("category")}
            >
              Categories
            </button>
            <button
              type="button"
              className={`btn join-item btn-xs flex-1 ${colorMode === "community" ? "btn-active" : ""}`}
              onClick={() => setColorMode("community")}
            >
              Communities
            </button>
          </div>
          {colorMode === "category" ? (
            <AuditCategoryLegend
              legend={categories.legend}
              selectedCategory={selectedCategory}
              onSelect={(category) =>
                setSelection(
                  category ? { kind: "category", id: category } : null,
                )
              }
            />
          ) : (
            <AuditClustersPanel
              clusters={structural.clusters}
              selectedClusterId={
                selection?.kind === "cluster" ? selection.id : null
              }
              onSelect={(id) =>
                setSelection(id ? { kind: "cluster", id } : null)
              }
            />
          )}
          <AuditInsightsPanel
            insights={insights}
            selectedId={selectedInsightId}
            onSelect={(id) =>
              setSelection(id ? { kind: "insight", id } : null)
            }
          />
        </div>
        <div className="relative">
          <div
            ref={containerRef}
            className="h-[600px] w-full rounded-lg border border-base-300"
          />
          {nodeDetail && (
            <div className="absolute right-3 top-3 z-10 max-h-[calc(100%-1.5rem)] w-[300px] overflow-y-auto rounded-lg bg-base-100 shadow-xl">
              <AuditNodeDetailPanel
                detail={nodeDetail}
                onClose={() => setSelectedNodeId(null)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
