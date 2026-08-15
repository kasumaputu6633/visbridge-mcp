// Deterministic offline adapter: `VISION_PROVIDER=mock`.
// Lets `doctor`, `demo`, integration tests, and CI exercise the full
// resolve -> validate -> analyze -> normalize pipeline with zero credentials
// and zero network. Answers are derived from the mode, so output is stable.

import type { AppConfig } from "../config.js";
import type { Capabilities } from "../core/capabilities.js";
import type { ProviderRequest, ProviderResult } from "../core/types.js";

const MOCK_LATENCY_MS = 10;

export class MockAdapter {
  constructor(private readonly config: AppConfig) {}

  getCapabilities(): Capabilities {
    return {
      provider: "mock",
      supportsOcr: true,
      supportsInspect: true,
      detailLevels: ["low", "high"],
      maxOutputTokens: Math.max(
        this.config.describeOutputBudget,
        this.config.inspectOutputBudget,
        this.config.ocrOutputBudget,
      ),
    };
  }

  async analyze(request: ProviderRequest): Promise<ProviderResult> {
    await sleep(MOCK_LATENCY_MS);

    const answer = answerFor(request);
    return {
      answer,
      usage: {
        promptTokens: 1_000,
        completionTokens: Math.ceil(answer.length / 4),
        totalTokens: 1_000 + Math.ceil(answer.length / 4),
        estimatedCostUsd: 0,
      },
      truncated: false,
    };
  }
}

function answerFor(request: ProviderRequest): string {
  const { mode, media, prompt } = request;

  if (mode === "ocr") {
    return "mock ocr text";
  }
  if (mode === "inspect") {
    return `mock inspect answer to: ${prompt ?? "(no prompt)"}`;
  }
  return `mock description of a ${media.mimeType} image (${media.bytes.length} bytes)`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
