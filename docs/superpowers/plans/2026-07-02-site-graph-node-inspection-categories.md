# Site Graph — Node Inspection + Slug Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-side node detail panel (per-page metrics) and slug-based page categorization (first URL segment) that colors graph nodes and drives a clickable category legend.

**Architecture:** Extend the existing Graph tab. Server adds three metadata fields to the graph payload. Client adds pure helpers (`deriveCategory`, `computeCategories`, `buildNodeDetail`), two presentational panels, and generalizes `AuditGraphView`'s single highlight selection to be either an insight or a category, colors nodes by category, and opens a detail panel on node click.

**Tech Stack:** TypeScript, React, graphology, Sigma.js (dynamic client-only import), Drizzle, Vitest.

## Global Constraints

- No page text in the payload (privacy) — only the three new metadata fields (`h1Count`, `externalLinkCount`, `canonicalUrl`).
- Category rule: first non-empty URL path segment; `(root)` for home or malformed URLs.
- One active highlight selection at a time: an insight OR a category (mutually exclusive). Node selection (detail panel) is independent of the highlight selection.
- Sigma + `graphology-layout-forceatlas2` MUST stay dynamic client-only imports inside the effect (static import crashes SSR: `WebGL2RenderingContext is not defined`). Never add a top-level `import Sigma`.
- No em dashes in any UI copy.
- Tests under vitest `environment: "node"`, `include: ["src/**/*.test.ts"]` (no jsdom/`.tsx` tests). Pure logic is unit-tested; React components verified by `pnpm types:check` + running the app (HTTP 200 + real interaction).
- Tests: `pnpm vitest run <path>`. Types: `pnpm types:check`. Follow existing daisyUI/tailwind conventions.

---

## File Structure

- `src/server/lib/audit/types.ts` — add 3 fields to `AuditGraphNode`.
- `src/server/features/audit/repositories/AuditRepository.ts` — `getAuditGraphData` selects the 3 columns.
- `src/server/features/audit/services/AuditService.ts` — `getGraph` maps the 3 fields.
- `src/client/features/audit/graph/pageCategories.ts` *(new)* — `deriveCategory`, `computeCategories`, `CATEGORY_PALETTE`, `CategoryLegendEntry`.
- `src/client/features/audit/graph/nodeDetail.ts` *(new)* — `buildNodeDetail`, `NodeDetail`.
- `src/client/features/audit/graph/AuditCategoryLegend.tsx` *(new)* — legend panel.
- `src/client/features/audit/graph/AuditNodeDetailPanel.tsx` *(new)* — detail panel.
- `src/client/features/audit/graph/AuditGraphView.tsx` *(modify)* — wiring, category colors, node-click detail, 3-column layout.

---

## Task 1: Server — add h1Count, externalLinkCount, canonicalUrl to the graph payload

**Files:**
- Modify: `src/server/lib/audit/types.ts` (`AuditGraphNode`)
- Modify: `src/server/features/audit/repositories/AuditRepository.ts` (`getAuditGraphData`)
- Modify: `src/server/features/audit/services/AuditService.ts` (`getGraph`)
- Test: `src/server/lib/audit/graph-edges.test.ts` (extend the existing `buildAuditGraphPayload` test)

**Interfaces:**
- Produces: `AuditGraphNode` gains `h1Count: number; externalLinkCount: number; canonicalUrl: string | null`.

- [ ] **Step 1: Extend the type**

In `src/server/lib/audit/types.ts`, add to `interface AuditGraphNode` (after `isIndexable`):

```ts
  h1Count: number;
  externalLinkCount: number;
  canonicalUrl: string | null;
```

- [ ] **Step 2: Write the failing test (payload preserves the new fields)**

Append to `src/server/lib/audit/graph-edges.test.ts` (inside the existing `describe("buildAuditGraphPayload", ...)` or a new one):

```typescript
import { buildAuditGraphPayload as buildPayloadForFields } from "./graph-edges";

describe("buildAuditGraphPayload new metadata fields", () => {
  it("passes h1Count, externalLinkCount, canonicalUrl through to nodes", () => {
    const payload = buildPayloadForFields({
      auditId: "a1",
      startUrl: "https://s.com/",
      pages: [
        {
          id: "p1", url: "https://s.com/", title: "Home", statusCode: 200,
          wordCount: 10, internalLinkCount: 1, isIndexable: true,
          h1Count: 2, externalLinkCount: 3, canonicalUrl: "https://s.com/",
        },
      ],
      edges: [],
    });
    expect(payload.nodes[0]).toMatchObject({
      h1Count: 2,
      externalLinkCount: 3,
      canonicalUrl: "https://s.com/",
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/server/lib/audit/graph-edges.test.ts`
Expected: FAIL — the fixture object is not assignable to `AuditGraphNode` until Step 1 is in, and (if Step 1 done) the fields are only preserved because `buildAuditGraphPayload` returns `nodes: input.pages`. If it already passes after Step 1, that confirms pass-through; if the payload builder reshapes nodes, fix it to preserve all node fields.

