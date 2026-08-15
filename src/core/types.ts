// Canonical internal types (CONCEPT.md §40-41).

export type Mode = "describe" | "ocr" | "inspect";
export type Detail = "low" | "high";

// The tool contract allows "auto"; these are resolved before reaching a provider.
export type RequestedMode = "auto" | Mode;
export type RequestedDetail = "auto" | Detail;

export type ImageKind = "path" | "url" | "base64" | "resource";

export interface ImageRef {
  kind: ImageKind;
  value: string;
}

export interface ResolvedMedia {
  bytes: Buffer;
  mimeType: string;
  // When the image was supplied as a base64/data-URL string, the exact payload
  // the client already sent. Provider adapters use this directly instead of
  // re-encoding `bytes` — no decode→re-encode round-trip for large images.
  // Invalidated when preprocessing changes the bytes.
  dataUrl?: string;
  // Warnings from preprocessing (e.g. a local resize) to surface in the
  // tool result.
  warnings?: string[];
}

export interface TokenUsage {
  promptTokens: number | "unavailable";
  completionTokens: number | "unavailable";
  totalTokens: number | "unavailable";
  estimatedCostUsd: number | "unavailable";
}

// Fully-resolved request handed to a provider adapter.
export interface ProviderRequest {
  media: ResolvedMedia;
  mode: Mode;
  prompt?: string;
  context?: string;
  detail: Detail;
  outputBudget: number;
}

export interface ProviderResult {
  answer: string;
  usage: TokenUsage;
  truncated: boolean;
}

// Canonical tool output (CONCEPT.md Appendix A).
export interface VisionResult {
  answer: string;
  text?: string;
  warnings?: string[];
  truncated?: boolean;
}
