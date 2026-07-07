import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { getMcpToolsConsole } from "@/serverFunctions/mcpTools";
import {
  ToolInvocationBuilder,
  type ToolDescriptor,
} from "@/client/features/mcp-tools/ToolInvocationBuilder";

export function McpToolsConsole({ projectId }: { projectId: string }) {
  const consoleQuery = useQuery({
    queryKey: ["mcp-tools-console"],
    queryFn: () => getMcpToolsConsole(),
    staleTime: 5 * 60 * 1000,
  });

  const [search, setSearch] = React.useState("");
  const [selectedName, setSelectedName] = React.useState<string | null>(null);

  const tools = consoleQuery.data?.tools ?? [];
  const filtered = tools.filter((tool) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      tool.name.includes(q) ||
      tool.title.toLowerCase().includes(q) ||
      tool.description.toLowerCase().includes(q)
    );
  });

  const selected =
    tools.find((tool) => tool.name === selectedName) ?? filtered[0] ?? null;

  const grouped = groupByCategory(filtered);

  if (consoleQuery.isLoading) {
    return (
      <div className="flex justify-center p-10">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-3">
        <label className="input input-bordered input-sm flex items-center gap-2">
          <Search className="size-4 text-base-content/40" />
          <input
            type="text"
            className="grow"
            placeholder="Search tools"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <div className="card bg-base-100 border border-base-300">
          <div className="card-body max-h-[70vh] gap-3 overflow-auto p-3">
            {grouped.map((group) => (
              <div key={group.category}>
                <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-base-content/50">
                  {group.category}
                </h2>
                <ul className="mt-1">
                  {group.tools.map((tool) => (
                    <li key={tool.name}>
                      <button
                        type="button"
                        className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-base-200 ${
                          selected?.name === tool.name ? "bg-base-200" : ""
                        }`}
                        onClick={() => setSelectedName(tool.name)}
                      >
                        {tool.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {grouped.length === 0 && (
              <p className="p-4 text-sm text-base-content/60">
                No tools match “{search}”.
              </p>
            )}
          </div>
        </div>
      </div>

      {selected ? (
        <ToolInvocationBuilder
          key={selected.name}
          tool={selected}
          projectId={projectId}
        />
      ) : null}
    </div>
  );
}

function groupByCategory(tools: ToolDescriptor[]) {
  const order: string[] = [];
  const byCategory = new Map<string, ToolDescriptor[]>();
  for (const tool of tools) {
    if (!byCategory.has(tool.category)) {
      byCategory.set(tool.category, []);
      order.push(tool.category);
    }
    byCategory.get(tool.category)?.push(tool);
  }
  return order.map((category) => ({
    category,
    tools: byCategory.get(category) ?? [],
  }));
}
