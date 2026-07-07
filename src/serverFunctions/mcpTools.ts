import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { getMcpToolCatalog } from "@/server/features/mcp-tools/toolCatalog";
import { runMcpToolInApp } from "@/server/features/mcp-tools/runToolInApp";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";

/** The MCP tool catalog plus this deployment's MCP server URL, for the console. */
export const getMcpToolsConsole = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async () => {
    const mcpUrl = new URL("/mcp", getPublicOrigin(getRequest())).toString();
    return { mcpUrl, tools: getMcpToolCatalog() };
  });

const runMcpToolSchema = z.object({
  projectId: z.string().min(1),
  toolName: z.string().min(1),
  // Raw args from the console form; the tool's own schema validates them.
  args: z.record(z.string(), z.unknown()),
});

/**
 * Executes an MCP tool in-app and returns its result, so the console can show
 * tool output in the page. Project-scoped auth mirrors the MCP path (the tool
 * re-checks project ownership against the caller's organization).
 */
export const runMcpTool = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => runMcpToolSchema.parse(data))
  .handler(async ({ data, context }) => {
    const baseUrl = getPublicOrigin(getRequest());
    const result = await runMcpToolInApp({
      toolName: data.toolName,
      // Force the caller's project so a tool can't be scoped elsewhere.
      args: { ...data.args, projectId: context.projectId },
      auth: {
        userId: context.userId,
        userEmail: context.userEmail,
        organizationId: context.organizationId,
        baseUrl,
      },
    });
    // Pre-serialize the arbitrary structured content so the server-function
    // response stays a concrete JSON-friendly type.
    return {
      text: result.text,
      structuredJson:
        result.structuredContent != null
          ? JSON.stringify(result.structuredContent, null, 2)
          : null,
    };
  });
