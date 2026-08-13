// Provider registry: map config.provider to a concrete adapter.

import type { AppConfig } from "../config.js";
import type { VisionProviderAdapter } from "../core/capabilities.js";
import { OpenAIAdapter } from "./openai.js";
import { OpenAICompatibleAdapter } from "./openaiCompatible.js";

export function createAdapter(config: AppConfig): VisionProviderAdapter {
  if (config.provider === "openai") return new OpenAIAdapter(config);
  return new OpenAICompatibleAdapter(config);
}
