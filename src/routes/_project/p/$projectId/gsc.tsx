import { createFileRoute } from "@tanstack/react-router";
import { GscPerformancePage } from "@/client/features/gsc/GscPerformancePage";

export const Route = createFileRoute("/_project/p/$projectId/gsc")({
  component: GscRoute,
});

function GscRoute() {
  const { projectId } = Route.useParams();
  return (
    <div className="px-4 py-4 pb-24 overflow-auto md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Search Console</h1>
          <p className="text-sm text-base-content/70">
            Clicks, impressions, CTR, and position — straight from Google
          </p>
        </div>
        <GscPerformancePage projectId={projectId} />
      </div>
    </div>
  );
}
