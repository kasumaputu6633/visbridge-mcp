import assert from "node:assert/strict";
import { test } from "node:test";
import type { TokenUsage } from "../core/types.js";
import { estimateTokenCost, fillCostUsd } from "./usage.js";

test("estimateTokenCost returns unavailable when tokens are unavailable", () => {
  assert.equal(estimateTokenCost("gpt-4o", "unavailable", 10), "unavailable");
  assert.equal(estimateTokenCost("gpt-4o", 10, "unavailable"), "unavailable");
});

test("estimateTokenCost computes a known-model cost", () => {
  // gpt-4o: $2.50/1M prompt, $10.00/1M completion.
  assert.equal(estimateTokenCost("gpt-4o", 1_000_000, 1_000_000), 12.5);
});

test("fillCostUsd leaves an existing cost untouched", () => {
  const usage: TokenUsage = {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    estimatedCostUsd: 0.123,
  };
  assert.equal(fillCostUsd(usage, "gpt-4o").estimatedCostUsd, 0.123);
});

test("fillCostUsd fills a missing cost", () => {
  const usage: TokenUsage = {
    promptTokens: 1_000_000,
    completionTokens: 1_000_000,
    totalTokens: 2_000_000,
    estimatedCostUsd: "unavailable",
  };
  assert.equal(fillCostUsd(usage, "gpt-4o").estimatedCostUsd, 12.5);
});
