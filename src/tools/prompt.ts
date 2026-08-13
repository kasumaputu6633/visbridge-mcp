// Task-specific prompts (CONCEPT.md §50-51: short, no prompt amplification).

import type { Mode } from "../core/types.js";

export function buildPrompt(mode: Mode, userPrompt?: string): string {
  if (mode === "ocr") {
    const base =
      "Extract the requested visible text exactly.\n" +
      "Do not infer missing text.\n" +
      "Return plain text only — no markdown, no code fences.";
    return userPrompt ? `${base}\n${userPrompt}` : base;
  }

  if (mode === "inspect") {
    return `Answer this visual question directly:\n${userPrompt ?? ""}\nOnly use information visible in the image.`;
  }

  return "Briefly describe the important visible content.";
}

// Defensively strip markdown code fences (a Phase 0 finding: OCR output was
// occasionally wrapped in ``` ``` fences, inflating CER).
export function stripCodeFences(text: string): string {
  let result = text.trim();
  result = result.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "");
  result = result.replace(/\n?\s*```\s*$/, "");
  return result.trim();
}
