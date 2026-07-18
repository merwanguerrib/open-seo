export type ContentKeywordRole = "pillar" | "satellite" | "standalone";
export type ContentAssetType = "blog" | "pillar" | "product" | "other";

export type ParsedContentKeyword = {
  keyword: string;
  normalizedKeyword: string;
  role: ContentKeywordRole;
  clusterName: string | null;
  targetUrl: string | null;
  title: string | null;
  intent: string | null;
  priority: string | null;
  searchVolume: number | null;
  difficulty: number | null;
  contentType: ContentAssetType;
};

export type ContentHealth = {
  status: "planned" | "unknown" | "healthy" | "needs_attention" | "critical";
  issues: string[];
};

type MasterPlanContext = {
  clusterName: string | null;
  role: ContentKeywordRole | null;
  contentType: ContentAssetType | null;
  site: string | null;
  path: string[];
};

type ContentHealthInput = {
  state: "planned" | "existing";
  contentType: ContentAssetType;
  statusCode: number | null;
  title: string | null;
  metaDescription: string | null;
  wordCount: number | null;
  h1Count: number | null;
  internalLinkCount: number | null;
  crawlDepth: number | null;
  hasStructuredData: boolean | null;
  isIndexable: boolean | null;
  lastAnalyzedAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function numberField(
  record: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.round(value);
    }
  }
  return null;
}

export function normalizeKeyword(keyword: string): string {
  return keyword.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseKeywordInput(content: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const rawLine of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const firstCell = line
      .split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/, 1)[0]
      ?.trim()
      .replace(/^"(.*)"$/, "$1");
    if (!firstCell) continue;

    const normalized = normalizeKeyword(firstCell);
    if (
      !normalized ||
      ["keyword", "keywords", "mot-clé", "mot cle"].includes(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    keywords.push(firstCell);
  }

  return keywords;
}

function siteBaseUrl(siteOrDomain: string | null): string | null {
  if (!siteOrDomain?.trim()) return null;
  const raw = siteOrDomain.trim();
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).toString();
  } catch {
    return null;
  }
}

export function normalizeContentUrl(
  rawUrl: string,
  siteOrDomain: string | null,
): string | null {
  if (!rawUrl.trim()) return null;
  const base = siteBaseUrl(siteOrDomain);
  try {
    const url = base ? new URL(rawUrl.trim(), base) : new URL(rawUrl.trim());
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function inferContentType(
  rawUrl: string,
  role: ContentKeywordRole | null = null,
): ContentAssetType {
  if (role === "pillar") return "pillar";
  if (role === "satellite") return "blog";

  let pathname = rawUrl;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    // Relative paths are still useful for the path heuristics below.
  }
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0]?.toLowerCase() ?? "";
  if (["blog", "article", "articles", "resources"].includes(first)) {
    return "blog";
  }
  if (["guide", "guides", "hub"].includes(first)) {
    return segments.length <= 2 ? "pillar" : "blog";
  }
  if (
    ["features", "feature", "product", "products", "solutions"].includes(first)
  ) {
    return "product";
  }
  return "other";
}

function roleFromContext(
  record: Record<string, unknown>,
  context: MasterPlanContext,
): ContentKeywordRole {
  const explicit = stringField(record, ["role", "type"])?.toLowerCase();
  if (explicit?.includes("pillar") || explicit?.includes("hub"))
    return "pillar";
  if (explicit?.includes("satellite") || explicit?.includes("spoke")) {
    return "satellite";
  }
  if (record.hub_url != null || context.path.at(-1) === "pillar") {
    return "pillar";
  }
  if (context.role) return context.role;
  return "standalone";
}

function contentTypeFromRecord(
  record: Record<string, unknown>,
  role: ContentKeywordRole,
  targetUrl: string | null,
  context: MasterPlanContext,
): ContentAssetType {
  const layer = numberField(record, ["layer"]);
  if (layer === 2) return "product";
  if (context.contentType) return context.contentType;
  return inferContentType(targetUrl ?? "", role);
}

function clusterNameFromRecord(
  record: Record<string, unknown>,
  context: MasterPlanContext,
): string | null {
  const hasChildren =
    Array.isArray(record.spokes) ||
    Array.isArray(record.posts) ||
    Array.isArray(record.clusters);
  if (!hasChildren) return context.clusterName;
  return (
    stringField(record, ["name", "id", "hub_title", "title"]) ??
    context.clusterName
  );
}

function childContext(
  key: string,
  record: Record<string, unknown>,
  context: MasterPlanContext,
): MasterPlanContext {
  const clusterName = clusterNameFromRecord(record, context);
  let role = context.role;
  let contentType = context.contentType;

  if (key === "pillar" || key === "pillars") role = "pillar";
  if (key === "spokes" || key === "posts") role = "satellite";
  if (key === "category_pages_layer_2") contentType = "product";
  if (key === "trust_pages_layer_3") contentType = "other";

  return {
    clusterName,
    role,
    contentType,
    site: context.site,
    path: [...context.path, key],
  };
}

