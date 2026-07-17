# Keyword-Driven Article Launch & Discovery

**Status:** Design approved, pending spec review
**Date:** 2026-07-17

## Summary

Extend the existing content-strategy keyword pipeline (`content_keywords` →
`content_topics` → article generation, built separately and already in the
tree) with three new ways keywords enter that pipeline:

1. **Direct launch** — select one or more keywords on the Saved Keywords or
   Rank Tracking pages and queue them as article topics immediately.
2. **Competitor keyword discovery** — auto-detect the project's most frequent
   SERP competitors from its own tracked keywords, then pull each
   competitor's ranked keywords to surface content gaps.
3. **Related-keyword discovery** — for keywords the project already has
   covered content for, pull DataForSEO's related keywords to find
   cluster-expansion opportunities (satellite content around existing
   pillars).

Discoveries (2) and (3) are noisy and can return many results, so they land
as **suggestions** requiring explicit review before they become topics.
Direct launch (1) is already a deliberate user action, so it queues
immediately with no review step.

This spec builds entirely on the existing `content_keywords` /
`content_topics` / `queueKeywords` machinery — it introduces two new
`source` values, one new `status` value, and no new tables.

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Launch entry points | Saved Keywords **and** Rank Tracking pages, checkbox multi-select |
| Multi-keyword grouping | Cluster together (1 pillar + satellites), not independent articles |
| Pillar selection | Highest search volume among the selected keywords, automatic |
| Competitor domain selection | Auto-detected from existing SERP Competitors data over the project's own top tracked keywords — no manual domain entry |
| Discovery review | Competitor + related discoveries land as `suggested`, reviewed and explicitly imported — not auto-queued |
| Direct launch review | No review step — selecting keywords and clicking "Generate" is already the deliberate action |

## Data model changes

All changes are to the existing `src/db/content.schema.ts` (`content_keywords`
and `content_topics`) plus the Postgres mirror in `src/db/pg/content.schema.ts`
— both already tracked by `schema-parity.test.ts`, so parity is enforced.

### `content_keywords.source` — add two enum values

```
enum: ["manual", "file", "master_plan", "competitor", "related"]
```

- `"competitor"` — discovered from a competitor's ranked keywords.
- `"related"` — discovered from DataForSEO related-keywords against an
  already-covered keyword.

Direct launch from Saved Keywords / Rank Tracking uses the existing
`"manual"` source with `sourceName` set to `"Saved Keywords"` or
`"Rank Tracking"` (same convention file imports use for provenance) — no
schema change needed for that path.

### `content_keywords.status` — add one enum value

```
enum: ["planned", "covered", "ignored", "suggested"]
```

- `"suggested"` — discovered, pending review. Excluded from `queueKeywords`
  (which only queues `"planned"` rows — no change needed there, since it
  already filters on `status === "planned"`).
- Import action on a suggestion transitions it to `"planned"` and runs the
  existing `queueKeywords` path.
- Dismiss action transitions it to `"ignored"`.

### `content_keywords.sourceName` for competitor suggestions

Reused (already nullable free text) to carry the origin competitor domain,
e.g. `"competitor:example.com"`, so the review UI can group suggestions by
domain without a new column.

No changes to `content_topics`, `content_assets`, or `content_documents`.

## Components

### 1. Direct launch (Saved Keywords / Rank Tracking)

**UI** — `src/client/features/saved-keywords/` and
`src/client/features/rank-tracking/`: add a checkbox column and a
"Generate Article(s)" action bar that appears once ≥1 row is selected.
Mirrors the existing bulk-action-bar pattern already used for tag
assignment on Saved Keywords.

**Server function** — new `launchArticlesFromKeywords` in
`src/serverFunctions/contentStrategy.ts`, input
`{ projectId, keywords: Array<{ keyword: string; searchVolume: number | null }> }`.

**Service** — new function in `contentStrategyImports.ts`:

```ts
export async function launchFromKeywords(input: {
  projectId: string;
  sourceName: "Saved Keywords" | "Rank Tracking";
  keywords: Array<{ keyword: string; searchVolume: number | null }>;
}) {
  const pillar = input.keywords.length > 1
    ? input.keywords.reduce((max, k) =>
        (k.searchVolume ?? 0) > (max.searchVolume ?? 0) ? k : max)
    : null;
  const clusterName = pillar?.keyword ?? null;

  // upsertKeywords with role/clusterName derived above, status: "planned"
  // then queueKeywords(rows) — both existing functions, reused as-is.
}
```

