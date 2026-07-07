# Site Graph — Phase 1 (Internal Link Graph Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the internal-link edges and page text the audit crawler already computes, expose them via a `getAuditGraph` API, and render an interactive page-graph tab on audit results.

**Architecture:** Extend the existing Site Audit (native fetch+cheerio crawler in a Cloudflare Workflow). The crawler already produces `internalLinks` per page; we persist edges into a new `audit_page_links` table, optionally store cleaned page text in R2, add a durable `resolve-graph` workflow step that links edges to crawled pages and flags broken ones, then build a Sigma.js + graphology graph in a new "Graph" tab.

**Tech Stack:** TypeScript, Drizzle ORM (Cloudflare D1/SQLite), Cloudflare Workflows + R2, TanStack Start server functions, React + TanStack Query, Sigma.js + graphology, Vitest.

## Global Constraints

- Edge dedup per page on `(fromPageId, toUrl)`; deterministic edge id `audit_page_links:${fromPageId}:${toUrl}` so durable-step retries are idempotent.
- `getAuditGraph` never returns page text.
- Page text capture is gated by `AuditConfig.captureContent` (default `false`); off → no R2 writes, Graphify export disabled later.
- Graph metrics (orphans, click depth, PageRank) computed client-side via graphology; no server pre-compute in Phase 1.
- Click-depth flag threshold default `3`, configurable in the UI.
- Follow existing patterns: `executeInBatches` for D1 inserts, `createServerFn().middleware(requireProjectContext).inputValidator(...).handler(...)` for server functions, Zod schemas in `src/types/schemas/`.
- Node version 20+, pnpm. Tests: `pnpm vitest run <path>`. Types: `pnpm types:check`. Migrations: `pnpm db:generate` then `pnpm db:migrate:local`.

---

## File Structure

- `src/db/app.schema.ts` — add `auditPageLinks` table + `auditPages.contentR2Key` column.
- `src/server/lib/audit/types.ts` — `captureContent` on `AuditConfig`; `internalLinkDetails` + `cleanedText` on `PageAnalysis`/`StepPageResult`; new `AuditGraphPayload` types.
- `src/server/lib/audit/page-analyzer.ts` — extract anchor text + cleaned body text.
- `src/server/lib/audit/graph-edges.ts` *(new)* — pure helpers: `buildEdgeRows`, `buildAuditGraphPayload`.
- `src/server/workflows/siteAuditWorkflowCrawl.ts` — thread `internalLinkDetails`/`cleanedText` into `StepPageResult` (the analyzer already runs here via `crawlPage`).
- `src/server/features/audit/repositories/AuditRepository.ts` — insert edges in `batchWriteResults`; new `resolveAuditGraphEdges`, `getAuditGraphData`.
- `src/server/workflows/siteAuditWorkflowPhases.ts` — push page text to R2 when `captureContent`; add `resolve-graph` step.
- `src/server/features/audit/services/AuditService.ts` — `getGraph(auditId, projectId)`.
- `src/types/schemas/audit.ts` — `getAuditGraphSchema`.
- `src/serverFunctions/audit.ts` — `getAuditGraph` server function.
- `src/client/features/audit/graph/graphologyGraph.ts` *(new)* — pure `buildGraphologyGraph`, `computeGraphMetrics`.
- `src/client/features/audit/graph/graphSummary.ts` *(new)* — pure `buildGraphSummary` (testable header logic).
- `src/client/features/audit/graph/AuditGraphView.tsx` *(new)* — Sigma render + summary; node panel + filters land in a later task.
- `src/client/features/audit/results/ResultsView.tsx` — add `"graph"` tab.

---

## Task 1: Database schema — edges table + content key

**Files:**
- Modify: `src/db/app.schema.ts` (after `auditPages`, ~line 431)
- Generated: `drizzle/` migration via `pnpm db:generate`

**Interfaces:**
- Produces: `auditPageLinks` table with columns `id, auditId, fromPageId, toUrl, toPageId, anchorText, isBroken`; `auditPages.contentR2Key`.

- [ ] **Step 1: Add the column and table to the schema**

In `src/db/app.schema.ts`, add `contentR2Key: text("content_r2_key"),` to the `auditPages` column object (just after `responseTimeMs`). Then append after the `auditPages` table definition:

