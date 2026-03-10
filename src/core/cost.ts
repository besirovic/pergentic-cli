import { statsFilePath } from "../config/paths";
import { ensureGlobalConfigDir } from "../config/loader";
import { atomicWriteFileAsync, safeJsonParseAsync } from "../utils/fs";

export interface TaskCostEntry {
  taskId: string;
  cost: number;
  duration: number;
  timestamp: string;
  project?: string;
  title?: string;
  status?: "success" | "failed";
  prUrl?: string;
  error?: string;
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

async function loadStats(): Promise<StatsFile> {
  return safeJsonParseAsync<StatsFile>(statsFilePath(), { taskHistory: [], dailyStats: {} });
}

async function saveStats(stats: StatsFile): Promise<void> {
  ensureGlobalConfigDir();
  await atomicWriteFileAsync(statsFilePath(), JSON.stringify(stats, null, 2));
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

export async function recordTaskCost(
  taskId: string,
  cost: number,
  duration: number,
  createdPR: boolean,
  failed: boolean,
  extra?: { project?: string; title?: string; prUrl?: string; error?: string },
): Promise<void> {
  const stats = await loadStats();
  const date = todayKey();
  const day = ensureDay(stats, date);

  stats.taskHistory.push({
    taskId,
    cost,
    duration,
    timestamp: new Date().toISOString(),
    status: failed ? "failed" : "success",
    ...extra,
  });

  day.tasks += 1;
  day.estimatedCost += cost;
  if (createdPR) day.prs += 1;
  if (failed) day.failed += 1;

  await saveStats(stats);
}

export async function getTaskHistory(): Promise<TaskCostEntry[]> {
  const stats = await loadStats();
  return stats.taskHistory;
}

export const STATS_RETENTION_DAYS = 90;

export async function pruneStats(maxDays: number = STATS_RETENTION_DAYS): Promise<void> {
  const stats = await loadStats();
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;

  stats.taskHistory = stats.taskHistory.filter(
    (entry) => new Date(entry.timestamp).getTime() >= cutoff,
  );

  const cutoffDate = new Date(cutoff).toISOString().slice(0, 10);
  for (const key of Object.keys(stats.dailyStats)) {
    if (key < cutoffDate) {
      delete stats.dailyStats[key];
    }
  }

  await saveStats(stats);
}
