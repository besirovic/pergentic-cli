import { existsSync, mkdirSync } from "node:fs";
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
import { loadSecrets, SECRET_FIELDS, validateSecretValue, type ResolvedSecrets } from "./env";
import { readYaml, writeYaml, withFileLock } from "./yaml-io";
import { invalidateConfigCache } from "./cache";
import { logger } from "../utils/logger";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadGlobalConfig(): GlobalConfig {
  const raw = readYaml(globalConfigPath());
  return GlobalConfigSchema.parse(raw);
}

export function saveGlobalConfig(config: GlobalConfig): void {
  writeYaml(globalConfigPath(), config);
}

/**
 * Atomically load, modify, and save the global config under a file lock.
 * Prevents lost updates from concurrent read-modify-write sequences.
 */
export function modifyGlobalConfig(fn: (config: GlobalConfig) => void): void {
  const filePath = globalConfigPath();
  withFileLock(filePath, () => {
    const raw = readYaml(filePath);
    const config = GlobalConfigSchema.parse(raw);
    fn(config);
    writeYaml(filePath, config);
  });
}

export function loadProjectConfig(projectPath: string): ProjectConfig {
  const configFile = projectConfigPath(projectPath);
  const raw = readYaml(configFile);
  if (!isRecord(raw)) {
    throw new Error(`Config at ${configFile} must be a YAML mapping`);
  }

  // Warn if secrets are found directly in config.yaml
  const secretFieldNames = Object.keys(SECRET_FIELDS);
  const foundSecrets = secretFieldNames.filter(
    (field) => typeof raw[field] === "string" && (raw[field] as string).length > 0,
  );
  if (foundSecrets.length > 0) {
    logger.warn(
      { fields: foundSecrets },
      "Secrets found in config.yaml — consider running `pergentic init` to migrate them to .env",
    );
  }

  const parsed = ProjectConfigSchema.parse(raw);

  // Validate any secrets present in config.yaml; collect invalid field names
  const invalidSecretFields = new Set<string>();
  for (const field of Object.keys(SECRET_FIELDS)) {
    const key = field as keyof ResolvedSecrets;
    const value = parsed[key];
    if (typeof value === "string" && value.length > 0) {
      if (!validateSecretValue(key, value)) {
        logger.warn(`Rejecting invalid ${key} from config.yaml`);
        invalidSecretFields.add(key);
      }
    }
  }

  // Build a cleaned raw copy without invalid secret fields (no mutation of parsed object)
  const cleanedRaw = Object.fromEntries(
    Object.entries(raw).filter(([k]) => !invalidSecretFields.has(k)),
  );

  // Merge env-based secrets into cleaned raw: config values take precedence (backwards compat)
  const secrets = loadSecrets(projectPath);
  for (const field of Object.keys(SECRET_FIELDS)) {
    const key = field as keyof ResolvedSecrets;
    if (cleanedRaw[key] === undefined && secrets[key] !== undefined) {
      cleanedRaw[key] = secrets[key];
    }
  }

  return ProjectConfigSchema.parse(cleanedRaw);
}

export function saveProjectConfig(
  projectPath: string,
  config: ProjectConfig,
): void {
  writeYaml(projectConfigPath(projectPath), config);
  invalidateConfigCache(projectPath);
}

/**
 * Atomically load, modify, and save a project config under a file lock.
 * Prevents lost updates from concurrent read-modify-write sequences.
 */
export function modifyProjectConfig(
  projectPath: string,
  fn: (config: ProjectConfig) => void,
): void {
  const filePath = projectConfigPath(projectPath);
  withFileLock(filePath, () => {
    const config = loadProjectConfig(projectPath);
    fn(config);
    writeYaml(filePath, config);
    invalidateConfigCache(projectPath);
  });
}

export function loadProjectsRegistry(): ProjectsRegistry {
  const raw = readYaml(projectsRegistryPath());
  return ProjectsRegistrySchema.parse(raw);
}

export function saveProjectsRegistry(registry: ProjectsRegistry): void {
  writeYaml(projectsRegistryPath(), registry);
}

/**
 * Atomically load, modify, and save the projects registry under a file lock.
 * Prevents lost updates from concurrent read-modify-write sequences.
 */
export function modifyProjectsRegistry(
  fn: (registry: ProjectsRegistry) => void,
): void {
  const filePath = projectsRegistryPath();
  withFileLock(filePath, () => {
    const raw = readYaml(filePath);
    const registry = ProjectsRegistrySchema.parse(raw);
    fn(registry);
    writeYaml(filePath, registry);
  });
}

export function readRawGlobalConfig(): Record<string, unknown> {
  const raw = readYaml(globalConfigPath());
  return isRecord(raw) ? raw : {};
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
