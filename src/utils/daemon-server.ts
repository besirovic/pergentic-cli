import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

type RouteHandler = (body: string, res: ServerResponse) => void;

interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

export function createDaemonServer(): {
  server: Server;
  get: (path: string, handler: (res: ServerResponse) => void) => void;
  post: (path: string, handler: RouteHandler) => void;
} {
  const routes: Route[] = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";

    // Handle GET routes
    if (method === "GET") {
      const route = routes.find((r) => r.method === "GET" && r.path === url);
      if (route) {
        route.handler("", res);
        return;
      }
    }

    // Handle POST routes
    if (method === "POST") {
      const route = routes.find((r) => r.method === "POST" && r.path === url);
      if (route) {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => route.handler(body, res));
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
