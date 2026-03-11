import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export function readYaml(filePath: string): unknown {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf-8");
  try {
    return parseYaml(raw) ?? {};
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse YAML config at ${filePath}: ${message}`);
  }
}

export function writeYaml(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + ".tmp";
  try {
    writeFileSync(tmpPath, stringifyYaml(data), "utf-8");
    renameSync(tmpPath, filePath);
  } catch (error: unknown) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // tmp file may not exist if writeFileSync failed
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write YAML config at ${filePath}: ${message}`);
  }
}
