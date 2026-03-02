import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { statsFilePath } from "../config/paths";
import { ensureGlobalConfigDir } from "../config/loader";

interface TaskCostEntry {
  taskId: string;
  cost: number;
  duration: number;
  timestamp: string;
}

interface DailyStats {
  date: string;
  tasks: number;
  prs: number;
  failed: number;
  estimatedCost: number;
}

interface StatsFile {
  taskHistory: TaskCostEntry[];
  dailyStats: Record<string, DailyStats>;
}

function loadStats(): StatsFile {
  const path = statsFilePath();
  if (!existsSync(path)) {
    return { taskHistory: [], dailyStats: {} };
  }
  return JSON.parse(readFileSync(path, "utf-8")) as StatsFile;
}

function saveStats(stats: StatsFile): void {
  ensureGlobalConfigDir();
  writeFileSync(statsFilePath(), JSON.stringify(stats, null, 2));
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureDay(stats: StatsFile, date: string): DailyStats {
  if (!stats.dailyStats[date]) {
    stats.dailyStats[date] = {
      date,
      tasks: 0,
      prs: 0,
      failed: 0,
      estimatedCost: 0,
    };
  }
  return stats.dailyStats[date];
}

export function recordTaskCost(
  taskId: string,
  cost: number,
  duration: number,
  createdPR: boolean,
  failed: boolean,
): void {
  const stats = loadStats();
  const date = todayKey();
  const day = ensureDay(stats, date);

  stats.taskHistory.push({
    taskId,
    cost,
    duration,
    timestamp: new Date().toISOString(),
  });

  day.tasks += 1;
  day.estimatedCost += cost;
  if (createdPR) day.prs += 1;
  if (failed) day.failed += 1;

  saveStats(stats);
}

export function getDailyStats(): DailyStats {
  const stats = loadStats();
  const date = todayKey();
  return ensureDay(stats, date);
}

export function getTaskStats(
  taskId: string,
): TaskCostEntry | undefined {
  const stats = loadStats();
  return stats.taskHistory.find((t) => t.taskId === taskId);
}
