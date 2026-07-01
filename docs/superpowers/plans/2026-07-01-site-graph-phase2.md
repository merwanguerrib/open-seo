# Site Graph — Phase 2 (Actionable SEO Insights) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Phase 1 graph metrics into an actionable SEO insights panel beside the graph, where clicking an insight highlights the affected pages in the graph and each insight exports to CSV.

**Architecture:** Pure functions derive insights from the existing `AuditGraphPayload` + graphology graph + `computeGraphMetrics`. `AuditGraphView` becomes the container: it computes insights, holds the selected-insight state, drives a Sigma `nodeReducer` (via a pure highlight helper) to accent/dim nodes, and renders an `AuditInsightsPanel` next to the graph. CSV export reuses the existing `buildCsv`/`downloadCsv` helpers.

**Tech Stack:** TypeScript, React, graphology + graphology-metrics, Sigma.js (dynamic client-only import — see Global Constraints), Vitest.

## Global Constraints

- Insights are derived **client-side** from the Phase 1 payload + graphology graph + `computeGraphMetrics`; no new server endpoint.
- Only include an insight when it has ≥1 affected node (`nodeIds.length > 0`) — empty categories are omitted.
- Click-depth threshold default `3` (matches Phase 1).
- Sigma and the forceatlas2 layout MUST remain **dynamic client-only imports inside the effect** (a static import crashes SSR on Cloudflare Workers — `WebGL2RenderingContext is not defined`). Do NOT add a top-level `import Sigma`/`import forceAtlas2`.
- CSV export reuses `buildCsv(headers, rows)` and `downloadCsv(filename, content)` from `@/client/lib/csv` (never hand-roll CSV — the helper does OWASP formula-injection sanitisation).
- Tests run under vitest `environment: "node"`, `include: ["src/**/*.test.ts"]` (no `.tsx`, no jsdom). Testable logic lives in pure `.ts` modules; React components are verified by `pnpm types:check` + running the app.
- Follow existing daisyUI/tailwind class conventions seen in `ResultsView.tsx`.
- Node version 20+, pnpm. Tests: `pnpm vitest run <path>`. Types: `pnpm types:check`.

---

## File Structure

- `src/client/features/audit/graph/auditInsights.ts` *(new)* — pure `computeAuditInsights` + `AuditInsight` type.
- `src/client/features/audit/graph/graphHighlight.ts` *(new)* — pure `nodeHighlightReducer` (accent/dim decision for the Sigma node reducer).
- `src/client/features/audit/graph/AuditInsightsPanel.tsx` *(new)* — presentational insight list + per-insight CSV export button.
- `src/client/features/audit/graph/AuditGraphView.tsx` *(modify)* — compute insights, hold selected-insight state, drive the Sigma `nodeReducer`, render the panel beside the graph.

`ResultsView.tsx` is unchanged: it still renders `<AuditGraphView payload={graphPayload} />`; the panel lives inside `AuditGraphView`.

---

## Task 1: Pure insights computation

**Files:**
- Create: `src/client/features/audit/graph/auditInsights.ts`
- Test: `src/client/features/audit/graph/auditInsights.test.ts`

**Interfaces:**
- Consumes: `AuditGraphPayload` (`@/server/lib/audit/types`), a graphology `Graph`, and `computeGraphMetrics`' return shape `{ orphans: string[]; depthByNode: Map<string, number>; pagerank: Record<string, number> }`.
- Produces: `AuditInsight` and `computeAuditInsights(input): AuditInsight[]`.

```ts
export interface AuditInsight {
  id: string;                 // stable key, e.g. "orphans"
  title: string;
  description: string;        // human summary including the count
  severity: "warning" | "info";
  nodeIds: string[];          // affected node ids → graph highlight
  csvHeaders: string[];
  csvRows: (string | number | null)[][];
}
```

- [ ] **Step 1: Write the failing test**

