// MIME allowlist and size validation (CONCEPT.md §81-88).

import { extname } from "node:path";
import { VisionError } from "../core/errors.js";

const MIME_BY_EXTENSION = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

export const SUPPORTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

// Magic-byte signatures used to confirm a supported image type regardless of
// the declared extension or Content-Type header.
interface MagicSignature {
  mimeType: string;
  bytes: number[];
  // Optional extra check to disambiguate a weak prefix (e.g. RIFF -> WEBP).
  verify?: (bytes: Buffer) => boolean;
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  {
    mimeType: "image/png",
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mimeType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  {
    mimeType: "image/webp",
    bytes: [0x52, 0x49, 0x46, 0x46],
    verify: (bytes) => bytes.length >= 12 && bytes.toString("ascii", 8, 12) === "WEBP",
  },
  { mimeType: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
];

export function mimeTypeFromExtension(fileName: string): string | undefined {
  return MIME_BY_EXTENSION.get(extname(fileName).toLowerCase());
}

export function sniffMimeType(bytes: Buffer): string | undefined {
  for (const signature of MAGIC_SIGNATURES) {
    if (bytes.length < signature.bytes.length) continue;
    const matches = signature.bytes.every((byte, index) => bytes[index] === byte);
    if (!matches) continue;
    if (signature.verify && !signature.verify(bytes)) continue;
    return signature.mimeType;
  }
  return undefined;
}

export function assertImageSize(bytes: Buffer, maxBytes: number): void {
  if (bytes.length > maxBytes) {
    throw new VisionError(
      "image_too_large",
      `Image is ${bytes.length} bytes; the limit is ${maxBytes} bytes`,
    );
  }
}

// Return the confirmed MIME type, preferring sniffed magic bytes over the
// caller's hint. Throws `unsupported_media` when the content is not a supported
// image format.
export function assertSupportedImage(bytes: Buffer, hintMimeType?: string): string {
  const sniffed = sniffMimeType(bytes);
  if (sniffed) return sniffed;

  if (hintMimeType && SUPPORTED_MIME_TYPES.has(hintMimeType)) {
    return hintMimeType;
  }

  throw new VisionError(
    "unsupported_media",
    "Image format not recognized (expected PNG, JPEG, WebP, or GIF)",
  );
}
