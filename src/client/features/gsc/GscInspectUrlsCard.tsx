import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { inspectGscUrls } from "@/serverFunctions/gsc";

const MAX_URLS = 10;

/** Paste up to 10 URLs and check index status, canonical, and last crawl
 *  against the project's connected Search Console property. */
export function GscInspectUrlsCard({ projectId }: { projectId: string }) {
  const [input, setInput] = React.useState("");

  const inspectMutation = useMutation({
    mutationFn: (urls: string[]) =>
      inspectGscUrls({ data: { projectId, urls } }),
    onError: (error) => {
      toast.error(getStandardErrorMessage(error, "Inspection failed"));
    },
  });

  const urls = input
    .split(/\s+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const result = inspectMutation.data;

  return (
    <div className="space-y-4">
      <form
        className="card bg-base-100 border border-base-300"
        onSubmit={(event) => {
          event.preventDefault();
          if (urls.length > 0) {
            inspectMutation.mutate(urls.slice(0, MAX_URLS));
          }
        }}
      >
        <div className="card-body gap-3 p-4">
          <label className="form-control">
            <span className="label-text text-xs">
              URLs to inspect (one per line, max {MAX_URLS})
            </span>
            <textarea
              className="textarea textarea-bordered font-mono text-sm"
              rows={4}
              placeholder={
                "https://example.com/page-1\nhttps://example.com/page-2"
              }
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </label>
          <div className="flex items-center justify-between">
            <p className="text-xs text-base-content/60">
              Index status, canonical, and last crawl — from Google's URL
              Inspection API.
            </p>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={inspectMutation.isPending || urls.length === 0}
            >
              {inspectMutation.isPending && (
                <span className="loading loading-spinner loading-xs" />
              )}
              Inspect {Math.min(urls.length, MAX_URLS) || ""}
            </button>
          </div>
        </div>
      </form>

      {result && !result.connected && (
        <div className="alert alert-warning text-sm">
          Search Console is not connected for this project.
        </div>
      )}

      {result?.connected && (
        <div className="card bg-base-100 border border-base-300">
          <div className="card-body p-0">
            <div className="overflow-x-auto">
              <table className="table table-zebra table-sm">
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Verdict</th>
                    <th>Coverage</th>
                    <th>Google canonical</th>
                    <th>Last crawl</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((entry) => {
                    const status = entry.result?.indexStatusResult;
                    return (
                      <tr key={entry.url}>
                        <td
                          className="max-w-xs truncate font-mono text-xs"
                          title={entry.url}
                        >
                          {entry.url}
                        </td>
                        {entry.error ? (
                          <td colSpan={4} className="text-xs text-error">
                            {entry.error}
                          </td>
                        ) : (
                          <>
                            <td>
                              <VerdictBadge verdict={status?.verdict} />
                            </td>
                            <td className="text-xs">
                              {status?.coverageState ?? "—"}
                            </td>
                            <td
                              className="max-w-xs truncate font-mono text-xs"
                              title={status?.googleCanonical}
                            >
                              {status?.googleCanonical ?? "—"}
                            </td>
                            <td className="whitespace-nowrap text-xs text-base-content/60">
                              {status?.lastCrawlTime
                                ? status.lastCrawlTime.slice(0, 10)
                                : "—"}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict?: string }) {
  if (!verdict) return <span className="text-xs text-base-content/50">—</span>;
  const className =
    verdict === "PASS"
      ? "badge-success"
      : verdict === "FAIL"
        ? "badge-error"
        : "badge-warning";
  return <span className={`badge badge-sm ${className}`}>{verdict}</span>;
}