Create `src/client/features/audit/graph/auditInsights.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeAuditInsights } from "./auditInsights";
import {
  buildGraphologyGraph,
  computeGraphMetrics,
} from "./graphologyGraph";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const node = (
  id: string,
  url: string,
  wordCount: number,
  statusCode = 200,
) => ({
  id,
  url,
  title: id,
  statusCode,
  wordCount,
  internalLinkCount: 0,
  isIndexable: true,
});

const payload: AuditGraphPayload = {
  nodes: [
    node("home", "https://s.com/", 100),
    node("a", "https://s.com/a", 500),
    node("b", "https://s.com/b", 10),
    node("orphan", "https://s.com/orphan", 5),
    node("dead", "https://s.com/dead", 5, 404),
  ],
  edges: [
    { from: "home", to: "a", anchorText: "A", isBroken: false },
    { from: "home", to: "b", anchorText: "B", isBroken: false },
    { from: "a", to: "b", anchorText: "B2", isBroken: false },
    { from: "b", to: "dead", anchorText: "dead", isBroken: true },
  ],
  meta: { auditId: "x", startUrl: "https://s.com/", pagesCrawled: 5, generatedAt: "t" },
};

describe("computeAuditInsights", () => {
  const graph = buildGraphologyGraph(payload);
  const metrics = computeGraphMetrics(graph, "home");
  const insights = computeAuditInsights({ payload, graph, metrics });
  const byId = (id: string) => insights.find((i) => i.id === id);

  it("detects orphan pages (no inbound links, excluding start)", () => {
    expect(byId("orphans")?.nodeIds).toEqual(["orphan"]);
  });

  it("detects broken internal links and lists both endpoints", () => {
    const broken = byId("broken-internal-links");
    expect(broken?.nodeIds.sort()).toEqual(["b", "dead"]);
    expect(broken?.csvRows).toEqual([
      ["https://s.com/b", "https://s.com/dead", "dead"],
    ]);
  });

  it("omits insights with no affected nodes", () => {
    // No page is deeper than depth 3 in this fixture
    expect(byId("deep-pages")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/client/features/audit/graph/auditInsights.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/client/features/audit/graph/auditInsights.ts`:

```typescript
import type Graph from "graphology";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

export interface AuditInsight {
  id: string;
  title: string;
  description: string;
  severity: "warning" | "info";
  nodeIds: string[];
  csvHeaders: string[];
  csvRows: (string | number | null)[][];
}

interface InsightInput {
  payload: AuditGraphPayload;
  graph: Graph;
  metrics: {
    orphans: string[];
    depthByNode: Map<string, number>;
    pagerank: Record<string, number>;
  };
  depthThreshold?: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function computeAuditInsights(input: InsightInput): AuditInsight[] {
  const { payload, graph, metrics } = input;
  const depthThreshold = input.depthThreshold ?? 3;
  const nodeById = new Map(payload.nodes.map((n) => [n.id, n]));
  const url = (id: string) => nodeById.get(id)?.url ?? id;
  const insights: AuditInsight[] = [];

  // Orphan pages: no inbound internal links (excluding the start node).
  if (metrics.orphans.length > 0) {
    insights.push({
      id: "orphans",
      title: "Orphan pages",
      description: `${metrics.orphans.length} page(s) with no inbound internal links — unreachable through the site's link graph.`,
      severity: "warning",
      nodeIds: metrics.orphans,
      csvHeaders: ["URL", "Title"],
      csvRows: metrics.orphans.map((id) => [url(id), nodeById.get(id)?.title ?? ""]),
    });
  }

  // Pages deeper than the click-depth threshold from the start page.
  const deep = [...metrics.depthByNode.entries()].filter(
    ([, depth]) => depth > depthThreshold,
  );
  if (deep.length > 0) {
    insights.push({
      id: "deep-pages",
      title: `Pages deeper than ${depthThreshold} clicks`,
      description: `${deep.length} page(s) are more than ${depthThreshold} clicks from the start page.`,
      severity: "warning",
      nodeIds: deep.map(([id]) => id),
      csvHeaders: ["URL", "Click depth"],
      csvRows: deep.map(([id, depth]) => [url(id), depth]),
    });
  }

  // Broken internal links (target crawled with a 4xx/5xx status).
  const brokenEdges = payload.edges.filter((e) => e.isBroken);
  if (brokenEdges.length > 0) {
    const nodeIds = [
      ...new Set(brokenEdges.flatMap((e) => [e.from, e.to])),
    ];
    insights.push({
      id: "broken-internal-links",
      title: "Broken internal links",
      description: `${brokenEdges.length} internal link(s) point to a page that returned an error.`,
      severity: "warning",
      nodeIds,
      csvHeaders: ["From URL", "To URL", "Anchor"],
      csvRows: brokenEdges.map((e) => [url(e.from), url(e.to), e.anchorText]),
    });
  }

  // Under-linked rich pages: above-median word count but below-median PageRank.
  const medianWords = median(payload.nodes.map((n) => n.wordCount));
  const medianPr = median(Object.values(metrics.pagerank));
  const underLinked = payload.nodes.filter(
    (n) =>
      n.wordCount >= medianWords &&
      (metrics.pagerank[n.id] ?? 0) <= medianPr,
  );
  if (underLinked.length > 0) {
    insights.push({
      id: "under-linked-rich-pages",
      title: "Under-linked content pages",
      description: `${underLinked.length} content-heavy page(s) receive little internal link equity — consider linking to them more.`,
      severity: "info",
      nodeIds: underLinked.map((n) => n.id),
      csvHeaders: ["URL", "Word count", "PageRank"],
      csvRows: underLinked.map((n) => [
        n.url,
        n.wordCount,
        metrics.pagerank[n.id] ?? 0,
      ]),
    });
  }

  // Hub pages: most inbound internal links (top 5).
  const hubs = payload.nodes
    .map((n) => ({ id: n.id, url: n.url, inDegree: graph.inDegree(n.id) }))
    .filter((n) => n.inDegree > 0)
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, 5);
  if (hubs.length > 0) {
    insights.push({
      id: "hub-pages",
      title: "Hub pages",
      description: `Top ${hubs.length} page(s) by inbound internal links — key pages to preserve.`,
      severity: "info",
      nodeIds: hubs.map((h) => h.id),
      csvHeaders: ["URL", "Inbound internal links"],
      csvRows: hubs.map((h) => [h.url, h.inDegree]),
    });
  }

  return insights;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/client/features/audit/graph/auditInsights.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/features/audit/graph/auditInsights.ts src/client/features/audit/graph/auditInsights.test.ts
