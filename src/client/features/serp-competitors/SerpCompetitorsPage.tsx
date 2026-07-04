import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Swords } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getSerpCompetitors } from "@/serverFunctions/serpCompetitors";

const MAX_KEYWORDS = 20;

export function SerpCompetitorsPage({
  projectId,
  initialKeywords,
}: {
  projectId: string;
  initialKeywords?: string[];
}) {
  const [input, setInput] = React.useState((initialKeywords ?? []).join("\n"));

  const competitorsMutation = useMutation({
    mutationFn: (keywords: string[]) =>
      getSerpCompetitors({ data: { projectId, keywords } }),
    onError: (error) => {
      toast.error(getStandardErrorMessage(error, "Failed to load competitors"));
    },
  });

  // Auto-run once when arriving with keywords preselected from Saved Keywords.
  const autoRan = React.useRef(false);
  React.useEffect(() => {
    if (autoRan.current) return;
    if (initialKeywords && initialKeywords.length > 0) {
      autoRan.current = true;
      competitorsMutation.mutate(initialKeywords.slice(0, MAX_KEYWORDS));
    }
  }, [initialKeywords, competitorsMutation]);

  const keywords = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const result = competitorsMutation.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">SERP Competitors</h1>
        <p className="text-sm text-base-content/70">
          The domains that dominate Google for a set of keywords, ranked by
          visibility
        </p>
      </div>

      <form
        className="card bg-base-100 border border-base-300"
        onSubmit={(event) => {
          event.preventDefault();
          if (keywords.length > 0) {
            competitorsMutation.mutate(keywords.slice(0, MAX_KEYWORDS));
          }
        }}
      >
        <div className="card-body gap-3 p-4">
          <label className="form-control">
            <span className="label-text text-xs">
              Keywords (one per line, max {MAX_KEYWORDS})
            </span>
            <textarea
              className="textarea textarea-bordered text-sm"
              rows={4}
              placeholder={
                "project management software\nbest tools for remote teams"
              }
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </label>
          <div className="flex items-center justify-between">
            <p className="text-xs text-base-content/60">
              Uses your project's location and language.
            </p>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={competitorsMutation.isPending || keywords.length === 0}
            >
              {competitorsMutation.isPending && (
                <span className="loading loading-spinner loading-xs" />
              )}
              Find competitors
            </button>
          </div>
        </div>
      </form>

      {competitorsMutation.isPending ? (
        <div className="flex justify-center p-10">
          <span className="loading loading-spinner loading-md" />
        </div>
      ) : result ? (
        result.competitors.length === 0 ? (
          <div className="card bg-base-100 border border-base-300">
            <div className="card-body items-center gap-2 p-10 text-center">
              <Swords className="size-8 text-base-content/30" />
              <p className="text-sm text-base-content/60">
                No competitors found for these keywords.
              </p>
            </div>
          </div>
        ) : (
          <div className="card bg-base-100 border border-base-300">
            <div className="card-body p-0">
              <div className="overflow-x-auto">
                <table className="table table-zebra table-sm">
                  <thead>
                    <tr>
                      <th>Domain</th>
                      <th className="text-right">Visibility</th>
                      <th className="text-right">Keywords</th>
                      <th className="text-right">Avg pos.</th>
                      <th className="text-right">Median pos.</th>
                      <th className="text-right">Est. traffic</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.competitors.map((competitor) => (
                      <tr
                        key={competitor.domain}
                        className={competitor.isSelf ? "bg-primary/5" : ""}
                      >
                        <td className="font-medium">
                          {competitor.domain}
                          {competitor.isSelf && (
                            <span className="badge badge-primary badge-sm ml-2">
                              You
                            </span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">
                          {competitor.visibility == null
                            ? "—"
                            : `${(competitor.visibility * 100).toFixed(1)}%`}
                        </td>
                        <td className="text-right tabular-nums">
                          {competitor.keywordsCount ?? "—"}
                        </td>
                        <td className="text-right tabular-nums">
                          {competitor.avgPosition == null
                            ? "—"
                            : competitor.avgPosition.toFixed(1)}
                        </td>
                        <td className="text-right tabular-nums">
                          {competitor.medianPosition == null
                            ? "—"
                            : competitor.medianPosition.toFixed(1)}
                        </td>
                        <td className="text-right tabular-nums">
                          {competitor.etv == null
                            ? "—"
                            : Math.round(competitor.etv).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
