// stdio transport (CONCEPT.md §58, Phase 1 — primary): JSON-RPC / MCP over stdin/stdout.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AppConfig } from "../config.js";
import { buildServer } from "./server.js";

export async function runServer(config: AppConfig): Promise<void> {
  const server = buildServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
