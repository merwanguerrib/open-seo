import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getMcpToolCatalog } from "@/server/features/mcp-tools/toolCatalog";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

/** The MCP tool catalog plus this deployment's MCP server URL, for the console. */
export const getMcpToolsConsole = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async () => {
    const mcpUrl = new URL("/mcp", getPublicOrigin(getRequest())).toString();
    return { mcpUrl, tools: getMcpToolCatalog() };
  });
