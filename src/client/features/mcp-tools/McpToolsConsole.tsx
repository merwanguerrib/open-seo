import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Search, Terminal } from "lucide-react";
import { getMcpToolsConsole } from "@/serverFunctions/mcpTools";
import { buildToolInvocation } from "@/shared/mcpToolInvocation";

type Catalog = Awaited<ReturnType<typeof getMcpToolsConsole>>;
type ToolDescriptor = Catalog["tools"][number];

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
          mcpConnected={Boolean(consoleQuery.data?.mcpUrl)}
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

function ToolInvocationBuilder({
  tool,
  projectId,
}: {
  tool: ToolDescriptor;
  projectId: string;
  mcpConnected: boolean;
}) {
  // Seed the form: projectId is always the current project; other params start
  // empty (or their JSON placeholder).
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const param of tool.params) {
      initial[param.name] = param.name === "projectId" ? projectId : "";
    }
    return initial;
  });

  const args = buildArgs(tool, values, projectId);
  const invocation = buildToolInvocation(tool.name, args);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-mono text-lg font-semibold">{tool.name}</h1>
        <p className="mt-1 text-sm text-base-content/70">{tool.description}</p>
      </div>

      <div className="card bg-base-100 border border-base-300">
        <div className="card-body gap-3 p-4">
          <h2 className="text-sm font-medium">Arguments</h2>
          {tool.params.length === 0 && (
            <p className="text-sm text-base-content/60">
              This tool takes no arguments.
            </p>
          )}
          {tool.params.map((param) => (
            <ParamField
              key={param.name}
              param={param}
              value={values[param.name] ?? ""}
              readOnly={param.name === "projectId"}
              onChange={(next) =>
                setValues((prev) => ({ ...prev, [param.name]: next }))
              }
            />
          ))}
        </div>
      </div>

      <div className="card bg-base-100 border border-base-300">
        <div className="card-body gap-3 p-4">
          <div className="flex items-center gap-2">
            <Terminal className="size-4" />
            <h2 className="text-sm font-medium">Run it from your terminal</h2>
          </div>
          <p className="text-xs text-base-content/60">
            Connect the OpenSEO MCP server once (see AI &amp; MCP), then run:
          </p>
          <CommandBlock
            label="Claude Code"
            command={invocation.claudeCommand}
          />
          <CommandBlock label="Codex" command={invocation.codexCommand} />
          <CommandBlock
            label="Raw MCP arguments"
            command={invocation.argsJson}
          />
        </div>
      </div>
    </div>
  );
}

function ParamField({
  param,
  value,
  readOnly,
  onChange,
}: {
  param: ToolDescriptor["params"][number];
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="form-control">
      <span className="label-text flex items-center gap-2 text-xs">
        <span className="font-mono">{param.name}</span>
        {param.required && (
          <span className="badge badge-ghost badge-xs">required</span>
        )}
      </span>
      {param.description && (
        <span className="mb-1 text-xs text-base-content/50">
          {param.description}
        </span>
      )}
      {param.kind === "boolean" ? (
        <select
          className="select select-bordered select-sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">— unset —</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : param.kind === "enum" ? (
        <select
          className="select select-bordered select-sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">— unset —</option>
          {param.enumValues?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : param.kind === "json" ? (
        <textarea
          className="textarea textarea-bordered font-mono text-xs"
          rows={3}
          placeholder='e.g. [{"seed":"coffee"}]'
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className="input input-bordered input-sm font-mono"
          value={value}
          readOnly={readOnly}
          inputMode={param.kind === "number" ? "numeric" : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function CommandBlock({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-base-content/60">
          {label}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => {
            void navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-base-200 p-3 text-xs">
        <code className="whitespace-pre-wrap break-all">{command}</code>
      </pre>
    </div>
  );
}

/** Assemble a clean args object from the form values, parsing per kind. */
function buildArgs(
  tool: ToolDescriptor,
  values: Record<string, string>,
  projectId: string,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const param of tool.params) {
    if (param.name === "projectId") {
      args.projectId = projectId;
      continue;
    }
    const raw = (values[param.name] ?? "").trim();
    if (!raw) continue;
    switch (param.kind) {
      case "number": {
        const parsed = Number(raw);
        args[param.name] = Number.isNaN(parsed) ? raw : parsed;
        break;
      }
      case "boolean":
        args[param.name] = raw === "true";
        break;
      case "json":
        try {
          args[param.name] = JSON.parse(raw);
        } catch {
          // Leave invalid JSON as a string so the user sees their input echoed.
          args[param.name] = raw;
        }
        break;
      default:
        args[param.name] = raw;
    }
  }
  return args;
}
