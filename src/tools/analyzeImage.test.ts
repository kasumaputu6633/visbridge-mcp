// Tool-level tests for AnalyzeImageTool with the mock provider: full
// resolve -> validate -> analyze -> normalize pipeline, offline.

import assert from "node:assert/strict";
import { test } from "node:test";
import { AnalyzeImageTool } from "./analyzeImage.js";
import { loadConfig } from "../config.js";
import { VisionError } from "../core/errors.js";

// 1x1 transparent PNG.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const MOCK_ENV = {
  VISION_PROVIDER: "mock",
  VISION_MAX_RETRIES: "0",
};

function makeTool() {
  return new AnalyzeImageTool(loadConfig(MOCK_ENV));
}

test("run resolves mode auto -> describe without a prompt", async () => {
  const tool = makeTool();
  const result = await tool.run({
    image: { kind: "base64", value: TINY_PNG_BASE64 },
  });
  assert.match(result.answer, /mock description of a image\/png image/);
  assert.equal(result.text, undefined);
});

test("run resolves mode auto -> inspect when a prompt is present", async () => {
  const tool = makeTool();
  const result = await tool.run({
    image: { kind: "base64", value: TINY_PNG_BASE64 },
    prompt: "what colour is it?",
  });
  assert.match(result.answer, /mock inspect answer to: what colour is it\?/);
});

test("run in ocr mode returns fence-free text plus the text field", async () => {
  const tool = makeTool();
  const result = await tool.run({
    image: { kind: "base64", value: TINY_PNG_BASE64 },
    mode: "ocr",
  });
  assert.equal(result.answer, "mock ocr text");
  assert.equal(result.text, "mock ocr text");
  assert.equal(result.truncated, undefined);
});

test("run strips fences from mock OCR answers defensively", async () => {
  // The mock returns plain text; this guards the normalize() contract.
  const tool = makeTool();
  const result = await tool.run({
    image: { kind: "base64", value: TINY_PNG_BASE64 },
    mode: "ocr",
  });
  assert.doesNotMatch(result.text ?? "", /```/);
});

test("run rejects a missing image file with invalid_input", async () => {
  const tool = makeTool();
  await assert.rejects(
    () => tool.run({ image: { kind: "path", value: "/nonexistent.png" } }),
    (error: unknown) => {
      assert.ok(error instanceof VisionError);
      assert.equal(error.code, "invalid_input");
      return true;
    },
  );
});

test("run rejects an unknown image kind", async () => {
  const tool = makeTool();
  await assert.rejects(
    () => tool.run({ image: { kind: "ftp", value: "x" } as never }),
    (error: unknown) => {
      assert.ok(error instanceof VisionError);
      assert.equal(error.code, "invalid_input");
      return true;
    },
  );
});

test("run rejects a non-image base64 payload", async () => {
  const tool = makeTool();
  await assert.rejects(
    () =>
      tool.run({
        image: { kind: "base64", value: Buffer.from("<html>nope</html>").toString("base64") },
      }),
    (error: unknown) => {
      assert.ok(error instanceof VisionError);
      assert.equal(error.code, "unsupported_media");
      return true;
    },
  );
});

test("run rejects an oversized image", async () => {
  const tool = new AnalyzeImageTool(
    loadConfig({ ...MOCK_ENV, VISION_MAX_IMAGE_BYTES: "16" }),
  );
  await assert.rejects(
    () => tool.run({ image: { kind: "base64", value: TINY_PNG_BASE64 } }),
    (error: unknown) => {
      assert.ok(error instanceof VisionError);
      assert.equal(error.code, "image_too_large");
      return true;
    },
  );
});

test("run rejects resource kind without a configured resource dir", async () => {
  const tool = makeTool();
  await assert.rejects(
    () => tool.run({ image: { kind: "resource", value: "photo.png" } }),
    (error: unknown) => {
      assert.ok(error instanceof VisionError);
      assert.equal(error.code, "invalid_input");
      return true;
    },
  );
});

test("getCapabilities reports the mock provider", () => {
  const caps = makeTool().getCapabilities();
  assert.equal(caps.provider, "mock");
  assert.equal(caps.supportsOcr, true);
  assert.equal(caps.supportsInspect, true);
});
