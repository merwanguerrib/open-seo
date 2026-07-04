# Content Articles — SEO Article Generation & Headless API (Phase 1)

**Status:** Design approved (AFK fallback), pending spec review
**Date:** 2026-07-04

## Summary

Bring PilotScribe-style "SEO content on autopilot" capabilities to OpenSEO. The
overall goal is a content pipeline that generates SEO articles grounded in live
Google results, schedules and publishes them with a review window, and then
improves underperforming posts using Google Search Console data.

The work is split into three phases, each with its own spec:

- **Phase 1 (this spec) — Article generation + headless API:** generate an SEO
  article from a keyword via a durable Cloudflare Workflow, store it as an
  editable draft per project, and expose published articles through a public
  headless REST API authenticated by per-project API keys.
- **Phase 2 — Autonomous content plan + editorial calendar + auto-publish:**
  the app discovers winnable topics on its own (site analysis + keyword data
  with volume/difficulty floors), organizes them as topic clusters (pillar +
  satellite articles with bidirectional internal links), fills an editorial
  calendar weeks ahead at a user-set cadence (N articles/week), and publishes
  automatically after a review window.
- **Phase 3 — GSC self-repair loop:** per-article journey timeline (written →
  published → live/gathering data → monitored weekly) and a weekly repair
  pass: title rewrites when CTR is low, internal depth relinks, full content
  refreshes for decaying posts, and archiving of dead articles.

Phase 1 deliberately builds the durable pipeline (not a one-shot server
function) because phases 2 and 3 reuse it unattended.

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Scope | Full pipeline cloned in phases; phase 1 = generation + headless API |
| Output | In-app article library **and** public headless API from phase 1 |
| Trigger | "Generate article" from keyword research / saved keywords (keyword + location + language) |
| Architecture | Cloudflare Workflow (`ArticleGenerationWorkflow`), same pattern as `RankCheckWorkflow` |
| SERP grounding | DataForSEO live organic SERP + on-page content parsing of top results |
| LLM | OpenRouter (existing `src/server/lib/openrouter.ts` infra), dedicated model env var |

## Data model

New file `src/db/content.schema.ts`, following `app.schema.ts` conventions
(text ids, `location_code` integer default 2840, `language_code` text default
"en", unix timestamps).

### New table: `content_articles`

```
id                text primary key
project_id        text not null → projects.id (cascade delete)
keyword           text not null
location_code     integer not null default 2840
language_code     text not null default 'en'
status            text not null default 'queued'
                  -- 'queued' | 'generating' | 'draft' | 'published' | 'failed'
slug              text not null            -- unique per project
title             text
meta_description  text
author            text                     -- E-E-A-T byline, editable in the editor
markdown          text                     -- full article body (markdown)
brief             text                     -- JSON: intent, angle, outline, entities, questions
faq               text                     -- JSON: [{question, answer}] — FAQ section + FAQPage JSON-LD
source_urls       text                     -- JSON: SERP URLs used for grounding
workflow_run_id   text                     -- Workflow instance id for status polling
error             text                     -- failure message when status = 'failed'
created_at        integer not null
updated_at        integer not null
published_at      integer                  -- set when status flips to 'published'

unique index (project_id, slug)
index (project_id, status)
```

### New table: `content_api_keys`

```
id           text primary key
project_id   text not null → projects.id (cascade delete)
key_hash     text not null unique   -- SHA-256 of the key; plaintext shown once at creation
label        text not null
created_at   integer not null
last_used_at integer
revoked_at   integer
```

Keys are random 32-byte tokens with a recognizable prefix (e.g.
`osk_live_...`). Only the hash is stored; lookup is by hash of the presented
bearer token.

## ArticleGenerationWorkflow

New `src/server/workflows/ArticleGenerationWorkflow.ts`, registered in
`wrangler.jsonc` alongside the existing workflows. Params: `articleId` (row is
created as `queued` before the workflow starts). Steps, each durable and
retryable:

1. **fetch-serp** — DataForSEO live organic SERP for (keyword, location,
   language), top 10 results, including People Also Ask questions and the AI
   Overview content when present. Persists `source_urls`.
2. **parse-competitors** — on-page content parsing of the top 3–5 organic
   results to capture the angle, depth, and structure that already rank.
   Failures on individual URLs are tolerated (skip and continue with ≥1
   parsed page).
3. **build-brief** — LLM call (OpenRouter): classify intent, pick the angle,
   produce an H2/H3 outline, list entities to cover and questions to answer
   (from PAA and the AI Overview when present). Persists `brief` JSON.
