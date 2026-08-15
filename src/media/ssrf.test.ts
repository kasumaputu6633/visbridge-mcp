import assert from "node:assert/strict";
import { test } from "node:test";
import { isBlockedIp, isAllowlisted, resolveSafeUrl } from "./ssrf.js";
import { VisionError } from "../core/errors.js";

test("blocks private IPv4 ranges", () => {
  assert.equal(isBlockedIp("10.0.0.1"), true);
  assert.equal(isBlockedIp("192.168.1.1"), true);
  assert.equal(isBlockedIp("172.16.0.1"), true);
  assert.equal(isBlockedIp("127.0.0.1"), true);
  assert.equal(isBlockedIp("169.254.1.1"), true);
  assert.equal(isBlockedIp("0.0.0.0"), true);
  assert.equal(isBlockedIp("100.64.0.1"), true);
});

test("allows public IPv4", () => {
  assert.equal(isBlockedIp("8.8.8.8"), false);
  assert.equal(isBlockedIp("104.16.0.1"), false);
  assert.equal(isBlockedIp("172.32.0.1"), false);
});

test("blocks private IPv6 ranges", () => {
  assert.equal(isBlockedIp("::1"), true);
  assert.equal(isBlockedIp("::"), true);
  assert.equal(isBlockedIp("fd00::1"), true);
  assert.equal(isBlockedIp("fe80::1"), true);
  assert.equal(isBlockedIp("::ffff:10.0.0.1"), true);
});

test("allows public IPv6", () => {
  assert.equal(isBlockedIp("2606:4700:4700::1111"), false);
  assert.equal(isBlockedIp("2001:4860:4860::8888"), false);
});

test("isAllowlisted matches exact hosts and subdomains", () => {
  const allow = ["localhost", "127.0.0.1", "internal.example.com"];
  assert.equal(isAllowlisted("localhost", allow), true);
  assert.equal(isAllowlisted("api.localhost", allow), true);
  assert.equal(isAllowlisted("127.0.0.1", allow), true);
  assert.equal(isAllowlisted("sub.internal.example.com", allow), true);
  assert.equal(isAllowlisted("example.com", allow), false);
  assert.equal(isAllowlisted("evillocalhost", allow), false);
});

test("resolveSafeUrl returns literal IPs as the pinned address", async () => {
  const addresses = await resolveSafeUrl(new URL("http://8.8.8.8/x.png"), []);
  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].address, "8.8.8.8");
  assert.equal(addresses[0].family, 4);
});

test("resolveSafeUrl lets an allowlisted literal IP bypass the block", async () => {
  const addresses = await resolveSafeUrl(new URL("http://127.0.0.1:8080/x.png"), ["127.0.0.1"]);
  assert.equal(addresses[0].address, "127.0.0.1");
});

test("resolveSafeUrl blocks a non-allowlisted literal IP", async () => {
  await assert.rejects(
    () => resolveSafeUrl(new URL("http://169.254.169.254/latest/meta-data"), []),
    (error: unknown) => {
      assert.ok(error instanceof VisionError);
      assert.equal(error.code, "media_fetch_failed");
      assert.match(error.message, /non-public/);
      return true;
    },
  );
});
