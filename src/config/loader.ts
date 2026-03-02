import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  GlobalConfigSchema,
  ProjectConfigSchema,
  ProjectsRegistrySchema,
  type GlobalConfig,
  type ProjectConfig,
  type ProjectsRegistry,
} from "./schema";
import {
  globalConfigPath,
  projectsRegistryPath,
  projectConfigPath,
  globalConfigDir,
} from "./paths";

function readYaml(filePath: string): unknown {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf-8");
  return parseYaml(raw) ?? {};
}

function writeYaml(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, stringifyYaml(data), "utf-8");
}

export function loadGlobalConfig(): GlobalConfig {
  const raw = readYaml(globalConfigPath());
  return GlobalConfigSchema.parse(raw);
}

export function saveGlobalConfig(config: GlobalConfig): void {
  writeYaml(globalConfigPath(), config);
}

export function loadProjectConfig(projectPath: string): ProjectConfig {
  const configFile = projectConfigPath(projectPath);
  const raw = readYaml(configFile);
  return ProjectConfigSchema.parse(raw);
}

export function saveProjectConfig(
  projectPath: string,
  config: ProjectConfig,
): void {
  writeYaml(projectConfigPath(projectPath), config);
}

export function loadProjectsRegistry(): ProjectsRegistry {
  const raw = readYaml(projectsRegistryPath());
  return ProjectsRegistrySchema.parse(raw);
}

export function saveProjectsRegistry(registry: ProjectsRegistry): void {
  writeYaml(projectsRegistryPath(), registry);
}

export function readRawGlobalConfig(): Record<string, unknown> {
  const raw = readYaml(globalConfigPath());
  return (raw as Record<string, unknown>) ?? {};
}

export function ensureGlobalConfigDir(): void {
  const dir = globalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export interface MergedConfig {
  global: GlobalConfig;
  project: ProjectConfig;
}

export function loadMergedConfig(projectPath: string): MergedConfig {
  return {
    global: loadGlobalConfig(),
    project: loadProjectConfig(projectPath),
  };
}
