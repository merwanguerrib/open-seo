/**
 * Builds ready-to-run CLI invocations that make Claude Code or Codex call a
 * specific OpenSEO MCP tool with given arguments. Pure and unit-testable; the
 * console renders the strings and the copy buttons.
 */

type ToolInvocation = {
  /** The natural-language instruction handed to the agent. */
  prompt: string;
  /** `claude -p '<prompt>'` */
  claudeCommand: string;
  /** `codex exec '<prompt>'` */
  codexCommand: string;
  /** Pretty-printed arguments object, for the "raw MCP args" view. */
  argsJson: string;
};

/** POSIX single-quote a string so it survives the shell verbatim. */
function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function buildToolInvocation(
  toolName: string,
  args: Record<string, unknown>,
): ToolInvocation {
  const compactArgs = JSON.stringify(args);
  const prompt =
    `Use the OpenSEO MCP server's \`${toolName}\` tool with these arguments: ` +
    `${compactArgs}. Return the result.`;
  const quoted = shellSingleQuote(prompt);

  return {
    prompt,
    claudeCommand: `claude -p ${quoted}`,
    codexCommand: `codex exec ${quoted}`,
    argsJson: JSON.stringify(args, null, 2),
  };
}