- [ ] **Step 4: Select the new columns in the repository**

In `getAuditGraphData` (`AuditRepository.ts`), extend the `auditPages` `columns` object to include:

```ts
        h1Count: true, externalLinkCount: true, canonicalUrl: true,
```

- [ ] **Step 5: Map the new fields in the service**

In `getGraph` (`AuditService.ts`), extend the `data.pages.map((p) => ({ ... }))` node object with:

```ts
      h1Count: p.h1Count, externalLinkCount: p.externalLinkCount,
      canonicalUrl: p.canonicalUrl,
```

- [ ] **Step 6: Run test + type-check**

Run: `pnpm vitest run src/server/lib/audit/graph-edges.test.ts` (PASS) then `pnpm types:check` (no errors — confirms the repo columns and service map line up with the type).

- [ ] **Step 7: Commit**

```bash
git add src/server/lib/audit/types.ts src/server/features/audit/repositories/AuditRepository.ts src/server/features/audit/services/AuditService.ts src/server/lib/audit/graph-edges.test.ts
git commit -m "feat(audit): expose h1 count, external links, canonical in graph payload"
```

---

## Task 2: Client — slug categories (deriveCategory + computeCategories)

**Files:**
- Create: `src/client/features/audit/graph/pageCategories.ts`
- Test: `src/client/features/audit/graph/pageCategories.test.ts`

**Interfaces:**
- Consumes: `AuditGraphPayload` (`@/server/lib/audit/types`).
- Produces: `deriveCategory(url): string`; `computeCategories(payload): { legend: CategoryLegendEntry[]; colorByNodeId: Map<string, string> }`; `CategoryLegendEntry = { category: string; color: string; count: number }`; `CATEGORY_PALETTE: string[]`.

- [ ] **Step 1: Write the failing test**

Create `src/client/features/audit/graph/pageCategories.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { deriveCategory, computeCategories, CATEGORY_PALETTE } from "./pageCategories";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

describe("deriveCategory", () => {
  it("uses the first path segment", () => {
    expect(deriveCategory("https://s.com/blog/post-1")).toBe("blog");
    expect(deriveCategory("https://s.com/guides/x/y")).toBe("guides");
    expect(deriveCategory("https://s.com/about")).toBe("about");
  });
  it("returns (root) for the home page and malformed URLs", () => {
    expect(deriveCategory("https://s.com/")).toBe("(root)");
    expect(deriveCategory("not a url")).toBe("(root)");
  });
});

describe("computeCategories", () => {
  const node = (id: string, url: string) => ({
    id, url, title: id, statusCode: 200, wordCount: 0, internalLinkCount: 0,
    isIndexable: true, h1Count: 0, externalLinkCount: 0, canonicalUrl: null,
  });
  const payload = {
    nodes: [
      node("h", "https://s.com/"),
      node("b1", "https://s.com/blog/a"),
      node("b2", "https://s.com/blog/b"),
      node("g1", "https://s.com/guides/a"),
    ],
    edges: [],
    meta: { auditId: "a", startUrl: "https://s.com/", pagesCrawled: 4, generatedAt: "t" },
  } as AuditGraphPayload;

  it("counts categories and sorts by count desc then name", () => {
    const { legend } = computeCategories(payload);
    expect(legend.map((e) => [e.category, e.count])).toEqual([
      ["blog", 2],
      ["(root)", 1],
      ["guides", 1],
    ]);
  });
  it("assigns palette colors by legend order and maps every node", () => {
    const { legend, colorByNodeId } = computeCategories(payload);
    expect(legend[0].color).toBe(CATEGORY_PALETTE[0]);
    expect(colorByNodeId.get("b1")).toBe(CATEGORY_PALETTE[0]); // blog is first
    expect(colorByNodeId.size).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/client/features/audit/graph/pageCategories.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/client/features/audit/graph/pageCategories.ts`:

