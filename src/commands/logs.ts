import { existsSync, readFileSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { daemonLogPath } from "../config/paths";

function parseLogLine(line: string): string {
  try {
    const obj = JSON.parse(line);
    const time = obj.time
      ? new Date(obj.time).toLocaleTimeString()
      : "";
    const level = obj.level ?? "";
    const msg = obj.msg ?? "";
    const project = obj.project ? `[${obj.project}]` : "";
    return `${time} ${levelName(level)} ${project} ${msg}`.trim();
  } catch {
    return line;
  }
}

function levelName(level: number | string): string {
  if (typeof level === "string") return level;
  if (level <= 10) return "TRACE";
  if (level <= 20) return "DEBUG";
  if (level <= 30) return "INFO";
  if (level <= 40) return "WARN";
  if (level <= 50) return "ERROR";
  return "FATAL";
}

export async function logs(opts: {
  project?: string;
  lines: string;
  follow?: boolean;
}): Promise<void> {
  const logFile = daemonLogPath();

  if (!existsSync(logFile)) {
    console.log("No log file found. Is the daemon running?");
    return;
  }

  const count = parseInt(opts.lines, 10) || 50;

  // Read last N lines
  const content = readFileSync(logFile, "utf-8");
  let lines = content.split("\n").filter(Boolean);

  if (opts.project) {
    lines = lines.filter((line) => {
      try {
        const obj = JSON.parse(line);
        return obj.project === opts.project;
      } catch {
        return false;
      }
    });
  }

  const lastN = lines.slice(-count);
  for (const line of lastN) {
    console.log(parseLogLine(line));
  }

  if (opts.follow) {
    // Simple follow mode - tail the file
    const { spawn } = await import("node:child_process");
    const tail = spawn("tail", ["-f", logFile], { stdio: "pipe" });

    if (!tail.stdout) {
      console.error("Failed to capture tail output stream.");
      tail.kill();
      return;
    }

    const rl = createInterface({ input: tail.stdout });
    rl.on("line", (line) => {
      if (opts.project) {
        try {
          const obj = JSON.parse(line);
          if (obj.project !== opts.project) return;
        } catch {
          return;
        }
      }
      console.log(parseLogLine(line));
    });

    process.once("SIGINT", () => {
      rl.close();
      tail.kill();
      process.exit(0);
    });
  }
}
