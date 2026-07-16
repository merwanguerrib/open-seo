import { createFileRoute } from "@tanstack/react-router";
import { AutopilotPage } from "@/client/features/content/AutopilotPage";

export const Route = createFileRoute("/_project/p/$projectId/autopilot")({
  component: AutopilotRoute,
});

function AutopilotRoute() {
  const { projectId } = Route.useParams();
  return (
    <div className="px-4 py-4 pb-24 overflow-auto md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <AutopilotPage projectId={projectId} />
      </div>
    </div>
  );
}
