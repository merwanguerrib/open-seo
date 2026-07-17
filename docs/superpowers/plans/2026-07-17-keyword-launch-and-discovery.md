# Keyword-Driven Article Launch & Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users queue article topics directly from Saved Keywords / Rank Tracking, and discover new topics from competitor content gaps and from expansion of already-covered keywords.

**Architecture:** Everything feeds the existing `content_keywords` → `content_topics` pipeline (built separately, already in the tree — see `src/server/features/content/repositories/ContentStrategyRepository.ts` and `contentStrategyImports.ts`). Direct launch upserts into `content_keywords` with `status: "planned"` and queues immediately. Competitor/related discovery insert-only into `content_keywords` with `status: "suggested"`, which sits outside the existing `queueKeywords()` filter (`status === "planned"`) until a human reviews and imports it.

**Tech Stack:** TanStack Start server functions, Drizzle ORM (SQLite/D1 + Postgres dual schema), DataForSEO Labs API (`serpCompetitors`, `rankedKeywords`, `related`), TanStack Table (`AppDataTable`/`useAppTable`), Vitest.

## Global Constraints

- Every schema change to `src/db/content.schema.ts` must be mirrored in `src/db/pg/content.schema.ts` with an identical enum/column — `src/db/schema-parity.test.ts` enforces this and must stay green.
- All DataForSEO calls pass `creditFeature: "content"` explicitly (this is content-pipeline spend, not domain/rank-tracking spend — see existing precedent in `topicDiscovery.ts`'s `client.keywords.suggestions` calls).
- Discovery functions never throw on a single failed lookup — wrap each per-domain/per-keyword DataForSEO call in try/catch and continue, matching `topicDiscovery.ts`'s `discoverExpansionTopics`.
- Never bypass `runBatch`/`executeInBatches` for multi-row writes — this repo requires D1/Postgres dual-backend compatibility (see `src/db/runBatch.ts`); the repository methods below use simple sequential `for` loops matching the existing `ContentStrategyRepository` style (which is not batched — follow that file's existing convention, don't introduce a new batching pattern for this feature).
- Route file paths in this codebase use TanStack Router file-based routing; `$projectId` in a path is a literal directory/file name (not a shell variable) — always quote it in shell commands.

---

## File Structure

**New files:**
- `src/server/features/content/services/competitorDiscovery.ts` — competitor domain detection + ranked-keyword gap discovery
- `src/server/features/content/services/competitorDiscovery.test.ts`
- `src/server/features/content/services/relatedDiscovery.ts` — related-keyword discovery for covered keywords
- `src/server/features/content/services/relatedDiscovery.test.ts`

**Modified files:**
- `src/db/content.schema.ts`, `src/db/pg/content.schema.ts` — enum extensions
- `src/server/features/content/repositories/ContentStrategyRepository.ts` — add `insertSuggestedKeywords`, `markKeywordsPlanned`, `markKeywordsIgnored`
- `src/server/features/rank-tracking/repositories/RankTrackingRepository.ts` — add `listTopTrackedKeywordStrings`
- `src/server/features/content/services/topicDiscovery.ts` — export `readSuggestion`
- `src/server/features/content/services/contentStrategyImports.ts` — export `queueKeywords`, add `launchFromKeywords`
- `src/server/features/content/services/ContentStrategyService.ts` — wire new service functions
- `src/types/schemas/contentStrategy.ts` — new zod schemas
- `src/serverFunctions/contentStrategy.ts` — new server functions
- `src/client/features/saved-keywords/SavedKeywordsBulkActionBar.tsx`, `.../saved.tsx` — "Generate Article(s)" bulk action
- `src/client/features/rank-tracking/RankTrackingTable.tsx` — "Generate Article(s)" bulk action
- `src/client/features/content/ContentStrategyKeywordsTab.tsx` — Suggestions review section

---

### Task 1: Schema — extend `content_keywords` enums, both dialects

**Files:**
- Modify: `src/db/content.schema.ts:145-224` (the `contentKeywords` table def)
- Modify: `src/db/pg/content.schema.ts:130-173` (the `contentKeywords` table def)
- Test: `src/db/schema-parity.test.ts` (existing, no changes — must stay green)

**Interfaces:**
- Produces: `content_keywords.source` accepts `"competitor" | "related"` in addition to existing values; `content_keywords.status` accepts `"suggested"` in addition to existing values. Both are consumed by every task below.

- [ ] **Step 1: Edit the SQLite schema**

In `src/db/content.schema.ts`, find the `contentKeywords` table definition and change:

```ts
    source: text("source", {
      enum: ["manual", "file", "master_plan"],
    }).notNull(),
```
to
```ts
    source: text("source", {
      enum: ["manual", "file", "master_plan", "competitor", "related"],
    }).notNull(),
```

and change:
```ts
    status: text("status", {
      enum: ["planned", "covered", "ignored"],
    })
```
to
```ts
    status: text("status", {
      enum: ["planned", "covered", "ignored", "suggested"],
    })
```

- [ ] **Step 2: Edit the Postgres mirror identically**

In `src/db/pg/content.schema.ts`, make the exact same two enum edits to the `contentKeywords` table definition (lines ~139-147).

- [ ] **Step 3: Run the schema-parity test**

Run: `npx vitest run src/db/schema-parity.test.ts --reporter=dot`
Expected: PASS (parity test compares structure, not enum values, so this shouldn't break — but run it to confirm nothing else regressed)

- [ ] **Step 4: Regenerate migrations for both dialects**

Run:
```bash
pnpm db:generate:d1
pnpm db:generate:pg
```
Expected: Two new migration files appear under `drizzle/` and `drizzle-pg/` altering the `content_keywords_status_check`/`content_keywords_source` constraints (Postgres) or no-op (SQLite `text` columns don't have a DB-level CHECK for the enum — drizzle-kit may still emit a no-op or comment-only diff; if the D1 command reports "No changes detected", that's correct and expected since SQLite enums are TypeScript-only).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add src/db/content.schema.ts src/db/pg/content.schema.ts drizzle drizzle-pg
git commit -m "feat(content): extend content_keywords source/status enums for competitor+related discovery"
```

---

### Task 2: `RankTrackingRepository.listTopTrackedKeywordStrings`

**Files:**
- Modify: `src/server/features/rank-tracking/repositories/RankTrackingRepository.ts`
- Test: `src/server/features/rank-tracking/repositories/RankTrackingRepository.test.ts` (create if it doesn't exist; check first — if it exists, add to it)

**Interfaces:**
- Consumes: `db` from `@/db`, `rankTrackingKeywords`, `rankTrackingConfigs` from `@/db/schema` (already imported in this file)
- Produces: `RankTrackingRepository.listTopTrackedKeywordStrings(projectId: string, limit: number): Promise<string[]>` — used by Task 7 (competitor discovery seeds)

- [ ] **Step 1: Check for an existing test file**

Run: `ls src/server/features/rank-tracking/repositories/RankTrackingRepository.test.ts`

If it doesn't exist, skip straight to Step 2 with a manual verification step instead of a unit test (this repository has no existing test file, so introducing one is out of scope for this task — a `oxlint`/`tsc` pass plus the manual check in Step 4 is the existing convention for this file).

- [ ] **Step 2: Add the function**

In `src/server/features/rank-tracking/repositories/RankTrackingRepository.ts`, add near `getKeywordsForConfig`:

```ts
async function listTopTrackedKeywordStrings(
  projectId: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ keyword: rankTrackingKeywords.keyword })
    .from(rankTrackingKeywords)
    .innerJoin(
      rankTrackingConfigs,
      eq(rankTrackingConfigs.id, rankTrackingKeywords.configId),
    )
    .where(eq(rankTrackingConfigs.projectId, projectId))
    .orderBy(desc(rankTrackingKeywords.searchVolume))
    .limit(limit);
  return rows.map((row) => row.keyword);
}
```

Add `listTopTrackedKeywordStrings` to the `RankTrackingRepository` export object at the bottom of the file.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (`eq`, `desc`, `rankTrackingKeywords`, `rankTrackingConfigs` are already imported at the top of this file)

- [ ] **Step 4: Manual verification**

Run: `npx tsx -e "
import('./src/server/features/rank-tracking/repositories/RankTrackingRepository.ts').then(async (m) => {
  console.log('function exists:', typeof m.RankTrackingRepository.listTopTrackedKeywordStrings);
});
"`
Expected: `function exists: function` (confirms the export wired correctly; this file can't run against a real D1 binding outside the Workers runtime, so this is a load-only smoke check — Task 7's own test exercises the real query indirectly via mocks)

