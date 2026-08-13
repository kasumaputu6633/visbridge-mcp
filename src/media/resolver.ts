// Turn an `image` reference (path | url | base64 | resource) into validated bytes.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { VisionError, isTimeoutError, safeErrorMessage } from "../core/errors.js";
import type { AppConfig } from "../config.js";
import type { ImageRef, ResolvedMedia } from "../core/types.js";
import { assertSafeUrl } from "./ssrf.js";
import { assertImageSize, assertSupportedImage, mimeTypeFromExtension } from "./validate.js";

export class MediaResolver {
  constructor(private readonly config: AppConfig) {}

  async resolve(ref: ImageRef): Promise<ResolvedMedia> {
    switch (ref.kind) {
      case "path":
        return this.resolvePath(ref.value);
      case "base64":
        return this.resolveBase64(ref.value);
      case "url":
        return this.resolveUrl(ref.value);
      case "resource":
        return this.resolveResource(ref.value);
      default:
        throw new VisionError("invalid_input", `Unknown image kind: ${(ref as ImageRef).kind}`);
    }
  }

  private async resolvePath(value: string): Promise<ResolvedMedia> {
    if (!value.trim()) throw new VisionError("invalid_input", "Image path is empty");

    const target = expandPath(value);
    let bytes: Buffer;
    try {
      bytes = await readFile(target);
    } catch (error) {
      if (isFileNotFound(error)) {
        throw new VisionError("invalid_input", `Image file not found: ${value}`);
      }
      throw new VisionError(
        "media_fetch_failed",
        `Failed to read image file: ${safeErrorMessage(error)}`,
        { cause: error },
      );
    }

    return this.finish(bytes, mimeTypeFromExtension(target));
  }

  private resolveBase64(value: string): ResolvedMedia {
    let encoded = value.trim();
    let hintMimeType: string | undefined;

    const dataUrl = encoded.match(/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is);
    if (dataUrl) {
      hintMimeType = dataUrl[1].toLowerCase();
      encoded = dataUrl[2];
    }

    // Pre-check before decoding: a base64 string of N bytes is ~ceil(N/3)*4 chars.
    const maxChars = Math.ceil(this.config.maxImageBytes / 3) * 4;
    if (encoded.length > maxChars) {
      throw new VisionError(
        "image_too_large",
        `Encoded image is ${encoded.length} chars; the limit is ${maxChars} chars`,
      );
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(encoded, "base64");
    } catch (error) {
      throw new VisionError("invalid_input", "Image base64 is not valid", { cause: error });
    }

    if (bytes.length === 0) {
      throw new VisionError("invalid_input", "Image base64 decoded to no data");
    }

    return this.finish(bytes, hintMimeType);
  }

  private async resolveUrl(value: string): Promise<ResolvedMedia> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new VisionError("invalid_input", "Image URL is not a valid URL");
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new VisionError("invalid_input", "Image URL must use http or https");
    }

    await assertSafeUrl(url, this.config.ssrfAllowHosts);

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new VisionError("media_fetch_failed", "Image download timed out");
      }
      throw new VisionError("media_fetch_failed", `Failed to download image: ${safeErrorMessage(error)}`, {
        cause: error,
      });
    }

    // Follow at most one redirect, re-validating the target host.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new VisionError("media_fetch_failed", "Image URL redirected without a location");
      }
      return this.resolveUrl(new URL(location, url).toString());
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new VisionError("media_fetch_failed", "Image URL requires authentication");
      }
      throw new VisionError("media_fetch_failed", `Image URL returned HTTP ${response.status}`);
    }

    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    return this.finish(bytes, contentType);
  }

  private resolveResource(value: string): Promise<ResolvedMedia> {
    const baseDir = this.config.resourceDir;
    if (!baseDir) {
      throw new VisionError(
        "invalid_input",
        "resource:// images require VISION_RESOURCE_DIR to be configured",
      );
    }

    const name = value.replace(/^resource:\/\//i, "").replace(/^\/+/, "");
    if (!name) {
      throw new VisionError("invalid_input", "Resource name is empty");
    }

    const baseRoot = resolve(baseDir);
    const target = resolve(join(baseRoot, name));
    if (target !== baseRoot && !target.startsWith(baseRoot + sep)) {
      throw new VisionError("invalid_input", "Resource name escapes the resource directory");
    }

    return this.resolvePath(target);
  }

  private finish(bytes: Buffer, hintMimeType?: string): ResolvedMedia {
    assertImageSize(bytes, this.config.maxImageBytes);
    const mimeType = assertSupportedImage(bytes, hintMimeType);
    return { bytes, mimeType };
  }
}

function expandPath(value: string): string {
  if (value === "~" || value.startsWith("~/")) {
    return join(homedir(), value.slice(1));
  }
  return resolve(value);
}

function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
