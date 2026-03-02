import { resolve } from "node:path";
import { confirm } from "@inquirer/prompts";
import {
  loadProjectsRegistry,
  saveProjectsRegistry,
} from "../config/loader";

export async function remove(projectPath: string): Promise<void> {
  const absPath = resolve(projectPath);
  const registry = loadProjectsRegistry();

  const idx = registry.projects.findIndex(
    (p) => resolve(p.path) === absPath,
  );

  if (idx === -1) {
    console.log(`Project not registered: ${absPath}`);
    return;
  }

  const ok = await confirm({
    message: `Remove project ${absPath}?`,
    default: false,
  });

  if (!ok) {
    console.log("Aborted.");
    return;
  }

  registry.projects.splice(idx, 1);
  saveProjectsRegistry(registry);
  console.log(`✅ Removed project: ${absPath}`);
}
