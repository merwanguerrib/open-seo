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