4. **write-article** — LLM call with a stronger model
   (`OPENROUTER_CONTENT_MODEL`, defaulting to `anthropic/claude-sonnet-5`): full
   markdown article in the project's language. Required article shape:
   - title and meta description;
   - an **answer-first opening block** (40–60 words directly answering the
     query, targeting featured snippets / position 0);
   - outline-driven H2/H3 sections;
   - **in-text citations of independent sources** (linked, drawn from the
     parsed SERP pages and any sources they reference);
   - a FAQ section, also persisted as structured `faq` JSON.
   Persists `title`, `meta_description`, `markdown`, `faq`, and a slugified
   `slug` (deduplicated per project with a numeric suffix).
5. **save-draft** — flips status to `draft`, clears `error`.

Any step exhausting retries marks the article `failed` with a human-readable
`error`; the UI offers a retry that starts a fresh workflow run on the same
row.

Status transitions: `queued → generating` (first step), `generating → draft`
(success) or `generating → failed`. `draft ↔ published` is a user action, not
a workflow concern.

## Server feature

New `src/server/features/content/` following the existing feature layout:

- Server functions: `generateArticle` (creates the row, starts the workflow),
  `listArticles`, `getArticle`, `updateArticle` (title/meta/slug/markdown
  edits), `setArticleStatus` (draft/published), `retryArticle`,
  `deleteArticle`, `createApiKey`, `revokeApiKey`, `listApiKeys`.
- All project-scoped functions verify project ownership like existing
  features.

## UI

- **New "Content" section** in the project nav:
  - `/p/$projectId/content` — article list: keyword, title, status badge,
    updated date; in-progress rows poll workflow status; failed rows show the
    error and a Retry button.
  - `/p/$projectId/content/$articleId` — editor: markdown editor + rendered
    preview, editable title / meta description / slug, copy & download
    (markdown) actions, draft/published toggle, brief and source URLs shown in
    a side panel.
- **"Generate article" trigger** in keyword research and saved keywords rows,
  pre-filling keyword + location + language and navigating to the article page
  in `queued` state.
- **API keys management** in project settings: create (plaintext shown once),
  list, revoke; plus a short "how to fetch your articles" snippet.

## Headless API

Public REST endpoints (TanStack server routes under `src/routes/api/content/`):

- `GET /api/content/v1/articles` — list published articles for the project
  identified by the bearer key. Fields: `slug`, `title`, `metaDescription`,
  `publishedAt`, `updatedAt`.
- `GET /api/content/v1/articles/:slug` — full article: adds `markdown`,
  `html` (markdown rendered server-side), `keyword`, `author`, `faq`, and
  `jsonLd` — ready-to-embed structured data (`BlogPosting` built from
  title/meta/author/dates, plus `FAQPage` when the article has a FAQ), so
  consuming sites are rich-result eligible without extra work.

Auth: `Authorization: Bearer <key>`; the key's hash resolves the project.
Revoked/unknown keys → 401. Only `published` articles are visible. Responses
set `last_used_at` on the key. Simple pagination via `?limit=` / `?cursor=`
(defaults fine for phase 1).

## Costs & observability

- DataForSEO calls (SERP + content parsing) go through the existing client so
  they are tracked like other features.
- LLM calls log OpenRouter usage (tokens in/out) per article, stored on the
  brief JSON for now (no billing UI in phase 1).

## Error handling

- Workflow step failures → `failed` status + message + retry.
- Slug collisions resolved at write time with numeric suffixes.
- Headless API returns 401 (bad key), 404 (unknown slug or unpublished), 429
  left to Cloudflare.

## Testing

- Unit: brief prompt assembly (competitor content → prompt inputs), slug
  generation/dedupe, API-key hashing + bearer auth resolution, published-only
  filtering in the headless API, JSON-LD generation (BlogPosting + FAQPage
  shapes).
- E2E (light): content list page renders; generate button creates a queued
  article row.

## Out of scope (later phases)

- Autonomous topic discovery, topic clusters (pillar + satellites), editorial
  calendar, cadence, auto-publish and review window (phase 2).
- GSC-driven weekly self-repair: title rewrites, content refreshes, internal
  depth relinks, archiving dead articles; per-article journey timeline
  (phase 3).
- CMS integrations (WordPress, Shopify, …) and hosted blog rendering —
  canonical/Open Graph tags and XML sitemaps belong to the consuming site (or
  to a hosted blog if ever built).
- Images / in-article media, IndexNow instant indexing (PilotScribe lists
  these as "coming soon" too).
