import assert from "node:assert/strict";
import { test } from "node:test";
import { VisionError } from "../core/errors.js";
import {
  assertImageSize,
  assertSupportedImage,
  mimeTypeFromExtension,
  sniffMimeType,
} from "./validate.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);

test("sniffMimeType detects png", () => assert.equal(sniffMimeType(PNG), "image/png"));
test("sniffMimeType detects jpeg", () => assert.equal(sniffMimeType(JPEG), "image/jpeg"));
test("sniffMimeType detects gif", () => assert.equal(sniffMimeType(GIF), "image/gif"));
test("sniffMimeType detects webp", () => assert.equal(sniffMimeType(WEBP), "image/webp"));
test("sniffMimeType rejects unknown content", () =>
  assert.equal(sniffMimeType(Buffer.from("hello")), undefined));

test("assertSupportedImage throws on unknown content", () => {
  assert.throws(
    () => assertSupportedImage(Buffer.from("not an image")),
    (error) => error instanceof VisionError && error.code === "unsupported_media",
  );
});

test("assertSupportedImage trusts a supported hint when sniffing fails", () => {
  assert.equal(assertSupportedImage(Buffer.from("opaque"), "image/png"), "image/png");
});

test("mimeTypeFromExtension maps known extensions and ignores case", () => {
  assert.equal(mimeTypeFromExtension("photo.png"), "image/png");
  assert.equal(mimeTypeFromExtension("photo.JPG"), "image/jpeg");
  assert.equal(mimeTypeFromExtension("photo.txt"), undefined);
});

test("assertImageSize throws when over the limit", () => {
  assert.throws(
    () => assertImageSize(Buffer.alloc(11), 10),
    (error) => error instanceof VisionError && error.code === "image_too_large",
  );
});

test("assertImageSize passes at the limit", () => {
  assert.doesNotThrow(() => assertImageSize(Buffer.alloc(10), 10));
});
