// Integration test: spawn the server as a child process and drive it with the
// MCP SDK client, exactly as a non-vision model's MCP client would. Uses dummy
// credentials and only exercises the fast (pre-provider) paths, so it runs with
// no network and no API key.

import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const entryPoint = fileURLToPath(new URL("index.ts", import.meta.url));

interface CallResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}

async function connect(): Promise<Client> {
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", entryPoint],
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH ?? "",
      VISION_BASE_URL: "http://127.0.0.1:1/v1",
      VISION_API_KEY: "test-key",
      VISION_MODEL: "test-model",
    },
    stderr: "ignore",
  });
  await client.connect(transport);
  return client;
}

test(
  "server exposes analyze_image over stdio",
  { timeout: 20_000 },
  async () => {
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((candidate) => candidate.name === "analyze_image");
      assert.ok(tool, "analyze_image should be listed");
      assert.equal(tool.inputSchema.type, "object");
      assert.ok(tool.inputSchema.properties?.image, "input should declare an image property");
      assert.ok(
        tool.outputSchema?.required?.includes("answer"),
        "output should require an answer",
      );
    } finally {
      await client.close();
    }
  },
);

test(
  "analyze_image returns a structured error for a missing file",
  { timeout: 20_000 },
  async () => {
    const client = await connect();
    try {
      const result = (await client.callTool({
        name: "analyze_image",
        arguments: { image: { kind: "path", value: "/nonexistent.png" } },
      })) as CallResult;

      assert.equal(result.isError, true);
      const text = result.content?.[0]?.text ?? "";
      assert.match(text, /invalid_input/);
    } finally {
      await client.close();
    }
  },
);
