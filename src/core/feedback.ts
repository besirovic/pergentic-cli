import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HISTORY_FILE = ".claude-history.json";

export interface FeedbackRound {
  round: number;
  comment: string;
  file?: string;
  line?: number;
  timestamp: string;
}

export interface FeedbackHistory {
  taskId: string;
  originalDescription: string;
  feedbackRounds: FeedbackRound[];
}

function historyPath(worktreePath: string): string {
  return join(worktreePath, HISTORY_FILE);
}

export function loadHistory(worktreePath: string): FeedbackHistory | null {
  const path = historyPath(worktreePath);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as FeedbackHistory;
}

export function saveHistory(
  worktreePath: string,
  history: FeedbackHistory,
): void {
  writeFileSync(historyPath(worktreePath), JSON.stringify(history, null, 2));
}

export function initHistory(
  worktreePath: string,
  taskId: string,
  description: string,
): FeedbackHistory {
  const history: FeedbackHistory = {
    taskId,
    originalDescription: description,
    feedbackRounds: [],
  };
  saveHistory(worktreePath, history);
  return history;
}

export function addFeedbackRound(
  worktreePath: string,
  comment: string,
  file?: string,
  line?: number,
): FeedbackHistory {
  let history = loadHistory(worktreePath);
  if (!history) {
    throw new Error("No feedback history found in worktree");
  }

  const round: FeedbackRound = {
    round: history.feedbackRounds.length + 1,
    comment,
    file,
    line,
    timestamp: new Date().toISOString(),
  };

  history.feedbackRounds.push(round);
  saveHistory(worktreePath, history);
  return history;
}

export function buildFeedbackPrompt(
  history: FeedbackHistory,
  newComment: string,
  file?: string,
  line?: number,
): string {
  const parts: string[] = [];

  parts.push(
    `You're working on task ${history.taskId}: ${history.originalDescription}`,
  );

  if (history.feedbackRounds.length > 0) {
    parts.push("\nPrevious feedback applied:");
    for (const round of history.feedbackRounds) {
      parts.push(`  Round ${round.round}: "${round.comment}"`);
    }
  }

  const roundNum = history.feedbackRounds.length + 1;
  parts.push(`\nNew feedback (Round ${roundNum}):`);
  parts.push(`  "${newComment}"`);

  if (file) {
    parts.push(
      `  This comment is on file ${file}${line ? `, line ${line}` : ""}.`,
    );
  }

  parts.push(
    "\nApply the requested changes without regressing on previous fixes.",
  );

  return parts.join("\n");
}
