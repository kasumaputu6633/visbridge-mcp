#!/usr/bin/env node
// Entrypoint: run the stdio MCP server, or a CLI subcommand when args are given.

import { runCli } from "./cli/index.js";
import { loadConfig } from "./config.js";
import { runHttpServer } from "./transports/http.js";
import { runServer } from "./transports/stdio.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    await runCli(args);
    return;
  }

  const config = loadConfig();
  if (config.transport === "http") {
    await runHttpServer(config);
  } else {
    await runServer(config);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`visbridge-mcp failed: ${message}\n`);
  process.exitCode = 1;
});
