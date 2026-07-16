# Site Graph — Internal Link Visualization, SEO Insights & Semantic Clustering

**Status:** Design approved, pending spec review
**Date:** 2026-06-30
**Branch:** `feat/site-graph`

## Summary

Add a "Graph" capability to OpenSEO that visualizes a crawled site as a graph of
its pages and their internal links, surfaces actionable SEO insights from that
structure, and supports semantic clustering of pages.

The feature **extends the existing Site Audit** rather than introducing a new
crawler. OpenSEO's native audit crawler (fetch + cheerio HTML parsing, running in
a Cloudflare Workflow) already extracts the full list of internal link targets per
page (`page.internalLinks: string[]`) to build its crawl frontier, but only the
_count_ is persisted (`audit_pages.internalLinkCount`). The graph data is therefore
already computed during every audit and simply discarded. This feature persists it
and builds on top.

Visualization uses **Sigma.js + graphology** (graphology provides in-JS PageRank
and Louvain community detection; Sigma renders via WebGL and scales to thousands of
nodes). Semantic clustering combines in-app structural communities (Louvain) with an
**offline Graphify** pipeline (export crawl → run Graphify CLI → optionally re-import
its semantic clusters). Graphify is an LLM/Python CLI and cannot run inside the
Cloudflare Workers runtime, so the coupling is deliberately file-based.

## Decisions (from brainstorming)

| Decision          | Choice                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| Scope             | All three layers (structure, SEO insights, semantic clustering) in one spec, built incrementally |
| Integration       | Extend the existing Site Audit; new "Graph" tab on audit results                                 |
| Crawl source      | Reuse the audit crawl; persist edges + page text instead of re-crawling                          |
| Viz library       | Sigma.js + graphology                                                                            |
| Clustering        | In-app structural (Louvain) + offline Graphify export/import                                     |
| Metrics location  | Client-side via graphology by default; server pre-compute only if perf demands                   |
| Page text storage | R2 (same pattern as Lighthouse payloads), gated by a config flag                                 |

## Phasing

The spec covers three phases; implementation proceeds phase by phase.

- **Phase 1 — Internal link graph (foundation):** persist edges + page text, new
  `getAuditGraph` API, the Graph tab with Sigma/graphology, node panel, raw
  client-side metrics.
- **Phase 2 — Actionable SEO insights:** an insights panel translating metrics into
  recommendations, each linkable to the graph, with CSV export.
- **Phase 3 — Semantic clustering:** in-app Louvain coloring + "Export for Graphify"
  - optional re-import of Graphify's semantic clusters.

Phases 2 and 3 depend on the data persisted in Phase 1 (edges + page content), so
Phase 1 is the prerequisite foundation.

## Data model

### New table: `audit_page_links` (one row per internal link / edge)

```
id            text primary key
auditId       text not null references audits(id) on delete cascade
fromPageId    text not null references audit_pages(id) on delete cascade
toUrl         text not null              -- normalized target URL
toPageId      text references audit_pages(id)  -- resolved post-crawl; null = target not crawled
anchorText    text                        -- nullable
isBroken      integer (boolean) not null default false
indexes: (auditId), (fromPageId), (toPageId)
```

Edges come from `page.internalLinks` (already computed by `page-analyzer`). After the
crawl, a `resolve-graph` phase matches `toUrl` against `audit_pages.url` of the same
run to populate `toPageId`; unmatched same-origin targets indicate links to
non-crawled pages.

Deduplicate edges per page on `(fromPageId, toUrl)` to bound row count. Use a
deterministic id (`auditId + fromPageId + toUrl`) so durable-step retries are
idempotent.

### New column: `audit_pages.contentR2Key` (text, nullable)

Cleaned page text (already extracted for `wordCount`) is pushed to R2 via
`putTextToR2` (same pattern as Lighthouse) and the key stored here. Gated by a new
`captureContent` flag in the audit config so storage does not grow when semantic
clustering is not wanted.

