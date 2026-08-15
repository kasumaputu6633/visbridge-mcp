// Unit tests for the OpenAI-compatible adapter: response parsing (JSON +
// SSE fallback), request shape, and the retry/backoff/retry-after behaviour —
// all against a local fake provider, no network.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAICompatibleAdapter, parseCompletionBody } from "./openaiCompatible.js";
import type { AppConfig } from "../config.js";
import type { ProviderRequest } from "../core/types.js";
import { VisionError } from "../core/errors.js";

// 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

interface ReceivedRequest {
  method?: string;
  path?: string;
  authorization?: string;
  body: Record<string, unknown>;
}

interface FakeProvider {
  server: Server;
  baseUrl: string;
  requests: ReceivedRequest[];
  handler: (req: ReceivedRequest, res: import("node:http").ServerResponse) => void;
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    baseUrl: "http://unused.local/v1",
    apiKey: "test-key",
    model: "test-model",
    provider: "openai-compatible",
    maxRetries: 2,
    describeOutputBudget: 256,
    inspectOutputBudget: 384,
    ocrOutputBudget: 1024,
    timeoutMs: 5_000,
    maxImageBytes: 20 * 1024 * 1024,
    maxRedirects: 3,
    maxDimension: 2048,
    ssrfAllowHosts: [],
    transport: "stdio",
    httpHost: "127.0.0.1",
    httpPort: 3000,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    media: { bytes: TINY_PNG, mimeType: "image/png" },
    mode: "describe",
    detail: "low",
    outputBudget: 256,
    ...overrides,
  };
}

