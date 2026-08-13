import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VisionError,
  isVisionError,
  providerErrorFromHttpStatus,
  toVisionError,
} from "./errors.js";

test("maps 401 to provider_auth_error", () => {
  assert.equal(providerErrorFromHttpStatus(401).code, "provider_auth_error");
});

test("maps 429 to provider_rate_limit", () => {
  assert.equal(providerErrorFromHttpStatus(429).code, "provider_rate_limit");
});

test("maps 413 to image_too_large", () => {
  assert.equal(providerErrorFromHttpStatus(413).code, "image_too_large");
});

test("maps 5xx to internal_error", () => {
  assert.equal(providerErrorFromHttpStatus(500).code, "internal_error");
});

test("maps unknown 4xx to invalid_provider_response", () => {
  assert.equal(providerErrorFromHttpStatus(418).code, "invalid_provider_response");
});

test("toVisionError passes through an existing VisionError", () => {
  const original = new VisionError("invalid_input", "bad");
  assert.equal(toVisionError(original), original);
});

test("toVisionError classifies a timeout", () => {
  const timeout = new Error("aborted");
  timeout.name = "TimeoutError";
  assert.equal(toVisionError(timeout).code, "provider_timeout");
});

test("toVisionError falls back to internal_error", () => {
  assert.equal(toVisionError(new Error("boom")).code, "internal_error");
});

test("isVisionError recognizes VisionError instances", () => {
  assert.equal(isVisionError(new VisionError("internal_error", "x")), true);
  assert.equal(isVisionError(new Error("x")), false);
});
