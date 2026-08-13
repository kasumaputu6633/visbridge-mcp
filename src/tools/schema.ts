// Zod schemas for the `analyze_image` tool (CONCEPT.md Appendix A).
// The MCP SDK serializes these to JSON Schema for tools/list.

import * as z from "zod/v4";

export const ANALYZE_IMAGE_DESCRIPTION =
  "Read or analyze an image you cannot view directly (for example, when you lack native vision). " +
  "Supply the image as a file path, URL, base64, or resource reference, and choose a mode: " +
  "describe (summarize it), ocr (extract its text), or inspect (answer a specific question via prompt).";

export const analyzeImageInputSchema = {
  image: z.object({
    kind: z.enum(["path", "url", "base64", "resource"]),
    value: z.string(),
  }),
  mode: z.enum(["auto", "describe", "ocr", "inspect"]).default("auto"),
  prompt: z.string().optional(),
  detail: z.enum(["low", "auto", "high"]).default("auto"),
};

export const analyzeImageOutputSchema = {
  answer: z.string(),
  text: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  truncated: z.boolean().optional(),
};
