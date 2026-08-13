// SSRF protection for `url` image references (CONCEPT.md §83).
// Resolve the hostname to IPs and block non-public addresses unless allowlisted.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { VisionError } from "../core/errors.js";

export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return false;
}

export async function assertSafeUrl(url: URL, allowHosts: string[]): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  // A literal IP in the URL is checked directly.
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new VisionError(
        "media_fetch_failed",
        `Blocked request to a non-public address (${hostname})`,
      );
    }
    return;
  }

  // Hostnames on the allowlist may reach private networks.
  if (allowHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`))) {
    return;
  }

  const addresses = await lookup(hostname, { all: true });
  for (const entry of addresses) {
    if (isBlockedIp(entry.address)) {
      throw new VisionError(
        "media_fetch_failed",
        `Blocked request to a non-public address (${hostname})`,
      );
    }
  }
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (CGNAT)
    (a === 169 && b === 254) || // 169.254.0.0/16 (link-local)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) // 192.168.0.0/16
  );
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;

  // Unique-local: fc00::/7
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;

  // Link-local: fe80::/10
  if (/^fe[89ab]/.test(lower)) return true;

  // IPv4-mapped: ::ffff:a.b.c.d
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);

  return false;
}
