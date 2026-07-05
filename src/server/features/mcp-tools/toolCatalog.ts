import { z } from "zod";
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

// A registered MCP tool, reduced to the fields the console needs. The tool
// objects have heterogeneous handler generics, so we type only the shared
// metadata surface.
type RegisteredTool = {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema: z.ZodRawShape;
  };
};

// Grouping + ordering mirror the AI & MCP page's catalog.
const TOOL_GROUPS: Array<{ category: string; tools: RegisteredTool[] }> = [
  {
    category: "Account",
    tools: [whoamiTool, listProjectsTool],
  },
  {
    category: "Keywords",
    tools: [
      researchKeywordsTool,
      getKeywordMetricsTool,
      getRankTrackerTool,
      listSavedKeywordsTool,
      saveKeywordsTool,
    ],
  },
  {
    category: "Competitive Research",
    tools: [
      getSerpResultsTool,
      findSerpCompetitorsTool,
      getRankedKeywordsTool,
      getDomainOverviewTool,
      getDomainKeywordSuggestionsTool,
      getBacklinksOverviewTool,
      getBacklinksProfileTool,
    ],
  },
  {
    category: "Local Business",
    tools: [
      searchLocalBusinessesTool,
      getLocalSerpResultsTool,
      getGoogleBusinessQuestionsTool,
    ],
  },
  {
    category: "Search Console",
    tools: [getSearchConsolePerformanceTool, inspectUrlsTool],
  },
];

type McpToolParam = {
  name: string;
  required: boolean;
  description: string | null;
  /** Rendered control: scalar controls get a field; `json` gets a JSON textarea. */
  kind: "string" | "number" | "boolean" | "enum" | "json";
  /** For `enum`, the allowed values (also covers const/literal unions). */
  enumValues?: string[];
};

type McpToolDescriptor = {
  name: string;
  title: string;
  description: string;
  category: string;
  params: McpToolParam[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Collect the allowed values of an enum / union-of-consts JSON Schema node. */
function readEnumValues(schema: Record<string, unknown>): string[] | null {
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value) => String(value));
  }
  if (Array.isArray(schema.anyOf)) {
    const consts = schema.anyOf
      .map((branch) =>
        isRecord(branch) && "const" in branch ? String(branch.const) : null,
      )
      .filter((value): value is string => value !== null);
    if (consts.length === schema.anyOf.length && consts.length > 0) {
      return consts;
    }
  }
  return null;
}

function paramKind(schema: Record<string, unknown>): {
  kind: McpToolParam["kind"];
  enumValues?: string[];
} {
  const enumValues = readEnumValues(schema);
  if (enumValues) return { kind: "enum", enumValues };

  const type = typeof schema.type === "string" ? schema.type : null;
  switch (type) {
    case "string":
      return { kind: "string" };
    case "number":
    case "integer":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    default:
      // Arrays, objects, and anything non-scalar are edited as raw JSON.
      return { kind: "json" };
  }
}

function describeTool(
  tool: RegisteredTool,
  category: string,
): McpToolDescriptor {
  const jsonSchema = z.toJSONSchema(z.object(tool.config.inputSchema), {
    io: "input",
    // Unrepresentable pieces shouldn't throw — the console degrades to JSON.
    unrepresentable: "any",
  });
  const properties = isRecord(jsonSchema.properties)
    ? jsonSchema.properties
    : {};
  const required = new Set(
    Array.isArray(jsonSchema.required)
      ? jsonSchema.required.map((name) => String(name))
      : [],
  );

  const params: McpToolParam[] = Object.entries(properties).map(
    ([name, raw]) => {
      const schema = isRecord(raw) ? raw : {};
      const { kind, enumValues } = paramKind(schema);
      return {
        name,
        required: required.has(name),
        description:
          typeof schema.description === "string" ? schema.description : null,
        kind,
        ...(enumValues ? { enumValues } : {}),
      };
    },
  );

  return {
    name: tool.name,
    title: tool.config.title ?? tool.name,
    description: tool.config.description ?? "",
    category,
    params,
  };
}

/** The full MCP tool catalog with per-param descriptors for the console. */
export function getMcpToolCatalog(): McpToolDescriptor[] {
  return TOOL_GROUPS.flatMap((group) =>
    group.tools.map((tool) => describeTool(tool, group.category)),
  );
}
