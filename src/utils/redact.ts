/**
 * Redacts sensitive values (API keys, tokens) from string arrays.
 * Used to sanitize agent command args before logging.
 */

const SENSITIVE_PATTERNS = [
	/^sk-ant-[A-Za-z0-9_-]+/,       // Anthropic API keys
	/^sk-[A-Za-z0-9_-]{20,}/,       // OpenAI API keys
	/^ghp_[A-Za-z0-9]{36,}/,        // GitHub personal access tokens
	/^gho_[A-Za-z0-9]{36,}/,        // GitHub OAuth tokens
	/^ghu_[A-Za-z0-9]{36,}/,        // GitHub user-to-server tokens
	/^ghs_[A-Za-z0-9]{36,}/,        // GitHub server-to-server tokens
	/^github_pat_[A-Za-z0-9_]{22,}/, // GitHub fine-grained PATs
	/^lin_api_[A-Za-z0-9]{30,}/,    // Linear API keys
	/^xoxb-[A-Za-z0-9-]+/,          // Slack bot tokens
	/^xoxp-[A-Za-z0-9-]+/,          // Slack user tokens
	/^sk-or-v1-[A-Za-z0-9]{40,}/,   // OpenRouter API keys
];

const REDACTED = "***REDACTED***";

function isSensitive(value: string): boolean {
	return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Returns a copy of args with sensitive values replaced by a redaction marker.
 * Non-sensitive args (file paths, flags, etc.) are left unchanged.
 */
export function redactArgs(args: readonly string[]): string[] {
	return args.map((arg) => (isSensitive(arg) ? REDACTED : arg));
}

/**
 * Redacts sensitive values embedded within a single string.
 * Splits on whitespace tokens and handles --flag=VALUE patterns.
 */
export function redactString(value: string): string {
	return value.replace(/\S+/g, (token) => {
		const eqIdx = token.indexOf("=");
		if (eqIdx !== -1) {
			const afterEq = token.slice(eqIdx + 1);
			if (isSensitive(afterEq)) {
				return token.slice(0, eqIdx + 1) + REDACTED;
			}
		}
		return isSensitive(token) ? REDACTED : token;
	});
}
