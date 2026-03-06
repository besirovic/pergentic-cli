import { loadProjectConfig } from "./loader";
import type { ProjectConfig } from "./schema";

const CONFIG_TTL_MS = 30_000; // 30 seconds

interface CacheEntry {
  config: ProjectConfig;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedProjectConfig(projectPath: string): ProjectConfig {
  const entry = cache.get(projectPath);
  if (entry && Date.now() - entry.timestamp < CONFIG_TTL_MS) {
    return entry.config;
  }

  const config = loadProjectConfig(projectPath);
  cache.set(projectPath, { config, timestamp: Date.now() });
  return config;
}

export function invalidateConfigCache(projectPath?: string): void {
  if (projectPath) {
    cache.delete(projectPath);
  } else {
    cache.clear();
  }
}
