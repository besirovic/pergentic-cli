import { readFileSync, existsSync } from "node:fs";
import { PROMPT_TEMPLATE_VARS, DEFAULT_PROMPT_TEMPLATE, type PromptTemplateVar } from "./prompt-template-constants";
import { promptTemplatePath } from "../config/paths";
import type { Task } from "./queue";
import type { ProjectConfig } from "../config/schema";
import { logger } from "../utils/logger";
import { detectPRTemplate, buildPRTemplatePromptSection } from "./pr-template";

export type PromptTemplateContext = Record<PromptTemplateVar, string>;

// Cache validated templates so we only warn once per file path
const validatedPaths = new Set<string>();

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

/**
 * Resolve a template string by replacing {var} placeholders.
 * Unknown variables are left as-is.
 */
export function resolveTemplate(
	template: string,
	context: PromptTemplateContext,
): string {
	return template.replace(/\{(\w+)\}/g, (match, key: string) => {
		if (key in context) {
			return context[key as PromptTemplateVar];
		}
		return match;
	});
}

/**
 * Load template from .pergentic/ directory.
 * Validates template variables on first load and logs warnings for unknown vars.
 * Returns null if file doesn't exist.
 */
export function loadPromptTemplate(
	projectPath: string,
	filename: string,
): string | null {
	const fullPath = promptTemplatePath(projectPath, filename);
	if (!existsSync(fullPath)) return null;

	const template = readFileSync(fullPath, "utf-8");

	if (!validatedPaths.has(fullPath)) {
		validatedPaths.add(fullPath);
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
 */
export function validateTemplate(template: string): string[] {
	const usedVars = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
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
export function buildPromptFromTemplate(opts: BuildPromptOptions): string {
	const { projectPath, task, projectName, projectConfig, agentName, worktreePath } = opts;
	const templateFilename = projectConfig.promptTemplate?.path ?? "PROMPT.md";
	const template = loadPromptTemplate(projectPath, templateFilename) ?? DEFAULT_PROMPT_TEMPLATE;

	// Detect PR template from worktree
	const repoRoot = worktreePath ?? projectPath;
	const prTemplateContent = detectPRTemplate(repoRoot, projectConfig.pr?.templatePath);
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
