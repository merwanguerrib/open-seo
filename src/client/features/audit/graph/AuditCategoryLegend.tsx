import type { CategoryLegendEntry } from "@/client/features/audit/graph/pageCategories";

export function AuditCategoryLegend({
  legend,
  selectedCategory,
  onSelect,
  title = "Page categories",
}: {
  legend: CategoryLegendEntry[];
  selectedCategory: string | null;
  onSelect: (category: string | null) => void;
  title?: string;
}) {
  if (legend.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase text-base-content/50">
        {title}
      </div>
      {legend.map((entry) => {
        const isSelected = entry.category === selectedCategory;
        return (
          <button
            key={entry.category}
            type="button"
            aria-label={`Highlight ${entry.category} pages`}
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${
              isSelected ? "bg-primary/10" : "hover:bg-base-200"
            }`}
            onClick={() => onSelect(isSelected ? null : entry.category)}
          >
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="flex-1 truncate">{entry.category}</span>
            <span className="text-xs text-base-content/50">{entry.count}</span>
          </button>
        );
      })}
    </div>
  );
}
