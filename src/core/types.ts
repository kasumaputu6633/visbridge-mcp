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
