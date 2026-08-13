import type { Detail, ProviderRequest, ProviderResult } from "./types.js";

export interface Capabilities {
  provider: string;
  supportsOcr: boolean;
  supportsInspect: boolean;
  detailLevels: Detail[];
  maxOutputTokens: number;
}

export interface VisionProviderAdapter {
  getCapabilities(): Capabilities;
  analyze(request: ProviderRequest): Promise<ProviderResult>;
}