async function startFakeProvider(
  handler: FakeProvider["handler"],
): Promise<FakeProvider> {
  const requests: ReceivedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const received: ReceivedRequest = {
        method: req.method,
        path: req.url,
        authorization: req.headers.authorization,
        body,
      };
      requests.push(received);
      handler(received, res);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}/v1`, requests, handler };
}

function stop(provider: FakeProvider): Promise<void> {
  return new Promise((resolve) => provider.server.close(() => resolve()));
}

function jsonResponse(res: import("node:http").ServerResponse, payload: unknown, status = 200): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": String(body.length) });
  res.end(body);
}

// ---- parseCompletionBody (pure) ----

test("parseCompletionBody parses a JSON completion with string content", () => {
  const parsed = parseCompletionBody(
    JSON.stringify({
      choices: [{ message: { content: "hello world" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  );
  assert.equal(parsed.answer, "hello world");
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.usage?.total_tokens, 15);
});

test("parseCompletionBody parses array-form content parts", () => {
  const parsed = parseCompletionBody(
    JSON.stringify({
      choices: [
        { message: { content: [{ type: "text", text: "part one " }, { type: "text", text: "part two" }] } },
      ],
    }),
  );
  assert.equal(parsed.answer, "part one \npart two");
});

test("parseCompletionBody flags finish_reason length as truncated", () => {
  const parsed = parseCompletionBody(
    JSON.stringify({ choices: [{ message: { content: "cut off" }, finish_reason: "length" }] }),
  );
  assert.equal(parsed.truncated, true);
});

test("parseCompletionBody parses SSE delta stream with usage", () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"He"}}]}',
    "",
    'data: {"choices":[{"delta":{"content":"llo"}}]}',
    "",
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const parsed = parseCompletionBody(sse);
  assert.equal(parsed.answer, "Hello");
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.usage?.total_tokens, 9);
});

test("parseCompletionBody prefers message content when stream has no deltas", () => {
  const sse = [
    'data: {"choices":[{"message":{"content":"final answer"}}]}',
    "data: [DONE]",
    "",
  ].join("\n");
  const parsed = parseCompletionBody(sse);
  assert.equal(parsed.answer, "final answer");
});

test("parseCompletionBody rejects an empty body", () => {
  assert.throws(() => parseCompletionBody("   "), /empty response body/i);
});

test("parseCompletionBody rejects malformed JSON without SSE lines", () => {
  assert.throws(() => parseCompletionBody("not json at all"), /neither valid JSON nor/i);
});

test("parseCompletionBody rejects SSE with malformed data events", () => {
  assert.throws(() => parseCompletionBody("data: {oops"), /malformed JSON inside an SSE/i);
});

// ---- adapter against a live fake provider ----

test("adapter sends the expected request shape and parses the answer", async () => {
  const provider = await startFakeProvider((_req, res) => {
    jsonResponse(res, {
      choices: [{ message: { content: "a compact description" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    });
  });
  try {
    const adapter = new OpenAICompatibleAdapter(makeConfig({ baseUrl: provider.baseUrl }));
    const result = await adapter.analyze(makeRequest());

    assert.equal(result.answer, "a compact description");
    assert.equal(result.usage.totalTokens, 120);
    assert.equal(result.usage.estimatedCostUsd, "unavailable");

    const seen = provider.requests[0];
    assert.equal(seen.method, "POST");
    assert.equal(seen.path, "/v1/chat/completions");
    assert.equal(seen.authorization, "Bearer test-key");
    assert.equal(seen.body.model, "test-model");
    assert.equal(seen.body.max_tokens, 256);
    assert.equal(seen.body.stream, false);

    const messages = seen.body.messages as Array<{
      role: string;
      content: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }>;
    }>;
    assert.equal(messages.length, 1);
    const parts = messages[0].content;
    assert.equal(parts[0].type, "text");
    const imagePart = parts[1];
    assert.equal(imagePart.type, "image_url");
    assert.equal(imagePart.image_url?.detail, "low");
    assert.match(imagePart.image_url?.url ?? "", /^data:image\/png;base64,/);
  } finally {
    await stop(provider);
  }
});

test("adapter prefers the original data URL when the media has one", async () => {
  const provider = await startFakeProvider((_req, res) => {
    jsonResponse(res, { choices: [{ message: { content: "ok" } }] });
  });
  try {
    const adapter = new OpenAICompatibleAdapter(makeConfig({ baseUrl: provider.baseUrl }));
    await adapter.analyze(
      makeRequest({
        media: { bytes: TINY_PNG, mimeType: "image/png", dataUrl: "data:image/png;base64,ORIGINAL" },
      }),
    );
    const messages = provider.requests[0].body.messages as Array<{
      content: Array<{ image_url?: { url: string } }>;
    }>;
    const imagePart = messages[0].content[1];
    assert.equal(imagePart.image_url?.url, "data:image/png;base64,ORIGINAL");
  } finally {
    await stop(provider);
  }
});

test("adapter retries a 500 then succeeds", async () => {
  let calls = 0;
  const provider = await startFakeProvider((_req, res) => {
    calls += 1;
    if (calls === 1) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "boom" }));
      return;
    }
    jsonResponse(res, { choices: [{ message: { content: "after retry" } }] });
  });
  try {
    const adapter = new OpenAICompatibleAdapter(
      makeConfig({ baseUrl: provider.baseUrl, maxRetries: 2 }),
    );
    const result = await adapter.analyze(makeRequest());
    assert.equal(result.answer, "after retry");
    assert.equal(calls, 2);
  } finally {
    await stop(provider);
  }
});

test("adapter honours retry-after on 429 then succeeds", async () => {
  let calls = 0;
  const provider = await startFakeProvider((_req, res) => {
    calls += 1;
    if (calls === 1) {
      res.writeHead(429, { "content-type": "application/json", "retry-after": "0" });
      res.end(JSON.stringify({ error: "slow down" }));
      return;
    }
    jsonResponse(res, { choices: [{ message: { content: "after 429" } }] });
  });
  try {
    const adapter = new OpenAICompatibleAdapter(
      makeConfig({ baseUrl: provider.baseUrl, maxRetries: 1 }),
    );
    const result = await adapter.analyze(makeRequest());
    assert.equal(result.answer, "after 429");
    assert.equal(calls, 2);
  } finally {
    await stop(provider);
  }
});

test("adapter does not retry a 401 auth error", async () => {
  let calls = 0;
  const provider = await startFakeProvider((_req, res) => {
    calls += 1;
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad key" }));
  });
  try {
    const adapter = new OpenAICompatibleAdapter(
      makeConfig({ baseUrl: provider.baseUrl, maxRetries: 3 }),
    );
    await assert.rejects(
      () => adapter.analyze(makeRequest()),
      (error: unknown) => {
        assert.ok(error instanceof VisionError);
        assert.equal(error.code, "provider_auth_error");
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    await stop(provider);
  }
});

test("adapter surfaces rate-limit exhaustion as provider_rate_limit", async () => {
  const provider = await startFakeProvider((_req, res) => {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "0" });
    res.end(JSON.stringify({ error: "always limited" }));
  });
  try {
    const adapter = new OpenAICompatibleAdapter(
      makeConfig({ baseUrl: provider.baseUrl, maxRetries: 1 }),
    );
    await assert.rejects(
      () => adapter.analyze(makeRequest()),
      (error: unknown) => {
        assert.ok(error instanceof VisionError);
        assert.equal(error.code, "provider_rate_limit");
        return true;
      },
    );
    assert.equal(provider.requests.length, 2);
  } finally {
    await stop(provider);
  }
});

test("adapter rejects a 200 with an empty message", async () => {
  const provider = await startFakeProvider((_req, res) => {
    jsonResponse(res, { choices: [{ message: { content: "" } }] });
  });
  try {
    const adapter = new OpenAICompatibleAdapter(makeConfig({ baseUrl: provider.baseUrl }));
    await assert.rejects(
      () => adapter.analyze(makeRequest()),
      (error: unknown) => {
        assert.ok(error instanceof VisionError);
        assert.equal(error.code, "invalid_provider_response");
        return true;
      },
    );
  } finally {
    await stop(provider);
  }
});