```typescript
import type { AuditGraphPayload } from "@/server/lib/audit/types";

export interface CategoryLegendEntry {
  category: string;
  color: string;
  count: number;
}

export const CATEGORY_PALETTE = [
  "#2563eb", "#16a34a", "#db2777", "#d97706", "#7c3aed",
  "#0891b2", "#dc2626", "#65a30d", "#c026d3", "#0d9488",
];

export function deriveCategory(url: string): string {
  try {
    const segment = new URL(url).pathname.split("/").filter(Boolean)[0];
    return segment ?? "(root)";
  } catch {
    return "(root)";
  }
}

export function computeCategories(payload: AuditGraphPayload): {
  legend: CategoryLegendEntry[];
  colorByNodeId: Map<string, string>;
} {
  const counts = new Map<string, number>();
  const categoryByNode = new Map<string, string>();
  for (const node of payload.nodes) {
    const category = deriveCategory(node.url);
    categoryByNode.set(node.id, category);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const legend: CategoryLegendEntry[] = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
    .map((entry, index) => ({
      ...entry,
      color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
    }));

  const colorByCategory = new Map(legend.map((e) => [e.category, e.color]));
  const colorByNodeId = new Map<string, string>();
  for (const [id, category] of categoryByNode) {
    colorByNodeId.set(id, colorByCategory.get(category) ?? CATEGORY_PALETTE[0]);
  }

  return { legend, colorByNodeId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/client/features/audit/graph/pageCategories.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/features/audit/graph/pageCategories.ts src/client/features/audit/graph/pageCategories.test.ts
git commit -m "feat(audit): derive slug page categories with a color legend"
```

---

## Task 3: Client — buildNodeDetail

**Files:**
- Create: `src/client/features/audit/graph/nodeDetail.ts`
- Test: `src/client/features/audit/graph/nodeDetail.test.ts`

**Interfaces:**
- Consumes: `AuditGraphPayload`, a graphology `Graph`, `computeGraphMetrics` output.
- Produces: `NodeDetail` and `buildNodeDetail(payload, graph, metrics, nodeId): NodeDetail | null`.

- [ ] **Step 1: Write the failing test**

Create `src/client/features/audit/graph/nodeDetail.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildNodeDetail } from "./nodeDetail";
import { buildGraphologyGraph, computeGraphMetrics } from "./graphologyGraph";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const payload: AuditGraphPayload = {
  nodes: [
    { id: "home", url: "https://s.com/", title: "Home", statusCode: 200, wordCount: 50, internalLinkCount: 2, isIndexable: true, h1Count: 1, externalLinkCount: 4, canonicalUrl: "https://s.com/" },
    { id: "a", url: "https://s.com/a", title: "A", statusCode: 200, wordCount: 30, internalLinkCount: 0, isIndexable: true, h1Count: 0, externalLinkCount: 1, canonicalUrl: null },
  ],
  edges: [{ from: "home", to: "a", anchorText: "A", isBroken: false }],
  meta: { auditId: "x", startUrl: "https://s.com/", pagesCrawled: 2, generatedAt: "t" },
};

describe("buildNodeDetail", () => {
  const graph = buildGraphologyGraph(payload);
  const metrics = computeGraphMetrics(graph, "home");

  it("derives inbound (inDegree), outbound, and page fields", () => {
    const detail = buildNodeDetail(payload, graph, metrics, "a");
    expect(detail).toMatchObject({
      url: "https://s.com/a",
      inbound: 1,
      outboundInternal: 0,
      externalLinks: 1,
      h1Count: 0,
      canonicalUrl: null,
      clickDepth: 1,
    });
  });

  it("returns null for an unknown node id", () => {
    expect(buildNodeDetail(payload, graph, metrics, "nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/client/features/audit/graph/nodeDetail.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/client/features/audit/graph/nodeDetail.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/client/features/audit/graph/nodeDetail.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/features/audit/graph/nodeDetail.ts src/client/features/audit/graph/nodeDetail.test.ts
git commit -m "feat(audit): build per-node detail for the graph inspector"
```

---

## Task 4: Client — category legend + node detail panel components

**Files:**
- Create: `src/client/features/audit/graph/AuditCategoryLegend.tsx`
- Create: `src/client/features/audit/graph/AuditNodeDetailPanel.tsx`