```typescript
// One row per internal link (graph edge) discovered during the crawl
export const auditPageLinks = sqliteTable(
  "audit_page_links",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    fromPageId: text("from_page_id")
      .notNull()
      .references(() => auditPages.id, { onDelete: "cascade" }),
    toUrl: text("to_url").notNull(),
    toPageId: text("to_page_id").references(() => auditPages.id, {
      onDelete: "set null",
    }),
    anchorText: text("anchor_text"),
    isBroken: integer("is_broken", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    index("audit_page_links_audit_id_idx").on(table.auditId),
    index("audit_page_links_from_page_id_idx").on(table.fromPageId),
    index("audit_page_links_to_page_id_idx").on(table.toPageId),
  ],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file under `drizzle/` (e.g. `0026_*.sql`) creating `audit_page_links` and adding `content_r2_key`.

- [ ] **Step 3: Apply locally**

Run: `pnpm db:migrate:local`
Expected: migration applies with ✅.

- [ ] **Step 4: Type-check**

Run: `pnpm types:check`
Expected: no errors (the new exports compile).

- [ ] **Step 5: Commit**

```bash
git add src/db/app.schema.ts drizzle/
git commit -m "feat(audit): add audit_page_links table and content_r2_key column"
```

---

## Task 2: Extract anchor text + cleaned body text in the analyzer

**Files:**
- Modify: `src/server/lib/audit/types.ts`
- Modify: `src/server/lib/audit/page-analyzer.ts`
- Test: `src/server/lib/audit/page-analyzer.test.ts` *(new)*

**Interfaces:**
- Produces: `PageAnalysis.internalLinkDetails: Array<{ url: string; anchorText: string | null }>` and `PageAnalysis.cleanedText: string`. `internalLinks: string[]` stays unchanged (the crawl frontier keeps using it).

- [ ] **Step 1: Write the failing test**

Create `src/server/lib/audit/page-analyzer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { analyzeHtml } from "./page-analyzer";

