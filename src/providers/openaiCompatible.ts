// OpenAI-compatible chat completions adapter.

import type { AppConfig } from "../config.js";
import type { Capabilities } from "../core/capabilities.js";
import {
  isVisionError,
  providerErrorFromHttpStatus,
  safeErrorMessage,
  toVisionError,
  VisionError,
} from "../core/errors.js";
import type { ProviderRequest, ProviderResult, TokenUsage } from "../core/types.js";
import { buildPrompt } from "../tools/prompt.js";

type MessageContent = string | Array<{ type?: string; text?: string }> | null;

interface ChatCompletionChoice {
  finish_reason?: string | null;
  message?: { content?: MessageContent };
  delta?: { content?: MessageContent };
  text?: string;
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    cost_usd?: number;
  };
}

interface ParsedCompletion {
  answer: string;
  usage: ChatCompletionResponse["usage"];
  truncated: boolean;
}

export class OpenAICompatibleAdapter {
  constructor(private readonly config: AppConfig) {}

  getCapabilities(): Capabilities {
    return {
      provider: "openai-compatible",
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
    const { media, mode, prompt, context, detail, outputBudget } = request;
    // Use the original data URL when available (base64/data-URL input) to avoid
    // a decode→re-encode round-trip. Otherwise build one from the resolved bytes.
    const imageDataUrl = media.dataUrl ?? `data:${media.mimeType};base64,${media.bytes.toString("base64")}`;
    const endpoint = `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

    const body = JSON.stringify({
      model: this.config.model,
      max_tokens: outputBudget,
      stream: false,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildPrompt(mode, prompt, context) },
            { type: "image_url", image_url: { url: imageDataUrl, detail } },
          ],
        },
      ],
    });

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            accept: "application/json",
            "content-type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });

        if (response.ok) {
          return this.parseResponse(await response.text());
        }

        // Transient failures — retryable unless it's the last attempt.
        const visionError = providerErrorFromHttpStatus(response.status);
        if (!isRetryable(visionError.code) || attempt === this.config.maxRetries) {
          throw visionError;
        }

        // Respect retry-after header; exponential backoff as floor.
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const delay = Math.max(retryAfter ?? 0, backoffMs(attempt));
        await sleep(delay);
        lastError = visionError;
      } catch (error) {
        // Network/timeout errors are retryable; domain errors are not.
        if (attempt === this.config.maxRetries || !isRetryableFetchError(error)) {
          throw toVisionError(error, "invalid_provider_response");
        }
        await sleep(backoffMs(attempt));
        lastError = error;
      }
    }

    // Unreachable — the loop always throws on final attempt.
    throw toVisionError(lastError, "invalid_provider_response");
  }

  private async parseResponse(bodyText: string): Promise<ProviderResult> {
    let parsed: ParsedCompletion;
    try {
      parsed = parseCompletionBody(bodyText);
    } catch (error) {
      throw new VisionError("invalid_provider_response", safeErrorMessage(error), { cause: error });
    }

    if (!parsed.answer) {
      throw new VisionError(
        "invalid_provider_response",
        "Provider response did not contain message text",
      );
    }

    return {
      answer: parsed.answer,
      usage: normalizeUsage(parsed.usage),
      truncated: parsed.truncated,
    };
  }
}

// Rate limits and upstream 5xx (mapped to internal_error) are worth retrying.
function isRetryable(code: string): boolean {
  return code === "provider_rate_limit" || code === "internal_error";
}

// A parse failure is a domain error and must not be retried; fetch/abort
// (network drop, DNS, timeout) can be transient.
function isRetryableFetchError(error: unknown): boolean {
  return !isVisionError(error);
}

function backoffMs(attempt: number): number {
  // 500ms, 1s, 2s, ... capped at 8s.
  return Math.min(500 * 2 ** attempt, 8_000);
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();

  // Numeric form: delay in seconds.
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  // HTTP-date form: milliseconds until that instant.
  const when = Date.parse(trimmed);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());

  return undefined;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseCompletionBody(responseBody: string): ParsedCompletion {
  const body = responseBody.trim();
  if (!body) {
    throw new Error("Provider returned an empty response body");
  }

  try {
    return parseJsonCompletion(JSON.parse(body) as ChatCompletionResponse);
  } catch (error) {
    if (!hasSseDataLines(body)) {
      if (error instanceof SyntaxError) {
        throw new Error("Provider returned neither valid JSON nor OpenAI-compatible SSE");
      }
      throw error;
    }
  }

  return parseSseCompletion(body);
}

function parseJsonCompletion(payload: ChatCompletionResponse): ParsedCompletion {
  const choice = payload.choices?.[0];

  return {
    answer: extractContent(choice?.message?.content).trim() || choice?.text?.trim() || "",
    usage: payload.usage,
    truncated: choice?.finish_reason === "length",
  };
}

function parseSseCompletion(body: string): ParsedCompletion {
  const streamedParts: string[] = [];
  let messageAnswer = "";
  let usage: ChatCompletionResponse["usage"];
  let truncated = false;
  let parsedEvents = 0;

  for (const line of body.split(/\r?\n/)) {
    const trimmedLine = line.trimStart();
    if (!trimmedLine.startsWith("data:")) continue;

    const data = trimmedLine.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;

    let payload: ChatCompletionResponse;
    try {
      payload = JSON.parse(data) as ChatCompletionResponse;
    } catch {
      throw new Error("Provider returned malformed JSON inside an SSE data event");
    }

    parsedEvents += 1;
    const choice = payload.choices?.[0];
    const delta = extractContent(choice?.delta?.content);
    if (delta) streamedParts.push(delta);

    const message = extractContent(choice?.message?.content).trim() || choice?.text?.trim();
    if (message) messageAnswer = message;
    if (choice?.finish_reason === "length") truncated = true;
    if (payload.usage) usage = payload.usage;
  }

  if (parsedEvents === 0) {
    throw new Error("Provider returned SSE without parseable data events");
  }

  return {
    answer: (streamedParts.length > 0 ? streamedParts.join("") : messageAnswer).trim(),
    usage,
    truncated,
  };
}

function hasSseDataLines(body: string): boolean {
  return body.split(/\r?\n/).some((line) => line.trimStart().startsWith("data:"));
}

function extractContent(content: MessageContent | undefined): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((item) => item.text ?? "")
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function normalizeUsage(usage: ChatCompletionResponse["usage"]): TokenUsage {
  return {
    promptTokens: usage?.prompt_tokens ?? "unavailable",
    completionTokens: usage?.completion_tokens ?? "unavailable",
    totalTokens: usage?.total_tokens ?? "unavailable",
    estimatedCostUsd: usage?.cost_usd ?? usage?.cost ?? "unavailable",
  };
}
