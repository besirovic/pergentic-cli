import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PROMPT_TEMPLATE_VARS, DEFAULT_PROMPT_TEMPLATE, type PromptTemplateVar } from "./prompt-template-constants";
import { promptTemplatePath } from "../config/paths";
import type { Task } from "./queue";
import type { ProjectConfig } from "../config/schema";
import { logger } from "../utils/logger";
import { LRUCache } from "../utils/lru-cache";
import { detectPRTemplate, buildPRTemplatePromptSection } from "./pr-template";

export type PromptTemplateContext = Record<PromptTemplateVar, string>;

// Cache validated templates so we only warn once per file path.
// LRU-evicted to prevent unbounded growth in long-running daemon processes.
const validatedPaths = new LRUCache<string, boolean>(256);

/**
 * Build context object from task and project config.
 */
export function buildTemplateContext(
	task: Task,
	projectName: string,
	projectConfig: ProjectConfig,
	agentName: string,
): PromptTemplateContext {
	const { payload } = task;
	const meta = (payload.metadata ?? {}) as Record<string, unknown>;
	const now = new Date();
	return {
		title: payload.title,
		description: payload.description,
		taskId: payload.taskId,
		source: payload.source,
		labels: (payload.labels ?? []).join(", "),
		priority: String(task.priority),
		url: String(meta.url ?? ""),
		identifier: String(meta.identifier ?? ""),
		issueNumber: String(meta.issueNumber ?? ""),
		owner: String(meta.owner ?? ""),
		repo: String(meta.repo ?? ""),
		project: projectName,
		branch: projectConfig.branch,
		agent: agentName,
		date: now.toISOString().slice(0, 10),
		timestamp: now.toISOString(),
	};
}

// Sentinels used to temporarily replace escaped braces ({{ and }}) during substitution.
const LBRACE_SENTINEL = "\x00LBRACE\x00";
const RBRACE_SENTINEL = "\x00RBRACE\x00";

/**
 * Temporarily encode {{ and }} to prevent them from being treated as placeholders.
 */
function escapeBraces(s: string): string {
	return s.replace(/\{\{/g, LBRACE_SENTINEL).replace(/\}\}/g, RBRACE_SENTINEL);
}

/**
 * Restore encoded {{ and }} back to literal { and }.
 */
function unescapeBraces(s: string): string {
	return s.replaceAll(LBRACE_SENTINEL, "{").replaceAll(RBRACE_SENTINEL, "}");
}

/**
 * Resolve a template string by replacing {var} placeholders.
 * Use {{ and }} to include literal braces that are not treated as placeholders.
 * Unknown variables are left as-is.
 */
export function resolveTemplate(
	template: string,
	context: PromptTemplateContext,
): string {
	const escaped = escapeBraces(template);
	const resolved = escaped.replace(/\{(\w+)\}/g, (match, key: string) => {
		if (key in context) {
			return context[key as PromptTemplateVar];
		}
		return match;
	});
	return unescapeBraces(resolved);
}

/**
 * Load template from .pergentic/ directory.
 * Validates template variables on first load and logs warnings for unknown vars.
 * Returns null if file doesn't exist.
 */
export async function loadPromptTemplate(
	projectPath: string,
	filename: string,
): Promise<string | null> {
	const fullPath = promptTemplatePath(projectPath, filename);
	if (!existsSync(fullPath)) return null;

	const template = await readFile(fullPath, "utf-8");

	if (!validatedPaths.has(fullPath)) {
		validatedPaths.set(fullPath, true);
		const unknownVars = validateTemplate(template);
		if (unknownVars.length > 0) {
			logger.warn(
				{ unknownVars, templatePath: filename },
				"Prompt template contains unknown variables",
			);
		}
	}

	return template;
}

/**
 * Validate template variables. Returns list of unknown variable names.
 * Escaped braces ({{ and }}) are ignored — they are treated as literal text.
 */
export function validateTemplate(template: string): string[] {
	const escaped = escapeBraces(template);
	const usedVars = [...escaped.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
	return usedVars.filter(
		(v) => !PROMPT_TEMPLATE_VARS.includes(v as PromptTemplateVar),
	);
}

export interface BuildPromptOptions {
	projectPath: string;
	task: Task;
	projectName: string;
	projectConfig: ProjectConfig;
	agentName: string;
	worktreePath?: string;
}

/**
 * Build the final prompt: load template, resolve variables,
 * prepend systemContext if configured.
 * Falls back to default template when no template file exists.
 */
export async function buildPromptFromTemplate(opts: BuildPromptOptions): Promise<string> {
	const { projectPath, task, projectName, projectConfig, agentName, worktreePath } = opts;
	const templateFilename = projectConfig.promptTemplate?.path ?? "PROMPT.md";
	const template = (await loadPromptTemplate(projectPath, templateFilename)) ?? DEFAULT_PROMPT_TEMPLATE;

	// Detect PR template from worktree
	const repoRoot = worktreePath ?? projectPath;
	const prTemplateContent = await detectPRTemplate(repoRoot, projectConfig.pr?.templatePath);
	const prTemplateSection = prTemplateContent
		? buildPRTemplatePromptSection(prTemplateContent)
		: "";

	// Resolve standard variables first (without prTemplate to avoid mangling
	// {var} placeholders that may appear inside the PR template content)
	const context = buildTemplateContext(task, projectName, projectConfig, agentName);
	let prompt = resolveTemplate(template, context);

	// Insert prTemplate after variable resolution to preserve its raw content
	if (template.includes("{prTemplate}")) {
		prompt = prompt.replace("{prTemplate}", prTemplateSection);
	} else if (prTemplateContent) {
		// Auto-append when the prompt template doesn't explicitly use {prTemplate}
		prompt = `${prompt}\n\n${prTemplateSection}`;
	}

	// Prepend systemContext if configured (preserves existing behavior)
	if (projectConfig.claude?.systemContext) {
		prompt = `${projectConfig.claude.systemContext}\n\n${prompt}`;
	}

	return prompt;
}