Toast: `"Queued N new topic(s)"`, matching the existing file-import UX.

### 2. Competitor keyword discovery

New file `src/server/features/content/services/competitorDiscovery.ts`:

```ts
export async function discoverCompetitorKeywords(input: {
  projectId: string;
  billingCustomer: BillingCustomerContext;
  plan: { minSearchVolume: number; maxDifficulty: number };
}): Promise<{ suggested: number }>
```

Steps:
1. Pull the project's top ~20 tracked keywords by volume (Saved Keywords +
   Rank Tracking, via `KeywordResearchRepository` /
   `RankTrackingRepository`).
2. Call `client.serp.serpCompetitors` (existing, metered) for those
   keywords; tally domain frequency, excluding the project's own domain.
3. Take the top 3-5 recurring domains.
4. For each, call `client.domain.rankedKeywords` (existing, metered),
   filtered by the plan's volume/difficulty floors.
5. Dedupe against **all** existing `content_keywords` regardless of status.
6. `upsertKeywords` with `source: "competitor"`, `status: "suggested"`,
   `role: "standalone"`, `sourceName: "competitor:{domain}"`.

Triggered on demand — a "Discover from competitors" button in the Keywords
tab — not on the cron, to keep DataForSEO spend opt-in and visible.

### 3. Related-keyword discovery

New function in the same or a sibling file:

```ts
export async function discoverRelatedKeywords(input: {
  projectId: string;
  billingCustomer: BillingCustomerContext;
  plan: { minSearchVolume: number; maxDifficulty: number };
}): Promise<{ suggested: number }>
```

Steps:
1. Pull `content_keywords` where `status === "covered"`, capped to the top
   ~15 by search volume.
2. For each, call `client.keywords.related` (existing, metered), filtered
   by the plan's floors.
3. Dedupe against all existing `content_keywords`.
4. `upsertKeywords` with `source: "related"`, `status: "suggested"`,
   `role: "satellite"`, `clusterName: {the covered keyword}` — so an
   imported suggestion joins the same cluster as the existing content,
   picking up internal linking automatically at generation time.

Also triggered on demand, via a "Discover related keywords" button.

### 4. Keywords tab — suggestion review

`ContentStrategyKeywordsTab.tsx` gains a "Suggestions" section, visible only
when `suggested` rows exist, grouped by `source` (competitor sub-grouped by
`sourceName` domain, related sub-grouped by `clusterName`). Each row has a
checkbox; bar actions: "Import selected" (bulk transition to `planned` +
`queueKeywords`) and "Dismiss" (bulk transition to `ignored`).

## Error handling

- Both discovery functions wrap each DataForSEO call in try/catch per
  competitor domain / per covered keyword (matching the existing pattern in
  `topicDiscovery.ts`'s `discoverExpansionTopics`) — one failing lookup
  doesn't abort the whole run.
- No tracked keywords yet (empty Saved Keywords + Rank Tracking) →
  competitor discovery returns `{ suggested: 0 }` with a toast explaining
  why, rather than throwing.
- No covered keywords yet → related discovery returns `{ suggested: 0 }`
  similarly.
- Direct launch with zero selected rows: the action bar simply doesn't
  render (no empty-submission state to handle).

## Testing

- `contentStrategyImports.test.ts` (existing file, extend): pillar/satellite
  assignment for direct launch, dedup behavior for both discovery paths,
  `suggested` → `planned` → queued transition, dismiss transition.
- `competitorDiscovery.test.ts`: domain-frequency tally logic (pure,
  extractable and unit-testable independent of the DataForSEO client, same
  shape as existing `repairDecision.test.ts`).
- No new e2e coverage planned — existing Playwright suite doesn't cover
  Content Strategy yet.

## Out of scope

- Automatic competitor detection beyond SERP-Competitors frequency (e.g. no
  manual competitor domain list/tracking — noted as a possible future
  follow-up, not blocking this spec).
- Any change to the autopilot cron — discovery here is on-demand only.
- Postgres-parity of `content_keywords`/`content_topics` enum changes is
  covered by the existing `pg/content.schema.ts` mirror and
  `schema-parity.test.ts`, already in place from the prior Content Strategy
  work.
