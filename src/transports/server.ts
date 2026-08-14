// Transport-agnostic server core (CONCEPT.md §59): build the McpServer and register
// tools here, independent of which transport (stdio / HTTP) is attached to it.
//
// The core bridge is transport-agnostic — the transport adapters only call
// `server.connect(transport)` with their own transport instance.

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import { isVisionError, safeErrorMessage } from "../core/errors.js";
import { AnalyzeImageTool, type AnalyzeImageInput } from "../tools/analyzeImage.js";
import {
  ANALYZE_IMAGE_DESCRIPTION,
  analyzeImageInputSchema,
  analyzeImageOutputSchema,
} from "../tools/schema.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

export const SERVER_NAME = "visbridge-mcp";
export const SERVER_VERSION = version;

export function buildServer(config: AppConfig): McpServer {
  const tool = new AnalyzeImageTool(config);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "analyze_image",
    {
      description: ANALYZE_IMAGE_DESCRIPTION,
      inputSchema: analyzeImageInputSchema,
      outputSchema: analyzeImageOutputSchema,
    },
    async (args) => {
      try {
        const result = await tool.run(args as AnalyzeImageInput);
        return {
          content: [{ type: "text", text: result.answer }],
          // Spread so the SDK's `structuredContent` index-signature type accepts it.
          structuredContent: { ...result },
        };
      } catch (error) {
        const message = isVisionError(error)
          ? `${error.code}: ${error.message}`
          : `internal_error: ${safeErrorMessage(error)}`;
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    },
  );

  return server;
}
