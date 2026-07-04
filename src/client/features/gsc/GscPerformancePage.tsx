import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getGscPerformanceOverview } from "@/serverFunctions/gsc";
import { GscInspectUrlsCard } from "@/client/features/gsc/GscInspectUrlsCard";

const DATE_RANGE_OPTIONS = [
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_28_days", label: "Last 28 days" },
  { value: "last_3_months", label: "Last 3 months" },
  { value: "last_6_months", label: "Last 6 months" },
  { value: "last_12_months", label: "Last 12 months" },
  { value: "last_16_months", label: "Last 16 months" },
] as const;

type DateRange = (typeof DATE_RANGE_OPTIONS)[number]["value"];

export function GscPerformancePage({ projectId }: { projectId: string }) {
  const [dateRange, setDateRange] = React.useState<DateRange>("last_28_days");
  const [tab, setTab] = React.useState<"performance" | "inspect">(
    "performance",
  );

  const overviewQuery = useQuery({
    queryKey: ["gsc-performance", projectId, dateRange],
    queryFn: () =>
      getGscPerformanceOverview({ data: { projectId, dateRange } }),
    staleTime: 5 * 60 * 1000,
  });

  const overview = overviewQuery.data;

  if (overview && !overview.connected) {
    return (
      <div className="card bg-base-100 border border-base-300">
        <div className="card-body items-center gap-3 p-10 text-center">
          <p className="font-medium">Search Console is not connected</p>
          <p className="text-sm text-base-content/60">
            Connect a property to see clicks, impressions, CTR, and position —
            straight from Google.
          </p>
          <Link
            to="/p/$projectId/settings"
            params={{ projectId }}
            hash="search-console"
            className="btn btn-primary btn-sm"
          >
            Connect in settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" className="tabs tabs-border">
          <button
            role="tab"
            type="button"
            className={`tab ${tab === "performance" ? "tab-active" : ""}`}
            onClick={() => setTab("performance")}
          >
            Performance
          </button>
          <button
            role="tab"
            type="button"
            className={`tab ${tab === "inspect" ? "tab-active" : ""}`}
            onClick={() => setTab("inspect")}
          >
            Inspect URLs
          </button>
        </div>
        {tab === "performance" && (
          <select
            className="select select-bordered select-sm"
            value={dateRange}
            onChange={(event) => setDateRange(event.target.value as DateRange)}
          >
            {DATE_RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {tab === "inspect" ? (
        <GscInspectUrlsCard projectId={projectId} />
      ) : overviewQuery.isLoading || !overview?.connected ? (
        <div className="flex justify-center p-10">
          <span className="loading loading-spinner loading-md" />
        </div>
      ) : (
        <>
          <p className="text-xs text-base-content/50">
            {overview.siteUrl} · {overview.startDate} → {overview.endDate}
          </p>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Total clicks"
              value={formatCount(overview.totals.clicks)}
            />
            <StatTile
              label="Total impressions"
              value={formatCount(overview.totals.impressions)}
            />
            <StatTile
              label="Average CTR"
              value={`${(overview.totals.ctr * 100).toFixed(1)}%`}
            />
            <StatTile
              label="Average position"
              value={overview.totals.position.toFixed(1)}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <PerformanceTable
              title="Top queries"
              keyLabel="Query"
              rows={overview.topQueries}
            />
            <PerformanceTable
              title="Top pages"
              keyLabel="Page"
              rows={overview.topPages}
            />
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-1 p-4">
        <p className="text-xs text-base-content/60">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function PerformanceTable({
  title,
  keyLabel,
  rows,
}: {
  title: string;
  keyLabel: string;
  rows: Array<{
    keys?: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
}) {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-2 p-4">
        <h2 className="text-sm font-medium">{title}</h2>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-base-content/60">
            No data for this period.
          </p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="table table-zebra table-xs">
              <thead className="sticky top-0 bg-base-100">
                <tr>
                  <th>{keyLabel}</th>
                  <th className="text-right">Clicks</th>
                  <th className="text-right">Impr.</th>
                  <th className="text-right">CTR</th>
                  <th className="text-right">Pos.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key = row.keys?.[0] ?? "";
                  return (
                    <tr key={key}>
                      <td className="max-w-xs truncate font-medium" title={key}>
                        {key}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatCount(row.clicks)}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatCount(row.impressions)}
                      </td>
                      <td className="text-right tabular-nums">
                        {(row.ctr * 100).toFixed(1)}%
                      </td>
                      <td className="text-right tabular-nums">
                        {row.position.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}
