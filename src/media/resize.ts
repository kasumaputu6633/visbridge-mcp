// Local preprocessing (CONCEPT.md §24-25): downscale oversized images before
// they are sent to the provider. Token-efficient *and* more reliable — many
// providers reject or expensively re-tile very large images. Never upscales.

import sharp from "sharp";
import { VisionError } from "../core/errors.js";

export interface ResizeOutcome {
  bytes: Buffer;
  mimeType: string;
  resized: boolean;
  from?: { width: number; height: number };
  to?: { width: number; height: number };
}

// Downscale so the longest edge fits `maxDimension` (fit: inside, no enlarge).
// GIFs collapse to their first frame; EXIF orientation is applied first.
// Returns the input untouched when disabled (maxDimension = 0), when the
// image already fits, or when the format gives no readable dimensions.
export async function resizeIfNeeded(
  bytes: Buffer,
  mimeType: string,
  maxDimension: number,
): Promise<ResizeOutcome> {
  if (maxDimension <= 0) return { bytes, mimeType, resized: false };

  let image = sharp(bytes, { failOn: "error", animated: false });
  let metadata;
  try {
    metadata = await image.metadata();
  } catch (error) {
    throw new VisionError(
      "unsupported_media",
      `Image could not be decoded for preprocessing: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) return { bytes, mimeType, resized: false };
  if (Math.max(width, height) <= maxDimension) {
    return { bytes, mimeType, resized: false };
  }

  // .gif falls back to the first frame; keep png/jpeg/webp in their own
  // format so transparency and compression survive the resize.
  const outputFormat =
    mimeType === "image/gif" ? "png" : (metadata.format ?? "png");

  try {
    const resizedBytes = await sharp(bytes, { failOn: "error", animated: false })
      .rotate() // auto-orient via EXIF before resizing
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toFormat(outputFormat as "png" | "jpeg" | "webp")
      .toBuffer();

    const resizedMeta = await sharp(resizedBytes).metadata();

    return {
      bytes: resizedBytes,
      mimeType: outputFormat === "png" ? "image/png" : outputFormat === "jpeg" ? "image/jpeg" : "image/webp",
      resized: true,
      from: { width, height },
      to: { width: resizedMeta.width ?? 0, height: resizedMeta.height ?? 0 },
    };
  } catch (error) {
    throw new VisionError(
      "unsupported_media",
      `Image preprocessing failed: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

// Human-readable warning for the tool result / logs.
export function resizeWarning(outcome: ResizeOutcome): string | undefined {
  if (!outcome.resized) return undefined;
  const from = `${outcome.from?.width}x${outcome.from?.height}`;
  const to = `${outcome.to?.width}x${outcome.to?.height}`;
  return `Image was resized locally before analysis (${from} -> ${to})`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
