#!/usr/bin/env node
/**
 * OpenSEO local terminal bridge (opt-in, developer tool).
 *
 * Lets the OpenSEO MCP Tools console run `claude` / `codex` on YOUR machine, in
 * the folder where you launch this script, and stream the output back into the
 * browser page. It is intentionally locked down:
 *
 *   - binds to 127.0.0.1 only (never exposed to the network)
 *   - requires a random token (printed on start) on every request
 *   - only runs commands whose executable is `claude` or `codex`
 *   - runs in this script's working directory; the page cannot change it
 *   - kills any run after a timeout
 *
 * Usage:
 *   node scripts/mcp-terminal-bridge.mjs            # cwd = current folder
 *   node scripts/mcp-terminal-bridge.mjs --cwd /path/to/your/site
 *   OPENSEO_BRIDGE_PORT=4600 node scripts/mcp-terminal-bridge.mjs
 *
 * Because browsers block https→http requests (mixed content), use this from an
 * OpenSEO opened over http:// (local dev or a self-hosted http instance).
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { cwd: { type: "string" }, port: { type: "string" } },
});

const PORT = Number(values.port ?? process.env.OPENSEO_BRIDGE_PORT ?? 4600);
const CWD = values.cwd ?? process.cwd();
const TOKEN =
  process.env.OPENSEO_BRIDGE_TOKEN ?? randomBytes(24).toString("hex");
const ALLOWED_EXECUTABLES = new Set(["claude", "codex"]);
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** Only allow localhost origins so a random public site can't reach the bridge. */
function isLocalOrigin(origin) {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (isLocalOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

/** The command's executable must be on the allowlist. */
function executableOf(command) {
  return command.trim().split(/\s+/, 1)[0] ?? "";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 100_000) reject(new Error("Body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sse(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

const server = createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, cwd: CWD }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/run") {
    res.writeHead(404).end("Not found");
    return;
  }

  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid or missing bridge token" }));
    return;
  }

  let command;
  try {
    const body = JSON.parse(await readBody(req));
    command = typeof body.command === "string" ? body.command : "";
  } catch {
    res.writeHead(400).end("Invalid JSON");
    return;
  }

  const executable = executableOf(command);
  if (!ALLOWED_EXECUTABLES.has(executable)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: `Only ${[...ALLOWED_EXECUTABLES].join(" / ")} commands are allowed (got "${executable}")`,
      }),
    );
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  sse(res, "start", { command, cwd: CWD });

  const child = spawn(command, { shell: true, cwd: CWD });
  const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);

  child.stdout.on("data", (chunk) =>
    sse(res, "stdout", { chunk: chunk.toString() }),
  );
  child.stderr.on("data", (chunk) =>
    sse(res, "stderr", { chunk: chunk.toString() }),
  );
  child.on("error", (error) =>
    sse(res, "stderr", { chunk: `${error.message}\n` }),
  );
  child.on("close", (code) => {
    clearTimeout(timer);
    sse(res, "exit", { code });
    res.end();
  });

  req.on("close", () => {
    clearTimeout(timer);
    child.kill("SIGKILL");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("OpenSEO terminal bridge running.");
  console.log(`  URL:   http://127.0.0.1:${PORT}`);
  console.log(`  Token: ${TOKEN}`);
  console.log(`  CWD:   ${CWD}`);
  console.log("  Allowed: claude, codex");
  console.log("\nPaste the URL + token into the OpenSEO MCP Tools console.");
});
