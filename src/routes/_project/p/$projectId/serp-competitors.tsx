import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SerpCompetitorsPage } from "@/client/features/serp-competitors/SerpCompetitorsPage";

const serpCompetitorsSearchSchema = z.object({
  // Prefilled + auto-run from Saved Keywords selection (comma-separated).
  keywords: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_project/p/$projectId/serp-competitors")(
  {
    validateSearch: serpCompetitorsSearchSchema,
    component: SerpCompetitorsRoute,
  },
);

function SerpCompetitorsRoute() {
  const { projectId } = Route.useParams();
  const { keywords } = Route.useSearch();
  const initialKeywords = keywords
    ? keywords
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean)
    : undefined;

  return (
    <div className="px-4 py-4 pb-24 overflow-auto md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <SerpCompetitorsPage
          projectId={projectId}
          initialKeywords={initialKeywords}
        />
      </div>
    </div>
  );
}
