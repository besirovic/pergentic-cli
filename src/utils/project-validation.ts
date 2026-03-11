import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { type Result, ok, err } from "../types/result";

export function validateProjectPath(projectPath: string): Result<string, string> {
  const absPath = resolve(projectPath);

  if (!existsSync(absPath)) {
    return err(`Directory does not exist: ${absPath}`);
  }

  if (!existsSync(resolve(absPath, ".git"))) {
    return err(`Not a git repository: ${absPath}`);
  }

  return ok(absPath);
}

const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.\-]*[a-zA-Z0-9])?$/;

export function isValidHostname(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (host.startsWith("-")) return false;
  return HOSTNAME_RE.test(host);
}

export function isValidPort(port: unknown): boolean {
  const n = typeof port === "string" ? Number(port) : port;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 65535;
}
