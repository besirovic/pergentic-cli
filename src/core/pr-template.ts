import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { logger } from "../utils/logger";

/**
 * Standard locations where GitHub PR templates can be found,
 * checked in priority order.
 */
const PR_TEMPLATE_PATHS = [
	".github/PULL_REQUEST_TEMPLATE.md",
	".github/pull_request_template.md",
	"docs/PULL_REQUEST_TEMPLATE.md",
	"docs/pull_request_template.md",
	"PULL_REQUEST_TEMPLATE.md",
	"pull_request_template.md",
];

/**
 * The file the agent is instructed to write its filled-out PR body to.
 */
export const PR_BODY_OUTPUT_FILE = ".pergentic/PR_BODY.md";

/** Maximum PR template size (10 KB). Templates larger than this are truncated. */
const MAX_TEMPLATE_BYTES = 10 * 1024;

/**
 * Read a template file with size guard.
 * Returns the content truncated to MAX_TEMPLATE_BYTES if necessary.
 */
async function readSafeTemplate(filePath: string): Promise<string> {
	const content = await readFile(filePath, "utf-8");
	if (Buffer.byteLength(content, "utf-8") > MAX_TEMPLATE_BYTES) {
		logger.warn(
			{ path: filePath, bytes: Buffer.byteLength(content, "utf-8"), maxBytes: MAX_TEMPLATE_BYTES },
			"PR template exceeds size limit, truncating",
		);
		return content.slice(0, MAX_TEMPLATE_BYTES);
	}
	return content;
}

/**
 * Detect and read a PR template from the repository.
 * Checks standard GitHub template locations and an optional explicit path.
 *
 * @param repoRoot - Root of the repository (or worktree)
 * @param explicitPath - Optional user-configured template path (relative to repo root)
 * @returns The template contents, or null if none found
 */
export async function detectPRTemplate(
	repoRoot: string,
	explicitPath?: string,
): Promise<string | null> {
	// Check explicit path first
	if (explicitPath) {
		const full = resolve(repoRoot, explicitPath);
		const rootBoundary = resolve(repoRoot) + sep;
		if (!full.startsWith(rootBoundary) && full !== resolve(repoRoot)) {
			logger.warn(
				{ path: explicitPath },
				"PR template path escapes repository root, ignoring",
			);
		} else if (existsSync(full)) {
			logger.debug({ path: explicitPath }, "Using configured PR template");
			return readSafeTemplate(full);
		} else {
			logger.warn(
				{ path: explicitPath },
				"Configured PR template path not found, falling back to auto-detection",
			);
		}
	}

	// Auto-detect from standard locations
	for (const relPath of PR_TEMPLATE_PATHS) {
		const full = join(repoRoot, relPath);
		if (existsSync(full)) {
			logger.debug({ path: relPath }, "Auto-detected PR template");
			return readSafeTemplate(full);
		}
	}

	// Check for template directory (use first .md file found)
	const templateDir = join(repoRoot, ".github", "PULL_REQUEST_TEMPLATE");
	if (existsSync(templateDir)) {
		try {
			const files = (await readdir(templateDir))
				.filter((f) => f.endsWith(".md"))
				.sort();
			if (files.length > 0) {
				const picked = join(templateDir, files[0]);
				logger.debug({ path: `.github/PULL_REQUEST_TEMPLATE/${files[0]}` }, "Auto-detected PR template from directory");
				return readSafeTemplate(picked);
			}
		} catch (err) {
			logger.debug({ err, path: templateDir }, "Failed to read PR template directory");
		}
	}

	return null;
}

/**
 * Read the agent-generated PR body from the worktree.
 *
 * @param worktreePath - Path to the worktree
 * @returns The agent-generated PR body, or null if not found
 */
export async function readAgentPRBody(worktreePath: string): Promise<string | null> {
	const full = join(worktreePath, PR_BODY_OUTPUT_FILE);
	if (!existsSync(full)) return null;

	const content = (await readFile(full, "utf-8")).trim();
	if (!content) return null;

	logger.debug("Using agent-generated PR body");
	return content;
}

/**
 * Build the prompt section that instructs the agent to fill out the PR template.
 */
export function buildPRTemplatePromptSection(template: string): string {
	return `## PR Description

After completing the implementation, write a filled-out PR description to the file \`${PR_BODY_OUTPUT_FILE}\`.
Use the template below as a guide — fill in every section with details about your changes.
Remove any sections that don't apply. Do NOT leave placeholder text.

\`\`\`markdown
${template}
\`\`\``;
}
