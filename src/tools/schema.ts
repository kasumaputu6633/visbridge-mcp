// Zod schemas for the `analyze_image` tool (CONCEPT.md Appendix A).
// The MCP SDK serializes these to JSON Schema for tools/list.

import * as z from "zod/v4";

export const ANALYZE_IMAGE_DESCRIPTION =
  "See an image: describe it, read its text (OCR), or answer a question about it. " +
  "This is your vision capability — call it in the same turn whenever the user's request " +
  "involves an image (file path, URL, base64, or attachment), including design review, " +
  "'make this prettier', comparing screenshots, or 'what does this say'. Never say you " +
  "cannot see images; call this tool and answer from its result. " +
  "Image references: a real filesystem path -> kind:path; an http(s) link -> kind:url; " +
  "a pasted/attached image part (e.g. clipboard-*.png with a data:image/...;base64 URL) -> " +
  "kind:base64 with that data URL as the value (do NOT invent disk paths for attachment " +
  "filenames); a configured resource name -> kind:resource. " +
  "Choose a mode: " +
  "describe (summarize it), ocr (extract its text), or inspect (answer a specific question via prompt). " +
  "Set `context` to the user's actual request or intent (e.g. the original question about the image) " +
  "so the vision model focuses on what the user cares about — put the full user request in `context` " +
  "and only the specific question (if any) in `prompt`.";

export const analyzeImageInputSchema = {
  image: z.object({
    kind: z.enum(["path", "url", "base64", "resource"]),
    value: z.string(),
  }),
  mode: z.enum(["auto", "describe", "ocr", "inspect"]).default("auto"),
  prompt: z.string().optional(),
  context: z.string().optional(),
  detail: z.enum(["low", "auto", "high"]).default("auto"),
};

export const analyzeImageOutputSchema = {
  answer: z.string(),
  text: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  truncated: z.boolean().optional(),
};
