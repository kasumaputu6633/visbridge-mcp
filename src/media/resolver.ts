// Turn an `image` reference (path | url | base64 | resource) into validated bytes.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { VisionError, isTimeoutError, safeErrorMessage } from "../core/errors.js";
import type { AppConfig } from "../config.js";
import type { ImageRef, ResolvedMedia } from "../core/types.js";
import { resolveSafeUrl } from "./ssrf.js";
import { ByteLimitError, pinnedFetch, readBodyWithLimit } from "./pinnedFetch.js";
import { resizeIfNeeded, resizeWarning } from "./resize.js";
import { assertImageSize, assertSupportedImage, mimeTypeFromExtension } from "./validate.js";

const DEFAULT_MAX_REDIRECTS = 3;

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

  private async resolveBase64(value: string): Promise<ResolvedMedia> {
    let encoded = value.trim();
    let hintMimeType: string | undefined;
    let dataUrl: string | undefined;

    const dataUrlMatch = encoded.match(/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is);
    if (dataUrlMatch) {
      hintMimeType = dataUrlMatch[1].toLowerCase();
      encoded = dataUrlMatch[2];
      // Preserve the original data URL so provider adapters can use it
      // directly instead of re-encoding the decoded bytes.
      if (hintMimeType) {
        dataUrl = `data:${hintMimeType};base64,${encoded}`;
      }
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

    return this.finish(bytes, hintMimeType, dataUrl);
  }

  private async resolveUrl(value: string): Promise<ResolvedMedia> {
    return this.fetchImageUrl(value, 0);
  }

  // Fetch a URL with SSRF validation and a pinned connection, following a
  // bounded number of redirects (each hop re-validated before connecting).
  private async fetchImageUrl(value: string, depth: number): Promise<ResolvedMedia> {
    if (depth > this.maxRedirects()) {
      throw new VisionError(
        "media_fetch_failed",
        `Image URL exceeded the redirect limit (${this.maxRedirects()})`,
      );
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new VisionError("invalid_input", "Image URL is not a valid URL");
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new VisionError("invalid_input", "Image URL must use http or https");
    }

    // Validate DNS + block private ranges, then pin the fetch to those addresses
    // so the connection cannot be re-resolved (DNS rebinding / TOCTOU).
    let addresses;
    try {
      addresses = await resolveSafeUrl(url, this.config.ssrfAllowHosts);
    } catch (error) {
      if (error instanceof VisionError) throw error;
      throw new VisionError(
        "media_fetch_failed",
        `Failed to resolve image host: ${safeErrorMessage(error)}`,
        { cause: error },
      );
    }

    let response: Response;
    try {
      const pinned = await pinnedFetch(url, addresses, { timeoutMs: this.config.timeoutMs });
      response = pinned.response;
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new VisionError("media_fetch_failed", "Image download timed out");
      }
      throw new VisionError("media_fetch_failed", `Failed to download image: ${safeErrorMessage(error)}`, {
        cause: error,
      });
    }

    // Follow a bounded number of redirects, re-validating every target.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new VisionError("media_fetch_failed", "Image URL redirected without a location");
      }
      return this.fetchImageUrl(new URL(location, url).toString(), depth + 1);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new VisionError("media_fetch_failed", "Image URL requires authentication");
      }
      throw new VisionError("media_fetch_failed", `Image URL returned HTTP ${response.status}`);
    }

    // Refuse oversized bodies before reading, when the server declares a size.
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > this.config.maxImageBytes) {
      await response.body?.cancel().catch(() => {});
      throw new VisionError(
        "image_too_large",
        `Image is ${declaredLength} bytes; the limit is ${this.config.maxImageBytes} bytes`,
      );
    }

    // Stream the body with a hard cap so a lying/absent content-length cannot
    // buffer an unbounded download into memory.
    let bytes: Buffer;
    try {
      bytes = await readBodyWithLimit(response, this.config.maxImageBytes);
    } catch (error) {
      if (error instanceof ByteLimitError) {
        throw new VisionError(
          "image_too_large",
          `Image exceeds the ${this.config.maxImageBytes}-byte limit while downloading`,
        );
      }
      if (isTimeoutError(error)) {
        throw new VisionError("media_fetch_failed", "Image download timed out");
      }
      throw new VisionError(
        "media_fetch_failed",
        `Failed to download image body: ${safeErrorMessage(error)}`,
        { cause: error },
      );
    }

    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || undefined;
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

  private async finish(bytes: Buffer, hintMimeType?: string, dataUrl?: string): Promise<ResolvedMedia> {
    assertImageSize(bytes, this.config.maxImageBytes);
    const mimeType = assertSupportedImage(bytes, hintMimeType);

    // Local preprocessing: downscale oversized images before the provider
    // call (token cost, latency, and provider-side limits all improve).
    const outcome = await resizeIfNeeded(bytes, mimeType, this.config.maxDimension);
    const warning = resizeWarning(outcome);

    return {
      bytes: outcome.bytes,
      mimeType: outcome.mimeType,
      // The passthrough data URL is only valid while the bytes are unchanged.
      dataUrl: outcome.resized ? undefined : dataUrl,
      warnings: warning ? [warning] : undefined,
    };
  }

  private maxRedirects(): number {
    return this.config.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
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
