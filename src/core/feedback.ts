import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { safeJsonParseAsync } from "../utils/fs";

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

export async function loadHistory(worktreePath: string): Promise<FeedbackHistory | null> {
  return safeJsonParseAsync<FeedbackHistory | null>(historyPath(worktreePath), null);
}

export async function saveHistory(
  worktreePath: string,
  history: FeedbackHistory,
): Promise<void> {
  await writeFile(historyPath(worktreePath), JSON.stringify(history, null, 2));
}

export async function initHistory(
  worktreePath: string,
  taskId: string,
  description: string,
): Promise<FeedbackHistory> {
  const history: FeedbackHistory = {
    taskId,
    originalDescription: description,
    feedbackRounds: [],
  };
  await saveHistory(worktreePath, history);
  return history;
}

export async function addFeedbackRound(
  worktreePath: string,
  comment: string,
  file?: string,
  line?: number,
): Promise<FeedbackHistory> {
  let history = await loadHistory(worktreePath);
  if (!history) {
    throw new Error(`No feedback history found in worktree: ${worktreePath}`);
  }

  const round: FeedbackRound = {
    round: history.feedbackRounds.length + 1,
    comment,
    file,
    line,
    timestamp: new Date().toISOString(),
  };

  history.feedbackRounds.push(round);
  await saveHistory(worktreePath, history);
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
