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
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : config.baseDelayMs * Math.pow(2, attempt) + Math.random() * RETRY_JITTER_MAX_MS;
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
