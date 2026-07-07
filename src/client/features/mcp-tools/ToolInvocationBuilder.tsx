import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, Play, Terminal } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  type getMcpToolsConsole,
  runMcpTool,
} from "@/serverFunctions/mcpTools";
import { buildToolInvocation } from "@/shared/mcpToolInvocation";
import { LocalTerminalPanel } from "@/client/features/mcp-tools/LocalTerminalPanel";

type Catalog = Awaited<ReturnType<typeof getMcpToolsConsole>>;
export type ToolDescriptor = Catalog["tools"][number];

export function ToolInvocationBuilder({
  tool,
  projectId,
}: {
  tool: ToolDescriptor;
  projectId: string;
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

  const runMutation = useMutation({
    mutationFn: () =>
      runMcpTool({ data: { projectId, toolName: tool.name, args } }),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Tool run failed")),
  });

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
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={runMutation.isPending}
              onClick={() => runMutation.mutate()}
            >
              {runMutation.isPending ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <Play className="size-4" />
              )}
              Run
            </button>
          </div>
        </div>
      </div>

      {(runMutation.isPending || runMutation.data || runMutation.error) && (
        <ToolResultPanel
          isPending={runMutation.isPending}
          result={runMutation.data}
          error={
            runMutation.error
              ? getStandardErrorMessage(runMutation.error, "Tool run failed")
              : null
          }
        />
      )}

      <div className="card bg-base-100 border border-base-300">
        <div className="card-body gap-3 p-4">
          <div className="flex items-center gap-2">
            <Terminal className="size-4" />
            <h2 className="text-sm font-medium">
              Or run it from your terminal
            </h2>
          </div>
          <p className="text-xs text-base-content/60">
            To drive it from an AI agent instead, connect the OpenSEO MCP server
            once (see AI &amp; MCP), then run:
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

      <LocalTerminalPanel
        claudeCommand={invocation.claudeCommand}
        codexCommand={invocation.codexCommand}
      />
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
        <>
          <textarea
            className="textarea textarea-bordered font-mono text-xs"
            rows={3}
            placeholder='JSON, e.g. [{"seed":"coffee"}]'
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          {param.schemaHint && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-base-content/50">
                Expected shape
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-base-200 p-2 text-xs">
                <code>{param.schemaHint}</code>
              </pre>
            </details>
          )}
        </>
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

function ToolResultPanel({
  isPending,
  result,
  error,
}: {
  isPending: boolean;
  result: { text: string; structuredJson: string | null } | undefined;
  error: string | null;
}) {
  return (
    <div
      className={`card border bg-base-100 ${error ? "border-error/40" : "border-primary/40"}`}
    >
      <div className="card-body gap-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Play className={`size-4 ${error ? "text-error" : "text-primary"}`} />
          Result
        </h2>
        {isPending ? (
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <span className="loading loading-spinner loading-sm" />
            Running…
          </div>
        ) : error ? (
          <pre className="overflow-x-auto rounded-lg bg-error/10 p-3 text-xs text-error">
            <code className="whitespace-pre-wrap">{error}</code>
          </pre>
        ) : result ? (
          <>
            {result.text && (
              <pre className="overflow-x-auto rounded-lg bg-base-200 p-3 text-xs">
                <code className="whitespace-pre-wrap">{result.text}</code>
              </pre>
            )}
            {result.structuredJson && (
              <div>
                <p className="mb-1 text-xs font-medium text-base-content/60">
                  Structured data
                </p>
                <pre className="max-h-96 overflow-auto rounded-lg bg-base-200 p-3 text-xs">
                  <code>{result.structuredJson}</code>
                </pre>
              </div>
            )}
            {!result.text && !result.structuredJson && (
              <p className="text-sm text-base-content/60">
                The tool returned no content.
              </p>
            )}
          </>
        ) : null}
      </div>
    </div>
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
