import assert from "node:assert/strict";
import { test } from "node:test";
import { isBlockedIp } from "./ssrf.js";

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
