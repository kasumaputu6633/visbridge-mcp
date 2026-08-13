import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt, stripCodeFences } from "./prompt.js";

test("stripCodeFences removes plain fences", () => {
  assert.equal(stripCodeFences("```\nOK\n```"), "OK");
});

test("stripCodeFences removes fences with a language tag", () => {
  assert.equal(stripCodeFences('```json\n{"a":1}\n```'), '{"a":1}');
});

test("stripCodeFences leaves unfenced text unchanged", () => {
  assert.equal(stripCodeFences("just text"), "just text");
});

test("stripCodeFences keeps interior newlines", () => {
  assert.equal(stripCodeFences("```\nline1\nline2\n```"), "line1\nline2");
});

test("buildPrompt ocr requests plain text without markdown", () => {
  const prompt = buildPrompt("ocr");
  assert.match(prompt, /plain text only/);
  assert.match(prompt, /no markdown/);
});

test("buildPrompt inspect embeds the question", () => {
  const prompt = buildPrompt("inspect", "What color is it?");
  assert.match(prompt, /What color is it\?/);
});
