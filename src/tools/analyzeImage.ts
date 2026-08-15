// The `analyze_image` tool handler: resolve -> validate -> analyze -> normalize.

import type { AppConfig } from "../config.js";
import type { Capabilities } from "../core/capabilities.js";
import { VisionError } from "../core/errors.js";
import type {
  Detail,
  ImageRef,
  Mode,
  ProviderResult,
  RequestedDetail,
  RequestedMode,
  VisionResult,
} from "../core/types.js";
import { MediaResolver } from "../media/resolver.js";
import type { VisionProviderAdapter } from "../core/capabilities.js";
import { createAdapter } from "../providers/registry.js";
import { fillCostUsd, logCall } from "../observability/usage.js";
import { stripCodeFences } from "./prompt.js";

export interface AnalyzeImageInput {
  image: ImageRef;
  mode?: RequestedMode;
  prompt?: string;
  context?: string;
  detail?: RequestedDetail;
}

export class AnalyzeImageTool {
  private readonly resolver: MediaResolver;
  private readonly adapter: VisionProviderAdapter;

  constructor(private readonly config: AppConfig) {
    this.resolver = new MediaResolver(config);
    this.adapter = createAdapter(config);
  }

  getCapabilities(): Capabilities {
    return this.adapter.getCapabilities();
  }

  async run(input: AnalyzeImageInput): Promise<VisionResult> {
    const image = validateImage(input.image);
    const mode = resolveMode(input.mode ?? "auto", input.prompt);
    const detail = resolveDetail(input.detail ?? "auto");
    const outputBudget = budgetFor(mode, this.config);

    const adapter = this.adapter;
    const media = await this.resolver.resolve(image);

    const startedAt = performance.now();
    let providerResult: ProviderResult;
    try {
      providerResult = await adapter.analyze({
        media,
        mode,
        prompt: input.prompt,
        context: input.context,
        detail,
        outputBudget,
      });
    } catch (error) {
      const visionError = toVisionError(error);
      logCall({
        model: this.config.model,
        provider: this.config.provider,
        mode,
        detail,
        latencyMs: Math.round(performance.now() - startedAt),
        usage: emptyUsage(),
        errorCode: visionError.code,
      });
      throw visionError;
    }
    const latencyMs = Math.round(performance.now() - startedAt);

    const usage = fillCostUsd(providerResult.usage, this.config.model);
    logCall({
      model: this.config.model,
      provider: this.config.provider,
      mode,
      detail,
      latencyMs,
      usage,
    });

    return normalize(providerResult, mode, media.warnings);
  }
}

function validateImage(image: unknown): ImageRef {
  if (
    !image ||
    typeof image !== "object" ||
    typeof (image as ImageRef).kind !== "string" ||
    typeof (image as ImageRef).value !== "string"
  ) {
    throw new VisionError("invalid_input", "`image` must be an object with `kind` and `value`");
  }
  const { kind, value } = image as ImageRef;
  if (!["path", "url", "base64", "resource"].includes(kind)) {
    throw new VisionError("invalid_input", `Unknown image kind: ${kind}`);
  }
  return { kind, value };
}

export function resolveMode(requested: RequestedMode, prompt?: string): Mode {
  if (requested === "auto") {
    return prompt && prompt.trim() ? "inspect" : "describe";
  }
  return requested;
}

export function resolveDetail(requested: RequestedDetail): Detail {
  return requested === "auto" ? "low" : requested;
}

export function budgetFor(mode: Mode, config: AppConfig): number {
  if (mode === "ocr") return config.ocrOutputBudget;
  if (mode === "inspect") return config.inspectOutputBudget;
  return config.describeOutputBudget;
}

function normalize(
  result: ProviderResult,
  mode: Mode,
  mediaWarnings?: string[],
): VisionResult {
  const raw = mode === "ocr" ? stripCodeFences(result.answer) : result.answer.trim();
  const output: VisionResult = { answer: raw };
  if (mode === "ocr") output.text = raw;

  const warnings = [...(mediaWarnings ?? [])];
  if (result.truncated) {
    output.truncated = true;
    warnings.push("Output was truncated at the configured token budget");
  }
  if (warnings.length > 0) output.warnings = warnings;

  return output;
}

function toVisionError(error: unknown): VisionError {
  if (error instanceof VisionError) return error;
  return new VisionError("internal_error", "Internal error", { cause: error });
}

function emptyUsage() {
  return {
    promptTokens: "unavailable" as const,
    completionTokens: "unavailable" as const,
    totalTokens: "unavailable" as const,
    estimatedCostUsd: "unavailable" as const,
  };
}
