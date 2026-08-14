import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";

const BASE_ENV = {
  VISION_BASE_URL: "https://example.com/v1",
  VISION_API_KEY: "sk-test",
  VISION_MODEL: "test-model",
};

test("loadConfig defaults to stdio transport", () => {
  const config = loadConfig({ ...BASE_ENV });
  assert.equal(config.transport, "stdio");
  assert.equal(config.httpHost, "127.0.0.1");
  assert.equal(config.httpPort, 3000);
  assert.equal(config.maxRetries, 2);
});

test("loadConfig parses http transport, host, and port", () => {
  const config = loadConfig({
    ...BASE_ENV,
    VISION_TRANSPORT: "http",
    VISION_HTTP_HOST: "0.0.0.0",
    VISION_HTTP_PORT: "8080",
  });
  assert.equal(config.transport, "http");
  assert.equal(config.httpHost, "0.0.0.0");
  assert.equal(config.httpPort, 8080);
});

test("loadConfig parses maxRetries and rejects negatives", () => {
  assert.equal(loadConfig({ ...BASE_ENV, VISION_MAX_RETRIES: "5" }).maxRetries, 5);
  assert.equal(loadConfig({ ...BASE_ENV, VISION_MAX_RETRIES: "0" }).maxRetries, 0);
  assert.throws(
    () => loadConfig({ ...BASE_ENV, VISION_MAX_RETRIES: "-1" }),
    /Expected a non-negative integer/,
  );
});

test("loadConfig rejects an unknown transport", () => {
  assert.throws(
    () => loadConfig({ ...BASE_ENV, VISION_TRANSPORT: "ws" }),
    /VISION_TRANSPORT/,
  );
});
