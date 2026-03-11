import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { ZodType } from "zod";
import { LIMITS } from "../config/constants";

// Rate limit constants (requests per window)
const STATUS_RATE_LIMIT = 120; // GET /status: 120 per minute
const ACTION_RATE_LIMIT = 30; // POST /retry, /cancel: 30 per minute
const RATE_WINDOW_MS = 60_000; // 1 minute window
const CLEANUP_INTERVAL_MS = 5 * 60_000; // Clean stale entries every 5 minutes

type RouteHandler = (body: string, res: ServerResponse) => void;

interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

function getRateLimitKey(ip: string, method: string): string {
  return `${ip}:${method}`;
}

/**
 * Parse a JSON request body and validate it against a Zod schema.
 * Sends a 400 response on failure and returns null so the caller can simply `return`.
 */
export function parseJsonBody<T>(body: string, schema: ZodType<T>, res: ServerResponse): T | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" }).end(
      JSON.stringify({ error: "Invalid JSON" }),
    );
    return null;
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    res.writeHead(400, { "Content-Type": "application/json" }).end(
      JSON.stringify({ error: parsed.error.issues.map((i) => i.message).join("; ") }),
    );
    return null;
  }

  return parsed.data;
}

export function createDaemonServer(): {
  server: Server;
  get: (path: string, handler: (res: ServerResponse) => void) => void;
  post: (path: string, handler: RouteHandler) => void;
} {
  const routes: Route[] = [];
  const rateLimitState = new Map<string, RateLimitEntry>();

  // Periodically clean up stale rate limit entries
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitState) {
      if (now - entry.windowStart > RATE_WINDOW_MS) {
        rateLimitState.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  function checkRateLimit(ip: string, method: string, res: ServerResponse): boolean {
    const limit = method === "GET" ? STATUS_RATE_LIMIT : ACTION_RATE_LIMIT;
    const key = getRateLimitKey(ip, method);
    const now = Date.now();
    let entry = rateLimitState.get(key);

    if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
      entry = { count: 0, windowStart: now };
      rateLimitState.set(key, entry);
    }

    entry.count++;

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.windowStart + RATE_WINDOW_MS - now) / 1000);
      res.writeHead(429, {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Remaining": "0",
      }).end();
      return false;
    }

    return true;
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const clientIp = req.socket.remoteAddress ?? "unknown";

    // Handle GET routes
    if (method === "GET") {
      const route = routes.find((r) => r.method === "GET" && r.path === url);
      if (route) {
        if (!checkRateLimit(clientIp, method, res)) return;
        route.handler("", res);
        return;
      }
    }

    // Handle POST routes
    if (method === "POST") {
      const route = routes.find((r) => r.method === "POST" && r.path === url);
      if (route) {
        if (!checkRateLimit(clientIp, method, res)) return;
        const chunks: Buffer[] = [];
        let bodyBytes = 0;
        let rejected = false;
        req.on("data", (chunk: Buffer) => {
          if (rejected) return;
          bodyBytes += chunk.length;
          if (bodyBytes > LIMITS.MAX_BODY_BYTES) {
            rejected = true;
            res.writeHead(413).end();
            req.resume(); // drain remaining data
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (!rejected) route.handler(Buffer.concat(chunks).toString("utf-8"), res);
        });
        return;
      }
    }

    res.writeHead(404).end();
  });

  return {
    server,
    get(path: string, handler: (res: ServerResponse) => void) {
      routes.push({ method: "GET", path, handler: (_body, res) => handler(res) });
    },
    post(path: string, handler: RouteHandler) {
      routes.push({ method: "POST", path, handler });
    },
  };
}
