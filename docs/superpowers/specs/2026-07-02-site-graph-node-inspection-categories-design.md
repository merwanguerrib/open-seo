# Site Graph — Node Inspection + Slug Categories

**Status:** Design approved, pending spec review
**Date:** 2026-07-02
**Branch:** `feat/site-graph`
**Builds on:** Phase 1 (graph foundation) + Phase 2 (insights panel)

## Summary

Add two related capabilities to the audit "Graph" tab:

1. **Node detail panel (right of the graph):** clicking a node opens a panel showing
   that page's URL, title, HTTP status, indexability, inbound internal links,
   outbound internal links, external links, H1 count, canonical URL, click depth,
   and internal PageRank.
2. **Slug categorization:** each page is categorized by the first segment of its URL
   path (e.g. `/blog/post` → `blog`, `/about` → `about`, `/` → `(root)`). Nodes are
   colored by category (making page types visible at a glance), and a category legend
   lists each category with its color and page count; clicking a category highlights
   all its pages using the same highlight mechanism as the insights.

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Node detail panel placement | Right column of the Graph tab |
| Detail fields (client-derived) | url, title, statusCode, isIndexable, inbound (inDegree), outbound internal (`internalLinkCount`), click depth, internal PageRank |
| Detail fields (new server payload) | H1 count, external links count, canonical URL |
| Meta description | Not included |
| Category rule | First URL path segment only; home/root → `(root)` |
| Category coloring | Base node color = category color; a fixed palette assigned deterministically |
| Category legend | Left column, below insights; clickable to highlight that category's pages |
| Highlight source | Generalized: a single active selection is either an insight OR a category |
| Node text | Never exposed (privacy — consistent with Phase 1) |

## Layout

Three columns on large screens: `[ left: category legend + insights panel | center: graph | right: node detail ]`.
- Left column keeps the Phase 2 insights panel; the category legend sits above it.
- Right column shows the node detail when a node is selected, otherwise a subtle
  placeholder ("Click a node to inspect it").
- On small screens the columns stack.

## Data model (server)

Add three fields to `AuditGraphNode` (`src/server/lib/audit/types.ts`):

```ts
h1Count: number;
externalLinkCount: number;
canonicalUrl: string | null;
```

- `getAuditGraphData` (`AuditRepository.ts`) adds `h1Count`, `externalLinkCount`,
  `canonicalUrl` to its `auditPages` column selection.
- `AuditService.getGraph` maps them into each node.
- Still no page text in the payload.

## Client — pure logic (unit-tested)

- **`deriveCategory(url: string): string`** — `new URL(url).pathname`, split on `/`,
  first non-empty segment; `(root)` when there is none. Malformed URL falls back to
  `(root)`.
- **`computeCategories(payload): { legend: CategoryLegendEntry[]; colorByNodeId: Map<string, string> }`**
  where `CategoryLegendEntry = { category: string; color: string; count: number }`.
  Categories sorted by count desc then name asc; colors assigned by that stable order
  from a fixed palette (cycling if categories exceed the palette). `colorByNodeId`
  maps each node id to its category color (shared with the graph rendering so legend
  and nodes always agree).
- **`buildNodeDetail(payload, graph, metrics, nodeId): NodeDetail | null`** — returns
  `{ url, title, statusCode, isIndexable, inbound, outboundInternal, externalLinks, h1Count, canonicalUrl, clickDepth, pagerank }` for the node, or `null` if the id is
  unknown. `inbound = graph.inDegree(nodeId)`; `outboundInternal = node.internalLinkCount`;
  `clickDepth = metrics.depthByNode.get(nodeId) ?? null`; `pagerank = metrics.pagerank[nodeId] ?? 0`.

## Client — components & wiring

- **`AuditCategoryLegend.tsx`** — props `{ legend, selectedCategory, onSelect }`; renders
  category rows (color swatch, name, count), clickable to toggle selection.
- **`AuditNodeDetailPanel.tsx`** — props `{ detail: NodeDetail | null; onClose }`; renders
  the fields (URL as an external link; canonical/absent indicator) and a close button;
  placeholder text when `detail` is null.
- **`AuditGraphView.tsx`** changes:
  - State: `selection: { kind: "insight" | "category"; id: string } | null` (single
    active highlight source) and `selectedNodeId: string | null` (detail panel).
  - `highlightedIds` derived: insight selection → that insight's `nodeIds`; category
    selection → all node ids whose category equals the id.
  - Base node color set from `computeCategories(...).colorByNodeId` via
    `graph.setNodeAttribute(id, "color", color)` before creating Sigma. The existing
    `nodeReducer` (highlight accent/dim) still overrides when a selection is active;
    with no selection it returns `{}` so category colors show.
  - Sigma events: `renderer.on("clickNode", ({ node }) => setSelectedNodeId(node))`;
    `renderer.on("clickStage", () => setSelectedNodeId(null))`.
  - Selecting an insight clears any category selection and vice versa (single source).
  - Sigma + forceatlas2 stay dynamic client-only imports (SSR safety — unchanged).

## Error handling

- Unknown / malformed URL in `deriveCategory` → `(root)` (no throw).
- `buildNodeDetail` for an unknown node id → `null` → panel shows the placeholder.
- Missing optional fields (`canonicalUrl` null, `clickDepth` unreachable) render as an
  explicit absent indicator (e.g. "None" / "Not set"). No em dashes in any UI copy.
- A node clicked after the audit's graph payload changed (stale id) → `null` → placeholder.

## Testing

- Unit (vitest node env): `deriveCategory` (blog/guides/about/root/malformed);
  `computeCategories` (counts, deterministic color assignment, sort order);
  `buildNodeDetail` (field derivation incl. inbound inDegree and unknown-id → null).
- Components verified by `pnpm types:check` + running the app (HTTP 200, real node
  click shows detail, category colors render, legend click highlights).
- No jsdom/testing-library added; presentational components have no render test.

## Out of scope

- Louvain structural community coloring and the Graphify export (still Phase 3).
- Meta description and other page-metadata fields not listed above.
- Multi-segment category grouping (first segment only).
