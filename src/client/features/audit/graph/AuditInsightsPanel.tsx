import { buildCsv, downloadCsv } from "@/client/lib/csv";
import type { AuditInsight } from "@/client/features/audit/graph/auditInsights";

function exportInsight(insight: AuditInsight) {
  downloadCsv(
    `audit-${insight.id}.csv`,
    buildCsv(insight.csvHeaders, insight.csvRows),
  );
}

export function AuditInsightsPanel({
  insights,
  selectedId,
  onSelect,
}: {
  insights: AuditInsight[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (insights.length === 0) {
    return (
      <div className="text-sm text-base-content/60">
        No issues detected in the internal link structure.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {insights.map((insight) => {
        const isSelected = insight.id === selectedId;
        return (
          <div
            key={insight.id}
            className={`rounded-lg border p-3 ${
              isSelected ? "border-primary bg-primary/5" : "border-base-300"
            }`}
          >
            <button
              type="button"
              className="w-full text-left"
              onClick={() => onSelect(isSelected ? null : insight.id)}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`badge badge-sm ${
                    insight.severity === "warning"
                      ? "badge-warning"
                      : "badge-ghost"
                  }`}
                >
                  {insight.nodeIds.length}
                </span>
                <span className="font-medium">{insight.title}</span>
              </div>
              <p className="mt-1 text-xs text-base-content/60">
                {insight.description}
              </p>
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs mt-2"
              aria-label={`Export ${insight.title} as CSV`}
              onClick={() => exportInsight(insight)}
            >
              Export CSV
            </button>
          </div>
        );
      })}
    </div>
  );
}
