# Site Graph — Phase 3 (Semantic Clustering) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three clustering layers from the design spec: (3a) in-app structural communities via Louvain with a clusters panel and a color-mode toggle, (3b) an "Export for Graphify" button that downloads a `graphify-input/` zip (page markdown + edges + manifest), and (3c) optional re-import of Graphify's semantic clusters into a new `audit_page_clusters` table with a third "semantic" color mode.

**Architecture:** Pure, unit-tested modules do the work (Louvain clustering + naming heuristic on the client; export-file and import-mapping builders on the server), while thin layers wire them up: `AuditGraphView` gains a color-mode state that swaps node colors, a `ClustersPanel`, an export button (zip built client-side with fflate from a JSON server-function payload), and an import button that posts Graphify's `graph.json` to a server function which maps communities to pages **by URL slug** and stores them in `audit_page_clusters`.

**Tech Stack:** TypeScript, React, graphology + `graphology-communities-louvain` (already installed), Sigma.js (dynamic import), fflate (new dep, client-side zip), Drizzle/D1, Zod v4, Vitest.

## Global Constraints

- Sigma and forceatlas2 MUST remain **dynamic client-only imports inside the effect** in `AuditGraphView.tsx` (static import crashes SSR on Cloudflare Workers — `WebGL2RenderingContext is not defined`). Do NOT add top-level `import Sigma`/`import forceAtlas2`. `graphology-communities-louvain` is pure JS and safe to import statically.
- Tests run under vitest `environment: "node"`, `include: ["src/**/*.test.ts"]` (no `.tsx`, no jsdom). Testable logic lives in pure `.ts` modules; React components are verified by `pnpm types:check` + running the app.
- `getAuditGraph` never returns page text (spec). Page text flows **only** through `exportAuditForGraphify`.
- Server functions follow the existing pattern: `createServerFn({ method: "POST" }).middleware(requireProjectContext).inputValidator(zodSchema.parse)` with input schemas in `src/types/schemas/audit.ts`.
- Errors use `AppError` with codes from `src/shared/error-codes.ts` (use `VALIDATION_ERROR` for bad import JSON, `CONFLICT` for "content capture was off", `NOT_FOUND` for missing audit).
- D1 writes in batches of 100 via the existing `executeInBatches` helper in `AuditRepository.ts`; deterministic row ids so workflow/step retries stay idempotent.
- Migration workflow: edit `src/db/app.schema.ts` → `pnpm db:generate` → `pnpm db:migrate:local`.
- daisyUI/tailwind class conventions as in `AuditCategoryLegend.tsx` / `AuditInsightsPanel.tsx`.
- Node 20+, pnpm. Tests: `pnpm vitest run <path>`. Types: `pnpm types:check`. Dev server: `pnpm dev` (http://localhost:3001).

---

## File Structure

**3a — structural communities (client):**
- `src/client/features/audit/graph/structuralClusters.ts` *(new)* — Louvain partition + cluster naming heuristic + colors (pure).
- `src/client/features/audit/graph/AuditClustersPanel.tsx` *(new)* — presentational clusters list.
- `src/client/features/audit/graph/AuditGraphView.tsx` *(modify)* — color-mode state (`category`/`community`, later `semantic`), color swap effect, panel switch.

**3b — Graphify export:**
- `src/server/lib/audit/graphify-export.ts` *(new)* — `buildSlugMap` + `buildGraphifyExportFiles` (pure).
- `src/server/features/audit/repositories/AuditRepository.ts` *(modify)* — `getGraphifyExportData`.
- `src/server/features/audit/services/AuditService.ts` *(modify)* — `exportForGraphify`, `contentCaptured` in graph meta.
- `src/serverFunctions/audit.ts` + `src/types/schemas/audit.ts` *(modify)* — `exportAuditForGraphify` fn + schema, `captureContent` on `startAuditSchema`.
- `src/client/features/audit/graph/graphifyZip.ts` *(new)* — fflate zip build + download.
- `src/client/features/audit/launch/*` *(modify)* — "Capture page content" toggle.

**3c — semantic re-import:**
- `src/db/app.schema.ts` *(modify)* — `audit_page_clusters` table + migration.
- `src/server/lib/audit/graphify-import.ts` *(new)* — Zod schema for Graphify `graph.json` + URL-slug mapper (pure).
- `AuditRepository` / `AuditService` / `serverFunctions/audit.ts` *(modify)* — `replaceGraphifyClusters`, clusters in graph payload, `importGraphifyClusters` fn.
- `src/client/features/audit/graph/semanticClusters.ts` *(new)* — legend/colors from `semanticCluster` node field (pure).
- `AuditGraphView.tsx` *(modify)* — third color mode + import button.

---

## Task 1: Structural clusters pure module (Louvain + naming)

**Files:**
- Create: `src/client/features/audit/graph/structuralClusters.ts`
- Test: `src/client/features/audit/graph/structuralClusters.test.ts`

**Interfaces:**
- Consumes: `AuditGraphPayload` (`@/server/lib/audit/types`), a graphology `Graph` (from `buildGraphologyGraph`), and `pagerank: Record<string, number>` (from `computeGraphMetrics`).
- Produces:

```ts
export interface StructuralCluster {
  id: string;          // louvain community id, stringified
  name: string;        // heuristic name (most frequent title/URL term) or "Cluster N"
  size: number;
  color: string;
  pivotNodeId: string; // max pagerank in the cluster
  pivotUrl: string;
  nodeIds: string[];
}
export function computeStructuralClusters(
  payload: AuditGraphPayload,
  graph: Graph,
  pagerank: Record<string, number>,
): { clusters: StructuralCluster[]; colorByNodeId: Map<string, string> };
```

- [ ] **Step 1: Write the failing test**

Create `src/client/features/audit/graph/structuralClusters.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeStructuralClusters } from "./structuralClusters";
import { buildGraphologyGraph, computeGraphMetrics } from "./graphologyGraph";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const node = (id: string, url: string, title: string) => ({
  id,
  url,
  title,
  statusCode: 200,
  wordCount: 100,
  internalLinkCount: 0,
  isIndexable: true,
  h1Count: 1,
  externalLinkCount: 0,
  canonicalUrl: null,
});
const edge = (from: string, to: string) => ({
  from,
  to,
  anchorText: null,
  isBroken: false,
});

// Two dense triangles with no links between them → 2 Louvain communities.
const payload: AuditGraphPayload = {
  nodes: [
    node("b1", "https://s.com/blog/one", "Blog post one"),
    node("b2", "https://s.com/blog/two", "Blog post two"),
    node("b3", "https://s.com/blog/three", "Blog post three"),
    node("s1", "https://s.com/shop/red", "Shop item red"),
    node("s2", "https://s.com/shop/blue", "Shop item blue"),
    node("s3", "https://s.com/shop/green", "Shop item green"),
  ],
  edges: [
    edge("b1", "b2"), edge("b2", "b3"), edge("b3", "b1"),
    edge("s1", "s2"), edge("s2", "s3"), edge("s3", "s1"),
  ],
  meta: { auditId: "x", startUrl: "https://s.com/blog/one", pagesCrawled: 6, generatedAt: "t" },
};

describe("computeStructuralClusters", () => {
  const graph = buildGraphologyGraph(payload);
  const { pagerank } = computeGraphMetrics(graph, "b1");
  const { clusters, colorByNodeId } = computeStructuralClusters(
    payload,
    graph,
    pagerank,
  );

  it("finds the two disconnected communities", () => {
    expect(clusters).toHaveLength(2);
    const memberships = clusters
      .map((c) => [...c.nodeIds].sort().join(","))
      .sort();
    expect(memberships).toEqual(["b1,b2,b3", "s1,s2,s3"]);
  });

  it("names clusters from the most frequent title/URL term", () => {
    const names = clusters.map((c) => c.name).sort();
    expect(names).toEqual(["blog", "shop"]);
  });

  it("picks the max-pagerank node as pivot and colors every node", () => {
    for (const cluster of clusters) {
      expect(cluster.nodeIds).toContain(cluster.pivotNodeId);
      const maxPr = Math.max(...cluster.nodeIds.map((id) => pagerank[id] ?? 0));
      expect(pagerank[cluster.pivotNodeId]).toBe(maxPr);
    }
    expect(colorByNodeId.size).toBe(6);
  });

  it("handles an edgeless graph with a single cluster", () => {
    const lonely: AuditGraphPayload = {
      ...payload,
      nodes: payload.nodes.slice(0, 2),
      edges: [],
    };
    const g = buildGraphologyGraph(lonely);
    const result = computeStructuralClusters(lonely, g, {});
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].nodeIds.sort()).toEqual(["b1", "b2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/client/features/audit/graph/structuralClusters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/client/features/audit/graph/structuralClusters.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/client/features/audit/graph/structuralClusters.test.ts`
Expected: PASS (4 tests). Louvain has a random component; the assertions are membership-level and stable for two disconnected triangles. If the run is flaky, pass a fixed rng: `louvain(graph, { rng: () => 0.5 })`.

- [ ] **Step 5: Commit**

```bash
git add src/client/features/audit/graph/structuralClusters.ts src/client/features/audit/graph/structuralClusters.test.ts
git commit -m "feat(audit): compute structural link communities with louvain"
```

---

## Task 2: Clusters panel + color-mode toggle in the graph view

**Files:**
- Create: `src/client/features/audit/graph/AuditClustersPanel.tsx`
- Modify: `src/client/features/audit/graph/AuditGraphView.tsx`

**Interfaces:**
- Consumes: `StructuralCluster` + `computeStructuralClusters` (Task 1).
- Produces: `AuditClustersPanel` with props `{ clusters: StructuralCluster[]; selectedClusterId: string | null; onSelect: (id: string | null) => void }`; `AuditGraphView` gains internal `colorMode: "category" | "community"` state (extended to `"semantic"` in Task 10).

Presentational component — verified by `pnpm types:check` + app run.

- [ ] **Step 1: Create the clusters panel**

Create `src/client/features/audit/graph/AuditClustersPanel.tsx`:

```typescript
import type { StructuralCluster } from "@/client/features/audit/graph/structuralClusters";
import { extractPathname } from "@/client/features/audit/shared";

export function AuditClustersPanel({
  clusters,
  selectedClusterId,
  onSelect,
}: {
  clusters: StructuralCluster[];
  selectedClusterId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (clusters.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase text-base-content/50">
        Link communities
      </div>
      {clusters.map((cluster) => {
        const isSelected = cluster.id === selectedClusterId;
        return (
          <button
            key={cluster.id}
            type="button"
            aria-label={`Highlight ${cluster.name} community`}
            className={`w-full rounded px-2 py-1 text-left text-sm ${
              isSelected ? "bg-primary/10" : "hover:bg-base-200"
            }`}
            onClick={() => onSelect(isSelected ? null : cluster.id)}
          >
            <span className="flex items-center gap-2">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: cluster.color }}
              />
              <span className="flex-1 truncate font-medium">{cluster.name}</span>
              <span className="text-xs text-base-content/50">{cluster.size}</span>
            </span>
            <span
              className="block truncate pl-5 text-xs text-base-content/50"
              title={cluster.pivotUrl}
            >
              pivot: {extractPathname(cluster.pivotUrl)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

Note: `extractPathname` already exists in `src/client/features/audit/shared.tsx` (used by the audit route). If its import path differs, match the existing import used in `src/routes/_project/p/$projectId/audit/index.tsx`.

- [ ] **Step 2: Wire color modes into AuditGraphView**

Modify `src/client/features/audit/graph/AuditGraphView.tsx` (read the file first; apply these exact changes):

1. Add imports:

```typescript
import { computeStructuralClusters } from "@/client/features/audit/graph/structuralClusters";
import { AuditClustersPanel } from "@/client/features/audit/graph/AuditClustersPanel";
```

2. Replace the `Selection` type and add a color-mode type:

```typescript
type Selection =
  | { kind: "insight" | "category" | "cluster"; id: string }
  | null;
type ColorMode = "category" | "community";
```

3. Inside the component, after the `categories` memo, add:

```typescript
  const [colorMode, setColorMode] = useState<ColorMode>("category");
  const structural = useMemo(
    () => computeStructuralClusters(payload, graph, metrics.pagerank),
    [payload, graph, metrics],
  );
```

4. Extend the `highlightedIds` memo with the cluster case — inside it, before the category branch:

```typescript
    if (selection.kind === "cluster") {
      const cluster = structural.clusters.find((c) => c.id === selection.id);
      return new Set(cluster?.nodeIds ?? []);
    }
```

and add `structural` to its dependency array.

5. Make the colors ref follow the mode. Replace:

```typescript
  const colorsRef = useRef(categories.colorByNodeId);
  colorsRef.current = categories.colorByNodeId;
```

with:

```typescript
  const activeColors =
    colorMode === "community"
      ? structural.colorByNodeId
      : categories.colorByNodeId;
  const colorsRef = useRef(activeColors);
  colorsRef.current = activeColors;
```

6. Add an effect (below the existing `refresh` effect) that re-paints node colors when the mode changes:

```typescript
  useEffect(() => {
    graph.forEachNode((n) => {
      graph.setNodeAttribute(n, "color", colorsRef.current.get(n) ?? "#999999");
    });
    rendererRef.current?.refresh();
  }, [activeColors, graph]);
```

7. Reset the mode with the other state on payload change — in the existing reset effect add `setColorMode("category");`.

8. In the JSX, above `<AuditCategoryLegend …/>`, add the toggle, and switch the left panel by mode. Replace the current `<AuditCategoryLegend …/>` block with:

```tsx
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
```

- [ ] **Step 3: Type-check and run the suite**

Run: `pnpm types:check && pnpm vitest run`
Expected: no type errors, all tests pass.

- [ ] **Step 4: Verify in the running app (REQUIRED — do not skip)**

`pnpm dev` (http://localhost:3001) must return HTTP 200 for `/` (SSR guard). On a completed audit's **Graph** tab:
- The Categories/Communities toggle switches node colors in place.
- The Communities panel lists clusters with name, size, and pivot path; clicking one highlights its nodes; clicking again clears.

- [ ] **Step 5: Commit**

```bash
git add src/client/features/audit/graph/AuditClustersPanel.tsx src/client/features/audit/graph/AuditGraphView.tsx
git commit -m "feat(audit): color graph by louvain communities with clusters panel"
```

---

## Task 3: Expose `captureContent` end-to-end + `contentCaptured` in graph meta

The audit config flag exists (`AuditConfig.captureContent`, R2 push already gated in the workflow) but nothing can turn it on: `startAuditSchema` and the launch form don't expose it, and the Graph tab can't tell whether content was captured (needed to enable/disable the Graphify export button in Task 6).

**Files:**
- Modify: `src/types/schemas/audit.ts` (startAuditSchema)
- Modify: `src/serverFunctions/audit.ts` (pass through)
- Modify: `src/server/lib/audit/types.ts` (`AuditGraphPayload.meta.contentCaptured?`)
- Modify: `src/server/lib/audit/graph-edges.ts` (`buildAuditGraphPayload`)
- Modify: `src/server/features/audit/services/AuditService.ts` (`getGraph`)
- Modify: `src/client/features/audit/launch/types.ts`, `useLaunchController.ts`, `LaunchFormCard.tsx`
- Test: `src/server/lib/audit/graph-edges.test.ts` (extend)

**Interfaces:**
- Produces: `startAuditSchema` gains `captureContent: z.boolean().optional().default(false)`; `AuditGraphPayload.meta.contentCaptured?: boolean`; `buildAuditGraphPayload` gains optional `contentCaptured` input. Optional field ⇒ existing test fixtures stay valid.

- [ ] **Step 1: Write the failing test**

In `src/server/lib/audit/graph-edges.test.ts`, append inside the existing `buildAuditGraphPayload` describe (or a new one):

```typescript
  it("carries contentCaptured into the payload meta", () => {
    const payload = buildAuditGraphPayload({
      auditId: "a",
      startUrl: "https://s.com/",
      pages: [],
      edges: [],
      contentCaptured: true,
    });
    expect(payload.meta.contentCaptured).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/lib/audit/graph-edges.test.ts`
Expected: FAIL — `contentCaptured` not accepted / undefined.

- [ ] **Step 3: Implement server side**

In `src/server/lib/audit/types.ts`, extend the meta type:

```typescript
export interface AuditGraphPayload {
  nodes: AuditGraphNode[];
  edges: AuditGraphEdge[];
  meta: {
    auditId: string;
    startUrl: string;
    pagesCrawled: number;
    generatedAt: string;
    contentCaptured?: boolean;
  };
}
```

In `src/server/lib/audit/graph-edges.ts`, add `contentCaptured?: boolean;` to the `buildAuditGraphPayload` input type and `contentCaptured: input.contentCaptured ?? false,` to the returned `meta`.

In `src/server/features/audit/services/AuditService.ts` `getGraph`, pass the config flag (parseAuditConfig is already imported):

```typescript
  return buildAuditGraphPayload({
    auditId,
    startUrl: data.audit.startUrl,
    contentCaptured:
      parseAuditConfig(data.audit.config)?.captureContent ?? false,
    pages: /* unchanged */,
    edges: data.edges,
  });
```

In `src/types/schemas/audit.ts`, add to `startAuditSchema`:

```typescript
  captureContent: z.boolean().optional().default(false),
```

In `src/serverFunctions/audit.ts` `startAudit`, pass `captureContent: data.captureContent,` into `AuditService.startAudit` (the service already accepts it).

- [ ] **Step 4: Implement the launch-form toggle**

`src/client/features/audit/launch/types.ts`:

```typescript
export type LaunchFormValues = {
  url: string;
  maxPagesInput: string;
  runLighthouse: boolean;
  captureContent: boolean;
};

export const DEFAULT_LAUNCH_FORM_VALUES: LaunchFormValues = {
  url: "",
  maxPagesInput: "50",
  runLighthouse: false,
  captureContent: false,
};
```

`src/client/features/audit/launch/useLaunchController.ts` — in `onSubmit`, add `captureContent: value.captureContent,` to the `startMutation.mutateAsync({...})` call, and add `captureContent: boolean;` to the `mutationFn` data type in `useLaunchMutations`.

`src/client/features/audit/launch/LaunchFormCard.tsx` — in `LaunchOptions`, below the max-pages block, add:

```tsx
      <label className="label cursor-pointer justify-start gap-2 p-0">
        <launchForm.Field name="captureContent">
          {(field) => (
            <input
              type="checkbox"
              className="toggle toggle-sm toggle-primary"
              checked={Boolean(field.state.value)}
              onChange={(event) => field.handleChange(event.target.checked)}
            />
          )}
        </launchForm.Field>
        <span
          className="text-sm font-medium text-base-content/80"
          title="Stores each page's text so you can export the crawl for Graphify semantic clustering."
        >
          Capture page content
        </span>
      </label>
```

- [ ] **Step 5: Run tests + type-check**

Run: `pnpm vitest run src/server/lib/audit/graph-edges.test.ts && pnpm types:check`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/schemas/audit.ts src/serverFunctions/audit.ts src/server/lib/audit/types.ts src/server/lib/audit/graph-edges.ts src/server/features/audit/services/AuditService.ts src/client/features/audit/launch/
git commit -m "feat(audit): expose captureContent flag end-to-end and surface it in graph meta"
```

---

## Task 4: Graphify export builder (pure, server lib)

**Files:**
- Create: `src/server/lib/audit/graphify-export.ts`
- Test: `src/server/lib/audit/graphify-export.test.ts`

**Interfaces:**
- Produces (consumed by Task 5's service and Task 8's import mapper — `buildSlugMap` is the shared URL↔file contract):

```ts
export function buildSlugMap(urls: string[]): Map<string, string>; // url → slug, deterministic (sorted input, -2/-3 suffixes on collision)
export interface GraphifyExportFile { path: string; content: string; }
export function buildGraphifyExportFiles(input: {
  auditId: string;
  startUrl: string;
  generatedAt: string;
  pages: Array<{ id: string; url: string; title: string | null; statusCode: number | null; text: string | null }>;
  edges: Array<{ fromPageId: string; toPageId: string | null; anchorText: string | null }>;
}): GraphifyExportFile[];
```

Layout produced (matches spec): `pages/<slug>.md` (frontmatter url/title/statusCode + text; only pages with `text != null`), `edges.json` (only edges whose both endpoints have a page file), `manifest.json` (startUrl, auditId, generatedAt, pageCount, `pages: [{ slug, url }]`).

**Important:** slugs are computed over **all** page URLs of the audit (not just content-bearing ones) so the import in Task 8 can recompute the identical mapping without the manifest.

- [ ] **Step 1: Write the failing test**

Create `src/server/lib/audit/graphify-export.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildSlugMap, buildGraphifyExportFiles } from "./graphify-export";

describe("buildSlugMap", () => {
  it("slugifies paths deterministically and disambiguates collisions", () => {
    const map = buildSlugMap([
      "https://s.com/blog/hello",
      "https://s.com/",
      "https://s.com/blog%2Fhello", // collides after sanitisation
    ]);
    expect(map.get("https://s.com/")).toBe("index");
    const slugs = [...map.values()];
    expect(new Set(slugs).size).toBe(3); // all unique
    expect(map.get("https://s.com/blog/hello")).toMatch(/^blog-hello/);
  });

  it("is order-independent", () => {
    const urls = ["https://s.com/a", "https://s.com/b"];
    const a = buildSlugMap(urls);
    const b = buildSlugMap([...urls].reverse());
    expect(a).toEqual(b);
  });
});

describe("buildGraphifyExportFiles", () => {
  const files = buildGraphifyExportFiles({
    auditId: "audit-1",
    startUrl: "https://s.com/",
    generatedAt: "2026-07-02T00:00:00.000Z",
    pages: [
      { id: "p1", url: "https://s.com/", title: "Home", statusCode: 200, text: "Welcome home" },
      { id: "p2", url: "https://s.com/about", title: 'About "us"', statusCode: 200, text: "About text" },
      { id: "p3", url: "https://s.com/no-content", title: "Empty", statusCode: 200, text: null },
    ],
    edges: [
      { fromPageId: "p1", toPageId: "p2", anchorText: "About" },
      { fromPageId: "p1", toPageId: "p3", anchorText: "skipped (no file)" },
      { fromPageId: "p2", toPageId: null, anchorText: "unresolved" },
    ],
  });
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  it("writes one markdown file per content-bearing page with frontmatter", () => {
    const home = byPath.get("pages/index.md");
    expect(home).toContain('url: "https://s.com/"');
    expect(home).toContain('title: "Home"');
    expect(home).toContain("statusCode: 200");
    expect(home).toContain("Welcome home");
    expect(byPath.get("pages/about.md")).toContain('title: "About \\"us\\""');
    expect(byPath.has("pages/no-content.md")).toBe(false);
  });

  it("emits only edges between exported files", () => {
    const edges = JSON.parse(byPath.get("edges.json") ?? "[]");
    expect(edges).toEqual([
      { from: "pages/index.md", to: "pages/about.md", anchor: "About" },
    ]);
  });

  it("emits a manifest with the slug map for content pages", () => {
    const manifest = JSON.parse(byPath.get("manifest.json") ?? "{}");
    expect(manifest.auditId).toBe("audit-1");
    expect(manifest.startUrl).toBe("https://s.com/");
    expect(manifest.pageCount).toBe(2);
    expect(manifest.pages).toEqual([
      { slug: "about", url: "https://s.com/about" },
      { slug: "index", url: "https://s.com/" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/lib/audit/graphify-export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/server/lib/audit/graphify-export.ts`:

```typescript
export interface GraphifyExportFile {
  path: string;
  content: string;
}

function slugify(url: string): string {
  let path = url;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    // fall back to the raw string
  }
  const slug = path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || "index";
}

/**
 * url → slug over ALL audit page URLs, deterministic regardless of input
 * order. The Graphify import (graphify-import.ts) recomputes this exact map
 * to resolve file paths back to URLs, so both sides must feed it the full
 * URL list of the audit.
 */
export function buildSlugMap(urls: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const url of [...urls].sort()) {
    if (map.has(url)) continue;
    const base = slugify(url);
    let slug = base;
    for (let i = 2; used.has(slug); i += 1) {
      slug = `${base}-${i}`;
    }
    used.add(slug);
    map.set(url, slug);
  }
  return map;
}

function frontmatterValue(value: string | number | null): string {
  return typeof value === "number" ? String(value) : JSON.stringify(value ?? "");
}

export function buildGraphifyExportFiles(input: {
  auditId: string;
  startUrl: string;
  generatedAt: string;
  pages: Array<{
    id: string;
    url: string;
    title: string | null;
    statusCode: number | null;
    text: string | null;
  }>;
  edges: Array<{
    fromPageId: string;
    toPageId: string | null;
    anchorText: string | null;
  }>;
}): GraphifyExportFile[] {
  const slugByUrl = buildSlugMap(input.pages.map((p) => p.url));
  const contentPages = input.pages.filter((p) => p.text != null);
  const fileByPageId = new Map(
    contentPages.map((p) => [p.id, `pages/${slugByUrl.get(p.url)}.md`]),
  );

  const files: GraphifyExportFile[] = contentPages.map((page) => ({
    path: fileByPageId.get(page.id) as string,
    content: [
      "---",
      `url: ${frontmatterValue(page.url)}`,
      `title: ${frontmatterValue(page.title)}`,
      `statusCode: ${frontmatterValue(page.statusCode)}`,
      "---",
      "",
      page.text ?? "",
      "",
    ].join("\n"),
  }));

  const edges = input.edges.flatMap((edge) => {
    const from = fileByPageId.get(edge.fromPageId);
    const to = edge.toPageId ? fileByPageId.get(edge.toPageId) : undefined;
    if (!from || !to) return [];
    return [{ from, to, anchor: edge.anchorText }];
  });
  files.push({ path: "edges.json", content: JSON.stringify(edges, null, 2) });

  const manifest = {
    auditId: input.auditId,
    startUrl: input.startUrl,
    generatedAt: input.generatedAt,
    pageCount: contentPages.length,
    pages: contentPages
      .map((p) => ({ slug: slugByUrl.get(p.url) as string, url: p.url }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  };
  files.push({
    path: "manifest.json",
    content: JSON.stringify(manifest, null, 2),
  });

  return files;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/server/lib/audit/graphify-export.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/audit/graphify-export.ts src/server/lib/audit/graphify-export.test.ts
git commit -m "feat(audit): build graphify export files from crawl data"
```

---

## Task 5: Export repository method + `exportAuditForGraphify` server function

**Files:**
- Modify: `src/server/features/audit/repositories/AuditRepository.ts`
- Modify: `src/server/features/audit/services/AuditService.ts`
- Modify: `src/types/schemas/audit.ts`
- Modify: `src/serverFunctions/audit.ts`
- Modify: `src/server/lib/r2.ts`

**Interfaces:**
- Consumes: `buildGraphifyExportFiles` (Task 4), `getJsonFromR2`-style R2 access.
- Produces: server fn `exportAuditForGraphify({ data: { projectId, auditId } })` → `{ files: GraphifyExportFile[] }` (consumed by Task 6's client zip). Throws `AppError("CONFLICT")` when no page has captured content, `AppError("NOT_FOUND")` for a missing audit.

The pure logic is covered by Task 4's tests; these layers are thin pass-throughs verified by `pnpm types:check` (matches how `getAuditGraph` is handled).

- [ ] **Step 1: Add a text read helper to r2.ts**

`getJsonFromR2` throws "Audit payload not found" and is Lighthouse-specific in name. Add alongside it in `src/server/lib/r2.ts`:

```typescript
export async function getTextFromR2(key: string): Promise<string | null> {
  const object = await env.R2.get(key);
  return object ? object.text() : null;
}
```

- [ ] **Step 2: Add the repository method**

In `src/server/features/audit/repositories/AuditRepository.ts`, add and export (in the `AuditRepository` const) the method:

```typescript
async function getGraphifyExportData(auditId: string, projectId: string) {
  const audit = await getAuditForProject(auditId, projectId);
  if (!audit) return null;
  const [pages, edges] = await Promise.all([
    db.query.auditPages.findMany({
      where: eq(auditPages.auditId, auditId),
      columns: {
        id: true,
        url: true,
        title: true,
        statusCode: true,
        contentR2Key: true,
      },
    }),
    db.query.auditPageLinks.findMany({
      where: eq(auditPageLinks.auditId, auditId),
      columns: { fromPageId: true, toPageId: true, anchorText: true },
    }),
  ]);
  return { audit, pages, edges };
}
```

- [ ] **Step 3: Add the service method**

In `src/server/features/audit/services/AuditService.ts`, add (and register in the exported const):

```typescript
async function exportForGraphify(auditId: string, projectId: string) {
  const data = await AuditRepository.getGraphifyExportData(auditId, projectId);
  if (!data) throw new AppError("NOT_FOUND");

  const withContent = data.pages.filter((p) => p.contentR2Key != null);
  if (withContent.length === 0) {
    throw new AppError(
      "CONFLICT",
      "This audit has no captured page content. Re-run it with content capture enabled.",
    );
  }

  const texts = await Promise.all(
    data.pages.map(async (page) => {
      if (!page.contentR2Key) return null;
      try {
        return await getTextFromR2(page.contentR2Key);
      } catch {
        return null; // a missing/unreadable object just drops that page
      }
    }),
  );

  const files = buildGraphifyExportFiles({
    auditId,
    startUrl: data.audit.startUrl,
    generatedAt: new Date().toISOString(),
    pages: data.pages.map((page, index) => ({
      id: page.id,
      url: page.url,
      title: page.title,
      statusCode: page.statusCode,
      text: texts[index],
    })),
    edges: data.edges,
  });

  return { files };
}
```

Imports to add at the top of the service: `import { buildGraphifyExportFiles } from "@/server/lib/audit/graphify-export";` and `import { getTextFromR2 } from "@/server/lib/r2";`.

- [ ] **Step 4: Add schema + server function**

In `src/types/schemas/audit.ts`:

```typescript
export const exportAuditForGraphifySchema = z.object({
  projectId: z.string().min(1),
  auditId: z.string().min(1),
});
```

In `src/serverFunctions/audit.ts` (import the schema alongside the others):

```typescript
export const exportAuditForGraphify = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => exportAuditForGraphifySchema.parse(data))
  .handler(async ({ data, context }) => {
    return AuditService.exportForGraphify(data.auditId, context.projectId);
  });
```

- [ ] **Step 5: Type-check and run the suite**

Run: `pnpm types:check && pnpm vitest run`
Expected: no errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/lib/r2.ts src/server/features/audit/repositories/AuditRepository.ts src/server/features/audit/services/AuditService.ts src/types/schemas/audit.ts src/serverFunctions/audit.ts
git commit -m "feat(audit): add exportAuditForGraphify server function"
```

---

## Task 6: Client zip + "Export for Graphify" button + help card

**Files:**
- Create: `src/client/features/audit/graph/graphifyZip.ts`
- Test: `src/client/features/audit/graph/graphifyZip.test.ts`
- Modify: `src/client/features/audit/graph/AuditGraphView.tsx`
- Modify: `src/client/features/audit/results/ResultsView.tsx`
- Modify: `package.json` (add fflate)

**Interfaces:**
- Consumes: `exportAuditForGraphify` (Task 5), `payload.meta.contentCaptured` (Task 3), `GraphifyExportFile` shape `{ path, content }`.
- Produces: `buildGraphifyZip(files): Uint8Array` and `downloadZip(filename, bytes): void`; `AuditGraphView` gains a required `projectId: string` prop (passed by `ResultsView`, which already receives it).

- [ ] **Step 1: Install fflate**

Run: `pnpm add fflate`
Expected: added to `dependencies`.

- [ ] **Step 2: Write the failing test**

Create `src/client/features/audit/graph/graphifyZip.test.ts` (fflate is pure JS — runs fine under node vitest):

```typescript
import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildGraphifyZip } from "./graphifyZip";

describe("buildGraphifyZip", () => {
  it("zips every file under a graphify-input/ root", () => {
    const bytes = buildGraphifyZip([
      { path: "pages/index.md", content: "# home" },
      { path: "manifest.json", content: "{}" },
    ]);
    const unzipped = unzipSync(bytes);
    expect(Object.keys(unzipped).sort()).toEqual([
      "graphify-input/manifest.json",
      "graphify-input/pages/index.md",
    ]);
    expect(strFromU8(unzipped["graphify-input/pages/index.md"])).toBe("# home");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/client/features/audit/graph/graphifyZip.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `src/client/features/audit/graph/graphifyZip.ts`:

```typescript
import { strToU8, zipSync } from "fflate";

export function buildGraphifyZip(
  files: Array<{ path: string; content: string }>,
): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[`graphify-input/${file.path}`] = strToU8(file.content);
  }
  return zipSync(entries);
}

export function downloadZip(filename: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/client/features/audit/graph/graphifyZip.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire the button into AuditGraphView**

Modify `src/client/features/audit/graph/AuditGraphView.tsx`:

1. Add imports:

```typescript
import { exportAuditForGraphify } from "@/serverFunctions/audit";
import {
  buildGraphifyZip,
  downloadZip,
} from "@/client/features/audit/graph/graphifyZip";
import { toast } from "sonner";
```

2. Change the props signature:

```typescript
export function AuditGraphView({
  payload,
  projectId,
}: {
  payload: AuditGraphPayload;
  projectId: string;
}) {
```

3. Next to the existing `exportCsv`/`exportJson` handlers, add:

```typescript
  const [isExportingGraphify, setIsExportingGraphify] = useState(false);
  const contentCaptured = payload.meta.contentCaptured === true;
  const exportGraphify = async () => {
    setIsExportingGraphify(true);
    try {
      const { files } = await exportAuditForGraphify({
        data: { projectId, auditId: payload.meta.auditId },
      });
      downloadZip("graphify-input.zip", buildGraphifyZip(files));
    } catch {
      toast.error("Graphify export failed. Try re-running the audit with content capture enabled.");
    } finally {
      setIsExportingGraphify(false);
    }
  };
```

4. In the export-buttons `<div className="flex shrink-0 gap-2">`, add after the JSON button:

```tsx
          <div
            className={contentCaptured ? "" : "tooltip tooltip-left"}
            data-tip="Re-run an audit with content capture enabled"
          >
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              disabled={!contentCaptured || isExportingGraphify}
              onClick={() => void exportGraphify()}
            >
              Export for Graphify
            </button>
          </div>
```

5. Below the graph grid (bottom of the returned JSX, inside the outer `space-y-3` div), add the help card, shown only when export is possible:

```tsx
      {contentCaptured && (
        <div className="rounded-lg border border-base-300 bg-base-200/20 p-3 text-xs text-base-content/70">
          <p className="font-medium text-base-content/80">
            Semantic clustering with Graphify (runs on your machine)
          </p>
          <p className="mt-1">
            Download the export, unzip it, then run:{" "}
            <code className="rounded bg-base-300 px-1 py-0.5">
              graphify ./graphify-input --directed --html
            </code>
            . You can re-import the resulting{" "}
            <code className="rounded bg-base-300 px-1 py-0.5">graph.json</code>{" "}
            to color this graph by semantic community.
          </p>
        </div>
      )}
```

6. In `src/client/features/audit/results/ResultsView.tsx`, pass the prop:
`<AuditGraphView payload={graphPayload} projectId={projectId} />` (the component already receives `projectId`).

- [ ] **Step 7: Type-check + app run (REQUIRED)**

Run: `pnpm types:check && pnpm vitest run`, then with `pnpm dev` confirm `/` returns 200 and on the Graph tab:
- Without content capture: the button is disabled with the tooltip; no help card.
- (If a content-captured audit exists) clicking downloads `graphify-input.zip` containing `graphify-input/pages/*.md`, `edges.json`, `manifest.json`.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/client/features/audit/graph/graphifyZip.ts src/client/features/audit/graph/graphifyZip.test.ts src/client/features/audit/graph/AuditGraphView.tsx src/client/features/audit/results/ResultsView.tsx
git commit -m "feat(audit): add Export for Graphify zip download with help card"
```

---

## Task 7: `audit_page_clusters` table + migration

**Files:**
- Modify: `src/db/app.schema.ts`
- Create (generated): `drizzle/*_<name>.sql` migration

- [ ] **Step 1: Add the table to the schema**

In `src/db/app.schema.ts`, after `auditPageLinks`:

```typescript
// Semantic cluster assignment per page, re-imported from Graphify (Phase 3)
export const auditPageClusters = sqliteTable(
  "audit_page_clusters",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => auditPages.id, { onDelete: "cascade" }),
    clusterLabel: text("cluster_label").notNull(),
    source: text("source").notNull(), // 'graphify'
  },
  (table) => [index("audit_page_clusters_audit_id_idx").on(table.auditId)],
);
```

(`src/db/schema.ts` re-exports `app.schema.ts`, so no extra export wiring is needed — verify with `grep -n "app.schema" src/db/schema.ts`.)

- [ ] **Step 2: Generate + apply the migration**

Run: `pnpm db:generate`
Expected: a new SQL file under `drizzle/` creating `audit_page_clusters` with the FK cascade and index.

Run: `pnpm db:migrate:local`
Expected: applies cleanly on the local D1.

- [ ] **Step 3: Type-check**

Run: `pnpm types:check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/db/app.schema.ts drizzle/
git commit -m "feat(audit): add audit_page_clusters table for graphify re-import"
```

---

## Task 8: Graphify import schema + URL mapper (pure, server lib)

**Files:**
- Create: `src/server/lib/audit/graphify-import.ts`
- Test: `src/server/lib/audit/graphify-import.test.ts`

**Interfaces:**
- Consumes: `buildSlugMap` (Task 4) — the shared slug contract.
- Produces (consumed by Task 9's service):

```ts
export const graphifyGraphJsonSchema: z.ZodType<GraphifyGraphJson>; // tolerant schema for graphify-out/graph.json
export function mapGraphifyClustersToPages(input: {
  graphJson: GraphifyGraphJson;
  pages: Array<{ id: string; url: string }>;
}): Array<{ pageId: string; clusterLabel: string }>;
```

Mapping rules: a Graphify node references source files via `source` (string) or `sources` (string[]); any ref matching `pages/<slug>.md` (path prefixes and a leading `graphify-input/` tolerated) votes the node's `community` onto that page; majority community wins per page; label comes from `community_labels[<community>]` when present, else `Cluster <community>`. Nodes without community or without a matching file ref are ignored.

- [ ] **Step 1: Write the failing test**

Create `src/server/lib/audit/graphify-import.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  graphifyGraphJsonSchema,
  mapGraphifyClustersToPages,
} from "./graphify-import";

const pages = [
  { id: "p-home", url: "https://s.com/" },
  { id: "p-about", url: "https://s.com/about" },
  { id: "p-blog", url: "https://s.com/blog/post" },
];

describe("graphifyGraphJsonSchema", () => {
  it("accepts a minimal graph.json and rejects garbage", () => {
    expect(
      graphifyGraphJsonSchema.safeParse({
        nodes: [{ id: "concept-1", community: 0, source: "pages/index.md" }],
      }).success,
    ).toBe(true);
    expect(graphifyGraphJsonSchema.safeParse({ nodes: "nope" }).success).toBe(
      false,
    );
    expect(graphifyGraphJsonSchema.safeParse(null).success).toBe(false);
  });
});

describe("mapGraphifyClustersToPages", () => {
  it("assigns each page its majority community, using labels when present", () => {
    const rows = mapGraphifyClustersToPages({
      graphJson: {
        nodes: [
          { id: "a", community: 0, source: "pages/index.md" },
          { id: "b", community: 0, source: "graphify-input/pages/index.md" },
          { id: "c", community: 1, source: "pages/index.md" },
          { id: "d", community: 1, sources: ["pages/about.md", "pages/blog-post.md"] },
          { id: "no-community", source: "pages/about.md" },
          { id: "no-source", community: 0 },
          { id: "unknown-file", community: 0, source: "pages/nope.md" },
        ],
        community_labels: { "1": "Company info" },
      },
      pages,
    });
    const byPage = new Map(rows.map((r) => [r.pageId, r.clusterLabel]));
    expect(byPage.get("p-home")).toBe("Cluster 0"); // 2 votes for 0 vs 1 for 1
    expect(byPage.get("p-about")).toBe("Company info");
    expect(byPage.get("p-blog")).toBe("Company info");
    expect(rows).toHaveLength(3);
  });

  it("returns an empty list when nothing matches", () => {
    const rows = mapGraphifyClustersToPages({
      graphJson: { nodes: [{ id: "x", community: 2, source: "other.md" }] },
      pages,
    });
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/lib/audit/graphify-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/server/lib/audit/graphify-import.ts`:

```typescript
import { z } from "zod";
import { buildSlugMap } from "@/server/lib/audit/graphify-export";

const graphifyNodeSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    community: z.union([z.number(), z.string()]).optional(),
    source: z.string().optional(),
    sources: z.array(z.string()).optional(),
  })
  .loose();

export const graphifyGraphJsonSchema = z
  .object({
    nodes: z.array(graphifyNodeSchema),
    community_labels: z.record(z.string(), z.string()).optional(),
  })
  .loose();

export type GraphifyGraphJson = z.infer<typeof graphifyGraphJsonSchema>;

/** "graphify-input/pages/about.md" | "./pages/about.md" | "pages/about.md" → "about" */
function slugFromFileRef(ref: string): string | null {
  const match = /(?:^|\/)pages\/([^/]+)\.md$/.exec(ref);
  return match ? match[1] : null;
}

export function mapGraphifyClustersToPages(input: {
  graphJson: GraphifyGraphJson;
  pages: Array<{ id: string; url: string }>;
}): Array<{ pageId: string; clusterLabel: string }> {
  const slugByUrl = buildSlugMap(input.pages.map((p) => p.url));
  const pageIdBySlug = new Map(
    input.pages.map((p) => [slugByUrl.get(p.url) as string, p.id]),
  );

  // pageId → community → votes
  const votes = new Map<string, Map<string, number>>();
  for (const node of input.graphJson.nodes) {
    if (node.community == null) continue;
    const community = String(node.community);
    const refs = [
      ...(node.source ? [node.source] : []),
      ...(node.sources ?? []),
    ];
    for (const ref of refs) {
      const slug = slugFromFileRef(ref);
      const pageId = slug ? pageIdBySlug.get(slug) : undefined;
      if (!pageId) continue;
      const pageVotes = votes.get(pageId) ?? new Map<string, number>();
      pageVotes.set(community, (pageVotes.get(community) ?? 0) + 1);
      votes.set(pageId, pageVotes);
    }
  }

  const labels = input.graphJson.community_labels ?? {};
  return [...votes.entries()].map(([pageId, pageVotes]) => {
    const [community] = [...pageVotes.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    return {
      pageId,
      clusterLabel: labels[community] ?? `Cluster ${community}`,
    };
  });
}
```

Note: if `z.object(...).loose()` is not available in the installed Zod v4 build, use `.passthrough()` — same semantics.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/server/lib/audit/graphify-import.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/audit/graphify-import.ts src/server/lib/audit/graphify-import.test.ts
git commit -m "feat(audit): validate and map graphify clusters to audit pages by url slug"
```

---

## Task 9: Import server function + semantic clusters in the graph payload

**Files:**
- Modify: `src/server/features/audit/repositories/AuditRepository.ts`
- Modify: `src/server/lib/audit/types.ts` (`AuditGraphNode.semanticCluster?`)
- Modify: `src/server/lib/audit/graph-edges.ts` (`buildAuditGraphPayload`)
- Modify: `src/server/features/audit/services/AuditService.ts`
- Modify: `src/types/schemas/audit.ts`, `src/serverFunctions/audit.ts`
- Test: `src/server/lib/audit/graph-edges.test.ts` (extend)

**Interfaces:**
- Consumes: `graphifyGraphJsonSchema` + `mapGraphifyClustersToPages` (Task 8), `auditPageClusters` table (Task 7).
- Produces: server fn `importGraphifyClusters({ data: { projectId, auditId, graphJson } })` → `{ imported: number }`; `AuditGraphNode` gains optional `semanticCluster?: string | null`; `buildAuditGraphPayload` gains optional `clusters?: Array<{ pageId: string; clusterLabel: string }>` input (consumed by Task 10's UI).

- [ ] **Step 1: Write the failing test**

Append to `src/server/lib/audit/graph-edges.test.ts`:

```typescript
  it("attaches semantic cluster labels to nodes when clusters are provided", () => {
    const page = {
      id: "p1",
      url: "https://s.com/",
      title: "Home",
      statusCode: 200,
      wordCount: 10,
      internalLinkCount: 0,
      isIndexable: true,
      h1Count: 1,
      externalLinkCount: 0,
      canonicalUrl: null,
    };
    const payload = buildAuditGraphPayload({
      auditId: "a",
      startUrl: "https://s.com/",
      pages: [page, { ...page, id: "p2", url: "https://s.com/b" }],
      edges: [],
      clusters: [{ pageId: "p1", clusterLabel: "Docs" }],
    });
    expect(payload.nodes.find((n) => n.id === "p1")?.semanticCluster).toBe("Docs");
    expect(payload.nodes.find((n) => n.id === "p2")?.semanticCluster).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/lib/audit/graph-edges.test.ts`
Expected: FAIL — `clusters` not accepted / `semanticCluster` undefined (not null).

- [ ] **Step 3: Implement payload + types**

In `src/server/lib/audit/types.ts`, add to `AuditGraphNode`:

```typescript
  semanticCluster?: string | null;
```

In `src/server/lib/audit/graph-edges.ts`, add `clusters?: Array<{ pageId: string; clusterLabel: string }>;` to the input type and map nodes:

```typescript
  const clusterByPageId = new Map(
    (input.clusters ?? []).map((c) => [c.pageId, c.clusterLabel]),
  );
  return {
    nodes: input.pages.map((page) => ({
      ...page,
      semanticCluster: clusterByPageId.get(page.id) ?? null,
    })),
    // edges + meta unchanged
```

- [ ] **Step 4: Repository methods**

In `src/server/features/audit/repositories/AuditRepository.ts`:

1. Import `auditPageClusters` from `@/db/schema`.
2. Extend `getAuditGraphData`'s `Promise.all` with a third query and return it:

```typescript
    db.query.auditPageClusters.findMany({
      where: eq(auditPageClusters.auditId, auditId),
      columns: { pageId: true, clusterLabel: true },
    }),
```

(destructure as `const [pages, edges, clusters] = ...` and return `{ audit, pages, edges, clusters }`.)

3. Add + export:

```typescript
async function replaceGraphifyClusters(
  auditId: string,
  rows: Array<{ pageId: string; clusterLabel: string }>,
) {
  await db
    .delete(auditPageClusters)
    .where(eq(auditPageClusters.auditId, auditId));
  await executeInBatches(rows, (row) =>
    db.insert(auditPageClusters).values({
      id: `audit_page_clusters:${auditId}:${row.pageId}`,
      auditId,
      pageId: row.pageId,
      clusterLabel: row.clusterLabel,
      source: "graphify",
    }),
  );
}
```

- [ ] **Step 5: Service + schema + server function**

In `src/server/features/audit/services/AuditService.ts`:

1. `getGraph` passes clusters through: `clusters: data.clusters,` in the `buildAuditGraphPayload` call.
2. Add (and register in the exported const):

```typescript
async function importGraphifyClusters(
  auditId: string,
  projectId: string,
  graphJsonRaw: unknown,
) {
  const audit = await AuditRepository.getAuditForProject(auditId, projectId);
  if (!audit) throw new AppError("NOT_FOUND");

  const parsed = graphifyGraphJsonSchema.safeParse(graphJsonRaw);
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This file does not look like a Graphify graph.json export.",
    );
  }

  const data = await AuditRepository.getAuditGraphData(auditId, projectId);
  if (!data) throw new AppError("NOT_FOUND");

  const rows = mapGraphifyClustersToPages({
    graphJson: parsed.data,
    pages: data.pages.map((p) => ({ id: p.id, url: p.url })),
  });
  if (rows.length === 0) {
    // Do not wipe existing clusters on a non-matching file (spec: no
    // overwrite when the import is invalid for this audit).
    throw new AppError(
      "VALIDATION_ERROR",
      "No Graphify nodes matched this audit's pages. Was the export generated from this audit?",
    );
  }

  await AuditRepository.replaceGraphifyClusters(auditId, rows);
  return { imported: rows.length };
}
```

Imports to add: `import { graphifyGraphJsonSchema, mapGraphifyClustersToPages } from "@/server/lib/audit/graphify-import";`.

In `src/types/schemas/audit.ts`:

```typescript
export const importGraphifyClustersSchema = z.object({
  projectId: z.string().min(1),
  auditId: z.string().min(1),
  graphJson: z.unknown(),
});
```

In `src/serverFunctions/audit.ts`:

```typescript
export const importGraphifyClusters = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => importGraphifyClustersSchema.parse(data))
  .handler(async ({ data, context }) => {
    return AuditService.importGraphifyClusters(
      data.auditId,
      context.projectId,
      data.graphJson,
    );
  });
```

- [ ] **Step 6: Run tests + type-check**

Run: `pnpm vitest run && pnpm types:check`
Expected: all pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/lib/audit/types.ts src/server/lib/audit/graph-edges.ts src/server/lib/audit/graph-edges.test.ts src/server/features/audit/repositories/AuditRepository.ts src/server/features/audit/services/AuditService.ts src/types/schemas/audit.ts src/serverFunctions/audit.ts
git commit -m "feat(audit): import graphify clusters and expose them on graph nodes"
```

---

## Task 10: Semantic color mode + "Import Graphify clusters" button

**Files:**
- Create: `src/client/features/audit/graph/semanticClusters.ts`
- Test: `src/client/features/audit/graph/semanticClusters.test.ts`
- Modify: `src/client/features/audit/graph/AuditCategoryLegend.tsx` (title prop)
- Modify: `src/client/features/audit/graph/AuditGraphView.tsx`

**Interfaces:**
- Consumes: `payload.nodes[].semanticCluster` (Task 9), `importGraphifyClusters` server fn (Task 9), `CategoryLegendEntry` + `CATEGORY_PALETTE` (existing).
- Produces: `computeSemanticClusters(payload): { legend: CategoryLegendEntry[]; colorByNodeId: Map<string, string> }` — legend entries reuse `CategoryLegendEntry` so `AuditCategoryLegend` renders them.

- [ ] **Step 1: Write the failing test**

Create `src/client/features/audit/graph/semanticClusters.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeSemanticClusters } from "./semanticClusters";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const node = (id: string, semanticCluster: string | null) => ({
  id,
  url: `https://s.com/${id}`,
  title: id,
  statusCode: 200,
  wordCount: 10,
  internalLinkCount: 0,
  isIndexable: true,
  h1Count: 1,
  externalLinkCount: 0,
  canonicalUrl: null,
  semanticCluster,
});

describe("computeSemanticClusters", () => {
  it("builds a legend sorted by size with unclustered pages grouped last", () => {
    const payload = {
      nodes: [
        node("a", "Docs"),
        node("b", "Docs"),
        node("c", "Blog"),
        node("d", null),
      ],
      edges: [],
      meta: { auditId: "x", startUrl: "https://s.com/a", pagesCrawled: 4, generatedAt: "t" },
    } as AuditGraphPayload;
    const { legend, colorByNodeId } = computeSemanticClusters(payload);
    expect(legend.map((e) => e.category)).toEqual(["Docs", "Blog", "(unclustered)"]);
    expect(legend.map((e) => e.count)).toEqual([2, 1, 1]);
    expect(colorByNodeId.get("a")).toBe(colorByNodeId.get("b"));
    expect(colorByNodeId.get("a")).not.toBe(colorByNodeId.get("c"));
    expect(colorByNodeId.size).toBe(4);
  });

  it("returns an empty legend when no node has a semantic cluster", () => {
    const payload = {
      nodes: [node("a", null)],
      edges: [],
      meta: { auditId: "x", startUrl: "https://s.com/a", pagesCrawled: 1, generatedAt: "t" },
    } as AuditGraphPayload;
    expect(computeSemanticClusters(payload).legend).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/client/features/audit/graph/semanticClusters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/client/features/audit/graph/semanticClusters.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/client/features/audit/graph/semanticClusters.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Give AuditCategoryLegend a title prop**

In `src/client/features/audit/graph/AuditCategoryLegend.tsx`, add an optional prop `title?: string` defaulting to `"Page categories"` and render `{title}` in place of the hard-coded heading text.

- [ ] **Step 6: Wire the semantic mode + import button into AuditGraphView**

Modify `src/client/features/audit/graph/AuditGraphView.tsx`:

1. Add imports:

```typescript
import { useQueryClient } from "@tanstack/react-query";
import { importGraphifyClusters } from "@/serverFunctions/audit";
import { computeSemanticClusters } from "@/client/features/audit/graph/semanticClusters";
```

2. Extend the types from Task 2:

```typescript
type Selection =
  | { kind: "insight" | "category" | "cluster" | "semantic"; id: string }
  | null;
type ColorMode = "category" | "community" | "semantic";
```

3. After the `structural` memo, add:

```typescript
  const semantic = useMemo(() => computeSemanticClusters(payload), [payload]);
  const hasSemantic = semantic.legend.length > 0;
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  const onImportFile = async (file: File) => {
    setIsImporting(true);
    try {
      const graphJson: unknown = JSON.parse(await file.text());
      const { imported } = await importGraphifyClusters({
        data: { projectId, auditId: payload.meta.auditId, graphJson },
      });
      toast.success(`Imported semantic clusters for ${imported} pages.`);
      await queryClient.invalidateQueries({ queryKey: ["audit-graph"] });
      setColorMode("semantic");
    } catch (error) {
      toast.error(
        error instanceof SyntaxError
          ? "That file is not valid JSON."
          : "Import failed. Use the graph.json produced by graphify on this audit's export.",
      );
    } finally {
      setIsImporting(false);
    }
  };
```

Note: `setColorMode("semantic")` runs before the payload-reset effect re-fires on the refetched payload; that effect resets the mode to `"category"`. To keep the semantic mode after import, change the reset effect to:

```typescript
  useEffect(() => {
    setSelection(null);
    setSelectedNodeId(null);
    setColorMode((mode) =>
      mode === "semantic" &&
      payload.nodes.some((n) => n.semanticCluster != null)
        ? "semantic"
        : "category",
    );
  }, [payload]);
```

4. Update `activeColors` (from Task 2):

```typescript
  const activeColors =
    colorMode === "community"
      ? structural.colorByNodeId
      : colorMode === "semantic"
        ? semantic.colorByNodeId
        : categories.colorByNodeId;
```

5. In the `highlightedIds` memo, add the semantic case:

```typescript
    if (selection.kind === "semantic") {
      return new Set(
        payload.nodes
          .filter(
            (n) => (n.semanticCluster ?? "(unclustered)") === selection.id,
          )
          .map((n) => n.id),
      );
    }
```

6. Extend the mode toggle with a third button, rendered only when `hasSemantic`:

```tsx
            {hasSemantic && (
              <button
                type="button"
                className={`btn join-item btn-xs flex-1 ${colorMode === "semantic" ? "btn-active" : ""}`}
                onClick={() => setColorMode("semantic")}
              >
                Semantic
              </button>
            )}
```

and add the semantic branch to the panel switch:

```tsx
          {colorMode === "semantic" ? (
            <AuditCategoryLegend
              title="Semantic communities (Graphify)"
              legend={semantic.legend}
              selectedCategory={
                selection?.kind === "semantic" ? selection.id : null
              }
              onSelect={(id) =>
                setSelection(id ? { kind: "semantic", id } : null)
              }
            />
          ) : colorMode === "category" ? (
            /* existing category legend */
          ) : (
            /* existing clusters panel */
          )}
```

7. Add the import button next to "Export for Graphify" (same buttons row), plus the hidden input:

```tsx
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
          >
            Import Graphify clusters
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onImportFile(file);
            }}
          />
```

- [ ] **Step 7: Full suite + type-check + app run (REQUIRED)**

Run: `pnpm vitest run && pnpm types:check`, then with `pnpm dev`:
- `/` returns 200 (SSR guard).
- Graph tab: "Import Graphify clusters" with a random JSON file shows the validation toast and leaves existing coloring untouched.
- With a real (or hand-crafted) `graph.json` whose nodes carry `source: "pages/<slug>.md"` + `community`, the import succeeds, the Semantic toggle appears, nodes recolor, and the semantic legend highlights/filters.

A minimal hand-crafted test file can be derived from the export: unzip `graphify-input.zip`, pick two slugs, and write `{"nodes":[{"id":"a","community":0,"source":"pages/<slug1>.md"},{"id":"b","community":1,"source":"pages/<slug2>.md"}],"community_labels":{"0":"Topic A","1":"Topic B"}}`.

- [ ] **Step 8: Commit**

```bash
git add src/client/features/audit/graph/semanticClusters.ts src/client/features/audit/graph/semanticClusters.test.ts src/client/features/audit/graph/AuditCategoryLegend.tsx src/client/features/audit/graph/AuditGraphView.tsx
git commit -m "feat(audit): semantic color mode with graphify cluster import"
```

---

## Self-review notes

- **Spec coverage (Phase 3, spec lines 184–225):** 3a Louvain coloring + clusters panel with size/pivot/auto-name (Tasks 1–2); color toggle community-vs-status → implemented as community-vs-category, matching the current UI where category replaced raw status coloring (status remains visible in the node inspector). 3b export button producing `graphify-input/` with `pages/*.md` frontmatter + text, `edges.json`, `manifest.json`, disabled state + exact-command help card (Tasks 3–6; Task 3 closes the gap that `captureContent` was unreachable from the UI). 3c `audit_page_clusters` table (Task 7, spec line 91), Zod-validated upload mapping communities by URL (Tasks 8–9), third color mode (Task 10). Error handling: malformed JSON → `VALIDATION_ERROR` without overwriting existing clusters; R2 miss → page dropped from export; no content → `CONFLICT` + disabled button.
- **Type consistency:** `StructuralCluster`/`computeStructuralClusters` (Task 1) consumed as-is in Task 2; `GraphifyExportFile { path, content }` (Task 4) flows through Task 5's `{ files }` into Task 6's `buildGraphifyZip`; `buildSlugMap` is shared by Tasks 4 & 8 (same-input determinism is what makes URL mapping work — both sides feed **all** audit page URLs); `semanticCluster?: string | null` (Task 9) is read by Task 10's `computeSemanticClusters`; `CategoryLegendEntry` reused for the semantic legend.
- **SSR safety:** all new client imports (louvain, fflate) are pure JS; Sigma/forceAtlas2 dynamic imports untouched; every UI task ends with the HTTP-200 app-run check.
- **Assumptions to verify during execution:** `graphology-communities-louvain` throws on an edgeless graph (guarded either way); Zod v4 `.loose()` vs `.passthrough()` naming (noted in Task 8); Graphify `graph.json` node `source`/`sources` field names — the tolerant schema plus slug regex accepts path variants, and a non-matching file fails safe with a clear message rather than corrupting data.
