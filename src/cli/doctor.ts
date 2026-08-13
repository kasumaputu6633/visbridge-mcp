// `doctor`: validate config, print capabilities, and run a live describe + ocr.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { AnalyzeImageTool } from "../tools/analyzeImage.js";
import type { RequestedMode } from "../core/types.js";

export async function runDoctor(imagePath?: string): Promise<void> {
  const config = loadConfig();
  printConfigSummary(config);

  const tool = new AnalyzeImageTool(config);
  printCapabilities(tool.getCapabilities());

  const target = resolve(imagePath ?? "fixtures/images/dense-ui.png");
  if (!existsSync(target)) {
    process.stderr.write(
      `\nImage not found: ${target}\nPass a path: visbridge-mcp doctor <image-path>\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\nTarget image: ${target}\n\n`);

  for (const mode of ["describe", "ocr"] as const) {
    const startedAt = performance.now();
    try {
      const result = await tool.run({ image: { kind: "path", value: target }, mode });
      const elapsedMs = Math.round(performance.now() - startedAt);
      process.stdout.write(`[${mode}] ok (${elapsedMs} ms)\n`);
      process.stdout.write(`  truncated: ${result.truncated ?? false}\n`);
      if (result.warnings?.length) {
        process.stdout.write(`  warnings: ${result.warnings.join("; ")}\n`);
      }
      process.stdout.write(`  answer: ${preview(result.answer)}\n\n`);
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      process.stdout.write(`[${mode}] failed (${elapsedMs} ms): ${errorMessage(error)}\n\n`);
    }
  }
}

function printConfigSummary(config: ReturnType<typeof loadConfig>): void {
  process.stdout.write(
    [
      `Model: ${config.model}  (provider: ${config.provider})`,
      `Base URL: ${config.baseUrl}`,
      `Budgets — describe ${config.describeOutputBudget} / inspect ${config.inspectOutputBudget} / ocr ${config.ocrOutputBudget} tokens`,
      "",
    ].join("\n"),
  );
}

function printCapabilities(caps: ReturnType<AnalyzeImageTool["getCapabilities"]>): void {
  process.stdout.write(
    [
      `Capabilities: ocr=${caps.supportsOcr}, inspect=${caps.supportsInspect}, ` +
        `detail=[${caps.detailLevels.join(", ")}], maxOutputTokens=${caps.maxOutputTokens}`,
      "",
    ].join("\n"),
  );
}

function preview(text: string, max = 240): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= max) return singleLine;
  return `${singleLine.slice(0, max)}…`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
