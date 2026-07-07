/**
 * Runs an OpenSEO MCP tool in-app — the same handlers the MCP server exposes,
 * so results are identical to the CLI/agent path. Auth is injected via the
 * tools' AsyncLocalStorage context (`runWithMcpToolAuthContext`), built from
 * the logged-in user, so the MCP request `extra` is never actually read.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MCP_OAUTH_SCOPES } from "@/lib/oauth-resource";
import { AppError } from "@/server/lib/errors";
import {
  runWithMcpToolAuthContext,
  type ToolExtra,
} from "@/server/mcp/context";
import { getBacklinksOverviewTool } from "@/server/mcp/tools/get-backlinks-overview";
import { getBacklinksProfileTool } from "@/server/mcp/tools/get-backlinks-profile";
import { getDomainKeywordSuggestionsTool } from "@/server/mcp/tools/get-domain-keyword-suggestions";
import { getDomainOverviewTool } from "@/server/mcp/tools/get-domain-overview";
import { getRankTrackerTool } from "@/server/mcp/tools/get-rank-tracker";
import { getSerpResultsTool } from "@/server/mcp/tools/get-serp-results";
import { listProjectsTool } from "@/server/mcp/tools/list-projects";
import { listSavedKeywordsTool } from "@/server/mcp/tools/list-saved-keywords";
import {
  findSerpCompetitorsTool,
  getGoogleBusinessQuestionsTool,
  getKeywordMetricsTool,
  getLocalSerpResultsTool,
  getRankedKeywordsTool,
  searchLocalBusinessesTool,
} from "@/server/mcp/tools/dataforseo-research-tools";
import { researchKeywordsTool } from "@/server/mcp/tools/research-keywords";
import { saveKeywordsTool } from "@/server/mcp/tools/save-keywords";
import {
  getSearchConsolePerformanceTool,
  inspectUrlsTool,
} from "@/server/mcp/tools/search-console-tools";
import { whoamiTool } from "@/server/mcp/tools/whoami";

type ToolRunner = (
  args: Record<string, unknown>,
  extra: ToolExtra,
) => Promise<CallToolResult> | CallToolResult;

/**
 * Registers a tool under its name with an adapter that validates the raw args
 * against the tool's own input schema before handing them to the real handler.
 * The generic `Shape` links `config.inputSchema` to the handler's arg type, so
 * the validated args match without a cast.
 */
function register<Shape extends z.ZodRawShape>(
  registry: Map<string, ToolRunner>,
  tool: {
    name: string;
    config: { inputSchema: Shape };
    handler: (
      args: z.infer<z.ZodObject<Shape>>,
      extra: ToolExtra,
    ) => Promise<CallToolResult> | CallToolResult;
  },
): void {
  registry.set(tool.name, (rawArgs, extra) => {
    const parsed = z.object(tool.config.inputSchema).parse(rawArgs);
    return tool.handler(parsed, extra);
  });
}

const TOOL_RUNNERS: Map<string, ToolRunner> = (() => {
  const registry = new Map<string, ToolRunner>();
  register(registry, whoamiTool);
  register(registry, listProjectsTool);
  register(registry, researchKeywordsTool);
  register(registry, getKeywordMetricsTool);
  register(registry, getRankTrackerTool);
  register(registry, listSavedKeywordsTool);
  register(registry, saveKeywordsTool);
  register(registry, getSerpResultsTool);
  register(registry, findSerpCompetitorsTool);
  register(registry, getRankedKeywordsTool);
  register(registry, getDomainOverviewTool);
  register(registry, getDomainKeywordSuggestionsTool);
  register(registry, getBacklinksOverviewTool);
  register(registry, getBacklinksProfileTool);
  register(registry, searchLocalBusinessesTool);
  register(registry, getLocalSerpResultsTool);
  register(registry, getGoogleBusinessQuestionsTool);
  register(registry, getSearchConsolePerformanceTool);
  register(registry, inspectUrlsTool);
  return registry;
})();

/** A `ToolExtra` stub — the handlers read auth from AsyncLocalStorage, not this. */
function inertToolExtra(): ToolExtra {
  return {
    signal: new AbortController().signal,
    requestId: 0,
    sendNotification: () => Promise.resolve(),
    sendRequest: () =>
      Promise.reject(new Error("sendRequest is unavailable for in-app runs")),
  };
}

function extractText(result: CallToolResult): string {
  return result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

export async function runMcpToolInApp(input: {
  toolName: string;
  args: Record<string, unknown>;
  auth: {
    userId: string;
    userEmail: string;
    organizationId: string;
    baseUrl: string;
  };
  // `unknown` structured content keeps the server-function serializer happy;
  // the console renders it as formatted JSON.
}): Promise<{ text: string; structuredContent: unknown }> {
  const runner = TOOL_RUNNERS.get(input.toolName);
  if (!runner) throw new AppError("NOT_FOUND", "Unknown MCP tool");

  const result = await runWithMcpToolAuthContext(
    {
      userId: input.auth.userId,
      userEmail: input.auth.userEmail,
      organizationId: input.auth.organizationId,
      clientId: null,
      scopes: [...MCP_OAUTH_SCOPES],
      audience: input.auth.baseUrl,
      subject: input.auth.userId,
      baseUrl: input.auth.baseUrl,
    },
    () => runner(input.args, inertToolExtra()),
  );

  return {
    text: extractText(result),
    structuredContent: result.structuredContent ?? null,
  };
}
