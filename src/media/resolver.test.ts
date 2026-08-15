// URL-resolution tests against a local HTTP server: SSRF blocking, allowlist,
// bounded redirects, MIME sniffing, and download size caps. No external network.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type Server } from "node:http";
import { MediaResolver } from "./resolver.js";
import { VisionError } from "../core/errors.js";
import type { AppConfig } from "../config.js";

// 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    baseUrl: "https://example.com/v1",
    apiKey: "test-key",
    model: "test-model",
    provider: "openai-compatible",
    maxRetries: 0,
    describeOutputBudget: 256,
    inspectOutputBudget: 384,
    ocrOutputBudget: 1024,
    timeoutMs: 5_000,
    maxImageBytes: 20 * 1024 * 1024,
    maxRedirects: 3,
    maxDimension: 0, // resize off for URL-pipeline tests
    ssrfAllowHosts: [],
    transport: "stdio",
    httpHost: "127.0.0.1",
    httpPort: 3000,
    ...overrides,
  };
}

function startServer(
  handler: (req: { url?: string }, res: import("node:http").ServerResponse) => void,
): Promise<{ server: Server; url: (path: string) => string }> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const base = `http://127.0.0.1:${address.port}`;
      resolve({ server, url: (path: string) => `${base}${path}` });
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function assertVisionError(
  promise: Promise<unknown>,
  code: string,
): Promise<VisionError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof VisionError, `expected VisionError, got: ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`expected promise to reject with ${code}, but it resolved`);
}

test("resolver fetches a PNG over http and sniffs the MIME type", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(TINY_PNG);
  });
  try {
    const resolver = new MediaResolver(makeConfig({ ssrfAllowHosts: ["127.0.0.1"] }));
    const media = await resolver.resolve({ kind: "url", value: url("/img.png") });
    assert.equal(media.mimeType, "image/png");
    assert.equal(media.bytes.length, TINY_PNG.length);
  } finally {
    await stopServer(server);
  }
});

test("resolver blocks a private IP unless allowlisted", async () => {
  const resolver = new MediaResolver(makeConfig());
  const error = await assertVisionError(
    resolver.resolve({ kind: "url", value: "http://127.0.0.1:9/x.png" }),
    "media_fetch_failed",
  );
  assert.match(error.message, /non-public/);
});

test("resolver allows an allowlisted literal IP", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(TINY_PNG);
  });
  try {
    const resolver = new MediaResolver(makeConfig({ ssrfAllowHosts: ["127.0.0.1"] }));
    const media = await resolver.resolve({ kind: "url", value: url("/allow.png") });
    assert.equal(media.mimeType, "image/png");
  } finally {
    await stopServer(server);
  }
});

test("resolver follows redirects and re-validates each hop", async () => {
  const { server, url } = await startServer((req, res) => {
    if (req.url === "/hop1") {
      res.writeHead(302, { location: "/hop2" });
      res.end();
      return;
    }
    if (req.url === "/hop2") {
      res.writeHead(302, { location: "/final.png" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "image/png" });
    res.end(TINY_PNG);
  });
  try {
    const resolver = new MediaResolver(makeConfig({ ssrfAllowHosts: ["127.0.0.1"] }));
    const media = await resolver.resolve({ kind: "url", value: url("/hop1") });
    assert.equal(media.mimeType, "image/png");
  } finally {
    await stopServer(server);
  }
});

test("resolver stops redirect loops at the configured limit", async () => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(302, { location: req.url }); // infinite self-redirect
    res.end();
  });
  try {
    const resolver = new MediaResolver(makeConfig({ ssrfAllowHosts: ["127.0.0.1"] }));
    const error = await assertVisionError(
      resolver.resolve({ kind: "url", value: url("/loop") }),
      "media_fetch_failed",
    );
    assert.match(error.message, /redirect limit/);
  } finally {
    await stopServer(server);
  }
});

test("resolver refuses a body larger than the declared content-length cap", async () => {
  const { server, url } = await startServer((_req, res) => {
    const big = Buffer.alloc(1024, 0x89); // starts with a PNG-ish byte but way too big
    res.writeHead(200, { "content-type": "image/png", "content-length": String(big.length) });
    res.end(big);
  });
  try {
    const resolver = new MediaResolver({
      ...makeConfig({ ssrfAllowHosts: ["127.0.0.1"] }),
      maxImageBytes: 512,
    });
    await assertVisionError(
      resolver.resolve({ kind: "url", value: url("/big.png") }),
      "image_too_large",
    );
  } finally {
    await stopServer(server);
  }
});

test("resolver aborts an over-cap chunked body mid-download", async () => {
  const { server, url } = await startServer((_req, res) => {
    // Chunked (no content-length): stream more than the cap in pieces.
    res.writeHead(200, { "content-type": "image/png" });
    res.write(Buffer.alloc(600, 0x00));
    setTimeout(() => {
      res.write(Buffer.alloc(600, 0x00));
      res.end();
    }, 30);
  });
  try {
    const resolver = new MediaResolver({
      ...makeConfig({ ssrfAllowHosts: ["127.0.0.1"] }),
      maxImageBytes: 1_024,
    });
    await assertVisionError(
      resolver.resolve({ kind: "url", value: url("/chunked.png") }),
      "image_too_large",
    );
  } finally {
    await stopServer(server);
  }
});

test("resolver maps 404 to media_fetch_failed", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("nope");
  });
  try {
    const resolver = new MediaResolver(makeConfig({ ssrfAllowHosts: ["127.0.0.1"] }));
    await assertVisionError(
      resolver.resolve({ kind: "url", value: url("/missing.png") }),
      "media_fetch_failed",
    );
  } finally {
    await stopServer(server);
  }
});

test("resolver rejects unsupported content", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>not an image</html>");
  });
  try {
    const resolver = new MediaResolver(makeConfig({ ssrfAllowHosts: ["127.0.0.1"] }));
    await assertVisionError(
      resolver.resolve({ kind: "url", value: url("/page.html") }),
      "unsupported_media",
    );
  } finally {
    await stopServer(server);
  }
});