### Optional columns (deferred): `audit_pages.clickDepth`, `audit_pages.internalPagerank`

Only added if client-side computation hits performance limits. Default is to compute
these in the browser with graphology.

### New table: `audit_page_clusters` (Phase 3 re-import)

```
id            text primary key
auditId       text not null references audits(id) on delete cascade
pageId        text not null references audit_pages(id) on delete cascade
clusterLabel  text not null
source        text not null              -- 'graphify'
index: (auditId)
```

Migration generated with `db:generate`, applied locally with `db:migrate:local`.

## Crawl / workflow changes

Files: `siteAuditWorkflowPhases.ts`, `siteAuditWorkflowCrawl.ts`,
`page-analyzer.ts`, `AuditRepository.ts`.

1. **Persist edges.** Where pages are inserted today (`AuditRepository`, currently
   using `page.internalLinks.length`), also batch-insert one `audit_page_links` row
   per unique internal link. Add anchor-text capture to `page-analyzer` (it already
   reads each `href`).
2. **Persist page text to R2.** When `captureContent` is on, push cleaned page text
   to R2 and store `contentR2Key`.
3. **New durable phase `resolve-graph`** (after crawl): resolve `toPageId`, set
   `isBroken` (target `statusCode` 4xx/5xx, or same-origin indexable target that was
   never crawled). Durable step → retries without re-crawling. If it fails
   permanently the audit stays valid and the Graph tab shows "unavailable for this
   run".

## Server API

New read-only server function `getAuditGraph({ auditId })`, scoped by project/auth
using the existing audit guards:

```
{
  nodes: [{ id, url, title, statusCode, clickDepth?, wordCount,
            internalLinkCount, isIndexable }],
  edges: [{ from, to, anchorText, isBroken }],
  meta:  { auditId, startUrl, pagesCrawled, generatedAt }
}
```

- Never returns page text (text is only used by the Graphify export).
- Large sites: minimal per-node fields; truncate above a documented node threshold
  with a "graph truncated, refine via filters" message. Optional
  `?cluster=structural` to return server-precomputed Louvain communities for very
  large graphs.

New server function `exportAuditForGraphify({ auditId })` (Phase 3): produces a
zipped folder (see Phase 3 below). New server function to accept the Graphify cluster
JSON re-import, validated with Zod.

## Frontend — Graph tab (Phase 1)

New tab on the existing audit-results page; component `AuditGraphView`.

- **Render:** Sigma.js over a graphology graph built from the `getAuditGraph`
  payload. Node size ∝ internal PageRank; node color = community (Phase 3) or HTTP
  status, via a toggle. Broken edges drawn in red.
- **Layout:** ForceAtlas2 (graphology) computed in a web worker so the UI does not
  block.
- **Interactions:** zoom/pan; hover highlights neighbors; click opens a side panel
  (URL, title, status, click depth, in/out links, link to the Pages tab); URL
  search; filters by click depth, status, community, orphan.

### Client-side metrics (graphology, no extra server call)

- **Orphan pages:** in-degree 0 (excluding the start URL). Derived client-side from
  edges; not a server payload field, to keep a single source of truth.
- **Click depth:** BFS from the start URL; flag pages at depth ≥ 3 (configurable
  threshold in the UI).
- **Internal PageRank:** `graphology-metrics`; link-equity distribution.
- **Hubs / authorities:** top nodes by out-/in-degree.
- **Broken internal links:** edges with `isBroken`.

## Frontend — SEO insights panel (Phase 2)

A panel beside the graph turning metrics into actions; each insight highlights the
relevant nodes when clicked:

- Orphan pages (unreachable via internal links) + suggestion.
- Pages deeper than the click-depth threshold (default 3) from home.
- Broken internal links (source → target table).
- High-content but low-PageRank pages (`wordCount` high × PageRank low) =
  under-linked.
