import { Agent, type Dispatcher } from "undici";
import { sleep } from "./sleep";

declare global {
  interface RequestInit {
    dispatcher?: Dispatcher;
  }
}

// Shared connection pool for all outbound HTTP requests.
// Node 20+ uses undici under the hood; providing an explicit Agent
// ensures keep-alive and connection reuse across polling cycles.
const pooledAgent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 10,
});

export class HttpError extends Error {
  status: number;
  statusText: string;
  body: string;
  url: string;

  constructor(status: number, statusText: string, body: string, url: string) {
    super(`HTTP ${status} ${statusText}: ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.url = url;
  }
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  retryableStatuses: number[];
}

const RETRY_JITTER_MAX_MS = 500;

/** Parse a Retry-After header value into milliseconds, or return undefined. */
export function parseRetryAfterMs(value: string): number | undefined {
  const seconds = parseInt(value, 10);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  // Try HTTP-date format (e.g. "Wed, 21 Oct 2025 07:28:00 GMT")
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    const delta = date.getTime() - Date.now();
    return Math.max(delta, 0);
  }
  return undefined;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryConfig?: Partial<RetryConfig>,
): Promise<Response> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        dispatcher: options.dispatcher ?? pooledAgent,
      });

      if (response.ok) return response;

      if (
        attempt < config.maxRetries &&
        config.retryableStatuses.includes(response.status)
      ) {
        const retryAfter = response.headers.get("Retry-After");
        const parsed = retryAfter ? parseRetryAfterMs(retryAfter) : undefined;
        const delayMs = parsed ??
          config.baseDelayMs * Math.pow(2, attempt) + Math.random() * RETRY_JITTER_MAX_MS;
        await sleep(delayMs);
        continue;
      }

      // Non-retryable failure or exhausted retries
      const body = await response.text().catch(() => "");
      throw new HttpError(response.status, response.statusText, body, url);
    } catch (err) {
      if (err instanceof HttpError) throw err;

      // Network error — retry if attempts remain
      if (attempt < config.maxRetries) {
        const delayMs = config.baseDelayMs * Math.pow(2, attempt) + Math.random() * RETRY_JITTER_MAX_MS;
        await sleep(delayMs);
        continue;
      }

      throw err;
    }
  }

  // Unreachable: the loop always returns or throws on the final iteration
  throw new Error(`fetchWithRetry: exhausted retries for ${url}`);
}
