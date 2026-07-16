import { describe, expect, it } from "vitest";
import { buildToolInvocation } from "./mcpToolInvocation";

describe("buildToolInvocation", () => {
  it("embeds the tool name and compact args in the prompt", () => {
    const result = buildToolInvocation("research_keywords", {
      projectId: "p1",
      seeds: [{ seed: "coffee" }],
    });
    expect(result.prompt).toContain("`research_keywords`");
    expect(result.prompt).toContain(
      '{"projectId":"p1","seeds":[{"seed":"coffee"}]}',
    );
  });

  it("wraps the prompt in single quotes for both CLIs", () => {
    const result = buildToolInvocation("whoami", {});
    expect(result.claudeCommand.startsWith("claude -p '")).toBe(true);
    expect(result.claudeCommand.endsWith("'")).toBe(true);
    expect(result.codexCommand.startsWith("codex exec '")).toBe(true);
    // The apostrophe in "server's" is POSIX-escaped, not left bare.
    expect(result.claudeCommand).toContain(`server'\\''s`);
  });

  it("escapes single quotes in argument values", () => {
    const result = buildToolInvocation("get_serp_results", {
      keyword: "l'expresso",
    });
    // The embedded single quote is POSIX-escaped as '\'' so the shell keeps it.
    expect(result.claudeCommand).toContain(`l'\\''expresso`);
  });

  it("pretty-prints the raw args JSON", () => {
    const result = buildToolInvocation("get_domain_overview", {
      projectId: "p1",
      domain: "example.com",
    });
    expect(result.argsJson).toBe(
      '{\n  "projectId": "p1",\n  "domain": "example.com"\n}',
    );
  });
});