- Hub pages (to preserve).
- CSV export per list, reusing the existing export pattern (`ExportToSheetsButton`).

Phase 1 ships the graph + raw metrics + node panel. Phase 2 enriches the same view
with the actionable insights panel + exports.

## Frontend — Clustering (Phase 3)

### 3a. In-app structural communities

- `graphology-communities-louvain` partitions the link graph on load; each node gets
  a community color.
- Toggle: color by community vs by status.
- "Clusters" panel: list of communities, size, pivot pages (max PageRank per
  cluster), and an auto-derived name (most frequent term in cluster titles/URLs —
  heuristic, no LLM).

### 3b. Export for Graphify (semantic, offline)

"Export for Graphify" button → `exportAuditForGraphify({ auditId })` produces a
zipped folder:

```
graphify-input/
  pages/
    <url-slug>.md      # frontmatter (url, title, statusCode) + page text (from R2)
  edges.json           # internal edges (from→to, anchor) for --directed mode
  manifest.json        # startUrl, auditId, date, page count
```

- Text comes from `contentR2Key`; if content capture was off for the run, the button
  is disabled with "re-run an audit with content capture enabled".
- The user then runs offline: `graphify ./graphify-input --directed --html`,
  producing the semantic knowledge-graph HTML + `GRAPH_REPORT.md` + GraphRAG JSON.
- A help card shows the exact command.

### 3c. Re-import semantic clusters (optional)

- "Import Graphify clusters" button → upload Graphify's JSON → server function maps
  semantic communities onto nodes **by URL**, stored in `audit_page_clusters`.
- Graph color toggle gains a third option: **semantic community (Graphify)**,
  overlaying Graphify's meaning on OpenSEO's crawled structure.

### Assumed limit

Graphify does not run inside OpenSEO (incompatible with Workers). Coupling is by
files (export → CLI → import JSON), keeping the app decoupled from Graphify's
Python/LLM runtime.

## Error handling

- `resolve-graph` failure: durable retry; permanent failure leaves the audit valid,
  Graph tab shows "unavailable".
- R2 unavailable for page text: log and continue crawl; `contentR2Key` stays null →
  Graphify export disabled for that run, everything else works.
- Edge batch exceeding a D1 limit: split into smaller batches; deterministic edge id
  keeps step retries idempotent.
- Malformed Graphify JSON: Zod validation, clear message, no overwrite of existing
  clusters when invalid.
- Audit with no edges (single-page site / robots-blocked crawl): single-node graph
  with an explicit message.

## Performance & limits

- Page count bounded by the audit config `maxPages` (existing) → bounds the graph.
- ForceAtlas2 + Louvain run in a web worker; above a threshold (~2,000 nodes) fall
  back to a degraded render (no animated layout, edge sampling) with a warning.
- `getAuditGraph` payload: minimal per-node fields, no text; documented truncation
  threshold.
- Edge inserts: an N-page site × ~50 internal links is many rows → batching, targeted
  indexes, and a per-page cap (unique deduplicated source→target links).

## Testing (TDD; Vitest + Playwright already configured)

- **Unit:** anchor-text extraction in `page-analyzer`; `toUrl`→`toPageId` resolution;
  `isBroken` detection; orphan / depth detection; `getAuditGraph` payload builder;
  Graphify export builder; Zod validation of the re-import.
- **Repo/integration:** insert + query `audit_page_links` on a mini D1 DB; cascade
  delete when an audit is deleted.
- **Component:** `AuditGraphView` mounts with a nodes/edges fixture; filters and color
  toggles apply.
- **E2E (Playwright, optional by cost):** run an audit on a fixture site → Graph tab
  populates → an insight highlights the correct nodes.
- Tests are written before implementation for each unit.

## Out of scope

- Running Graphify inside OpenSEO.
- Cross-audit / historical graph diffing.
- External (outbound) link graph beyond counts.
- Server-side metric pre-computation (deferred unless perf requires it).