describe("analyzeHtml internalLinkDetails", () => {
  it("captures anchor text for internal links and cleaned body text", () => {
    const html = `<html><body>
      <a href="/about">About us</a>
      <a href="https://other.com/x">External</a>
      <p>Hello   world</p>
      <script>ignored()</script>
    </body></html>`;
    const result = analyzeHtml(html, "https://site.com/", 200, 10);

    expect(result.internalLinkDetails).toEqual([
      { url: "https://site.com/about", anchorText: "About us" },
    ]);
    expect(result.cleanedText).toContain("Hello world");
    expect(result.cleanedText).not.toContain("ignored");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/lib/audit/page-analyzer.test.ts`
Expected: FAIL — `internalLinkDetails`/`cleanedText` undefined.

- [ ] **Step 3: Extend the types**

In `src/server/lib/audit/types.ts`, inside `interface PageAnalysis` after `externalLinks: string[];` add:

```typescript
  // Internal links with anchor text, for the page graph
  internalLinkDetails: Array<{ url: string; anchorText: string | null }>;
  // Cleaned visible body text (for optional R2 storage / Graphify)
  cleanedText: string;
```

Add the same two fields to `interface StepPageResult` after its `externalLinks: string[];`.

- [ ] **Step 4: Implement extraction**

In `src/server/lib/audit/page-analyzer.ts`, replace the `// --- Links ---` block so each internal link also records its trimmed anchor text, and capture the already-computed `bodyText` as cleaned text:

```typescript
  // --- Links ---
  const internalLinks: string[] = [];
  const externalLinks: string[] = [];
  const internalLinkDetails: Array<{ url: string; anchorText: string | null }> =
    [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (/^(javascript:|mailto:|tel:|#)/.test(href)) return;

    const resolved = normalizeUrl(href, pageUrl);
    if (!resolved) return;

    if (isSameOrigin(resolved, pageUrl)) {
      internalLinks.push(resolved);
      const anchor = $(el).text().replace(/\s+/g, " ").trim();
      internalLinkDetails.push({ url: resolved, anchorText: anchor || null });
    } else {
      externalLinks.push(resolved);
    }
  });
```

Then in the returned object add `internalLinkDetails,` and `cleanedText: bodyText,` (note: `bodyText` is the variable already computed for `wordCount`).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/server/lib/audit/page-analyzer.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/lib/audit/types.ts src/server/lib/audit/page-analyzer.ts src/server/lib/audit/page-analyzer.test.ts
git commit -m "feat(audit): extract internal-link anchor text and cleaned body text"
```

---

## Task 3: Thread link details + cleaned text into StepPageResult

**Files:**
- Modify: `src/server/workflows/siteAuditWorkflowCrawl.ts` (the `crawlPage` → `StepPageResult` mapping)
- Test: `src/server/workflows/siteAuditWorkflowCrawl.test.ts` *(extend or new)*

**Interfaces:**
- Consumes: `PageAnalysis.internalLinkDetails`, `PageAnalysis.cleanedText` (Task 2).
- Produces: each `StepPageResult` carries `internalLinkDetails` and `cleanedText`.

- [ ] **Step 1: Locate the mapping**

Run: `grep -n "analyzeHtml\|internalLinks:\|externalLinks:\|cleanedText" src/server/workflows/siteAuditWorkflowCrawl.ts`
Expected: find where `analyzeHtml(...)` result is mapped into a `StepPageResult` (the object literal with `internalLinks: analysis.internalLinks`).

- [ ] **Step 2: Write the failing test**

Create `src/server/workflows/siteAuditWorkflowCrawl.test.ts` (or extend existing) — test the mapping helper that turns a `PageAnalysis` + id into a `StepPageResult`. If the mapping is inline, first extract it into an exported `toStepPageResult(analysis: PageAnalysis, id: string, isIndexable: boolean): StepPageResult` function, then:

```typescript
import { describe, it, expect } from "vitest";
import { toStepPageResult } from "./siteAuditWorkflowCrawl";
import type { PageAnalysis } from "@/server/lib/audit/types";

const analysis = {
  url: "https://s.com/",
  statusCode: 200,
  redirectUrl: null,
  responseTimeMs: 5,
  title: "t",
  metaDescription: "",
  canonical: null,
  robotsMeta: null,
  ogTitle: null,
  ogDescription: null,
  ogImage: null,
  h1s: [],
  headingOrder: [],
  wordCount: 2,
  images: [],
  internalLinks: ["https://s.com/a"],
  externalLinks: [],
  internalLinkDetails: [{ url: "https://s.com/a", anchorText: "A" }],
  cleanedText: "hello world",
  hasStructuredData: false,
  hreflangTags: [],
} satisfies PageAnalysis;

describe("toStepPageResult", () => {
  it("carries internalLinkDetails and cleanedText", () => {
    const result = toStepPageResult(analysis, "page-1", true);
    expect(result.internalLinkDetails).toEqual([
      { url: "https://s.com/a", anchorText: "A" },
    ]);
    expect(result.cleanedText).toBe("hello world");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/server/workflows/siteAuditWorkflowCrawl.test.ts`
Expected: FAIL — `toStepPageResult` not exported / fields missing.

- [ ] **Step 4: Implement**

Extract the inline mapping into an exported function and include the new fields:

```typescript
export function toStepPageResult(
  analysis: PageAnalysis,
  id: string,
  isIndexable: boolean,
): StepPageResult {
  return {
    id,
    url: analysis.url,
    statusCode: analysis.statusCode,
    redirectUrl: analysis.redirectUrl,
    title: analysis.title,
    metaDescription: analysis.metaDescription,
    canonicalUrl: analysis.canonical,
    robotsMeta: analysis.robotsMeta,
    ogTitle: analysis.ogTitle,
    ogDescription: analysis.ogDescription,
    ogImage: analysis.ogImage,
    h1Count: analysis.h1s.length,
    h2Count: analysis.headingOrder.filter((l) => l === 2).length,
    h3Count: analysis.headingOrder.filter((l) => l === 3).length,
    h4Count: analysis.headingOrder.filter((l) => l === 4).length,
    h5Count: analysis.headingOrder.filter((l) => l === 5).length,
    h6Count: analysis.headingOrder.filter((l) => l === 6).length,
    headingOrder: analysis.headingOrder,
    wordCount: analysis.wordCount,
    imagesTotal: analysis.images.length,
    imagesMissingAlt: analysis.images.filter((img) => !img.alt).length,
    images: analysis.images,
    internalLinks: analysis.internalLinks,
    externalLinks: analysis.externalLinks,
    internalLinkDetails: analysis.internalLinkDetails,
    cleanedText: analysis.cleanedText,
    hasStructuredData: analysis.hasStructuredData,
    hreflangTags: analysis.hreflangTags,
    isIndexable,
    responseTimeMs: analysis.responseTimeMs,
  };
}
```

Replace the inline mapping in `crawlPage` with a call to `toStepPageResult(...)` (preserve how `id` and `isIndexable` are currently derived). If the existing mapping computes h-counts differently, keep the existing logic — only ADD `internalLinkDetails` and `cleanedText`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/server/workflows/siteAuditWorkflowCrawl.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check + commit**

Run: `pnpm types:check` (expect no errors), then:

```bash
git add src/server/workflows/siteAuditWorkflowCrawl.ts src/server/workflows/siteAuditWorkflowCrawl.test.ts
git commit -m "feat(audit): thread internalLinkDetails and cleanedText through StepPageResult"
```

---

## Task 4: Persist edges in batchWriteResults

**Files:**
- Create: `src/server/lib/audit/graph-edges.ts`
- Modify: `src/server/features/audit/repositories/AuditRepository.ts` (`batchWriteResults`)
- Test: `src/server/lib/audit/graph-edges.test.ts` *(new)*

**Interfaces:**
- Produces: `buildEdgeRows(auditId, pages): Array<{ id; auditId; fromPageId; toUrl; anchorText }>` — deduped per `(fromPageId, toUrl)`, id = `audit_page_links:${fromPageId}:${toUrl}`.

- [ ] **Step 1: Write the failing test**

Create `src/server/lib/audit/graph-edges.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildEdgeRows } from "./graph-edges";
import type { StepPageResult } from "./types";

const page = (id: string, links: Array<[string, string | null]>) =>
  ({
    id,
    internalLinkDetails: links.map(([url, anchorText]) => ({ url, anchorText })),
  }) as unknown as StepPageResult;

describe("buildEdgeRows", () => {
  it("dedupes per (fromPageId, toUrl) and builds deterministic ids", () => {
    const rows = buildEdgeRows("audit-1", [
      page("p1", [
        ["https://s.com/a", "A"],
        ["https://s.com/a", "A again"],
        ["https://s.com/b", null],
      ]),
    ]);
    expect(rows).toEqual([
      {
        id: "audit_page_links:p1:https://s.com/a",
        auditId: "audit-1",
        fromPageId: "p1",
        toUrl: "https://s.com/a",
        anchorText: "A",
      },
      {
        id: "audit_page_links:p1:https://s.com/b",
        auditId: "audit-1",
        fromPageId: "p1",
        toUrl: "https://s.com/b",
        anchorText: null,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/lib/audit/graph-edges.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure helper**

Create `src/server/lib/audit/graph-edges.ts`:

```typescript
import type { StepPageResult } from "./types";

export interface EdgeRow {
  id: string;
  auditId: string;
  fromPageId: string;
  toUrl: string;
  anchorText: string | null;
}

export function buildEdgeRows(
  auditId: string,
  pages: Pick<StepPageResult, "id" | "internalLinkDetails">[],
): EdgeRow[] {
  const rows: EdgeRow[] = [];
  for (const page of pages) {
    const seen = new Set<string>();
    for (const link of page.internalLinkDetails) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      rows.push({
        id: `audit_page_links:${page.id}:${link.url}`,
        auditId,
        fromPageId: page.id,
        toUrl: link.url,
        anchorText: link.anchorText,
      });
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/server/lib/audit/graph-edges.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire edge inserts into batchWriteResults**

In `src/server/features/audit/repositories/AuditRepository.ts`: import `buildEdgeRows` and `auditPageLinks`, and after the `auditPages` insert loop in `batchWriteResults` (after line ~165), add:

```typescript
  const edgeRows = buildEdgeRows(auditId, pages);
  if (edgeRows.length > 0) {
    await executeInBatches(edgeRows, (row) =>
      db.insert(auditPageLinks).values(row).onConflictDoNothing(),
    );
  }
```

Add `auditPageLinks` to the `@/db/schema` import at the top of the file.

- [ ] **Step 6: Type-check + commit**

Run: `pnpm types:check` (expect no errors), then:

```bash
git add src/server/lib/audit/graph-edges.ts src/server/lib/audit/graph-edges.test.ts src/server/features/audit/repositories/AuditRepository.ts
git commit -m "feat(audit): persist internal-link edges during crawl"
```

---

## Task 5: Store page text in R2 when captureContent is on

**Files:**
- Modify: `src/server/lib/audit/types.ts` (`AuditConfig` + zod schema)
- Modify: `src/server/features/audit/repositories/AuditRepository.ts` (write `contentR2Key`)
- Modify: `src/server/workflows/siteAuditWorkflowPhases.ts` (upload text when enabled)
- Test: `src/server/lib/audit/types.test.ts` *(new)*

**Interfaces:**
- Consumes: `putTextToR2(key, text)` from `@/server/lib/r2` (returns `{ key }`).
- Produces: `AuditConfig.captureContent: boolean`; `auditPages.contentR2Key` populated when enabled.

- [ ] **Step 1: Write the failing test (config parsing)**

Create `src/server/lib/audit/types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseAuditConfig } from "./types";

describe("parseAuditConfig captureContent", () => {
  it("defaults captureContent to false when absent", () => {
    const cfg = parseAuditConfig(
      JSON.stringify({ maxPages: 50, lighthouseStrategy: "none" }),
    );
    expect(cfg?.captureContent).toBe(false);
  });
  it("preserves captureContent when present", () => {
    const cfg = parseAuditConfig(
      JSON.stringify({
        maxPages: 50,
        lighthouseStrategy: "none",
        captureContent: true,
      }),
    );
    expect(cfg?.captureContent).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/lib/audit/types.test.ts`
Expected: FAIL — `captureContent` undefined.

- [ ] **Step 3: Extend AuditConfig**

In `src/server/lib/audit/types.ts`: add `captureContent: boolean;` to `interface AuditConfig`, and in `auditConfigSchema` add `captureContent: z.boolean().default(false),`. (Zod `.default` fills the field when absent.)

- [ ] **Step 4: Run config test to verify it passes**

Run: `pnpm vitest run src/server/lib/audit/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Accept contentR2Key in the repository insert**

In `AuditRepository.batchWriteResults`, add `contentR2Key: page.contentR2Key ?? null,` to the `auditPages` insert values. Add `contentR2Key?: string | null;` to `StepPageResult` in `types.ts`.

- [ ] **Step 6: Upload text in the workflow when enabled**

In `src/server/workflows/siteAuditWorkflowPhases.ts`, after the crawl produces `allPages` and before persisting, add a durable step that (only when `config.captureContent`) uploads each page's `cleanedText` to R2 and sets `contentR2Key`:

```typescript
  if (config.captureContent) {
    await step.do("store-page-content", async () => {
      for (const page of allPages) {
        if (!page.cleanedText) continue;
        const key = `audits/${auditId}/content/${page.id}.txt`;
        const uploaded = await putTextToR2(key, page.cleanedText);
        page.contentR2Key = uploaded.key;
      }
    });
  }
```

Add `import { putTextToR2 } from "@/server/lib/r2";` at the top. (`allPages` is the `StepPageResult[]` returned by `runCrawlPhase`; mutating before persistence is fine since persistence happens after this step.)

- [ ] **Step 7: Type-check + commit**

Run: `pnpm types:check` (expect no errors), then:

```bash
git add src/server/lib/audit/types.ts src/server/lib/audit/types.test.ts src/server/features/audit/repositories/AuditRepository.ts src/server/workflows/siteAuditWorkflowPhases.ts
git commit -m "feat(audit): store page text in R2 when captureContent enabled"
```

---

## Task 6: Resolve edges (toPageId + isBroken) in a durable step

**Files:**
- Modify: `src/server/lib/audit/graph-edges.ts` (`resolveEdges` pure helper)
- Modify: `src/server/features/audit/repositories/AuditRepository.ts` (`resolveAuditGraphEdges`)
- Modify: `src/server/workflows/siteAuditWorkflowPhases.ts` (`resolve-graph` step)
- Test: `src/server/lib/audit/graph-edges.test.ts` (extend)

**Interfaces:**
- Produces: `resolveEdges(edges, pagesByUrl)` returns per-edge `{ id, toPageId, isBroken }`. `AuditRepository.resolveAuditGraphEdges(auditId)` applies it in D1.

- [ ] **Step 1: Write the failing test**

Append to `src/server/lib/audit/graph-edges.test.ts`:

```typescript
import { resolveEdges } from "./graph-edges";

describe("resolveEdges", () => {
  it("links toPageId by url and flags broken targets", () => {
    const pages = [
      { id: "p1", url: "https://s.com/a", statusCode: 200 },
      { id: "p2", url: "https://s.com/b", statusCode: 404 },
    ];
    const edges = [
      { id: "e1", toUrl: "https://s.com/a" },
      { id: "e2", toUrl: "https://s.com/b" },
      { id: "e3", toUrl: "https://s.com/missing" },
    ];
    expect(resolveEdges(edges, pages)).toEqual([
      { id: "e1", toPageId: "p1", isBroken: false },
      { id: "e2", toPageId: "p2", isBroken: true },
      { id: "e3", toPageId: null, isBroken: false },
    ]);
  });
});
```

(`isBroken` = target crawled with a 4xx/5xx status. An unmatched target is `toPageId: null, isBroken: false` — it is a link to a non-crawled page, surfaced separately by the orphan/coverage metric, not as a broken link.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/lib/audit/graph-edges.test.ts`
Expected: FAIL — `resolveEdges` not exported.

- [ ] **Step 3: Implement the pure helper**

Add to `src/server/lib/audit/graph-edges.ts`:

```typescript
export function resolveEdges(
  edges: Array<{ id: string; toUrl: string }>,
  pages: Array<{ id: string; url: string; statusCode: number | null }>,
): Array<{ id: string; toPageId: string | null; isBroken: boolean }> {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  return edges.map((edge) => {
    const target = byUrl.get(edge.toUrl) ?? null;
    const isBroken =
      target?.statusCode != null && target.statusCode >= 400;
    return {
      id: edge.id,
      toPageId: target?.id ?? null,
      isBroken: Boolean(isBroken),
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/server/lib/audit/graph-edges.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the repository method**

In `AuditRepository.ts` add (and export via the `AuditRepository` object):

```typescript
async function resolveAuditGraphEdges(auditId: string) {
  const [edges, pages] = await Promise.all([
    db.query.auditPageLinks.findMany({
      where: eq(auditPageLinks.auditId, auditId),
      columns: { id: true, toUrl: true },
    }),
    db.query.auditPages.findMany({
      where: eq(auditPages.auditId, auditId),
      columns: { id: true, url: true, statusCode: true },
    }),
  ]);
  const resolved = resolveEdges(edges, pages);
  await executeInBatches(resolved, (row) =>
    db
      .update(auditPageLinks)
      .set({ toPageId: row.toPageId, isBroken: row.isBroken })
      .where(eq(auditPageLinks.id, row.id)),
  );
}
```

Import `resolveEdges` from `@/server/lib/audit/graph-edges`. Add `resolveAuditGraphEdges` to the exported `AuditRepository` object.

- [ ] **Step 6: Add the workflow step**

In `siteAuditWorkflowPhases.ts`, after pages+edges are persisted (after the write-results step, before/after Lighthouse), add:

```typescript
  await step.do("resolve-graph", async () => {
    await AuditRepository.resolveAuditGraphEdges(auditId);
  });
```

(`AuditRepository` is already imported in this file.)

- [ ] **Step 7: Type-check + commit**

Run: `pnpm types:check` (expect no errors), then:

```bash
git add src/server/lib/audit/graph-edges.ts src/server/lib/audit/graph-edges.test.ts src/server/features/audit/repositories/AuditRepository.ts src/server/workflows/siteAuditWorkflowPhases.ts
git commit -m "feat(audit): resolve graph edge targets and broken-link flags"
```

---

## Task 7: getAuditGraph payload + server function

**Files:**
- Modify: `src/server/lib/audit/graph-edges.ts` (`buildAuditGraphPayload`)
- Modify: `src/server/lib/audit/types.ts` (`AuditGraphPayload` types)
- Modify: `src/server/features/audit/repositories/AuditRepository.ts` (`getAuditGraphData`)
- Modify: `src/server/features/audit/services/AuditService.ts` (`getGraph`)
- Modify: `src/types/schemas/audit.ts` (`getAuditGraphSchema`)
- Modify: `src/serverFunctions/audit.ts` (`getAuditGraph`)
- Test: `src/server/lib/audit/graph-edges.test.ts` (extend)

**Interfaces:**
- Produces: `AuditGraphPayload { nodes: AuditGraphNode[]; edges: AuditGraphEdge[]; meta: {...} }`; server function `getAuditGraph({ data: { projectId, auditId } })`.

- [ ] **Step 1: Add payload types**

In `src/server/lib/audit/types.ts` add:

```typescript
export interface AuditGraphNode {
  id: string;
  url: string;
  title: string | null;
  statusCode: number | null;
  wordCount: number;
  internalLinkCount: number;
  isIndexable: boolean;
}
export interface AuditGraphEdge {
  from: string;
  to: string;
  anchorText: string | null;
  isBroken: boolean;
}
export interface AuditGraphPayload {
  nodes: AuditGraphNode[];
  edges: AuditGraphEdge[];
  meta: {
    auditId: string;
    startUrl: string;
    pagesCrawled: number;
    generatedAt: string;
  };
}
```

- [ ] **Step 2: Write the failing test**

Append to `src/server/lib/audit/graph-edges.test.ts`:

```typescript
import { buildAuditGraphPayload } from "./graph-edges";

describe("buildAuditGraphPayload", () => {
  it("maps pages to nodes and resolved edges to edges (skipping unresolved)", () => {
    const payload = buildAuditGraphPayload({
      auditId: "a1",
      startUrl: "https://s.com/",
      pages: [
        { id: "p1", url: "https://s.com/", title: "Home", statusCode: 200, wordCount: 10, internalLinkCount: 1, isIndexable: true },
        { id: "p2", url: "https://s.com/a", title: "A", statusCode: 200, wordCount: 5, internalLinkCount: 0, isIndexable: true },
      ],
      edges: [
        { fromPageId: "p1", toPageId: "p2", anchorText: "A", isBroken: false },
        { fromPageId: "p1", toPageId: null, anchorText: null, isBroken: false },
      ],
    });
    expect(payload.nodes).toHaveLength(2);
    expect(payload.edges).toEqual([
      { from: "p1", to: "p2", anchorText: "A", isBroken: false },
    ]);
    expect(payload.meta.pagesCrawled).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/server/lib/audit/graph-edges.test.ts`
Expected: FAIL — `buildAuditGraphPayload` not exported.

- [ ] **Step 4: Implement the builder**

Add to `src/server/lib/audit/graph-edges.ts`:

```typescript
import type {
  AuditGraphNode,
  AuditGraphPayload,
} from "./types";

export function buildAuditGraphPayload(input: {
  auditId: string;
  startUrl: string;
  pages: AuditGraphNode[];
  edges: Array<{
    fromPageId: string;
    toPageId: string | null;
    anchorText: string | null;
    isBroken: boolean;
  }>;
}): AuditGraphPayload {
  return {
    nodes: input.pages,
    edges: input.edges
      .filter((e) => e.toPageId !== null)
      .map((e) => ({
        from: e.fromPageId,
        to: e.toPageId as string,
        anchorText: e.anchorText,
        isBroken: e.isBroken,
      })),
    meta: {
      auditId: input.auditId,
      startUrl: input.startUrl,
      pagesCrawled: input.pages.length,
      generatedAt: new Date().toISOString(),
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/server/lib/audit/graph-edges.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the repository query**

In `AuditRepository.ts` add and export `getAuditGraphData`:

```typescript
async function getAuditGraphData(auditId: string, projectId: string) {
  const audit = await getAuditForProject(auditId, projectId);
  if (!audit) return null;
  const [pages, edges] = await Promise.all([
    db.query.auditPages.findMany({
      where: eq(auditPages.auditId, auditId),
      columns: {
        id: true, url: true, title: true, statusCode: true,
        wordCount: true, internalLinkCount: true, isIndexable: true,
      },
    }),
    db.query.auditPageLinks.findMany({
      where: eq(auditPageLinks.auditId, auditId),
      columns: { fromPageId: true, toPageId: true, anchorText: true, isBroken: true },
    }),
  ]);
  return { audit, pages, edges };
}
```

- [ ] **Step 7: Add the service method**

In `AuditService.ts` add `getGraph` and export it on the `AuditService` object:

```typescript
import { buildAuditGraphPayload } from "@/server/lib/audit/graph-edges";

async function getGraph(auditId: string, projectId: string) {
  const data = await AuditRepository.getAuditGraphData(auditId, projectId);
  if (!data) return null;
  return buildAuditGraphPayload({
    auditId,
    startUrl: data.audit.startUrl,
    pages: data.pages.map((p) => ({
      id: p.id, url: p.url, title: p.title, statusCode: p.statusCode,
      wordCount: p.wordCount, internalLinkCount: p.internalLinkCount,
      isIndexable: p.isIndexable,
    })),
    edges: data.edges,
  });
}
```

(Use the audit's actual start-URL field; confirm its name on the `audits` row — adjust `data.audit.startUrl` if the column differs.)

- [ ] **Step 8: Add the input schema**

In `src/types/schemas/audit.ts` add (mirroring `getAuditResultsSchema`):

```typescript
export const getAuditGraphSchema = z.object({
  projectId: z.string(),
  auditId: z.string(),
});
```

- [ ] **Step 9: Add the server function**

In `src/serverFunctions/audit.ts` add:

```typescript
export const getAuditGraph = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => getAuditGraphSchema.parse(data))
  .handler(async ({ data, context }) => {
    return AuditService.getGraph(data.auditId, context.projectId);
  });
```

Import `getAuditGraphSchema`. Add `getGraph` to the exported `AuditService` object.

- [ ] **Step 10: Type-check + commit**

Run: `pnpm types:check` (expect no errors), then:

```bash
git add src/server/lib/audit/graph-edges.ts src/server/lib/audit/graph-edges.test.ts src/server/lib/audit/types.ts src/server/features/audit/repositories/AuditRepository.ts src/server/features/audit/services/AuditService.ts src/types/schemas/audit.ts src/serverFunctions/audit.ts
git commit -m "feat(audit): add getAuditGraph server function and payload builder"
```

---

## Task 8: Client graph builder + metrics (pure)

**Files:**
- Create: `src/client/features/audit/graph/graphologyGraph.ts`
- Create: `src/client/features/audit/graph/graphologyGraph.test.ts`
- Modify: `package.json` (add deps)

**Interfaces:**
- Consumes: `AuditGraphPayload` (Task 7).
- Produces: `buildGraphologyGraph(payload): Graph`; `computeGraphMetrics(graph): { orphans: string[]; depthByNode: Map<string, number>; pagerank: Record<string, number> }`.

- [ ] **Step 1: Add dependencies**

Run: `pnpm add graphology sigma graphology-layout-forceatlas2 graphology-metrics graphology-communities-louvain && pnpm add -D @types/graphology`
Expected: packages added to `package.json`.

- [ ] **Step 2: Write the failing test**

Create `src/client/features/audit/graph/graphologyGraph.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildGraphologyGraph, computeGraphMetrics } from "./graphologyGraph";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const payload: AuditGraphPayload = {
  nodes: [
    { id: "home", url: "https://s.com/", title: "Home", statusCode: 200, wordCount: 9, internalLinkCount: 1, isIndexable: true },
    { id: "a", url: "https://s.com/a", title: "A", statusCode: 200, wordCount: 5, internalLinkCount: 0, isIndexable: true },
    { id: "orphan", url: "https://s.com/orphan", title: "O", statusCode: 200, wordCount: 5, internalLinkCount: 0, isIndexable: true },
  ],
  edges: [{ from: "home", to: "a", anchorText: "A", isBroken: false }],
  meta: { auditId: "a1", startUrl: "https://s.com/", pagesCrawled: 3, generatedAt: "x" },
};

describe("graphologyGraph", () => {
  it("builds a directed graph with all nodes and edges", () => {
    const g = buildGraphologyGraph(payload);
    expect(g.order).toBe(3);
    expect(g.size).toBe(1);
    expect(g.hasEdge("home", "a")).toBe(true);
  });
  it("detects orphan nodes (no inbound edges, excluding start)", () => {
    const g = buildGraphologyGraph(payload);
    const metrics = computeGraphMetrics(g, "home");
    expect(metrics.orphans).toEqual(["orphan"]);
    expect(metrics.depthByNode.get("a")).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/client/features/audit/graph/graphologyGraph.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `src/client/features/audit/graph/graphologyGraph.ts`:

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/client/features/audit/graph/graphologyGraph.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/client/features/audit/graph/graphologyGraph.ts src/client/features/audit/graph/graphologyGraph.test.ts
git commit -m "feat(audit): add client graph builder and metrics"
```

---

## Task 9: AuditGraphView component + Graph tab

**Files:**
- Create: `src/client/features/audit/graph/graphSummary.ts`
- Create: `src/client/features/audit/graph/graphSummary.test.ts`
- Create: `src/client/features/audit/graph/AuditGraphView.tsx`
- Modify: `src/client/features/audit/results/ResultsView.tsx` (add `"graph"` tab)
- Modify: `src/routes/_project/p/$projectId/audit/index.tsx` (provide graph data)

**Interfaces:**
- Consumes: `getAuditGraph` server function (Task 7), `buildGraphologyGraph`/`computeGraphMetrics` (Task 8).
- Produces: `buildGraphSummary(payload, metrics): { pagesCrawled; orphanCount; brokenCount }`.

> The project has no component tests and vitest runs `environment: "node"` with `include: ["src/**/*.test.ts"]` (no `.tsx`, no jsdom/testing-library). Rather than introduce DOM test infra in Phase 1, the testable logic is extracted into a pure `buildGraphSummary` (`.test.ts`, node env); `AuditGraphView` rendering is verified manually in the running app (Step 7).

- [ ] **Step 1: Write the failing test (pure summary)**

Create `src/client/features/audit/graph/graphSummary.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildGraphSummary } from "./graphSummary";
import { buildGraphologyGraph, computeGraphMetrics } from "./graphologyGraph";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const payload: AuditGraphPayload = {
  nodes: [
    { id: "home", url: "https://s.com/", title: "Home", statusCode: 200, wordCount: 9, internalLinkCount: 1, isIndexable: true },
    { id: "orphan", url: "https://s.com/o", title: "O", statusCode: 200, wordCount: 1, internalLinkCount: 0, isIndexable: true },
  ],
  edges: [{ from: "home", to: "orphan", anchorText: null, isBroken: true }],
  meta: { auditId: "a1", startUrl: "https://s.com/", pagesCrawled: 2, generatedAt: "x" },
};

describe("buildGraphSummary", () => {
  it("counts pages, orphans, and broken links", () => {
    const graph = buildGraphologyGraph(payload);
    const metrics = computeGraphMetrics(graph, "home");
    expect(buildGraphSummary(payload, metrics)).toEqual({
      pagesCrawled: 2,
      orphanCount: 0, // 'orphan' now has an inbound edge
      brokenCount: 1,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/client/features/audit/graph/graphSummary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure summary + the component**

Create `src/client/features/audit/graph/graphSummary.ts`:

```typescript
import type { AuditGraphPayload } from "@/server/lib/audit/types";

export interface GraphSummary {
  pagesCrawled: number;
  orphanCount: number;
  brokenCount: number;
}

export function buildGraphSummary(
  payload: AuditGraphPayload,
  metrics: { orphans: string[] },
): GraphSummary {
  return {
    pagesCrawled: payload.meta.pagesCrawled,
    orphanCount: metrics.orphans.length,
    brokenCount: payload.edges.filter((e) => e.isBroken).length,
  };
}
```

Create `src/client/features/audit/graph/AuditGraphView.tsx` — builds the graph, computes metrics + summary, renders the summary header and a Sigma container. Mount Sigma in a `useEffect` against a ref; seed positions with ForceAtlas2 (synchronous in Phase 1; the web-worker upgrade is a later task):

```typescript
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
    () => payload.nodes.find((n) => n.url === payload.meta.startUrl)?.id
      ?? payload.nodes[0]?.id ?? "",
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
        {summary.pagesCrawled} pages · {summary.orphanCount} orphan
        {summary.orphanCount === 1 ? "" : "s"} · {summary.brokenCount} broken
        internal link{summary.brokenCount === 1 ? "" : "s"}
      </div>
      <div
        ref={containerRef}
        className="h-[600px] w-full rounded-lg border border-base-300"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/client/features/audit/graph/graphSummary.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the Graph tab**

In `src/client/features/audit/results/ResultsView.tsx`: add `"graph"` to the `ResultsTab` union type, add `{ tab: "graph", label: "Graph" }` to the tabs array, and render `<AuditGraphView payload={graphPayload} />` when `activeTab === "graph"`. Pass `graphPayload` down as a new prop on `ResultsView` (typed `AuditGraphPayload | null`); when null, render a "Graph unavailable for this run" message.

- [ ] **Step 6: Fetch graph data in the route**

In `src/routes/_project/p/$projectId/audit/index.tsx`: add a query mirroring `resultsQuery`:

```typescript
const graphQuery = useQuery({
  queryKey: ["audit-graph", projectId, auditId],
  queryFn: () => getAuditGraph({ data: { projectId, auditId } }),
  enabled: isComplete,
});
```

Import `getAuditGraph` from `@/serverFunctions/audit`, and pass `graphPayload={graphQuery.data ?? null}` into `<ResultsView>`.

- [ ] **Step 7: Verify in the running app**

Run an audit (with content capture on for later phases) on a small site at `http://localhost:3001`, open the audit, click the **Graph** tab, confirm nodes/edges render and the summary counts look right.

- [ ] **Step 8: Type-check + commit**

Run: `pnpm types:check` (expect no errors), then:

```bash
git add src/client/features/audit/graph/ src/client/features/audit/results/ResultsView.tsx "src/routes/_project/p/\$projectId/audit/index.tsx"
git commit -m "feat(audit): add interactive site graph tab to audit results"
```

---

## Self-review notes

- **Spec coverage (Phase 1):** edges table + content key (T1), anchor/text extraction (T2–T3), edge persistence (T4), R2 text gated by `captureContent` (T5), `resolve-graph` durable step with `toPageId`/`isBroken` (T6), `getAuditGraph` API without text (T7), Sigma+graphology graph with orphan/depth/PageRank metrics (T8–T9). Phase 2 (insights panel, CSV, broken-link table) and Phase 3 (Louvain coloring, Graphify export/import) are deliberately out of this plan and get their own plans.
- **Type consistency:** `internalLinkDetails`, `cleanedText`, `EdgeRow`, `AuditGraphNode/Edge/Payload`, `buildEdgeRows`/`resolveEdges`/`buildAuditGraphPayload`, `buildGraphologyGraph`/`computeGraphMetrics` are defined once and consumed with matching signatures.
- **Verified during planning:** `audits.startUrl` maps to column `start_url` (T7 code is correct); vitest is `environment: "node"`, `include: ["src/**/*.test.ts"]` with no jsdom/testing-library — so T9 tests a pure `buildGraphSummary` in `.test.ts` and verifies rendering manually, avoiding new DOM test infra.
- **Assumptions to verify during execution:** the precise inline page-mapping in `siteAuditWorkflowCrawl.ts` (T3) — preserve existing h-count/`isIndexable` logic, only add the two fields; that `<ResultsView>` receives data via props from the route (T9 step 5–6) as the existing `pages`/`lighthouse` do.
- **Scope reminder:** node side-panel, search, filters, web-worker layout, and community coloring are intentionally deferred — Phase 1 ships a rendered, summarised graph. They belong to the Phase 1 polish backlog or Phase 2/3 plans.
