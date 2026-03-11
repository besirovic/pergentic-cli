import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { envFilePath, projectEnvPath, projectConfigPath } from "./paths";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { invalidateConfigCache } from "./cache";
import { logger } from "../utils/logger";
import type { ProjectConfig } from "./schema";

export interface ResolvedSecrets {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  githubToken?: string;
  linearApiKey?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  jiraApiToken?: string;
  jiraEmail?: string;
  jiraDomain?: string;
}

export const SECRET_FIELDS: Record<keyof ResolvedSecrets, string> = {
  anthropicApiKey: "PERGENTIC_ANTHROPIC_API_KEY",
  openaiApiKey: "PERGENTIC_OPENAI_API_KEY",
  openrouterApiKey: "PERGENTIC_OPENROUTER_API_KEY",
  githubToken: "PERGENTIC_GITHUB_TOKEN",
  linearApiKey: "PERGENTIC_LINEAR_API_KEY",
  slackBotToken: "PERGENTIC_SLACK_BOT_TOKEN",
  slackAppToken: "PERGENTIC_SLACK_APP_TOKEN",
  jiraApiToken: "PERGENTIC_JIRA_API_TOKEN",
  jiraEmail: "PERGENTIC_JIRA_EMAIL",
  jiraDomain: "PERGENTIC_JIRA_DOMAIN",
};

export function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};

  const content = readFileSync(filePath, "utf-8");
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip matching quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

const PLACEHOLDER_PATTERNS = [
  /^your[-_\w]*[-_]?here$/i,
  /^<.*>$/,
  /^TODO$/i,
  /^CHANGEME$/i,
  /^xxx+$/i,
  /^replace[-_]?me$/i,
  /^sk-ant-api-\.\.\./,
];

const KEY_PREFIX_RULES: Partial<
  Record<keyof ResolvedSecrets, { prefix: string; label: string }>
> = {
  anthropicApiKey: { prefix: "sk-ant-", label: "Anthropic API key" },
  githubToken: { prefix: "ghp_", label: "GitHub token" },
  linearApiKey: { prefix: "lin_api_", label: "Linear API key" },
};

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(value));
}

export function validateSecretValue(
  field: keyof ResolvedSecrets,
  value: string,
): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (isPlaceholder(trimmed)) return false;
  if (!validateSecretFormat(field, trimmed)) return false;
  return true;
}

function validateSecretFormat(
  field: keyof ResolvedSecrets,
  value: string,
): boolean {
  const rule = KEY_PREFIX_RULES[field];
  if (rule && !value.startsWith(rule.prefix)) {
    if (process.env.PERGENTIC_SKIP_SECRET_VALIDATION === "1") {
      logger.warn(
        `${rule.label} does not start with expected prefix "${rule.prefix}" — accepting due to PERGENTIC_SKIP_SECRET_VALIDATION=1`,
      );
      return true;
    }
    const actualPrefix = value.slice(0, rule.prefix.length) || "(empty)";
    logger.error(
      `Invalid ${field}: expected prefix "${rule.prefix}", got "${actualPrefix}". Skipping.`,
    );
    return false;
  }
  return true;
}

export function loadSecrets(projectPath: string): ResolvedSecrets {
  // 1. Global .env
  const globalEnv = parseEnvFile(envFilePath());

  // 2. Project .env (overrides global)
  const projectEnv = parseEnvFile(projectEnvPath(projectPath));

  // 3. Merge: global < project < process.env, keyed by field name
  const merged: Record<string, string | undefined> = {};
  for (const [fieldName, envVarName] of Object.entries(SECRET_FIELDS)) {
    merged[fieldName] =
      process.env[envVarName] ?? projectEnv[envVarName] ?? globalEnv[envVarName];
  }

  // 4. Validate values and build secrets object
  const secrets: ResolvedSecrets = {};
  for (const [field, envVar] of Object.entries(SECRET_FIELDS)) {
    const raw = merged[field];
    if (raw == null) continue;

    const value = raw.trim();
    if (value.length === 0) continue;

    if (isPlaceholder(value)) {
      logger.warn(`Skipping %s: value looks like a placeholder`, envVar);
      continue;
    }

    if (!validateSecretFormat(field as keyof ResolvedSecrets, value)) {
      continue;
    }
    (secrets as Record<string, string>)[field] = value;
  }

  return secrets;
}

export function saveProjectEnv(
  projectPath: string,
  secrets: ResolvedSecrets,
): void {
  const filePath = projectEnvPath(projectPath);
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Load existing env file to preserve non-secret entries
  const existing = parseEnvFile(filePath);

  // Overlay secrets
  for (const [field, envVar] of Object.entries(SECRET_FIELDS)) {
    const value = (secrets as Record<string, string>)[field];
    if (value) {
      existing[envVar] = value;
    }
  }

  const lines = Object.entries(existing).map(
    ([key, value]) => `${key}=${value}`,
  );
  writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
  invalidateConfigCache(projectPath);
}

function isYamlObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function migrateConfigSecrets(
  projectPath: string,
): { migrated: boolean; fields: string[] } {
  const configFile = projectConfigPath(projectPath);
  if (!existsSync(configFile)) return { migrated: false, fields: [] };

  const parsed: unknown = parseYaml(readFileSync(configFile, "utf-8"));
  if (!isYamlObject(parsed)) return { migrated: false, fields: [] };
  const raw = parsed;

  const secretKeys = Object.keys(SECRET_FIELDS) as (keyof ResolvedSecrets)[];
  const extracted: ResolvedSecrets = {};
  const migratedFields: string[] = [];

  for (const key of secretKeys) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) {
      extracted[key] = value;
      migratedFields.push(key);
    }
  }

  if (migratedFields.length === 0) return { migrated: false, fields: [] };

  // Capture original .env content for rollback
  const envFile = projectEnvPath(projectPath);
  const originalEnvContent = existsSync(envFile)
    ? readFileSync(envFile, "utf-8")
    : null;

  // Write secrets to .env
  saveProjectEnv(projectPath, extracted);

  // Remove secrets from config.yaml — if this fails, roll back .env
  try {
    for (const key of migratedFields) {
      delete raw[key];
    }
    writeFileSync(configFile, stringifyYaml(raw), "utf-8");
  } catch (err) {
    // Rollback: restore .env to its pre-migration state
    if (originalEnvContent === null) {
      // .env didn't exist before — remove it
      try {
        unlinkSync(envFile);
      } catch {
        // best-effort cleanup
      }
    } else {
      writeFileSync(envFile, originalEnvContent, "utf-8");
    }
    invalidateConfigCache(projectPath);
    throw err;
  }

  return { migrated: true, fields: migratedFields };
}

export function extractSecrets(
  config: ProjectConfig,
): { secrets: ResolvedSecrets; cleaned: ProjectConfig } {
  const secrets: ResolvedSecrets = {};
  const cleaned = { ...config };
  const secretKeys = Object.keys(SECRET_FIELDS) as (keyof ResolvedSecrets)[];

  for (const key of secretKeys) {
    const value = cleaned[key];
    if (typeof value === "string" && value.length > 0) {
      secrets[key] = value;
      delete cleaned[key];
    }
  }

  return { secrets, cleaned };
}
