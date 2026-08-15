// Fetch helper that pins the DNS resolution: the connection can only go to
// the addresses that were validated by `resolveSafeUrl`. This closes the
// TOCTOU gap where a re-resolving fetch could be steered to a private
// address between validation and connect (DNS rebinding).

import { Agent, fetch as undiciFetch } from "undici";
import type { SafeAddress } from "./ssrf.js";

export interface PinnedFetchResult {
  response: Response;
  // The pinned addresses the connection used — pass them along on redirects
  // within the same hop chain (they are re-validated per hop anyway).
  addresses: SafeAddress[];
}

export async function pinnedFetch(
  url: URL,
  addresses: SafeAddress[],
  options: { timeoutMs: number },
): Promise<PinnedFetchResult> {
  const pinned = [...addresses];
  const dispatcher = new Agent({
    connect: {
      // Every DNS question for this request must answer with a pre-validated
      // address — a rebinding attempt has nothing left to re-resolve to.
      lookup: (_hostname, _options, callback) => {
        callback(
          null,
          pinned.map((entry) => ({ address: entry.address, family: entry.family })),
        );
      },
    },
  });

  const response = await undiciFetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeoutMs),
    dispatcher,
  });
  // undici's Response is structurally the WHATWG Response; assert the shape
  // the rest of the codebase expects (headers/body/status).
  return { response: response as unknown as Response, addresses: pinned };
}

// Consume the body with a hard byte cap, aborting the download as soon as
// the cap is exceeded — never buffer an unbounded response in memory.
export async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response has no body to read");
  }

  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ByteLimitError(received, maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (!(error instanceof ByteLimitError)) await reader.cancel().catch(() => {});
    throw error;
  }

  return Buffer.concat(chunks);
}

export class ByteLimitError extends Error {
  constructor(readonly received: number, readonly maxBytes: number) {
    super(`Body exceeded ${maxBytes} bytes (received at least ${received})`);
    this.name = "ByteLimitError";
  }
}
