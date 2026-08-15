// Configuration loaded from the environment (CONCEPT.md §62-66).
// The MCP client populates process.env from its own config; a `.env` file is optional.

export type ProviderId = "openai" | "openai-compatible" | "mock";
export type TransportId = "stdio" | "http";

export interface AppConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: ProviderId;
  maxRetries: number;
  describeOutputBudget: number;
  inspectOutputBudget: number;
  ocrOutputBudget: number;
  timeoutMs: number;
  maxImageBytes: number;
  maxRedirects: number;
  maxDimension: number;
  ssrfAllowHosts: string[];
  resourceDir?: string;
  transport: TransportId;
  httpHost: string;
  httpPort: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const provider = readProvider(env.VISION_PROVIDER);
  const credentialsOptional = provider === "mock";
  const baseUrl = validateBaseUrl(
    requiredEnv(env, "VISION_BASE_URL", credentialsOptional ? "http://localhost/v1" : undefined),
  );
  const apiKey = requiredEnv(env, "VISION_API_KEY", credentialsOptional ? "mock-key" : undefined);
  const model = requiredEnv(env, "VISION_MODEL", credentialsOptional ? "mock-model" : undefined);
  const maxRetries = readNonNegativeInt(env.VISION_MAX_RETRIES, 2);
  const describeOutputBudget = readPositiveInt(env.VISION_DESCRIBE_OUTPUT_BUDGET, 256);
  const inspectOutputBudget = readPositiveInt(env.VISION_INSPECT_OUTPUT_BUDGET, 384);
  const ocrOutputBudget = readPositiveInt(env.VISION_OCR_OUTPUT_BUDGET, 1024);
  const timeoutMs = readPositiveInt(env.VISION_TIMEOUT_MS, 60_000);
  const maxImageBytes = readPositiveInt(env.VISION_MAX_IMAGE_BYTES, 20 * 1024 * 1024);
  const maxRedirects = readNonNegativeInt(env.VISION_MAX_REDIRECTS, 3);
  const maxDimension = readNonNegativeInt(env.VISION_MAX_DIMENSION, 2048);
  const ssrfAllowHosts = readList(env.VISION_SSRF_ALLOW_HOSTS);
  const resourceDir = readOptional(env.VISION_RESOURCE_DIR);
  const transport = readTransport(env.VISION_TRANSPORT);
  const httpHost = readOptional(env.VISION_HTTP_HOST) ?? "127.0.0.1";
  const httpPort = readPositiveInt(env.VISION_HTTP_PORT, 3000);

  return {
    baseUrl,
    apiKey,
    model,
    provider,
    maxRetries,
    describeOutputBudget,
    inspectOutputBudget,
    ocrOutputBudget,
    timeoutMs,
    maxImageBytes,
    maxRedirects,
    maxDimension,
    ssrfAllowHosts,
    resourceDir,
    transport,
    httpHost,
    httpPort,
  };
}

function requiredEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback?: string,
): string {
  const value = env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required; set it in your MCP client config or copy .env.example to .env`);
}

function readOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readList(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed) return [];
  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = readNonNegativeInt(value, fallback);
  if (parsed <= 0) {
    throw new Error(`Expected a positive integer, got "${String(value?.trim())}"`);
  }
  return parsed;
}

function readNonNegativeInt(value: string | undefined, fallback: number): number {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got "${trimmed}"`);
  }
  return parsed;
}

function readProvider(value: string | undefined): ProviderId {
  const trimmed = value?.trim() || "openai-compatible";
  if (trimmed === "openai") {
    throw new Error(
      'VISION_PROVIDER=openai is a scaffold only (Responses API adapter not yet implemented). ' +
      'Use VISION_PROVIDER=openai-compatible for chat-completions-based providers.',
    );
  }
  if (trimmed !== "openai-compatible" && trimmed !== "mock") {
    throw new Error(
      `VISION_PROVIDER must be "openai-compatible" or "mock", got "${trimmed}"`,
    );
  }
  return trimmed;
}

function readTransport(value: string | undefined): TransportId {
  const trimmed = value?.trim() || "stdio";
  if (trimmed !== "stdio" && trimmed !== "http") {
    throw new Error(`VISION_TRANSPORT must be "stdio" or "http", got "${trimmed}"`);
  }
  return trimmed;
}

function validateBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("VISION_BASE_URL must be a valid absolute URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("VISION_BASE_URL must use http or https");
  }

  return value;
}
