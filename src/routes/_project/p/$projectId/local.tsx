import { createFileRoute } from "@tanstack/react-router";
import { LocalSeoPage } from "@/client/features/local/LocalSeoPage";

export const Route = createFileRoute("/_project/p/$projectId/local")({
  component: LocalRoute,
});

function LocalRoute() {
  const { projectId } = Route.useParams();
  return (
    <div className="px-4 py-4 pb-24 overflow-auto md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <LocalSeoPage projectId={projectId} />
      </div>
    </div>
  );
}
