/**
 * URL slugs for generated articles. Slugs are unique per project; collisions
 * are resolved with a numeric suffix at save time (the workflow queries
 * existing slugs and passes them here).
 */

const MAX_SLUG_LENGTH = 80;

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFD")
    // Strip diacritics (é → e) so non-English titles produce ASCII slugs.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
  return slug || "article";
}

export function dedupeSlug(base: string, existingSlugs: Set<string>): string {
  if (!existingSlugs.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!existingSlugs.has(candidate)) return candidate;
  }
}
