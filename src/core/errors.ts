// Error taxonomy (CONCEPT.md §72).

export type ErrorCode =
  | "invalid_input"
  | "unsupported_media"
  | "image_too_large"
  | "media_fetch_failed"
  | "provider_auth_error"
  | "provider_rate_limit"
  | "provider_timeout"
  | "unsupported_capability"
  | "invalid_provider_response"
  | "internal_error";

export class VisionError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VisionError";
    this.code = code;
  }
}

export function isVisionError(error: unknown): error is VisionError {
  return error instanceof VisionError;
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

// Map an arbitrary thrown value into a VisionError, classifying well-known shapes.
export function toVisionError(
  error: unknown,
  fallbackCode: ErrorCode = "internal_error",
): VisionError {
  if (isVisionError(error)) return error;
  if (isTimeoutError(error)) {
    return new VisionError("provider_timeout", "Provider request timed out", { cause: error });
  }
  return new VisionError(fallbackCode, safeErrorMessage(error), { cause: error });
}

// Classify an upstream HTTP status into a provider error.
export function providerErrorFromHttpStatus(status: number): VisionError {
  if (status === 401 || status === 403) {
    return new VisionError(
      "provider_auth_error",
      "Provider rejected the request (authentication failed)",
    );
  }
  if (status === 429) {
    return new VisionError("provider_rate_limit", "Provider rate limit exceeded; retry later");
  }
  if (status === 413) {
    return new VisionError("image_too_large", "Image exceeds the provider's size limit");
  }
  if (status >= 500) {
    return new VisionError("internal_error", "Provider returned a server error");
  }
  return new VisionError(
    "invalid_provider_response",
    `Provider returned an unexpected HTTP status (${status})`,
  );
}
