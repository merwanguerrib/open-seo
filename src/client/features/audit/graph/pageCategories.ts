import type { AuditGraphPayload } from "@/server/lib/audit/types";

export interface CategoryLegendEntry {
  category: string;
  color: string;
  count: number;
}

export const CATEGORY_PALETTE = [
  "#2563eb", "#16a34a", "#db2777", "#d97706", "#7c3aed",
  "#0891b2", "#dc2626", "#65a30d", "#c026d3", "#0d9488",
];

export function deriveCategory(url: string): string {
  try {
    const segment = new URL(url).pathname.split("/").filter(Boolean)[0];
    return segment ?? "(root)";
  } catch {
    return "(root)";
  }
}

export function computeCategories(payload: AuditGraphPayload): {
  legend: CategoryLegendEntry[];
  colorByNodeId: Map<string, string>;
} {
  const counts = new Map<string, number>();
  const categoryByNode = new Map<string, string>();
  for (const node of payload.nodes) {
    const category = deriveCategory(node.url);
    categoryByNode.set(node.id, category);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const legend: CategoryLegendEntry[] = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
    .map((entry, index) => ({
      ...entry,
      color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
    }));

  const colorByCategory = new Map(legend.map((e) => [e.category, e.color]));
  const colorByNodeId = new Map<string, string>();
  for (const [id, category] of categoryByNode) {
    colorByNodeId.set(id, colorByCategory.get(category) ?? CATEGORY_PALETTE[0]);
  }

  return { legend, colorByNodeId };
}
