import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { envFilePath, projectEnvPath, projectConfigPath } from "./paths";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

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

export function loadSecrets(projectPath: string): ResolvedSecrets {
  // 1. Global .env
  const globalEnv = parseEnvFile(envFilePath());

  // 2. Project .env (overrides global)
  const projectEnv = parseEnvFile(projectEnvPath(projectPath));

  // 3. Merge: global < project < process.env
  const merged = { ...globalEnv, ...projectEnv };
  for (const envVar of Object.values(SECRET_FIELDS)) {
    if (process.env[envVar]) {
      merged[envVar] = process.env[envVar];
    }
  }

  // 4. Map env var names to config field names
  const secrets: ResolvedSecrets = {};
  for (const [field, envVar] of Object.entries(SECRET_FIELDS)) {
    const value = merged[envVar];
    if (value) {
      (secrets as Record<string, string>)[field] = value;
    }
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
}

export function migrateConfigSecrets(
  projectPath: string,
): { migrated: boolean; fields: string[] } {
  const configFile = projectConfigPath(projectPath);
  if (!existsSync(configFile)) return { migrated: false, fields: [] };

  const raw = parseYaml(readFileSync(configFile, "utf-8")) as Record<
    string,
    unknown
  >;
  if (!raw) return { migrated: false, fields: [] };

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

  // Write secrets to .env
  saveProjectEnv(projectPath, extracted);

  // Remove secrets from config.yaml
  for (const key of migratedFields) {
    delete raw[key];
  }
  writeFileSync(configFile, stringifyYaml(raw), "utf-8");

  return { migrated: true, fields: migratedFields };
}

export function extractSecrets(
  config: Record<string, unknown>,
): { secrets: ResolvedSecrets; cleaned: Record<string, unknown> } {
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