**Interfaces:**
- Consumes: `CategoryLegendEntry` (Task 2), `NodeDetail` (Task 3).
- Produces: `AuditCategoryLegend` (props `{ legend: CategoryLegendEntry[]; selectedCategory: string | null; onSelect: (category: string | null) => void }`); `AuditNodeDetailPanel` (props `{ detail: NodeDetail | null; onClose: () => void }`).

Presentational; no automated test. Verified by `pnpm types:check` + Task 5's app run.

- [ ] **Step 1: Implement the category legend**

Create `src/client/features/audit/graph/AuditCategoryLegend.tsx`:

```typescript
import type { CategoryLegendEntry } from "@/client/features/audit/graph/pageCategories";

export function AuditCategoryLegend({
  legend,
  selectedCategory,
  onSelect,
}: {
  legend: CategoryLegendEntry[];
  selectedCategory: string | null;
  onSelect: (category: string | null) => void;
}) {
  if (legend.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase text-base-content/50">
        Page categories
      </div>
      {legend.map((entry) => {
        const isSelected = entry.category === selectedCategory;
        return (
          <button
            key={entry.category}
            type="button"
            aria-label={`Highlight ${entry.category} pages`}
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${
              isSelected ? "bg-primary/10" : "hover:bg-base-200"
            }`}
            onClick={() => onSelect(isSelected ? null : entry.category)}
          >
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="flex-1 truncate">{entry.category}</span>
            <span className="text-xs text-base-content/50">{entry.count}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Implement the node detail panel**

Create `src/client/features/audit/graph/AuditNodeDetailPanel.tsx`:

```typescript
import type { NodeDetail } from "@/client/features/audit/graph/nodeDetail";

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-base-content/60">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function AuditNodeDetailPanel({
  detail,
  onClose,
}: {
  detail: NodeDetail | null;
  onClose: () => void;
}) {
  if (!detail) {
    return (
      <div className="rounded-lg border border-base-300 p-4 text-sm text-base-content/50">
        Click a node to inspect it.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-base-300 p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="font-semibold">{detail.title ?? "Untitled"}</div>
        <button
          type="button"
          aria-label="Close node detail"
          className="btn btn-ghost btn-xs"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <a
        href={detail.url}
        target="_blank"
        rel="noreferrer"
        className="block break-all text-xs text-primary hover:underline"
      >
        {detail.url}
      </a>
      <div className="mt-3 divide-y divide-base-200">
        <Row label="HTTP status" value={detail.statusCode ?? "Unknown"} />
        <Row label="Indexable" value={detail.isIndexable ? "Yes" : "No"} />
        <Row label="Inbound internal links" value={detail.inbound} />
        <Row label="Outbound internal links" value={detail.outboundInternal} />
        <Row label="External links" value={detail.externalLinks} />
        <Row label="H1 count" value={detail.h1Count} />
        <Row label="Click depth" value={detail.clickDepth ?? "Unreachable"} />
        <Row label="Internal PageRank" value={detail.pagerank.toFixed(4)} />
        <Row label="Canonical" value={detail.canonicalUrl ?? "Not set"} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm types:check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/client/features/audit/graph/AuditCategoryLegend.tsx src/client/features/audit/graph/AuditNodeDetailPanel.tsx
git commit -m "feat(audit): add category legend and node detail panel components"
```

---

## Task 5: Wire node inspection + categories into AuditGraphView

**Files:**
- Modify: `src/client/features/audit/graph/AuditGraphView.tsx`

**Interfaces:**
- Consumes: `computeCategories`, `deriveCategory` (Task 2); `buildNodeDetail` (Task 3); `AuditCategoryLegend`, `AuditNodeDetailPanel` (Task 4); existing `computeAuditInsights`, `nodeHighlightReducer`, `AuditInsightsPanel`.

- [ ] **Step 1: Overwrite AuditGraphView**

Replace `src/client/features/audit/graph/AuditGraphView.tsx` with (Sigma/forceAtlas2 stay dynamic imports; do not add static ones):

