// A real MCP *client* that drives the server over stdio — the same way a
// non-vision model (Claude Code, Cursor, …) would. Run: `npm run demo [image]`.
//
// This proves the full loop: spawn server → MCP handshake → tools/list →
// tools/call → structured vision result returned to the client.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadConfig } from "./config.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const entryPoint = fileURLToPath(new URL("index.ts", import.meta.url));

interface CallResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: {
    answer?: string;
    text?: string;
    warnings?: string[];
    truncated?: boolean;
  };
}

export async function runDemo(imagePath?: string): Promise<void> {
  const config = loadConfig();
  const target = resolve(imagePath ?? "fixtures/images/dense-ui.png");

  write(`Vision MCP Bridge — demo (MCP client → analyze_image)\n`);
  write(`Model: ${config.model}  (provider: ${config.provider})\n`);
  write(`Connecting to the MCP server over stdio …\n\n`);

  const client = new Client({ name: "visbridge-demo", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", entryPoint],
    cwd: repoRoot,
    env: forwardEnv(),
    stderr: "inherit",
  });

  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    write(`Available tools (${tools.length}):\n`);
    for (const tool of tools) {
      write(`  • ${tool.name} — ${tool.description ?? "(no description)"}\n`);
    }
    write("\n");

    for (const mode of ["describe", "ocr"] as const) {
      write(`[${mode}] ${target}\n`);
      const startedAt = performance.now();
      const result = (await client.callTool({
        name: "analyze_image",
        arguments: { image: { kind: "path", value: target }, mode },
      })) as CallResult;
      const elapsedMs = Math.round(performance.now() - startedAt);

      if (result.isError) {
        write(`  ✗ error (${elapsedMs} ms): ${firstText(result)}\n\n`);
        continue;
      }

      const structured = result.structuredContent ?? {};
      const body = mode === "ocr" ? (structured.text ?? structured.answer ?? "") : (structured.answer ?? "");
      write(`  ✓ ok (${elapsedMs} ms)${structured.truncated ? "  [truncated]" : ""}\n`);
      write(`  ${preview(body)}\n\n`);
    }
  } finally {
    await client.close();
  }
}

function firstText(result: CallResult): string {
  return result.content?.map((block) => block.text ?? "").join(" ") ?? "(no message)";
}

function preview(text: string, max = 400): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= max) return singleLine;
  return `${singleLine.slice(0, max)}…`;
}

function write(line: string): void {
  process.stdout.write(line);
}

// `process.env` is `Record<string, string | undefined>`; the SDK client's `env`
// expects `Record<string, string>`, so drop any undefined entries.
function forwardEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

runDemo(process.argv[2]).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`demo failed: ${message}\n`);
  process.exitCode = 1;
});
