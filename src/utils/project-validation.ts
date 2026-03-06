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
