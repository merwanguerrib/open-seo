import type { StructuralCluster } from "@/client/features/audit/graph/structuralClusters";
import { extractPathname } from "@/client/features/audit/shared";

export function AuditClustersPanel({
  clusters,
  selectedClusterId,
  onSelect,
}: {
  clusters: StructuralCluster[];
  selectedClusterId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (clusters.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase text-base-content/50">
        Link communities
      </div>
      {clusters.map((cluster) => {
        const isSelected = cluster.id === selectedClusterId;
        return (
          <button
            key={cluster.id}
            type="button"
            aria-label={`Highlight ${cluster.name} community`}
            className={`w-full rounded px-2 py-1 text-left text-sm ${
              isSelected ? "bg-primary/10" : "hover:bg-base-200"
            }`}
            onClick={() => onSelect(isSelected ? null : cluster.id)}
          >
            <span className="flex items-center gap-2">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: cluster.color }}
              />
              <span className="flex-1 truncate font-medium">{cluster.name}</span>
              <span className="text-xs text-base-content/50">{cluster.size}</span>
            </span>
            <span
              className="block truncate pl-5 text-xs text-base-content/50"
              title={cluster.pivotUrl}
            >
              pivot: {extractPathname(cluster.pivotUrl)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