- [ ] **Step 5: Commit**

```bash
git add src/server/features/rank-tracking/repositories/RankTrackingRepository.ts
git commit -m "feat(rank-tracking): add listTopTrackedKeywordStrings for competitor-discovery seeding"
```

---

### Task 3: `contentStrategyImports.ts` — export `queueKeywords`, add `launchFromKeywords`

**Files:**
- Modify: `src/server/features/content/services/contentStrategyImports.ts`
- Test: `src/server/features/content/services/contentStrategyImports.test.ts` (create — check first if a test file already exists for this module and extend it instead)

**Interfaces:**
- Consumes: `ContentStrategyRepository.upsertKeywords`, `ContentStrategyRepository.markKeywordsPlanned` (added in Task 8), `normalizeKeyword` from `contentStrategyParsing.ts`
- Produces: `launchFromKeywords(input: { projectId: string; sourceName: "Saved Keywords" | "Rank Tracking"; keywords: Array<{ keyword: string; searchVolume: number | null }> }): Promise<{ imported: number; queued: number }>` — consumed by Task 4's server function

- [ ] **Step 1: Check for an existing test file, write the failing test**

Run: `ls src/server/features/content/services/contentStrategyImports.test.ts`

If none exists, create it:

```ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listKeywords: vi.fn(),
  upsertKeywords: vi.fn(),
  markKeywordsPlanned: vi.fn(),
  markKeywordsIgnored: vi.fn(),
  getExistingKeywords: vi.fn(),
  getOrCreateCluster: vi.fn(),
  insertTopics: vi.fn(),
}));

vi.mock(
  "@/server/features/content/repositories/ContentStrategyRepository",
  () => ({
    ContentStrategyRepository: {
      listKeywords: mocks.listKeywords,
      upsertKeywords: mocks.upsertKeywords,
      markKeywordsPlanned: mocks.markKeywordsPlanned,
      markKeywordsIgnored: mocks.markKeywordsIgnored,
    },
  }),
);
vi.mock("@/server/features/content/repositories/ContentPlanRepository", () => ({
  ContentPlanRepository: {
    getExistingKeywords: mocks.getExistingKeywords,
    getOrCreateCluster: mocks.getOrCreateCluster,
    insertTopics: mocks.insertTopics,
  },
}));

describe("launchFromKeywords", () => {
  it("makes the highest-volume keyword the pillar when launching multiple", async () => {
    mocks.listKeywords.mockResolvedValue([]);
    mocks.getExistingKeywords.mockResolvedValue(new Set());
    mocks.getOrCreateCluster.mockResolvedValue("cluster-1");
    mocks.upsertKeywords.mockImplementation(async (rows) =>
      rows.map((row: Record<string, unknown>, i: number) => ({
        id: `kw-${i}`,
        ...row,
      })),
    );

    const { launchFromKeywords } = await import("./contentStrategyImports");
    const result = await launchFromKeywords({
      projectId: "p1",
      sourceName: "Saved Keywords",
      keywords: [
        { keyword: "low volume kw", searchVolume: 10 },
        { keyword: "high volume kw", searchVolume: 500 },
      ],
    });

    expect(mocks.upsertKeywords).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: "high volume kw",
          role: "pillar",
          clusterName: "high volume kw",
        }),
        expect.objectContaining({
          keyword: "low volume kw",
          role: "satellite",
          clusterName: "high volume kw",
        }),
      ]),
    );
    expect(result.imported).toBe(2);
  });

  it("uses role standalone for a single launched keyword", async () => {
    mocks.listKeywords.mockResolvedValue([]);
    mocks.getExistingKeywords.mockResolvedValue(new Set());
    mocks.upsertKeywords.mockImplementation(async (rows) =>
      rows.map((row: Record<string, unknown>, i: number) => ({
        id: `kw-${i}`,
        ...row,
      })),
    );

    const { launchFromKeywords } = await import("./contentStrategyImports");
    await launchFromKeywords({
      projectId: "p1",
      sourceName: "Rank Tracking",
      keywords: [{ keyword: "solo keyword", searchVolume: 100 }],
    });

    expect(mocks.upsertKeywords).toHaveBeenCalledWith([
      expect.objectContaining({
        keyword: "solo keyword",
        role: "standalone",
        clusterName: null,
        sourceName: "Rank Tracking",
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/features/content/services/contentStrategyImports.test.ts --reporter=verbose`
Expected: FAIL — `launchFromKeywords is not a function` or similar (function doesn't exist yet)

- [ ] **Step 3: Export `queueKeywords` and add `launchFromKeywords`**

In `src/server/features/content/services/contentStrategyImports.ts`:

Change `async function queueKeywords(` to `export async function queueKeywords(`.

Add this new function (place it after `queueKeywords`, before `mergeKeywordRole`):

```ts
export async function launchFromKeywords(input: {
  projectId: string;
  sourceName: "Saved Keywords" | "Rank Tracking";
  keywords: Array<{ keyword: string; searchVolume: number | null }>;
}): Promise<{ imported: number; queued: number }> {
  if (input.keywords.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Select at least one keyword.");
  }

  const pillar =
    input.keywords.length > 1
      ? input.keywords.reduce((max, entry) =>
          (entry.searchVolume ?? 0) > (max.searchVolume ?? 0) ? entry : max,
        )
      : null;
  const clusterName = pillar?.keyword ?? null;

  const existingByKeyword = new Map(
    (await ContentStrategyRepository.listKeywords(input.projectId)).map(
      (keyword) => [keyword.normalizedKeyword, keyword],
    ),
  );

  const rows = await ContentStrategyRepository.upsertKeywords(
    input.keywords.map((entry) => {
      const normalizedKeyword = normalizeKeyword(entry.keyword);
      const existing = existingByKeyword.get(normalizedKeyword);
      const isPillar = pillar !== null && entry.keyword === pillar.keyword;
      return {
        projectId: input.projectId,
        keyword: entry.keyword,
        normalizedKeyword,
        source: "manual" as const,
        sourceName: input.sourceName,
        role:
          pillar === null
            ? ("standalone" as const)
            : isPillar
              ? ("pillar" as const)
              : ("satellite" as const),
        clusterName,
        targetUrl: existing?.targetUrl ?? null,
        title: existing?.title ?? null,
        intent: existing?.intent ?? null,
        priority: existing?.priority ?? null,
        searchVolume: entry.searchVolume ?? existing?.searchVolume ?? null,
        difficulty: existing?.difficulty ?? null,
      };
    }),
  );

  // A keyword may already exist with a non-"planned" status (e.g. a
  // discovery "suggested" row the user never reviewed) — launching it is a
  // deliberate action, so force it into the queueable state regardless.
  await ContentStrategyRepository.markKeywordsPlanned(rows.map((row) => row.id));
  const queued = await queueKeywords(
    rows.map((row) => ({ ...row, status: "planned" as const })),
  );
  return { imported: rows.length, queued };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/features/content/services/contentStrategyImports.test.ts --reporter=verbose`
Expected: PASS (2 tests) — note this step depends on Task 8's `markKeywordsPlanned` existing; if running this task before Task 8, stub it inline in the test mock as shown above (already done) and add the real repository method now too, minimally:

In `src/server/features/content/repositories/ContentStrategyRepository.ts`, add (this duplicates part of Task 8 — do it now so this task's code actually compiles; Task 8 will add the sibling `markKeywordsIgnored` and its own test):

```ts
async function markKeywordsPlanned(keywordIds: string[]): Promise<void> {
  if (keywordIds.length === 0) return;
  await db
    .update(contentKeywords)
    .set({ status: "planned", ...touchUpdatedAt })
    .where(inArray(contentKeywords.id, keywordIds));
}
```

Add `markKeywordsPlanned` to the `ContentStrategyRepository` export object.

- [ ] **Step 5: Run the full test file again**

Run: `npx vitest run src/server/features/content/services/contentStrategyImports.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/server/features/content/services/contentStrategyImports.ts src/server/features/content/services/contentStrategyImports.test.ts src/server/features/content/repositories/ContentStrategyRepository.ts
git commit -m "feat(content): add launchFromKeywords for direct article launch from a keyword selection"
```

---

### Task 4: Server function `launchArticlesFromKeywords`

**Files:**
- Modify: `src/types/schemas/contentStrategy.ts`
- Modify: `src/serverFunctions/contentStrategy.ts`
- Modify: `src/server/features/content/services/ContentStrategyService.ts`

**Interfaces:**
- Consumes: `launchFromKeywords` from Task 3
- Produces: `launchArticlesFromKeywords({ data: { projectId, sourceName, keywords } })` TanStack server function, consumed by Task 5 and Task 6 client code

- [ ] **Step 1: Add the zod schema**

In `src/types/schemas/contentStrategy.ts`, add:

```ts
export const launchArticlesFromKeywordsSchema = z.object({
  projectId: z.string().min(1),
  sourceName: z.enum(["Saved Keywords", "Rank Tracking"]),
  keywords: z
    .array(
      z.object({
        keyword: z.string().min(1).max(200),
        searchVolume: z.number().int().nonnegative().nullable(),
      }),
    )
    .min(1)
    .max(50),
});
```

- [ ] **Step 2: Wire the service facade**

In `src/server/features/content/services/ContentStrategyService.ts`, add `launchFromKeywords` to both the import list and the exported object:

```ts
import {
  deleteDocument,
  importKeywords,
  importUrls,
  launchFromKeywords,
  saveDocument,
} from "@/server/features/content/services/contentStrategyImports";
```
```ts
export const ContentStrategyService = {
  importKeywords,
  saveDocument,
  deleteDocument,
  importUrls,
  launchFromKeywords,
  analyzeExistingContent,
  getWorkspace,
  buildPromptContext,
};
```

- [ ] **Step 3: Add the server function**

In `src/serverFunctions/contentStrategy.ts`, add the import to the schema list and the new export:

```ts
import {
  analyzeExistingContentSchema,
  deleteContentDocumentSchema,
  getContentStrategyWorkspaceSchema,
  importContentKeywordsSchema,
  importContentUrlsSchema,
  launchArticlesFromKeywordsSchema,
  saveContentDocumentSchema,
} from "@/types/schemas/contentStrategy";
```
```ts
export const launchArticlesFromKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) =>
    launchArticlesFromKeywordsSchema.parse(data),
  )
  .handler(async ({ data, context }) => {
    return ContentStrategyService.launchFromKeywords({
      projectId: context.projectId,
      sourceName: data.sourceName,
      keywords: data.keywords,
    });
  });
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Run the existing content-strategy test suite to confirm no regression**

Run: `npx vitest run src/server/features/content --reporter=dot`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/types/schemas/contentStrategy.ts src/serverFunctions/contentStrategy.ts src/server/features/content/services/ContentStrategyService.ts
git commit -m "feat(content): expose launchArticlesFromKeywords server function"
```

---

### Task 5: Saved Keywords — "Generate Article(s)" bulk action

**Files:**
- Modify: `src/client/features/saved-keywords/SavedKeywordsBulkActionBar.tsx`
- Modify: `src/routes/_project/p/$projectId/saved.tsx`

**Interfaces:**
- Consumes: `launchArticlesFromKeywords` server function (Task 4), existing `selectedRows: SavedKeywordRow[]` / `selectedCount` state already in `saved.tsx`

- [ ] **Step 1: Add the button to the bulk action bar**

In `src/client/features/saved-keywords/SavedKeywordsBulkActionBar.tsx`, add a new prop `onGenerateArticles: () => void` to the props type, and a new `TableBulkActionButton` before the "Tag" button:

```tsx
import { Copy, FileDown, FileText, Sheet, Swords, Tags, Trash2 } from "lucide-react";
```
(add `FileText` to the existing lucide-react import)

```tsx
export function SavedKeywordsBulkActionBar({
  selectedCount,
  onGenerateArticles,
  onCopy,
  onOpenTags,
  onAnalyzeCompetitors,
  onExportCsv,
  onExportSheets,
  onDelete,
  onClear,
  exportingSelection,
}: {
  selectedCount: number;
  onGenerateArticles: () => void;
  onCopy: () => void;
  onOpenTags: () => void;
  onAnalyzeCompetitors: () => void;
  onExportCsv: () => void;
  onExportSheets: () => void;
  onDelete: () => void;
  onClear: () => void;
  exportingSelection: "csv" | "sheets" | null;
}) {
```

Inside the `actions` JSX, in the first `<div className="flex items-center gap-0.5 px-1.5">` block, add before the "Tag" `TableBulkActionButton`:

```tsx
            <TableBulkActionButton
              icon={<FileText className="size-3.5" />}
              onClick={onGenerateArticles}
            >
              Generate Article{selectedCount !== 1 ? "s" : ""}
            </TableBulkActionButton>
```

- [ ] **Step 2: Wire the mutation and prop in the route**

In `src/routes/_project/p/$projectId/saved.tsx`, add the import:

```ts
import { launchArticlesFromKeywords } from "@/serverFunctions/contentStrategy";
```

Add a mutation next to `removeMutation` (same pattern — `useMutation` + `invalidateSavedKeywords`/toast):

```ts
const launchArticlesMutation = useMutation({
  mutationFn: (keywords: Array<{ keyword: string; searchVolume: number | null }>) =>
    launchArticlesFromKeywords({
      data: { projectId, sourceName: "Saved Keywords", keywords },
    }),
  onSuccess: (result) => {
    setRowSelection({});
    toast.success(`Queued ${result.queued} new topic${result.queued !== 1 ? "s" : ""}`);
  },
  onError: (error) =>
    toast.error(getStandardErrorMessage(error, "Could not queue articles")),
});
```

Wire the new prop on `<SavedKeywordsBulkActionBar ...>` (next to `onAnalyzeCompetitors`):

```tsx
          onGenerateArticles={() =>
            launchArticlesMutation.mutate(
              selectedRows.map((row) => ({
                keyword: row.keyword,
                searchVolume: row.searchVolume,
              })),
            )
          }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification**

Start the dev server (`pnpm dev`), open a project's Saved Keywords page, select 2+ rows with different search volumes, click "Generate Articles", and confirm:
- A success toast reading "Queued N new topic(s)" appears
- The `content_topics` table gains rows for these keywords (check via the Autopilot page's topic queue, or query the local D1 sqlite file directly)
- Selection clears after the action

- [ ] **Step 5: Commit**

```bash
git add src/client/features/saved-keywords/SavedKeywordsBulkActionBar.tsx "src/routes/_project/p/\$projectId/saved.tsx"
git commit -m "feat(content): add Generate Article(s) bulk action to Saved Keywords"
```

---

### Task 6: Rank Tracking — "Generate Article(s)" bulk action

**Files:**
- Modify: `src/client/features/rank-tracking/RankTrackingTable.tsx`

**Interfaces:**
- Consumes: `launchArticlesFromKeywords` server function (Task 4), existing `selectedRows`/`selectedRankRows`/`selectedCount` already computed in this file from `table.getSelectedRowModel()`

- [ ] **Step 1: Add the mutation and button**

In `src/client/features/rank-tracking/RankTrackingTable.tsx`:

Add imports:
```ts
import { FileText } from "lucide-react";
import { launchArticlesFromKeywords } from "@/serverFunctions/contentStrategy";
```
(merge `FileText` into the existing `lucide-react` import line)

Add a mutation next to `removeMutation`:

```ts
const launchArticlesMutation = useMutation({
  mutationFn: () =>
    launchArticlesFromKeywords({
      data: {
        projectId,
        sourceName: "Rank Tracking",
        keywords: selectedRankRows.map((row) => ({
          keyword: row.keyword,
          searchVolume: row.searchVolume,
        })),
      },
    }),
  onSuccess: (result) => {
    table.resetRowSelection();
    toast.success(
      `Queued ${result.queued} new topic${result.queued !== 1 ? "s" : ""}`,
    );
  },
  onError: (error) =>
    toast.error(getStandardErrorMessage(error, "Could not queue articles")),
});
```

In the `<TableBulkActionBar actions={...}>` JSX, add before the "Remove" button:

```tsx
            <TableBulkActionButton
              icon={<FileText className="size-3.5" />}
              onClick={() => launchArticlesMutation.mutate()}
            >
              Generate Article{selectedCount !== 1 ? "s" : ""}
            </TableBulkActionButton>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Manual verification**

Start the dev server, open a project's Rank Tracking config detail page, select 2+ tracked keywords, click "Generate Articles", confirm the same toast/queueing behavior as Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/client/features/rank-tracking/RankTrackingTable.tsx
git commit -m "feat(content): add Generate Article(s) bulk action to Rank Tracking"
```

---

### Task 7: `ContentStrategyRepository.insertSuggestedKeywords`

**Files:**
- Modify: `src/server/features/content/repositories/ContentStrategyRepository.ts`

**Interfaces:**
- Produces: `ContentStrategyRepository.insertSuggestedKeywords(rows: Array<{projectId, keyword, normalizedKeyword, source: "competitor" | "related", sourceName: string, role: ContentKeywordRow["role"], clusterName: string | null, searchVolume: number | null, difficulty: number | null}>): Promise<void>` — insert-only (never overwrites an existing row's status), consumed by Task 9 and Task 11

- [ ] **Step 1: Add the function**

In `src/server/features/content/repositories/ContentStrategyRepository.ts`, add after `upsertKeywords`:

```ts
/** Insert-only: discovery suggestions must never downgrade an existing
 *  keyword's status (e.g. a row already "planned" or "covered" stays as-is
 *  if rediscovered — onConflictDoNothing is the guard). */
async function insertSuggestedKeywords(
  rows: Array<{
    projectId: string;
    keyword: string;
    normalizedKeyword: string;
    source: "competitor" | "related";
    sourceName: string;
    role: ContentKeywordRow["role"];
    clusterName: string | null;
    searchVolume: number | null;
    difficulty: number | null;
  }>,
): Promise<void> {
  for (const row of rows) {
    await db
      .insert(contentKeywords)
      .values({
        id: crypto.randomUUID(),
        projectId: row.projectId,
        keyword: row.keyword,
        normalizedKeyword: row.normalizedKeyword,
        source: row.source,
        sourceName: row.sourceName,
        status: "suggested",
        role: row.role,
        clusterName: row.clusterName,
        targetUrl: null,
        title: null,
        intent: null,
        priority: null,
        searchVolume: row.searchVolume,
        difficulty: row.difficulty,
      })
      .onConflictDoNothing();
  }
}
```

Add `insertSuggestedKeywords` to the `ContentStrategyRepository` export object.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/server/features/content/repositories/ContentStrategyRepository.ts
git commit -m "feat(content): add insert-only ContentStrategyRepository.insertSuggestedKeywords"
```

---

### Task 8: `ContentStrategyRepository.markKeywordsIgnored` + finish Task 3's `markKeywordsPlanned`

**Files:**
- Modify: `src/server/features/content/repositories/ContentStrategyRepository.ts`
- Test: `src/server/features/content/repositories/ContentStrategyRepository.test.ts` (create if none exists — check first)

**Interfaces:**
- Produces: `ContentStrategyRepository.markKeywordsIgnored(keywordIds: string[]): Promise<void>`, consumed by Task 12

- [ ] **Step 1: Confirm `markKeywordsPlanned` exists**

Task 3 already added `markKeywordsPlanned` (needed to compile `launchFromKeywords`). Run:

Run: `grep -n "markKeywordsPlanned" src/server/features/content/repositories/ContentStrategyRepository.ts`
Expected: two matches (the function definition and its entry in the export object)

If missing, add it now exactly as shown in Task 3 Step 4.

- [ ] **Step 2: Add `markKeywordsIgnored`**

Add right after `markKeywordsPlanned` (mirrors `markKeywordsCovered`, already in this file):

```ts
async function markKeywordsIgnored(keywordIds: string[]): Promise<void> {
  if (keywordIds.length === 0) return;
  await db
    .update(contentKeywords)
    .set({ status: "ignored", ...touchUpdatedAt })
    .where(inArray(contentKeywords.id, keywordIds));
}
```

Add `markKeywordsIgnored` to the export object.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/server/features/content/repositories/ContentStrategyRepository.ts
git commit -m "feat(content): add ContentStrategyRepository.markKeywordsIgnored"
```

---

### Task 9: `competitorDiscovery.ts`

**Files:**
- Create: `src/server/features/content/services/competitorDiscovery.ts`
- Create: `src/server/features/content/services/competitorDiscovery.test.ts`

**Interfaces:**
- Consumes: `KeywordResearchRepository.listTopSavedKeywordStrings`, `RankTrackingRepository.listTopTrackedKeywordStrings` (Task 2), `createDataforseoClient`, `mapKeywordItem` from `src/server/features/domain/services/domainKeywordMapper.ts`, `normalizeDomainInput` from `@/server/lib/domainUtils`, `normalizeKeyword` from `contentStrategyParsing.ts`, `ContentStrategyRepository.listKeywords` / `insertSuggestedKeywords` (Task 7)
- Produces: `tallyCompetitorDomains(competitorSets: string[][], excludeDomain: string | null): string[]` (pure, exported for the test), `discoverCompetitorKeywords(input): Promise<{ suggested: number }>` — consumed by Task 10

- [ ] **Step 1: Write the failing test for the pure tally function**

Create `src/server/features/content/services/competitorDiscovery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tallyCompetitorDomains } from "./competitorDiscovery";

describe("tallyCompetitorDomains", () => {
  it("ranks domains by how many keyword-competitor-sets they appear in", () => {
    const result = tallyCompetitorDomains(
      [
        ["a.com", "b.com", "c.com"],
        ["a.com", "b.com"],
        ["a.com"],
      ],
      null,
    );
    expect(result).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("counts a domain once per set even if repeated within it", () => {
    const result = tallyCompetitorDomains(
      [
        ["a.com", "a.com", "b.com"],
        ["a.com"],
      ],
      null,
    );
    expect(result).toEqual(["a.com", "b.com"]);
  });

  it("excludes the project's own domain", () => {
    const result = tallyCompetitorDomains(
      [["a.com", "self.com"], ["self.com"]],
      "self.com",
    );
    expect(result).toEqual(["a.com"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/features/content/services/competitorDiscovery.test.ts --reporter=verbose`
Expected: FAIL — cannot find module `./competitorDiscovery`

- [ ] **Step 3: Write `competitorDiscovery.ts`**

Create `src/server/features/content/services/competitorDiscovery.ts`:

```ts
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { KeywordResearchRepository } from "@/server/features/keywords/repositories/KeywordResearchRepository";
import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { ContentStrategyRepository } from "@/server/features/content/repositories/ContentStrategyRepository";
import { normalizeKeyword } from "@/server/features/content/services/contentStrategyParsing";
import { mapKeywordItem } from "@/server/features/domain/services/domainKeywordMapper";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { normalizeDomainInput } from "@/server/lib/domainUtils";

const MAX_SEED_KEYWORDS = 20;
const MAX_COMPETITOR_DOMAINS = 5;
const RANKED_KEYWORDS_PER_DOMAIN = 50;

/** Ranks domains by how many of the input keyword-competitor sets they
 *  appear in (deduped per set, so one keyword can't inflate a domain's
 *  count on its own). */
export function tallyCompetitorDomains(
  competitorSets: string[][],
  excludeDomain: string | null,
): string[] {
  const counts = new Map<string, number>();
  for (const domains of competitorSets) {
    for (const domain of new Set(domains)) {
      if (excludeDomain && domain === excludeDomain) continue;
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([domain]) => domain);
}

/** Discovers content-gap keywords from the project's most frequent SERP
 *  competitors. Landed as `status: "suggested"` — a human reviews before
 *  they're queued as topics. On-demand only (button-triggered), not cron. */
export async function discoverCompetitorKeywords(input: {
  projectId: string;
  projectDomain: string | null;
  billingCustomer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
  plan: { minSearchVolume: number; maxDifficulty: number };
}): Promise<{ suggested: number }> {
  const [savedSeeds, trackedSeeds] = await Promise.all([
    KeywordResearchRepository.listTopSavedKeywordStrings(
      input.projectId,
      MAX_SEED_KEYWORDS,
    ),
    RankTrackingRepository.listTopTrackedKeywordStrings(
      input.projectId,
      MAX_SEED_KEYWORDS,
    ),
  ]);
  const seeds = [...new Set([...savedSeeds, ...trackedSeeds])].slice(
    0,
    MAX_SEED_KEYWORDS,
  );
  if (seeds.length === 0) return { suggested: 0 };

  const client = createDataforseoClient(input.billingCustomer);

  let selfDomain: string | null = null;
  if (input.projectDomain) {
    try {
      selfDomain = normalizeDomainInput(input.projectDomain, false);
    } catch {
      selfDomain = null;
    }
  }

  let competitorItems: Array<{ domain?: string | null }>;
  try {
    competitorItems = await client.labs.serpCompetitors({
      keywords: seeds,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      itemTypes: ["organic", "local_pack"],
      limit: 50,
      creditFeature: "content",
    });
  } catch (error) {
    console.error("[competitor-discovery] serpCompetitors failed:", error);
    return { suggested: 0 };
  }

  const domains = tallyCompetitorDomains(
    [
      competitorItems
        .map((item) => item.domain)
        .filter((domain): domain is string => Boolean(domain)),
    ],
    selfDomain,
  ).slice(0, MAX_COMPETITOR_DOMAINS);
  if (domains.length === 0) return { suggested: 0 };

  const existingKeywords = new Set(
    (await ContentStrategyRepository.listKeywords(input.projectId)).map(
      (keyword) => keyword.normalizedKeyword,
    ),
  );

  const rows: Parameters<
    typeof ContentStrategyRepository.insertSuggestedKeywords
  >[0] = [];

  for (const domain of domains) {
    try {
      const response = await client.domain.rankedKeywords({
        target: domain,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        limit: RANKED_KEYWORDS_PER_DOMAIN,
        creditFeature: "content",
      });
      for (const item of response.items) {
        const mapped = mapKeywordItem(item);
        if (!mapped) continue;
        const normalizedKeyword = normalizeKeyword(mapped.keyword);
        if (existingKeywords.has(normalizedKeyword)) continue;
        if (
          mapped.searchVolume != null &&
          mapped.searchVolume < input.plan.minSearchVolume
        ) {
          continue;
        }
        if (
          mapped.keywordDifficulty != null &&
          mapped.keywordDifficulty > input.plan.maxDifficulty
        ) {
          continue;
        }
        existingKeywords.add(normalizedKeyword);
        rows.push({
          projectId: input.projectId,
          keyword: mapped.keyword,
          normalizedKeyword,
          source: "competitor",
          sourceName: `competitor:${domain}`,
          role: "standalone",
          clusterName: null,
          searchVolume: mapped.searchVolume,
          difficulty: mapped.keywordDifficulty,
        });
      }
    } catch (error) {
      console.error(
        `[competitor-discovery] rankedKeywords failed for ${domain}:`,
        error,
      );
    }
  }

  if (rows.length === 0) return { suggested: 0 };
  await ContentStrategyRepository.insertSuggestedKeywords(rows);
  return { suggested: rows.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/features/content/services/competitorDiscovery.test.ts --reporter=verbose`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors — pay attention to `client.labs.serpCompetitors`/`client.domain.rankedKeywords` return types matching what's destructured; if TS complains about the `competitorItems` type annotation, remove the explicit `Array<{ domain?: string | null }>` annotation and let it infer from `createDataforseoClient`'s return type instead

- [ ] **Step 6: Commit**

```bash
git add src/server/features/content/services/competitorDiscovery.ts src/server/features/content/services/competitorDiscovery.test.ts
git commit -m "feat(content): add competitor keyword gap discovery"
```

---

### Task 10: Server function `runCompetitorDiscovery`

**Files:**
- Modify: `src/types/schemas/contentStrategy.ts`
- Modify: `src/server/features/content/services/ContentStrategyService.ts`
- Modify: `src/serverFunctions/contentStrategy.ts`

**Interfaces:**
- Consumes: `discoverCompetitorKeywords` from Task 9, `ContentPlanRepository.getOrCreatePlan` (existing)

- [ ] **Step 1: Add the zod schema**

In `src/types/schemas/contentStrategy.ts`:

```ts
export const runCompetitorDiscoverySchema = z.object({
  projectId: z.string().min(1),
});
```

- [ ] **Step 2: Add a thin wrapper in `ContentStrategyService.ts`**

Add the imports (this file has no `BillingCustomerContext` import yet — add it as a new top-level type import):
```ts
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { ContentPlanRepository } from "@/server/features/content/repositories/ContentPlanRepository";
import { discoverCompetitorKeywords } from "@/server/features/content/services/competitorDiscovery";
```

Add a new exported function above `export const ContentStrategyService = {`:

```ts
async function runCompetitorDiscovery(input: {
  projectId: string;
  projectDomain: string | null;
  billingCustomer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
}) {
  const plan = await ContentPlanRepository.getOrCreatePlan(input.projectId);
  return discoverCompetitorKeywords({
    projectId: input.projectId,
    projectDomain: input.projectDomain,
    billingCustomer: input.billingCustomer,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    plan: {
      minSearchVolume: plan.minSearchVolume,
      maxDifficulty: plan.maxDifficulty,
    },
  });
}
```

Add `runCompetitorDiscovery` to the `ContentStrategyService` export object.

- [ ] **Step 3: Add the server function**

In `src/serverFunctions/contentStrategy.ts`, add to the schema import list and add:

```ts
export const runCompetitorDiscovery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => runCompetitorDiscoverySchema.parse(data))
  .handler(async ({ context }) => {
    return ContentStrategyService.runCompetitorDiscovery({
      projectId: context.projectId,
      projectDomain: context.project.domain,
      billingCustomer: context,
      locationCode: context.project.locationCode,
      languageCode: context.project.languageCode,
    });
  });
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/types/schemas/contentStrategy.ts src/server/features/content/services/ContentStrategyService.ts src/serverFunctions/contentStrategy.ts
git commit -m "feat(content): expose runCompetitorDiscovery server function"
```

---

### Task 11: `relatedDiscovery.ts`

**Files:**
- Modify: `src/server/features/content/services/topicDiscovery.ts` (export `readSuggestion`)
- Create: `src/server/features/content/services/relatedDiscovery.ts`
- Create: `src/server/features/content/services/relatedDiscovery.test.ts`

**Interfaces:**
- Consumes: `readSuggestion` (now exported) from `topicDiscovery.ts`, `ContentStrategyRepository.listKeywords` / `insertSuggestedKeywords`, `createDataforseoClient`, `normalizeKeyword`
- Produces: `discoverRelatedKeywords(input): Promise<{ suggested: number }>` — consumed by Task 12

- [ ] **Step 1: Export `readSuggestion`**

In `src/server/features/content/services/topicDiscovery.ts`, change:
```ts
function readSuggestion(raw: unknown): {
```
to
```ts
export function readSuggestion(raw: unknown): {
```

- [ ] **Step 2: Write the failing test**

Create `src/server/features/content/services/relatedDiscovery.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listKeywords: vi.fn(),
  insertSuggestedKeywords: vi.fn(),
  related: vi.fn(),
}));

vi.mock(
  "@/server/features/content/repositories/ContentStrategyRepository",
  () => ({
    ContentStrategyRepository: {
      listKeywords: mocks.listKeywords,
      insertSuggestedKeywords: mocks.insertSuggestedKeywords,
    },
  }),
);
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: () => ({
    keywords: { related: mocks.related },
  }),
}));

describe("discoverRelatedKeywords", () => {
  it("suggests related keywords clustered under the covered keyword they came from", async () => {
    mocks.listKeywords.mockResolvedValue([
      {
        id: "kw-1",
        normalizedKeyword: "best running shoes",
        keyword: "best running shoes",
        status: "covered",
        searchVolume: 1000,
      },
    ]);
    mocks.related.mockResolvedValue([
      {
        keyword_data: {
          keyword: "trail running shoes",
          keyword_info: { search_volume: 300 },
          keyword_properties: { keyword_difficulty: 20 },
        },
      },
    ]);

    const { discoverRelatedKeywords } = await import("./relatedDiscovery");
    const result = await discoverRelatedKeywords({
      projectId: "p1",
      billingCustomer: {
        userId: "u1",
        userEmail: "u@x.com",
        organizationId: "org1",
        projectId: "p1",
      },
      locationCode: 2840,
      languageCode: "en",
      plan: { minSearchVolume: 10, maxDifficulty: 60 },
    });

    expect(mocks.insertSuggestedKeywords).toHaveBeenCalledWith([
      expect.objectContaining({
        keyword: "trail running shoes",
        source: "related",
        role: "satellite",
        clusterName: "best running shoes",
      }),
    ]);
    expect(result.suggested).toBe(1);
  });

  it("returns zero suggestions when there is no covered content yet", async () => {
    mocks.listKeywords.mockResolvedValue([]);
    const { discoverRelatedKeywords } = await import("./relatedDiscovery");
    const result = await discoverRelatedKeywords({
      projectId: "p1",
      billingCustomer: {
        userId: "u1",
        userEmail: "u@x.com",
        organizationId: "org1",
        projectId: "p1",
      },
      locationCode: 2840,
      languageCode: "en",
      plan: { minSearchVolume: 10, maxDifficulty: 60 },
    });
    expect(result).toEqual({ suggested: 0 });
    expect(mocks.insertSuggestedKeywords).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/server/features/content/services/relatedDiscovery.test.ts --reporter=verbose`
Expected: FAIL — cannot find module `./relatedDiscovery`

- [ ] **Step 4: Write `relatedDiscovery.ts`**

Create `src/server/features/content/services/relatedDiscovery.ts`:

```ts
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { ContentStrategyRepository } from "@/server/features/content/repositories/ContentStrategyRepository";
import { normalizeKeyword } from "@/server/features/content/services/contentStrategyParsing";
import { readSuggestion } from "@/server/features/content/services/topicDiscovery";
import { createDataforseoClient } from "@/server/lib/dataforseo";

const MAX_COVERED_SEEDS = 15;
const RELATED_PER_SEED = 20;

/** Discovers cluster-expansion keywords around content the project already
 *  has covered. Landed as `status: "suggested"`, clustered under the
 *  covered keyword they expand — so an imported suggestion joins the
 *  existing content's cluster and gets internal-linked at generation time. */
export async function discoverRelatedKeywords(input: {
  projectId: string;
  billingCustomer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
  plan: { minSearchVolume: number; maxDifficulty: number };
}): Promise<{ suggested: number }> {
  const allKeywords = await ContentStrategyRepository.listKeywords(
    input.projectId,
  );
  const coveredSeeds = allKeywords
    .filter((keyword) => keyword.status === "covered")
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, MAX_COVERED_SEEDS);
  if (coveredSeeds.length === 0) return { suggested: 0 };

  const client = createDataforseoClient(input.billingCustomer);
  const existingKeywords = new Set(
    allKeywords.map((keyword) => keyword.normalizedKeyword),
  );

  const rows: Parameters<
    typeof ContentStrategyRepository.insertSuggestedKeywords
  >[0] = [];

  for (const seed of coveredSeeds) {
    try {
      const items = await client.keywords.related({
        keyword: seed.keyword,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        limit: RELATED_PER_SEED,
        creditFeature: "content",
      });
      for (const item of items) {
        const suggestion = readSuggestion(
          (item as { keyword_data?: unknown }).keyword_data,
        );
        if (!suggestion) continue;
        const normalizedKeyword = normalizeKeyword(suggestion.keyword);
        if (existingKeywords.has(normalizedKeyword)) continue;
        if (
          suggestion.searchVolume != null &&
          suggestion.searchVolume < input.plan.minSearchVolume
        ) {
          continue;
        }
        if (
          suggestion.difficulty != null &&
          suggestion.difficulty > input.plan.maxDifficulty
        ) {
          continue;
        }
        existingKeywords.add(normalizedKeyword);
        rows.push({
          projectId: input.projectId,
          keyword: suggestion.keyword,
          normalizedKeyword,
          source: "related",
          sourceName: `related:${seed.keyword}`,
          role: "satellite",
          clusterName: seed.keyword,
          searchVolume: suggestion.searchVolume,
          difficulty: suggestion.difficulty,
        });
      }
    } catch (error) {
      console.error(
        `[related-discovery] related keywords failed for "${seed.keyword}":`,
        error,
      );
    }
  }

  if (rows.length === 0) return { suggested: 0 };
  await ContentStrategyRepository.insertSuggestedKeywords(rows);
  return { suggested: rows.length };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/server/features/content/services/relatedDiscovery.test.ts --reporter=verbose`
Expected: PASS (2 tests)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Run the topicDiscovery test suite to confirm the export change didn't break anything**

Run: `npx vitest run src/server/features/content/services/topicDiscovery.test.ts --reporter=dot`
Expected: PASS (if this test file doesn't exist, skip — check with `ls` first)

- [ ] **Step 8: Commit**

```bash
git add src/server/features/content/services/topicDiscovery.ts src/server/features/content/services/relatedDiscovery.ts src/server/features/content/services/relatedDiscovery.test.ts
git commit -m "feat(content): add related-keyword discovery for already-covered content"
```

---

### Task 12: Server function `runRelatedDiscovery`

**Files:**
- Modify: `src/types/schemas/contentStrategy.ts`
- Modify: `src/server/features/content/services/ContentStrategyService.ts`
- Modify: `src/serverFunctions/contentStrategy.ts`

**Interfaces:**
- Consumes: `discoverRelatedKeywords` from Task 11

- [ ] **Step 1: Add the zod schema**

In `src/types/schemas/contentStrategy.ts`:

```ts
export const runRelatedDiscoverySchema = z.object({
  projectId: z.string().min(1),
});
```

- [ ] **Step 2: Wire the service facade**

In `src/server/features/content/services/ContentStrategyService.ts`, add the import:

```ts
import { discoverRelatedKeywords } from "@/server/features/content/services/relatedDiscovery";
```

Add:

```ts
async function runRelatedDiscovery(input: {
  projectId: string;
  billingCustomer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
}) {
  const plan = await ContentPlanRepository.getOrCreatePlan(input.projectId);
  return discoverRelatedKeywords({
    projectId: input.projectId,
    billingCustomer: input.billingCustomer,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    plan: {
      minSearchVolume: plan.minSearchVolume,
      maxDifficulty: plan.maxDifficulty,
    },
  });
}
```

Add `runRelatedDiscovery` to the `ContentStrategyService` export object.

- [ ] **Step 3: Add the server function**

In `src/serverFunctions/contentStrategy.ts`:

```ts
export const runRelatedDiscovery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => runRelatedDiscoverySchema.parse(data))
  .handler(async ({ context }) => {
    return ContentStrategyService.runRelatedDiscovery({
      projectId: context.projectId,
      billingCustomer: context,
      locationCode: context.project.locationCode,
      languageCode: context.project.languageCode,
    });
  });
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/types/schemas/contentStrategy.ts src/server/features/content/services/ContentStrategyService.ts src/serverFunctions/contentStrategy.ts
git commit -m "feat(content): expose runRelatedDiscovery server function"
```

---

### Task 13: Server functions `importSuggestedKeywords` / `dismissSuggestedKeywords`

**Files:**
- Modify: `src/server/features/content/services/contentStrategyImports.ts`
- Modify: `src/server/features/content/services/ContentStrategyService.ts`
- Modify: `src/types/schemas/contentStrategy.ts`
- Modify: `src/serverFunctions/contentStrategy.ts`
- Test: `src/server/features/content/services/contentStrategyImports.test.ts` (extend from Task 3)

**Interfaces:**
- Consumes: `queueKeywords` (exported in Task 3), `ContentStrategyRepository.markKeywordsPlanned` / `markKeywordsIgnored`
- Produces: `importSuggestedKeywords({projectId, keywordIds}): Promise<{imported, queued}>`, `dismissSuggestedKeywords({projectId, keywordIds}): Promise<{dismissed: number}>` — consumed by Task 14

- [ ] **Step 1: Write the failing test**

Append to `src/server/features/content/services/contentStrategyImports.test.ts`:

```ts
describe("importSuggestedKeywords", () => {
  it("marks the given keywords planned and queues them as topics", async () => {
    mocks.listKeywords.mockResolvedValue([
      {
        id: "kw-1",
        projectId: "p1",
        keyword: "trail running shoes",
        normalizedKeyword: "trail running shoes",
        status: "planned",
        clusterName: null,
        searchVolume: 300,
        difficulty: 20,
        source: "related",
      },
    ]);
    mocks.getExistingKeywords.mockResolvedValue(new Set());
    mocks.getOrCreateCluster.mockResolvedValue("cluster-1");

    const { importSuggestedKeywords } = await import(
      "./contentStrategyImports"
    );
    const result = await importSuggestedKeywords({
      projectId: "p1",
      keywordIds: ["kw-1"],
    });

    expect(result.imported).toBe(1);
    expect(result.queued).toBe(1);
  });
});

describe("dismissSuggestedKeywords", () => {
  it("marks the given keywords ignored", async () => {
    const { dismissSuggestedKeywords } = await import(
      "./contentStrategyImports"
    );
    const result = await dismissSuggestedKeywords({
      projectId: "p1",
      keywordIds: ["kw-1", "kw-2"],
    });
    expect(result).toEqual({ dismissed: 2 });
  });
});
```

`mocks.markKeywordsPlanned` and `mocks.markKeywordsIgnored` already exist in the mock setup from Task 3 — no changes needed there.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/features/content/services/contentStrategyImports.test.ts --reporter=verbose`
Expected: FAIL — `importSuggestedKeywords is not a function`

- [ ] **Step 3: Implement both functions**

In `src/server/features/content/services/contentStrategyImports.ts`, add:

```ts
export async function importSuggestedKeywords(input: {
  projectId: string;
  keywordIds: string[];
}): Promise<{ imported: number; queued: number }> {
  await ContentStrategyRepository.markKeywordsPlanned(input.keywordIds);
  const allKeywords = await ContentStrategyRepository.listKeywords(
    input.projectId,
  );
  const justImported = allKeywords.filter((keyword) =>
    input.keywordIds.includes(keyword.id),
  );
  const queued = await queueKeywords(justImported);
  return { imported: justImported.length, queued };
}

export async function dismissSuggestedKeywords(input: {
  projectId: string;
  keywordIds: string[];
}): Promise<{ dismissed: number }> {
  await ContentStrategyRepository.markKeywordsIgnored(input.keywordIds);
  return { dismissed: input.keywordIds.length };
}
```

(`projectId` on `dismissSuggestedKeywords`'s input is unused by the body — keep it anyway for API symmetry with `importSuggestedKeywords` and so a future ownership check can be added without an API change; this matches how other service functions in this file accept `projectId` even where a given internal call doesn't strictly need it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/features/content/services/contentStrategyImports.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 5: Wire the service facade**

In `src/server/features/content/services/ContentStrategyService.ts`:

```ts
import {
  deleteDocument,
  dismissSuggestedKeywords,
  importKeywords,
  importSuggestedKeywords,
  importUrls,
  launchFromKeywords,
  saveDocument,
} from "@/server/features/content/services/contentStrategyImports";
```
```ts
export const ContentStrategyService = {
  importKeywords,
  saveDocument,
  deleteDocument,
  importUrls,
  launchFromKeywords,
  importSuggestedKeywords,
  dismissSuggestedKeywords,
  runCompetitorDiscovery,
  runRelatedDiscovery,
  analyzeExistingContent,
  getWorkspace,
  buildPromptContext,
};
```

- [ ] **Step 6: Add schemas and server functions**

In `src/types/schemas/contentStrategy.ts`:

```ts
export const importSuggestedKeywordsSchema = z.object({
  projectId: z.string().min(1),
  keywordIds: z.array(z.string().min(1)).min(1).max(200),
});

export const dismissSuggestedKeywordsSchema = z.object({
  projectId: z.string().min(1),
  keywordIds: z.array(z.string().min(1)).min(1).max(200),
});
```

In `src/serverFunctions/contentStrategy.ts`:

```ts
export const importSuggestedKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => importSuggestedKeywordsSchema.parse(data))
  .handler(async ({ data, context }) => {
    return ContentStrategyService.importSuggestedKeywords({
      projectId: context.projectId,
      keywordIds: data.keywordIds,
    });
  });

export const dismissSuggestedKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) =>
    dismissSuggestedKeywordsSchema.parse(data),
  )
  .handler(async ({ data, context }) => {
    return ContentStrategyService.dismissSuggestedKeywords({
      projectId: context.projectId,
      keywordIds: data.keywordIds,
    });
  });
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/server/features/content/services/contentStrategyImports.ts src/server/features/content/services/contentStrategyImports.test.ts src/server/features/content/services/ContentStrategyService.ts src/types/schemas/contentStrategy.ts src/serverFunctions/contentStrategy.ts
git commit -m "feat(content): expose importSuggestedKeywords/dismissSuggestedKeywords server functions"
```

---

### Task 14: Keywords tab — Suggestions review section

**Files:**
- Modify: `src/client/features/content/ContentStrategyKeywordsTab.tsx`

**Interfaces:**
- Consumes: `workspace.keywords` (each row now may have `status: "suggested"`), `runCompetitorDiscovery`, `runRelatedDiscovery`, `importSuggestedKeywords`, `dismissSuggestedKeywords` server functions (Tasks 10, 12, 13)

- [ ] **Step 1: Exclude suggestions from the main keyword table**

In `src/client/features/content/ContentStrategyKeywordsTab.tsx`, the `KeywordTable` component currently renders `workspace.keywords.slice(0, 200)` unconditionally. Change the parent `ContentStrategyKeywordsTab` to split keywords by status before rendering:

```tsx
  const approvedKeywords = workspace.keywords.filter(
    (keyword) => keyword.status !== "suggested",
  );
  const suggestedKeywords = workspace.keywords.filter(
    (keyword) => keyword.status === "suggested",
  );
```

Replace the existing:
```tsx
      {workspace.keywords.length === 0 ? (
        <EmptyState
          icon={<ListPlus className="size-6" />}
          text="No approved keywords yet. Import a flat list or add a master plan."
        />
      ) : (
        <KeywordTable workspace={workspace} />
      )}
      {workspace.keywords.length > 200 && (
        <p className="text-xs text-base-content/50">
          Showing the first 200 of {workspace.keywords.length} keywords.
        </p>
      )}
```
with:
```tsx
      <SuggestionsSection
        projectId={projectId}
        suggestions={suggestedKeywords}
        onChanged={onChanged}
      />

      {approvedKeywords.length === 0 ? (
        <EmptyState
          icon={<ListPlus className="size-6" />}
          text="No approved keywords yet. Import a flat list or add a master plan."
        />
      ) : (
        <KeywordTable keywords={approvedKeywords} />
      )}
      {approvedKeywords.length > 200 && (
        <p className="text-xs text-base-content/50">
          Showing the first 200 of {approvedKeywords.length} keywords.
        </p>
      )}
```

Update `KeywordTable`'s props to take `keywords` directly instead of `workspace` (change `{ workspace }: { workspace: Workspace }` to `{ keywords }: { keywords: Workspace["keywords"] }` and replace every `workspace.keywords` reference inside it with `keywords`).

- [ ] **Step 2: Add discovery trigger buttons and the `SuggestionsSection` component**

Add imports:
```tsx
import { Search, Sparkles, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  dismissSuggestedKeywords,
  importSuggestedKeywords,
  runCompetitorDiscovery,
  runRelatedDiscovery,
} from "@/serverFunctions/contentStrategy";
import type { Workspace } from "@/client/features/content/contentStrategyTypes";
```
(merge `Search`, `Sparkles`, `X` into the existing `lucide-react` import; the `Workspace` type import already exists — just note it's now also used for `Workspace["keywords"]`)

Add this component at the bottom of the file, after `KeywordTable`:

```tsx
function SuggestionsSection({
  projectId,
  suggestions,
  onChanged,
}: {
  projectId: string;
  suggestions: Workspace["keywords"];
  onChanged: () => void;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const discoverCompetitors = useMutation({
    mutationFn: () => runCompetitorDiscovery({ data: { projectId } }),
    onSuccess: (result) => {
      toast.success(`Found ${result.suggested} competitor keyword suggestion${result.suggested !== 1 ? "s" : ""}`);
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Competitor discovery failed")),
  });

  const discoverRelated = useMutation({
    mutationFn: () => runRelatedDiscovery({ data: { projectId } }),
    onSuccess: (result) => {
      toast.success(`Found ${result.suggested} related keyword suggestion${result.suggested !== 1 ? "s" : ""}`);
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Related-keyword discovery failed")),
  });

  const importSelected = useMutation({
    mutationFn: (keywordIds: string[]) =>
      importSuggestedKeywords({ data: { projectId, keywordIds } }),
    onSuccess: (result) => {
      setSelected(new Set());
      toast.success(`Imported ${result.imported} keyword${result.imported !== 1 ? "s" : ""}, queued ${result.queued}`);
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Import failed")),
  });

  const dismissSelected = useMutation({
    mutationFn: (keywordIds: string[]) =>
      dismissSuggestedKeywords({ data: { projectId, keywordIds } }),
    onSuccess: () => {
      setSelected(new Set());
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Dismiss failed")),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-2 rounded-box border border-base-300 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          Suggestions {suggestions.length > 0 ? `(${suggestions.length})` : ""}
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={discoverCompetitors.isPending}
            onClick={() => discoverCompetitors.mutate()}
          >
            <Swords className="size-4" />
            Discover from competitors
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={discoverRelated.isPending}
            onClick={() => discoverRelated.mutate()}
          >
            <Sparkles className="size-4" />
            Discover related keywords
          </button>
        </div>
      </div>

      {suggestions.length === 0 ? (
        <p className="text-xs text-base-content/50">
          No pending suggestions. Run a discovery above to find content gaps.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-box border border-base-300">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th />
                  <th>Keyword</th>
                  <th>Source</th>
                  <th>Volume</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((keyword) => (
                  <tr key={keyword.id}>
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={selected.has(keyword.id)}
                        onChange={() => toggle(keyword.id)}
                      />
                    </td>
                    <td className="font-medium">{keyword.keyword}</td>
                    <td className="max-w-52 truncate text-xs text-base-content/60">
                      {keyword.sourceName ?? keyword.source}
                    </td>
                    <td>{keyword.searchVolume ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={selected.size === 0 || importSelected.isPending}
              onClick={() => importSelected.mutate([...selected])}
            >
              Import selected ({selected.size})
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={selected.size === 0 || dismissSelected.isPending}
              onClick={() => dismissSelected.mutate([...selected])}
            >
              <X className="size-4" />
              Dismiss selected
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

Add `Swords` to the lucide-react import too (used by the "Discover from competitors" button).

Remove the now-unused `useQueryClient` import if it was added speculatively and isn't actually referenced (it isn't in the code above — don't add it).

- [ ] **Step 2b: Add the missing `Workspace["keywords"]` summary count (optional but keeps `summary.plannedKeywords`-style counts consistent)**

This step is optional polish, not required for the feature to work — skip if short on time. If done: in `src/server/features/content/services/contentStrategyAnalysis.ts`, add `suggestedKeywords: keywords.filter((k) => k.status === "suggested").length,` to the `summary` object next to `plannedKeywords`/`coveredKeywords`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification**

Start the dev server, open a project's Content > Autopilot/Keywords tab (`/p/$projectId/content` or wherever `ContentStrategyKeywordsTab` is rendered — check `ContentStrategyWorkspace.tsx` for the exact route), confirm:
- "Discover from competitors" and "Discover related keywords" buttons appear and show a toast after running
- Discovered suggestions render in the new Suggestions table, separate from the main approved-keywords table
- Selecting rows and clicking "Import selected" moves them into the main table and shows a "queued" toast
- "Dismiss selected" removes them from the Suggestions list without adding topics

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run --reporter=dot`
Expected: all pass (pre-existing flaky tests noted in project memory are a known exception — re-run any isolated failure to confirm it's not a regression)

- [ ] **Step 6: Commit**

```bash
git add src/client/features/content/ContentStrategyKeywordsTab.tsx src/server/features/content/services/contentStrategyAnalysis.ts
git commit -m "feat(content): add suggestion review UI for competitor/related keyword discovery"
```

---

## Self-Review Notes

- **Spec coverage:** Section 1 (direct launch) → Tasks 3-6. Section 2 (competitor discovery) → Tasks 2, 9, 10. Section 3 (related discovery) → Task 11, 12. Section 4 (review UI) → Tasks 7, 8, 14. Data model changes → Task 1. All four spec sections have at least one task.
- **Terminology flag:** `content_topics.status` already has its own pre-existing `"suggested"` value (topic queued, not yet scheduled) — completely distinct from the new `content_keywords.status = "suggested"` this plan adds (keyword discovered, not yet reviewed). Tasks reference the correct table each time; don't conflate them during implementation.
- **Type consistency:** `launchFromKeywords`, `importSuggestedKeywords`, and `discoverCompetitorKeywords`/`discoverRelatedKeywords` all funnel through the same `queueKeywords`/`upsertKeywords`/`insertSuggestedKeywords` repository methods introduced or reused consistently across tasks — verified the field names (`clusterName`, `role`, `sourceName`, `status`) match between the schema (Task 1), the repository (Tasks 7-8), and every service that calls them (Tasks 3, 9, 11, 13).
