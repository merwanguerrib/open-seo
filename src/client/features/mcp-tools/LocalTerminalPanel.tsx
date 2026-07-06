import * as React from "react";
import { Play, TerminalSquare } from "lucide-react";

const URL_KEY = "openseo.bridge.url";
const TOKEN_KEY = "openseo.bridge.token";
const DEFAULT_URL = "http://127.0.0.1:4600";

type Line = { stream: "stdout" | "stderr" | "meta"; text: string };

/**
 * Opt-in advanced panel: streams a `claude` / `codex` command through a local
 * terminal bridge (scripts/mcp-terminal-bridge.mjs) running in the user's own
 * project folder, and shows the output in the page. Requires the bridge to be
 * running and an http (not https) OpenSEO origin — browsers block https→http.
 */
export function LocalTerminalPanel({
  claudeCommand,
  codexCommand,
}: {
  claudeCommand: string;
  codexCommand: string;
}) {
  const [bridgeUrl, setBridgeUrl] = React.useState("");
  const [token, setToken] = React.useState("");
  const [cli, setCli] = React.useState<"claude" | "codex">("claude");
  const [lines, setLines] = React.useState<Line[]>([]);
  const [running, setRunning] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  // Restore the bridge URL/token so they persist across tool selections.
  React.useEffect(() => {
    setBridgeUrl(localStorage.getItem(URL_KEY) ?? DEFAULT_URL);
    setToken(localStorage.getItem(TOKEN_KEY) ?? "");
  }, []);

  const command = cli === "claude" ? claudeCommand : codexCommand;

  const run = async () => {
    localStorage.setItem(URL_KEY, bridgeUrl);
    localStorage.setItem(TOKEN_KEY, token);
    setLines([]);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${bridgeUrl.replace(/\/$/, "")}/run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ command }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const message = await response.text().catch(() => response.statusText);
        setLines([{ stream: "stderr", text: message || "Bridge error" }]);
        return;
      }

      await readSse(response.body, (event, data) => {
        if (event === "start") {
          const shown =
            typeof data.command === "string" ? data.command : command;
          appendLine(setLines, { stream: "meta", text: `$ ${shown}` });
        } else if (event === "stdout" || event === "stderr") {
          if (typeof data.chunk === "string") {
            appendLine(setLines, { stream: event, text: data.chunk });
          }
        } else if (event === "exit") {
          const code = typeof data.code === "number" ? data.code : "?";
          appendLine(setLines, {
            stream: "meta",
            text: `\n[exited with code ${code}]`,
          });
        }
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        setLines((prev) => [
          ...prev,
          {
            stream: "stderr",
            text:
              error instanceof Error &&
              error.message.includes("Failed to fetch")
                ? "Could not reach the bridge. Is it running, and is OpenSEO opened over http?"
                : error instanceof Error
                  ? error.message
                  : "Run failed",
          },
        ]);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  return (
    <details className="card border border-base-300 bg-base-100">
      <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-medium">
        <TerminalSquare className="size-4" />
        Run in your local terminal (agentic — advanced)
      </summary>
      <div className="card-body gap-3 border-t border-base-300 p-4">
        <p className="text-xs text-base-content/60">
          Start the bridge in your project folder, then paste its URL and token:
        </p>
        <pre className="overflow-x-auto rounded-lg bg-base-200 p-2 text-xs">
          <code>pnpm mcp:bridge</code>
        </pre>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className="input input-bordered input-sm font-mono"
            placeholder="http://127.0.0.1:4600"
            value={bridgeUrl}
            onChange={(event) => setBridgeUrl(event.target.value)}
          />
          <input
            className="input input-bordered input-sm font-mono"
            placeholder="Bridge token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <select
            className="select select-bordered select-sm"
            value={cli}
            onChange={(event) =>
              setCli(event.target.value === "codex" ? "codex" : "claude")
            }
          >
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={running || !token.trim()}
            onClick={() => void run()}
          >
            {running ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <Play className="size-4" />
            )}
            Run in local terminal
          </button>
        </div>

        {lines.length > 0 && (
          <pre className="max-h-96 overflow-auto rounded-lg bg-neutral p-3 text-xs text-neutral-content">
            <code>
              {lines.map((line, index) => (
                <span
                  key={index}
                  className={
                    line.stream === "stderr"
                      ? "text-error"
                      : line.stream === "meta"
                        ? "text-info"
                        : ""
                  }
                >
                  {line.text}
                </span>
              ))}
            </code>
          </pre>
        )}
      </div>
    </details>
  );
}

function appendLine(
  setLines: React.Dispatch<React.SetStateAction<Line[]>>,
  line: Line,
) {
  setLines((prev) => [...prev, line]);
}

/** Minimal SSE reader over a fetch response body. */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      handleFrame(frame, onEvent);
      separator = buffer.indexOf("\n\n");
    }
  }
}

function handleFrame(
  frame: string,
  onEvent: (event: string, data: Record<string, unknown>) => void,
): void {
  let event = "message";
  let dataLine = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
  }
  if (!dataLine) return;
  try {
    const parsed: unknown = JSON.parse(dataLine);
    onEvent(event, isRecord(parsed) ? parsed : {});
  } catch {
    // Ignore malformed frames.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
