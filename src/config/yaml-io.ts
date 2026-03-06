import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export function readYaml(filePath: string): unknown {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf-8");
  return parseYaml(raw) ?? {};
}

export function writeYaml(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, stringifyYaml(data), "utf-8");
}
