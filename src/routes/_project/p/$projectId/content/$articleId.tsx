import { createFileRoute } from "@tanstack/react-router";
import { ArticleEditorPage } from "@/client/features/content/ArticleEditorPage";

export const Route = createFileRoute(
  "/_project/p/$projectId/content/$articleId",
)({
  component: ArticleEditorRoute,
});

function ArticleEditorRoute() {
  const { projectId, articleId } = Route.useParams();
  return <ArticleEditorPage projectId={projectId} articleId={articleId} />;
}