function mergeEntry(
  current: ParsedContentKeyword | undefined,
  next: ParsedContentKeyword,
): ParsedContentKeyword {
  if (!current) return next;
  return {
    keyword: current.keyword,
    normalizedKeyword: current.normalizedKeyword,
    role:
      current.role === "pillar" || next.role === "pillar"
        ? "pillar"
        : current.role === "satellite" || next.role === "satellite"
          ? "satellite"
          : "standalone",
    clusterName: current.clusterName ?? next.clusterName,
    targetUrl: current.targetUrl ?? next.targetUrl,
    title: current.title ?? next.title,
    intent: current.intent ?? next.intent,
    priority: current.priority ?? next.priority,
    searchVolume: current.searchVolume ?? next.searchVolume,
    difficulty: current.difficulty ?? next.difficulty,
    contentType:
      current.contentType !== "other" ? current.contentType : next.contentType,
  };
}

export function extractMasterPlanEntries(
  value: unknown,
  fallbackSite: string | null,
): ParsedContentKeyword[] {
  const rootSite =
    isRecord(value) && typeof value.site === "string"
      ? value.site
      : fallbackSite;
  const entries = new Map<string, ParsedContentKeyword>();

  function visit(node: unknown, context: MasterPlanContext): void {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, context);
      return;
    }
    if (!isRecord(node)) return;

    const keyword = stringField(node, [
      "primary_keyword",
      "keyword",
      "kw",
      "seed_keyword",
    ]);
    const role = roleFromContext(node, context);
    const rawTargetUrl = stringField(node, ["hub_url", "url", "target_url"]);
    const targetUrl = rawTargetUrl
      ? normalizeContentUrl(rawTargetUrl, context.site)
      : null;
    const clusterName = clusterNameFromRecord(node, context);

    if (keyword) {
      const normalizedKeyword = normalizeKeyword(keyword);
      const entry: ParsedContentKeyword = {
        keyword,
        normalizedKeyword,
        role,
        clusterName,
        targetUrl,
        title: stringField(node, ["hub_title", "title", "h1"]),
        intent: stringField(node, ["intent", "intent_focus"]),
        priority: stringField(node, ["priority"]),
        searchVolume: numberField(node, [
          "search_volume",
          "volume",
          "vol",
          "cluster_volume_mo",
        ]),
        difficulty: numberField(node, ["difficulty", "kd", "primary_kd"]),
        contentType: contentTypeFromRecord(node, role, targetUrl, context),
      };
      entries.set(
        normalizedKeyword,
        mergeEntry(entries.get(normalizedKeyword), entry),
      );
    }

    for (const [key, child] of Object.entries(node)) {
      if (
        [
          "primary_keyword",
          "keyword",
          "kw",
          "seed_keyword",
          "hub_url",
          "url",
          "target_url",
          "hub_title",
          "title",
          "h1",
          "intent",
          "intent_focus",
          "priority",
          "search_volume",
          "volume",
          "vol",
          "cluster_volume_mo",
          "difficulty",
          "kd",
          "primary_kd",
          "role",
          "type",
          "layer",
          "site",
        ].includes(key)
      ) {
        continue;
      }
      visit(child, childContext(key, node, context));
    }
  }

  visit(value, {
    clusterName: null,
    role: null,
    contentType: null,
    site: rootSite,
    path: [],
  });

  return [...entries.values()];
}

export function assessContentHealth(input: ContentHealthInput): ContentHealth {
  if (input.state === "planned") return { status: "planned", issues: [] };
  if (!input.lastAnalyzedAt) return { status: "unknown", issues: [] };

  const critical: string[] = [];
  const warnings: string[] = [];

  if (
    input.statusCode != null &&
    (input.statusCode < 200 || input.statusCode >= 400)
  ) {
    critical.push(`HTTP ${input.statusCode}`);
  }
  if (input.isIndexable === false) critical.push("Not indexable");
  if (!input.title?.trim()) warnings.push("Missing title");
  if (!input.metaDescription?.trim()) warnings.push("Missing meta description");
  if (input.h1Count != null && input.h1Count !== 1) {
    warnings.push(`${input.h1Count} H1 headings`);
  }

  const minimumWords =
    input.contentType === "pillar"
      ? 1_500
      : input.contentType === "blog"
        ? 800
        : 400;
  if (input.wordCount != null && input.wordCount < minimumWords) {
    warnings.push(`Thin content (${input.wordCount} words)`);
  }
  if (input.internalLinkCount === 0) warnings.push("No internal links");
  if (input.crawlDepth == null) warnings.push("Orphan or sitemap-only");
  else if (input.crawlDepth > 4)
    warnings.push(`Deep page (${input.crawlDepth})`);
  if (input.hasStructuredData === false) {
    warnings.push("No structured data");
  }

  if (critical.length > 0) {
    return { status: "critical", issues: [...critical, ...warnings] };
  }
  if (warnings.length > 0) {
    return { status: "needs_attention", issues: warnings };
  }
  return { status: "healthy", issues: [] };
}
