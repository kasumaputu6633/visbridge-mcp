// Integration test for the Streamable HTTP transport (Phase 2): spawn the server in
// HTTP mode with dummy credentials, wait for /health, then drive it with the SDK's
// StreamableHTTPClientTransport — localhost only, no API key, no provider call.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const entryPoint = fileURLToPath(new URL("index.ts", import.meta.url));

interface CallResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}

function makePort(): number {
  // High, per-process port to avoid collisions across parallel test files.
  return 21_000 + (process.pid % 1_000);
}

async function waitForHealth(baseUrl: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // server not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`HTTP server did not become ready at ${baseUrl}`);
}

async function startHttpServer(): Promise<{
  child: ReturnType<typeof spawn>;
  baseUrl: string;
}> {
  const port = makePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx", entryPoint], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH ?? "",
      VISION_TRANSPORT: "http",
      VISION_HTTP_HOST: "127.0.0.1",
      VISION_HTTP_PORT: String(port),
      VISION_BASE_URL: "http://127.0.0.1:1/v1",
      VISION_API_KEY: "test-key",
      VISION_MODEL: "test-model",
    },
    stdio: "ignore",
  });

  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    child.kill();
    throw error;
  }

  return { child, baseUrl };
}

test(
  "http transport serves analyze_image over /mcp",
  { timeout: 30_000 },
  async () => {
    const { child, baseUrl } = await startHttpServer();
    const client = new Client({ name: "integration-http", version: "1.0.0" });
    try {
      const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
      await client.connect(transport);

      const { tools } = await client.listTools();
      const tool = tools.find((candidate) => candidate.name === "analyze_image");
      assert.ok(tool, "analyze_image should be listed over HTTP");
      assert.equal(tool.inputSchema.type, "object");
      assert.ok(tool.inputSchema.properties?.image, "input should declare an image property");

      const result = (await client.callTool({
        name: "analyze_image",
        arguments: { image: { kind: "path", value: "/nonexistent.png" } },
      })) as CallResult;
      assert.equal(result.isError, true);
      assert.match(result.content?.[0]?.text ?? "", /invalid_input/);
    } finally {
      await client.close().catch(() => {});
      child.kill();
    }
  },
);
