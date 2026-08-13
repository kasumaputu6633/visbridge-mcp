// Streamable HTTP transport (CONCEPT.md §60, Phase 2): remote / shared / team deployments.
// The HTTP layer is only a transport adapter — the core (`buildServer`) is unchanged.
//
// Stateless mode (MCP 2026-07-28 stateless protocol core): the SDK requires a *fresh*
// transport per request (reusing a stateless transport 500s with message-id collisions),
// and `McpServer.connect()` owns a single transport — so each `/mcp` request builds a
// fresh McpServer + transport. `buildServer` is cheap (one tool), so this is fine.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AppConfig } from "../config.js";
import { safeErrorMessage } from "../core/errors.js";
import { buildServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

export async function runHttpServer(config: AppConfig): Promise<void> {
  const httpServer = createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0];

    if (pathname === "/mcp") {
      void handleMcpRequest(req, res, config);
      return;
    }

    if (pathname === "/health" || pathname === "/healthz" || pathname === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: SERVER_NAME, version: SERVER_VERSION }));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  // Graceful shutdown.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      httpServer.close(() => process.exit(0));
    });
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.httpPort, config.httpHost, () => {
      process.stderr.write(
        `visbridge-mcp listening on http://${config.httpHost}:${config.httpPort}/mcp\n`,
      );
      resolve();
    });
  });
}

async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: AppConfig,
): Promise<void> {
  // No standalone SSE streams: this is a request/response-only service (no
  // server-initiated messages). Clients open the stream opportunistically and
  // ignore the failure.
  if (req.method === "GET") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("standalone SSE streams are not supported; POST JSON-RPC to /mcp");
    return;
  }

  const server = buildServer(config);
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    process.stderr.write(`[http] request failed: ${safeErrorMessage(error)}\n`);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: "internal_error" }));
  } finally {
    await transport.close().catch(() => {});
  }
}
