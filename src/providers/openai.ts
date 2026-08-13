// OpenAI Responses API adapter — scaffold only (CONCEPT.md §44-46).
// The real provider in use is OpenAI-compatible (chat completions); this
// adapter exists to satisfy the registry and is not yet implemented.

import type { AppConfig } from "../config.js";
import type { Capabilities } from "../core/capabilities.js";
import { VisionError } from "../core/errors.js";
import type { ProviderRequest, ProviderResult } from "../core/types.js";

export class OpenAIAdapter {
  constructor(private readonly config: AppConfig) {}

  getCapabilities(): Capabilities {
    return {
      provider: "openai",
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

  async analyze(_request: ProviderRequest): Promise<ProviderResult> {
    throw new VisionError(
      "unsupported_capability",
      "The 'openai' provider (Responses API) is not implemented yet; use VISION_PROVIDER=openai-compatible",
    );
  }
}
