import { existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { daemonLogPath } from "../config/paths";
import { LIMITS } from "../config/constants";
import { readLastLines } from "../utils/read-last-lines";
import { error } from "../utils/ui";

const DEFAULT_LOG_LINES = 50;

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

  const count = parseInt(opts.lines, 10) || DEFAULT_LOG_LINES;

  const fileSize = statSync(logFile).size;
  if (fileSize > LIMITS.LOG_SIZE_WARNING_BYTES) {
    console.log(
      `Warning: Log file is ${Math.round(fileSize / (1024 * 1024))}MB. Consider using 'tail -f ${logFile}' for large files.`,
    );
  }

  // When filtering by project we need more lines since many will be filtered out.
  // For large files, read a generous multiple; for small files readLastLines reads everything.
  const readCount = opts.project ? count * 20 : count;
  let lines = readLastLines(logFile, readCount);

  if (opts.project) {
    lines = lines.filter((line) => {
      try {
        const obj = JSON.parse(line);
        return obj.project === opts.project;
      } catch {
        return false;
      }
    });
    lines = lines.slice(-count);
  }

  for (const line of lines) {
    console.log(parseLogLine(line));
  }

  if (opts.follow) {
    // Simple follow mode - tail the file
    const { spawn } = await import("node:child_process");
    const tail = spawn("tail", ["-f", logFile], { stdio: "pipe" });

    if (!tail.stdout) {
      error("Failed to capture tail output stream.");
      tail.kill();
      return;
    }

    const rl = createInterface({ input: tail.stdout });

    const cleanup = (): void => {
      rl.close();
      tail.kill();
    };

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

    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = (): void => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve();
      };

      process.once("SIGINT", done);
      rl.once("error", done);
      rl.once("close", done);
      tail.once("exit", done);
      tail.once("error", done);
    });
  }
}