```typescript
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
import { AuditInsightsPanel } from "@/client/features/audit/graph/AuditInsightsPanel";
import { AuditCategoryLegend } from "@/client/features/audit/graph/AuditCategoryLegend";
import { AuditNodeDetailPanel } from "@/client/features/audit/graph/AuditNodeDetailPanel";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

type Selection = { kind: "insight" | "category"; id: string } | null;

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

  const highlightedIds = useMemo(() => {
    if (!selection) return new Set<string>();
    if (selection.kind === "insight") {
      const selected = insights.find((i) => i.id === selection.id);
      return new Set(selected?.nodeIds ?? []);
    }
    return new Set(
      payload.nodes
        .filter((n) => deriveCategory(n.url) === selection.id)
        .map((n) => n.id),
    );
  }, [selection, insights, payload]);

  const nodeDetail = useMemo(
    () =>
      selectedNodeId
        ? buildNodeDetail(payload, graph, metrics, selectedNodeId)
        : null,
    [selectedNodeId, payload, graph, metrics],
  );

  const highlightRef = useRef<Set<string>>(highlightedIds);
  highlightRef.current = highlightedIds;
  const colorsRef = useRef(categories.colorByNodeId);
  colorsRef.current = categories.colorByNodeId;

  useEffect(() => {
    if (!containerRef.current || graph.order === 0) return;
    let renderer: {
      refresh: () => void;
      kill: () => void;
      on: (event: string, handler: (payload: { node: string }) => void) => void;
    } | null = null;
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
      forceAtlas2.assign(graph, { iterations: 100 });
      renderer = new Sigma(graph, containerRef.current, {
        zIndex: true,
        nodeReducer: (node: string, data: Record<string, unknown>) => {
          const h = highlightRef.current;
          return { ...data, ...nodeHighlightReducer(h.has(node), h.size > 0) };
        },
      });
      renderer.on("clickNode", ({ node }) => setSelectedNodeId(node));
      renderer.on("clickStage", () => setSelectedNodeId(null));
      rendererRef.current = renderer;
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

  const selectedCategory =
    selection?.kind === "category" ? selection.id : null;
  const selectedInsightId =
    selection?.kind === "insight" ? selection.id : null;

  return (
    <div className="space-y-3">
      <div className="text-sm text-base-content/70">
        {summary.pagesCrawled} pages &middot; {summary.orphanCount} orphan
        {summary.orphanCount === 1 ? "" : "s"} &middot; {summary.brokenCount}{" "}
        broken internal link{summary.brokenCount === 1 ? "" : "s"}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr_300px]">
        <div className="max-h-[600px] space-y-4 overflow-y-auto">
          <AuditCategoryLegend
            legend={categories.legend}
            selectedCategory={selectedCategory}
            onSelect={(category) =>
              setSelection(category ? { kind: "category", id: category } : null)
            }
          />
          <AuditInsightsPanel
            insights={insights}
            selectedId={selectedInsightId}
            onSelect={(id) =>
              setSelection(id ? { kind: "insight", id } : null)
            }
          />
        </div>
        <div
          ref={containerRef}
          className="h-[600px] w-full rounded-lg border border-base-300"
        />
        <div className="max-h-[600px] overflow-y-auto">
          <AuditNodeDetailPanel
            detail={nodeDetail}
            onClose={() => setSelectedNodeId(null)}
          />
        </div>
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
Expected: all pass (Phase 1/2 tests + Tasks 1-3 new tests).

- [ ] **Step 4: Verify in the running app (REQUIRED — do not skip)**

The dev server is running at http://localhost:3001. Confirm `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/` returns **200** (catches SSR crashes). Then on a completed audit's Graph tab:
- Nodes are colored by category; the left column shows the category legend with counts.
- Clicking a category highlights its pages (red) and dims the rest; clicking an insight does the same and clears any category selection.
- Clicking a node opens the right-side detail panel with its fields; clicking the graph background closes it.

If `/` returns 500, read `.logs/dev-run.log`, fix (usually a top-level browser-only import), re-check.

- [ ] **Step 5: Commit**

```bash
git add src/client/features/audit/graph/AuditGraphView.tsx
git commit -m "feat(audit): color nodes by category, add legend and node inspector"
```

---

## Self-review notes

- **Spec coverage:** server 3 fields (Task 1); slug categories + coloring + legend (Tasks 2, 4, 5); node detail panel on the right (Tasks 3, 4, 5); generalized insight-or-category selection (Task 5); SSR-safe dynamic Sigma import preserved (Task 5); app-run verification (Task 5 Step 4).
- **Type consistency:** `AuditGraphNode` +3 fields (Task 1) are read by `buildNodeDetail` (Task 3) and the category test fixtures (Task 2); `CategoryLegendEntry`/`NodeDetail` defined in Tasks 2/3 consumed by Task 4 components and Task 5.
- **Assumption:** Sigma v3 `clickNode`/`clickStage` events and `zIndex: true` setting behave as used; adjust the inline renderer event-handler types if the installed Sigma typings differ, without changing the pure helpers.
