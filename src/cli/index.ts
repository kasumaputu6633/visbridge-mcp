// CLI dispatch: init | config | doctor | help.

import { loadConfig } from "../config.js";
import { runDoctor } from "./doctor.js";

export async function runCli(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  switch (command) {
    case "init":
      return runInit();
    case "config":
      return runConfig();
    case "doctor":
      return runDoctor(rest[0]);
    case "help":
    case "--help":
    case "-h":
      return printHelp();
    default:
      process.stderr.write(`Unknown command: ${command ?? ""}\n\n`);
      printHelp();
      process.exitCode = 1;
  }
}

function runInit(): void {
  const snippet = JSON.stringify(
    {
      mcpServers: {
        visbridge: {
          command: "npx",
          args: ["-y", "visbridge-mcp"],
          env: {
            VISION_BASE_URL: "https://example.com/v1",
            VISION_API_KEY: "sk-...",
            VISION_MODEL: "ag/gemini-3.6-flash-medium",
          },
        },
      },
    },
    null,
    2,
  );

  process.stdout.write(
    [
      "Paste this into your MCP client config (Claude Code: `claude mcp add` or ~/.claude.json):",
      "",
      snippet,
      "",
      "Then verify with:  VISION_BASE_URL=... VISION_API_KEY=... VISION_MODEL=... npx -y visbridge-mcp doctor",
      "",
    ].join("\n"),
  );
}

function runConfig(): void {
  const config = loadConfig();
  process.stdout.write(
    [
      "Effective configuration (secrets redacted):",
      `  VISION_BASE_URL   = ${config.baseUrl}`,
      `  VISION_API_KEY    = ${maskSecret(config.apiKey)}`,
      `  VISION_MODEL      = ${config.model}`,
      `  VISION_PROVIDER   = ${config.provider}`,
      `  describe budget   = ${config.describeOutputBudget} tokens`,
      `  inspect budget    = ${config.inspectOutputBudget} tokens`,
      `  ocr budget        = ${config.ocrOutputBudget} tokens`,
      `  timeout           = ${config.timeoutMs} ms`,
      `  max image bytes   = ${config.maxImageBytes}`,
      `  max redirects     = ${config.maxRedirects}`,
      `  ssrf allow hosts  = ${config.ssrfAllowHosts.join(", ") || "(none)"}`,
      `  resource dir      = ${config.resourceDir ?? "(not set)"}`,
      `  transport         = ${config.transport}`,
      `  http host         = ${config.httpHost}`,
      `  http port         = ${config.httpPort}`,
      "",
    ].join("\n"),
  );
}

function printHelp(): void {
  process.stdout.write(
    [
      "visbridge-mcp — token-efficient vision for MCP clients",
      "",
      "Usage:",
      "  visbridge-mcp              start the MCP server (stdio; VISION_TRANSPORT=http for HTTP)",
      "  visbridge-mcp init         print a ready-to-paste client config",
      "  visbridge-mcp config       print effective (redacted) configuration",
      "  visbridge-mcp doctor [img] run a live describe + ocr against an image",
      "",
    ].join("\n"),
  );
}

function maskSecret(secret: string): string {
  if (secret.length <= 4) return "••••";
  return `••••${secret.slice(-4)}`;
}
