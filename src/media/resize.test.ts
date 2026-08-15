// Local preprocessing tests: downscaling behaviour, no-upscale guarantee,
// GIF first-frame collapse, and end-to-end integration through the resolver
// and the tool (warnings surfaced).

import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { resizeIfNeeded, resizeWarning } from "./resize.js";
import { MediaResolver } from "./resolver.js";
import { AnalyzeImageTool } from "../tools/analyzeImage.js";
import { loadConfig } from "../config.js";

function mockConfig(env: Record<string, string> = {}) {
  return loadConfig({
    VISION_PROVIDER: "mock",
    VISION_MAX_RETRIES: "0",
    ...env,
  });
}

async function pngOf(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 10, b: 10 } },
  })
    .png()
    .toBuffer();
}

test("resizeIfNeeded leaves a fitting image untouched", async () => {
  const bytes = await pngOf(100, 50);
  const outcome = await resizeIfNeeded(bytes, "image/png", 2048);
  assert.equal(outcome.resized, false);
  assert.equal(outcome.bytes, bytes); // same buffer, no re-encode
  assert.equal(resizeWarning(outcome), undefined);
});

test("resizeIfNeeded is disabled when maxDimension is 0", async () => {
  const bytes = await pngOf(4000, 3000);
  const outcome = await resizeIfNeeded(bytes, "image/png", 0);
  assert.equal(outcome.resized, false);
});

test("resizeIfNeeded downscales to fit inside the cap and never upscales", async () => {
  const bytes = await pngOf(4000, 2000);
  const outcome = await resizeIfNeeded(bytes, "image/png", 2048);
  assert.equal(outcome.resized, true);
  assert.equal(outcome.to?.width, 2048);
  assert.equal(outcome.to?.height, 1024); // aspect ratio preserved
  assert.match(resizeWarning(outcome) ?? "", /4000x2000 -> 2048x1024/);

  // Portrait orientation: the height is the long edge.
  const portrait = await pngOf(1500, 3000);
  const portraitOutcome = await resizeIfNeeded(portrait, "image/png", 1000);
  assert.equal(portraitOutcome.to?.width, 500);
  assert.equal(portraitOutcome.to?.height, 1000);
});

test("resizeIfNeeded keeps PNG format and validity", async () => {
  const bytes = await pngOf(3000, 3000);
  const outcome = await resizeIfNeeded(bytes, "image/png", 512);
  assert.equal(outcome.mimeType, "image/png");
  const meta = await sharp(outcome.bytes).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 512);
});

test("resizeIfNeeded collapses an animated GIF to its first frame as PNG", async () => {
  const gif = await sharp(await pngOf(900, 900))
    .gif()
    .toBuffer();
  const outcome = await resizeIfNeeded(gif, "image/gif", 256);
  assert.equal(outcome.resized, true);
  assert.equal(outcome.mimeType, "image/png"); // gif -> png on resize
  const meta = await sharp(outcome.bytes).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 256);
});

test("resolver surfaces a resize warning and invalidates the data URL passthrough", async () => {
  const bytes = await pngOf(2500, 2500);
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;

  const resolver = new MediaResolver(mockConfig()); // default maxDimension 2048
  const media = await resolver.resolve({ kind: "base64", value: dataUrl });

  assert.equal(media.warnings?.length, 1);
  assert.match(media.warnings?.[0] ?? "", /resized locally/);
  assert.equal(media.dataUrl, undefined); // original payload no longer valid
  assert.equal((await sharp(media.bytes).metadata()).width, 2048);
});

test("resolver keeps the data URL passthrough when no resize happens", async () => {
  const bytes = await pngOf(64, 64);
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;

  const resolver = new MediaResolver(mockConfig());
  const media = await resolver.resolve({ kind: "base64", value: dataUrl });

  assert.equal(media.warnings, undefined);
  assert.equal(media.dataUrl, dataUrl);
});

test("the tool result carries the resize warning through normalize()", async () => {
  const bytes = await pngOf(4096, 4096);
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;

  const tool = new AnalyzeImageTool(mockConfig());
  const result = await tool.run({ image: { kind: "base64", value: dataUrl } });

  assert.equal(result.warnings?.length, 1);
  assert.match(result.warnings?.[0] ?? "", /resized locally/);
});
