import { useQuery } from "@tanstack/react-query";
import { Check, Circle } from "lucide-react";
import { getArticleJourney } from "@/serverFunctions/contentPlan";

type JourneyStage = "written" | "published" | "gathering" | "monitored";

const STAGES: Array<{ key: JourneyStage; label: string; hint: string }> = [
  { key: "written", label: "Written", hint: "Draft generated" },
  { key: "published", label: "Published", hint: "Live on your site" },
  {
    key: "gathering",
    label: "Gathering data",
    hint: "Waiting for Google to index",
  },
  { key: "monitored", label: "Monitored", hint: "Tracked & auto-improved" },
];

const STAGE_ORDER: Record<JourneyStage, number> = {
  written: 0,
  published: 1,
  gathering: 2,
  monitored: 3,
};

/** Phase 3 journey timeline + latest GSC metrics for an article. */
export function ArticleJourneyPanel({
  projectId,
  articleId,
}: {
  projectId: string;
  articleId: string;
}) {
  const journeyQuery = useQuery({
    queryKey: ["content-journey", projectId, articleId],
    queryFn: () => getArticleJourney({ data: { projectId, articleId } }),
    staleTime: 60 * 1000,
  });

  const journey = journeyQuery.data;
  if (!journey) return null;

  const currentIndex = STAGE_ORDER[journey.stage];
  const latest = journey.metrics.at(-1);

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3 p-4">
        <h2 className="text-xs font-medium uppercase text-base-content/50">
          Journey
        </h2>

        <ol className="space-y-2">
          {STAGES.map((stage, index) => {
            const done = index < currentIndex;
            const current = index === currentIndex;
            return (
              <li key={stage.key} className="flex items-start gap-2">
                {done ? (
                  <Check className="mt-0.5 size-4 text-success" />
                ) : (
                  <Circle
                    className={`mt-0.5 size-4 ${current ? "text-primary" : "text-base-content/30"}`}
                    {...(current ? { fill: "currentColor" } : {})}
                  />
                )}
                <div>
                  <p
                    className={`text-sm ${current ? "font-medium" : done ? "" : "text-base-content/50"}`}
                  >
                    {stage.label}
                  </p>
                  <p className="text-xs text-base-content/50">{stage.hint}</p>
                </div>
              </li>
            );
          })}
        </ol>

        {latest && (
          <div className="grid grid-cols-2 gap-2 border-t border-base-300 pt-3">
            <Metric label="Clicks" value={latest.clicks.toLocaleString()} />
            <Metric
              label="Impressions"
              value={latest.impressions.toLocaleString()}
            />
            <Metric label="CTR" value={`${(latest.ctr * 100).toFixed(1)}%`} />
            <Metric label="Position" value={latest.position.toFixed(1)} />
          </div>
        )}

        {journey.lastRepairedAt && (
          <p className="text-xs text-base-content/50">
            Last checked {journey.lastRepairedAt.slice(0, 10)}
          </p>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-base-content/50">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