git commit -m "feat(audit): compute actionable SEO insights from the page graph"
```

---

## Task 2: Pure node-highlight reducer

**Files:**
- Create: `src/client/features/audit/graph/graphHighlight.ts`
- Test: `src/client/features/audit/graph/graphHighlight.test.ts`

**Interfaces:**
- Produces: `nodeHighlightReducer(isHighlighted, anyHighlighted): { color?: string; zIndex?: number }` — the display override the Sigma `nodeReducer` merges onto a node when an insight is selected.

- [ ] **Step 1: Write the failing test**

Create `src/client/features/audit/graph/graphHighlight.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { nodeHighlightReducer, HIGHLIGHT_COLOR, DIMMED_COLOR } from "./graphHighlight";

describe("nodeHighlightReducer", () => {
  it("returns no override when nothing is highlighted", () => {
    expect(nodeHighlightReducer(false, false)).toEqual({});
  });
  it("accents highlighted nodes", () => {
    expect(nodeHighlightReducer(true, true)).toEqual({
      color: HIGHLIGHT_COLOR,
      zIndex: 1,
    });
  });
  it("dims non-highlighted nodes when a selection is active", () => {
    expect(nodeHighlightReducer(false, true)).toEqual({
      color: DIMMED_COLOR,
      zIndex: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/client/features/audit/graph/graphHighlight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/client/features/audit/graph/graphHighlight.ts`:

```typescript
export const HIGHLIGHT_COLOR = "#ef4444"; // red-500
export const DIMMED_COLOR = "#e5e7eb"; // gray-200

export function nodeHighlightReducer(
  isHighlighted: boolean,
  anyHighlighted: boolean,
): { color?: string; zIndex?: number } {
  if (!anyHighlighted) return {};
  return isHighlighted
    ? { color: HIGHLIGHT_COLOR, zIndex: 1 }
    : { color: DIMMED_COLOR, zIndex: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/client/features/audit/graph/graphHighlight.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/features/audit/graph/graphHighlight.ts src/client/features/audit/graph/graphHighlight.test.ts
git commit -m "feat(audit): add pure node-highlight reducer for the graph"
```

---

## Task 3: Insights panel component

**Files:**
- Create: `src/client/features/audit/graph/AuditInsightsPanel.tsx`

**Interfaces:**
- Consumes: `AuditInsight` (Task 1), `buildCsv`/`downloadCsv` (`@/client/lib/csv`).
- Produces: `AuditInsightsPanel` component with props `{ insights: AuditInsight[]; selectedId: string | null; onSelect: (id: string | null) => void }`.

This component is presentational (no automated test — the project has no DOM test infra). It is verified by `pnpm types:check` and the app-run in Task 4.

- [ ] **Step 1: Implement the component**

Create `src/client/features/audit/graph/AuditInsightsPanel.tsx`:

```typescript
import { buildCsv, downloadCsv } from "@/client/lib/csv";
import type { AuditInsight } from "@/client/features/audit/graph/auditInsights";

function exportInsight(insight: AuditInsight) {
  downloadCsv(
    `audit-${insight.id}.csv`,
    buildCsv(insight.csvHeaders, insight.csvRows),
  );
}

export function AuditInsightsPanel({
  insights,
  selectedId,
  onSelect,
}: {
  insights: AuditInsight[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (insights.length === 0) {
    return (
      <div className="text-sm text-base-content/60">
        No issues detected in the internal link structure.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {insights.map((insight) => {
        const isSelected = insight.id === selectedId;
        return (
          <div
            key={insight.id}
            className={`rounded-lg border p-3 ${
              isSelected ? "border-primary bg-primary/5" : "border-base-300"
            }`}
          >
            <button
              type="button"
              className="w-full text-left"
              onClick={() => onSelect(isSelected ? null : insight.id)}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`badge badge-sm ${
                    insight.severity === "warning"
                      ? "badge-warning"
                      : "badge-ghost"
                  }`}
                >
                  {insight.nodeIds.length}
                </span>
                <span className="font-medium">{insight.title}</span>
              </div>
              <p className="mt-1 text-xs text-base-content/60">
                {insight.description}
              </p>
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs mt-2"
              onClick={() => exportInsight(insight)}
            >
              Export CSV
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm types:check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/features/audit/graph/AuditInsightsPanel.tsx
git commit -m "feat(audit): add SEO insights panel with per-insight CSV export"
```

---

## Task 4: Wire insights + highlighting into AuditGraphView

**Files:**
- Modify: `src/client/features/audit/graph/AuditGraphView.tsx`

**Interfaces:**
- Consumes: `computeAuditInsights` (Task 1), `nodeHighlightReducer` (Task 2), `AuditInsightsPanel` (Task 3).

- [ ] **Step 1: Replace AuditGraphView with the insights-aware container**

Overwrite `src/client/features/audit/graph/AuditGraphView.tsx` with (note: Sigma + forceAtlas2 stay dynamically imported inside the effect — do not add static imports for them):

```typescript
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
```

- [ ] **Step 2: Type-check**

Run: `pnpm types:check`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm vitest run`
Expected: all pass (the Phase 1 graphSummary/graphologyGraph tests plus the new Task 1/2 tests).

- [ ] **Step 4: Verify in the running app (REQUIRED — do not skip)**

Ensure the dev server is running (`pnpm dev`, http://localhost:3001) and that it returns HTTP 200 for `/` (this catches SSR crashes like the Phase 1 sigma import). Then, on a completed audit's **Graph** tab:
- The insights panel lists issues (orphans / broken links / hubs / etc.).
- Clicking an insight accents its nodes (red) and dims the rest; clicking again clears it.
- "Export CSV" downloads a file for that insight.

If `/` returns 500, read `.logs/dev-run.log` for the error (a top-level browser-only import is the usual cause) and fix before committing.

- [ ] **Step 5: Commit**

```bash
git add src/client/features/audit/graph/AuditGraphView.tsx
git commit -m "feat(audit): show SEO insights beside the graph with click-to-highlight"
```

---

## Self-review notes

- **Spec coverage (Phase 2):** insights panel translating metrics into recommendations (Task 1: orphans, deep pages, broken links, under-linked, hubs); each insight highlights nodes in the graph (Tasks 2+4); CSV export per insight (Task 3, reusing `buildCsv`/`downloadCsv`). Node coloring by community and the Graphify export remain Phase 3.
- **SSR safety:** Task 4 preserves the dynamic client-only import of Sigma/forceAtlas2 and adds a mandatory app-run HTTP-200 check (Step 4) — the Phase 1 regression must not recur.
- **Type consistency:** `AuditInsight` (Task 1) is consumed unchanged by Tasks 3 & 4; `nodeHighlightReducer(isHighlighted, anyHighlighted)` (Task 2) is called with exactly those two booleans in Task 4's `nodeReducer`.
- **Assumptions to verify during execution:** Sigma's `nodeReducer` setting accepts `(node, data) => partialDisplayData` and honors a `color`/`zIndex` override (correct for Sigma v3); if the installed Sigma types demand a stricter reducer signature, adjust the inline types at the `new Sigma(...)` call without changing `nodeHighlightReducer`.
