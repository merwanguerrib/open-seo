import { createFileRoute } from "@tanstack/react-router";
import { McpToolsConsole } from "@/client/features/mcp-tools/McpToolsConsole";

export const Route = createFileRoute("/_project/p/$projectId/tools")({
  component: ToolsRoute,
});

function ToolsRoute() {
  const { projectId } = Route.useParams();
  return (
    <div className="px-4 py-4 pb-24 overflow-auto md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">MCP Tools</h1>
          <p className="text-sm text-base-content/70">
            Run any OpenSEO MCP tool from Claude Code or Codex — fill the
            arguments and copy the command
          </p>
        </div>
        <McpToolsConsole projectId={projectId} />
      </div>
    </div>
  );
}
