import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ContentListPage } from "@/client/features/content/ContentListPage";

const contentSearchSchema = z.object({
  // Prefills the generate form (used by "Generate article" row actions).
  keyword: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_project/p/$projectId/content/")({
  validateSearch: contentSearchSchema,
  component: ContentIndexRoute,
});

function ContentIndexRoute() {
  const { projectId } = Route.useParams();
  const { keyword } = Route.useSearch();
  return <ContentListPage projectId={projectId} initialKeyword={keyword} />;
}
