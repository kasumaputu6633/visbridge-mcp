// Token/cost estimation and structured per-call logging (stderr only).

import type { TokenUsage } from "../core/types.js";

// Pricing per million tokens (USD).
const PRICING_TABLE: Record<string, { promptPerM: number; completionPerM: number }> = {
  "ag/gemini-3.6-flash-medium": { promptPerM: 0.075, completionPerM: 0.3 },
  "ag/gemini-3.6-flash-high": { promptPerM: 0.075, completionPerM: 0.3 },
  "gemini-1.5-flash": { promptPerM: 0.075, completionPerM: 0.3 },
  "gemini-1.5-pro": { promptPerM: 1.25, completionPerM: 5.0 },
  "gpt-4o-mini": { promptPerM: 0.15, completionPerM: 0.6 },
  "gpt-4o": { promptPerM: 2.5, completionPerM: 10.0 },
};

export function estimateTokenCost(
  model: string,
  promptTokens: number | "unavailable",
  completionTokens: number | "unavailable",
): number | "unavailable" {
  if (promptTokens === "unavailable" || completionTokens === "unavailable") {
    return "unavailable";
  }

  const rates = PRICING_TABLE[model] ?? { promptPerM: 0.1, completionPerM: 0.4 };
  const cost =
    (promptTokens / 1_000_000) * rates.promptPerM +
    (completionTokens / 1_000_000) * rates.completionPerM;

  return round(cost, 6);
}

export function fillCostUsd(usage: TokenUsage, model: string): TokenUsage {
  if (usage.estimatedCostUsd !== "unavailable") return usage;
  return {
    ...usage,
    estimatedCostUsd: estimateTokenCost(model, usage.promptTokens, usage.completionTokens),
  };
}

export interface CallLogEntry {
  model: string;
  provider: string;
  mode: string;
  detail: string;
  latencyMs: number;
  usage: TokenUsage;
  errorCode?: string;
}

// Emit one JSON line per call to stderr. stdout is reserved for JSON-RPC, and
// secrets / URLs / image content must never appear in logs.
export function logCall(entry: CallLogEntry, write: (line: string) => void = defaultWrite): void {
  const line = JSON.stringify(entry);
  write(line);
}

function defaultWrite(line: string): void {
  process.stderr.write(`${line}\n`);
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
