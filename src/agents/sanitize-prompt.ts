const MAX_PROMPT_BYTES = 50 * 1024; // 50KB

/**
 * Sanitizes a prompt string before passing it to an agent process.
 *
 * Security considerations:
 * - Prompts originate from external, untrusted sources (Linear, GitHub, Slack tickets).
 * - Even though agents are spawned via execFile/spawn (no shell interpolation), malformed
 *   input containing null bytes, lone surrogates, or excessive lengths can crash agent
 *   internal parsers or trigger undefined behaviour in argument-handling libraries.
 * - We strip C0/C1 control characters (except tab, LF, CR) and lone UTF-16 surrogates,
 *   then enforce a hard 50 KB byte-length cap.
 */
export function sanitizePrompt(prompt: string): string {
  // Strip null bytes, non-printable C0 control chars (except \t \n \r), DEL, and lone surrogates.
  // eslint-disable-next-line no-control-regex
  const sanitized = prompt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uD800-\uDFFF]/g, "");

  const byteLength = Buffer.byteLength(sanitized, "utf8");
  if (byteLength > MAX_PROMPT_BYTES) {
    throw new Error(
      `Prompt exceeds maximum allowed size of ${MAX_PROMPT_BYTES} bytes (received ${byteLength} bytes). ` +
        `Reduce the ticket content before dispatching.`,
    );
  }

  return sanitized;
}
