# Pergentic v1.0 — Complete CLI Specification

## What It Is

Pergentic is a CLI tool that turns project management tickets into pull requests autonomously. When a task moves to "In Progress" in Linear, GitHub Issues, or gets triggered via Slack, Pergentic picks it up, runs a coding agent (Claude Code, OpenCode, Codex, Aider), and creates a PR. When you leave a PR comment with feedback, it picks that up too, applies the changes, and pushes again. It runs as a background daemon on any machine.

---

## Core Workflow

### New Task Flow

```
1. User moves ticket to "In Progress" in Linear/GitHub/Slack
2. Pergentic poller detects the change (polls every 30s)
3. Creates a git worktree: git worktree add -b {branch} ./worktrees/{task-id} main
4. Fetches task title + description from provider API
5. Spawns the configured coding agent with the task prompt
6. Agent reads codebase, makes edits, runs lint/build
7. Commits all changes, pushes to remote
8. Creates PR via GitHub CLI with configured template
9. Updates task status in provider (→ "In Review")
10. Sends notification via Slack/Discord webhook
```

### Feedback Loop Flow

```
1. User checks Vercel/Netlify preview, spots an issue
2. Leaves a PR comment: "The sidebar overlaps on mobile"
3. Pergentic poller detects new comment on a Pergentic-managed PR
4. Resolves the existing worktree for that task (already exists)
5. Loads feedback history from .claude-history.json
6. Builds prompt with original task + all prior feedback + new comment
7. Spawns agent in the same worktree with full prior context
8. Agent applies targeted changes
9. Amends commit, force pushes → Vercel auto-redeploys
10. Replies to PR comment: "Applied, preview redeploying"
```

### Worktree Cleanup

```
PR merged   → delete worktree + delete remote branch
PR closed   → delete worktree + delete remote branch
Stale (7d)  → notify user, then clean up
```

---

## CLI Commands

```bash
pergentic init                      # Interactive setup wizard
pergentic init slack                # Slack-specific setup

pergentic add [path]                # Register a project directory
pergentic remove [path]             # Unregister a project
pergentic list                      # Show all projects + status

pergentic start                     # Start daemon in background
pergentic stop                      # Stop daemon gracefully
pergentic restart                   # Stop + start
pergentic status                    # One-line status check
pergentic status --remote prod      # Check remote instance via SSH tunnel

pergentic dashboard                 # Full TUI monitoring
pergentic logs [--project] [-n]     # Tail daemon logs

pergentic retry [task-id]           # Retry a failed task
pergentic cancel [task-id]          # Cancel a running task

pergentic service install           # Generate systemd/launchd config
```

---

## `pergentic init` — Interactive Setup

```
$ pergentic init

🔧 Setting up Pergentic...

? Repo URL: git@github.com:username/my-saas.git
? Default branch: main
? Anthropic API key: sk-ant-•••••
? GitHub token: ghp_•••••
? Linear API key: lin_api_•••••
? Poll interval (seconds): 30

✅ Created .pergentic/config.yaml
✅ Created .pergentic/.env
✅ Added .pergentic/.env to .gitignore

Run `pergentic start` to begin.
```

### Slack Setup

```
$ pergentic init slack

? Slack Bot Token: xoxb-•••••
? Slack App Token: xapp-•••••
? Channel to listen in: #pergentic

✅ Slack connected via Socket Mode
```

Slack uses Socket Mode (WebSockets, outbound connection). No public URL needed. Works behind any firewall.

---

## File System Layout

### Global Config

```
~/.pergentic/
├── config.yaml          # Global settings + API keys
├── projects.yaml        # Registered project paths (auto-managed by CLI)
├── daemon.pid           # PID of running daemon
├── daemon.log           # Daemon log output
├── state.json           # Live state (daemon writes, dashboard reads)
└── stats.json           # Cumulative statistics
```

### Per-Project Config

```
~/projects/my-saas/.pergentic/
└── config.yaml          # Project-specific settings only
```

### Workspaces

```
~/.pergentic/workspaces/
├── my-saas/
│   ├── repo/                  # Main clone
│   │   ├── .git/
│   │   ├── node_modules/      # Cached, saves time on subsequent tasks
│   │   └── src/
│   └── worktrees/
│       ├── SAAS-142/          # Active task
│       └── SAAS-143/          # Active task
├── client-app/
│   ├── repo/
│   └── worktrees/
└── landing-page/
    ├── repo/
    └── worktrees/
```

Actual project directories stay untouched. Pergentic works in its own space.

---

## Configuration

### Global Config — `~/.pergentic/config.yaml`

```yaml
# API keys — shared across all projects
anthropicApiKey: sk-ant-...
githubToken: ghp_...
linearApiKey: lin_api_...

# Polling
pollInterval: 30 # seconds

# Concurrency
maxConcurrent:
  2 # parallel agent processes (default: 2)
  # Laptop 16GB → 3-4
  # VPS 4GB → 2
  # VPS 8GB → 3-4

# Notifications
notifications:
  slack:
    webhook: https://hooks.slack.com/services/xxx
    on:
      taskCompleted: true
      taskFailed: true
      prCreated: true
  discord:
    webhook: https://discord.com/api/webhooks/xxx
    on:
      taskFailed: true

# Remote monitoring
remotes:
  production:
    host: ec2-user@your-server
    port: 7890
```

### Per-Project Config — `.pergentic/config.yaml`

No API keys here. Those live globally.

```yaml
repo: git@github.com:username/my-saas.git
branch: main
agent: claude-code # claude-code | codex | aider | opencode

# Linear integration
linearTeamId: SAAS

# Agent options
claude:
  instructions: "CLAUDE.md" # Path relative to repo root
  maxCostPerTask: 5.00 # Kill run if exceeded
  allowedTools:
    - edit
    - bash
    - read
  systemContext: |
    This is a Next.js 15 app with Supabase backend.
    Always use server components unless interactivity is needed.
    Run `yarn lint` before finishing.

# PR creation
pr:
  titleFormat: "feat: {taskTitle} [{taskId}]"
  bodyTemplate: |
    ## {taskTitle}

    Resolves {taskId}

    ### What changed
    {claudeSummary}
  labels:
    - "ai-generated"
    - "needs-review"
  reviewers:
    - "username"

# Linear status mapping
linear:
  triggers:
    onInProgress: true
    onInReview: false
  updateStatus:
    afterPR: "In Review"
    afterMerge: "Done"

# Feedback settings
feedback:
  listenTo:
    issueComments: true
    reviewComments: true
    reviewRequests: false
  ignoreUsers:
    - "pergentic[bot]"
  maxRounds: 5

# Slack channel binding
slack:
  channels:
    "#saas-dev": my-saas
    "#client-dev": client-app
```

### Projects Registry — `~/.pergentic/projects.yaml`

Auto-managed by `pergentic add` / `pergentic remove`:

```yaml
projects:
  - path: /home/user/projects/my-saas
  - path: /home/user/projects/client-app
  - path: /home/user/projects/landing-page
```

---

## Polling Strategy

Both Linear and GitHub are polled. No public URL, no tunnels, no webhook secrets. Works behind NAT, firewalls, corporate VPNs.

- Zero network configuration
- Linear: 1,500 req/hour limit. Polling every 30s uses ~120/hour.
- GitHub: 5,000 req/hour limit. Polling every 30s uses ~120/hour.
- Tradeoff: 0-30 seconds latency. For a pipeline that takes minutes, nobody notices.

### Poll Cycle

```
Every 30 seconds:
  for each registered project:
    ├── Check Linear API (filtered by project's teamId)
    │   └── Any tasks moved to "In Progress"?
    ├── Check GitHub API (filtered by project's repo)
    │   ├── Any new issue assignments?
    │   └── Any new PR comments on Pergentic-managed branches?
    └── Queue any new work (prioritized)
```

### Slack

Uses Socket Mode — WebSocket connection initiated from CLI. Events pushed instantly. No polling, no public URL.

```
@pergentic fix the login redirect bug on the /auth page
@pergentic in my-saas add dark mode toggle to settings
```

Multi-project resolution:

- Mention project: `@pergentic in my-saas fix the bug`
- Channel binding in config (channels map to projects)
- Pergentic asks which project if ambiguous

Response in thread:

```
🔧 Working on it...

✅ PR #48 created: "Fix login redirect on /auth"
   https://github.com/ademir/my-saas/pull/48
   Preview: https://my-saas-pr-48.vercel.app
```

Slack app setup:

1. Create app at api.slack.com/apps
2. Enable Socket Mode → generates `xapp-` token
3. Add Bot Token Scopes: `chat:write`, `app_mentions:read`, `channels:history`
4. Install to workspace → generates `xoxb-` token
5. Invite `@pergentic` to channel

---

## Task Queue + Worker Pool

### Priority System

```
Priority 1 (highest): Feedback on existing PR
  → User is actively reviewing, fast to execute

Priority 2: New task
  → Takes longer, can wait a few minutes

Priority 3: Retry after failure
  → Lowest urgency
```

### In-Memory Queue

No Redis needed. Single Node.js process, simple priority array:

```typescript
interface Task {
	id: string;
	project: string;
	priority: number;
	type: "new" | "feedback";
	payload: TaskPayload;
}

class TaskQueue {
	private tasks: Task[] = [];

	add(task: Task) {
		this.tasks.push(task);
		this.tasks.sort((a, b) => a.priority - b.priority);
	}

	next(): Task | undefined {
		return this.tasks.shift();
	}

	get length() {
		return this.tasks.length;
	}
}
```

### Worker Pool

Each agent runs as a separate child process. Node.js supervises them:

```typescript
class TaskRunner {
	private active: Map<string, ChildProcess> = new Map();
	private maxConcurrent: number;

	constructor(config: Config) {
		this.maxConcurrent = config.maxConcurrent ?? 2;
	}

	async run(task: Task): Promise<boolean> {
		if (this.active.size >= this.maxConcurrent) {
			return false;
		}

		const worktree = await createWorktree(task);
		const agent = resolveAgent(task.project.agent);

		const child = spawn(agent.command, agent.args(task), {
			cwd: worktree.path,
			env: {
				...process.env,
				ANTHROPIC_API_KEY: task.project.apiKey,
			},
		});

		this.active.set(task.id, child);

		child.on("exit", async (code) => {
			this.active.delete(task.id);

			if (code === 0) {
				await commitAndPush(worktree, task);
				await createPR(task);
				await notify({ type: "taskCompleted", task });
			} else {
				await notify({ type: "taskFailed", task });
			}
		});

		return true;
	}

	get availableSlots() {
		return this.maxConcurrent - this.active.size;
	}
}
```

### Poll Loop

```typescript
async function pollLoop(runner: TaskRunner, queue: TaskQueue) {
	while (!shuttingDown) {
		for (const project of projects) {
			const newTasks = await pollProviders(project);
			newTasks.forEach((t) => queue.add(t));
		}

		while (runner.availableSlots > 0 && queue.length > 0) {
			const task = queue.next();
			await runner.run(task);
		}

		await sleep(config.pollInterval * 1000);
	}
}
```

### Feedback While Task Is Running

If feedback arrives for a task currently being processed:

1. Feedback gets queued (Priority 1)
2. Current run finishes, commits, pushes, creates PR
3. Worker picks up queued feedback immediately
4. Applies feedback in same worktree, amends commit, force pushes

---

## Agent Abstraction

```typescript
interface Agent {
	name: string;
	command(prompt: string, workdir: string): string;
	isInstalled(): Promise<boolean>;
}
```

### Claude Code

```typescript
export const claudeCode: Agent = {
	name: "claude-code",
	command: (prompt, workdir) =>
		`claude -p "${prompt}" --allowedTools edit,bash,read`,
	isInstalled: async () => {
		try {
			await exec("claude --version");
			return true;
		} catch {
			return false;
		}
	},
};
```

### Codex

```typescript
export const codex: Agent = {
	name: "codex",
	command: (prompt) => `codex --quiet "${prompt}"`,
	isInstalled: async () => {
		try {
			await exec("codex --version");
			return true;
		} catch {
			return false;
		}
	},
};
```

### Aider

```typescript
export const aider: Agent = {
	name: "aider",
	command: (prompt) => `aider --message "${prompt}" --yes`,
	isInstalled: async () => {
		try {
			await exec("aider --version");
			return true;
		} catch {
			return false;
		}
	},
};
```

### OpenCode

```typescript
export const opencode: Agent = {
	name: "opencode",
	command: (prompt) => `opencode run "${prompt}"`,
	isInstalled: async () => {
		try {
			await exec("opencode --version");
			return true;
		} catch {
			return false;
		}
	},
};
```

---

## Task Provider Abstraction

```typescript
interface TaskProvider {
	name: string;
	poll(project: Project): Promise<IncomingTask[]>;
	onComplete(task: Task, result: TaskResult): Promise<void>;
}
```

Three providers: Linear, GitHub Issues, Slack. Each implements this interface. The poller iterates over active providers for each project.

---

## Feedback Context Management

Each task maintains a history file to prevent regressions across feedback rounds:

```json
// .claude-history.json (per worktree)
{
	"taskId": "SAAS-142",
	"originalDescription": "Add Stripe billing integration",
	"feedbackRounds": [
		{ "round": 1, "comment": "Fix the mobile layout" },
		{ "round": 2, "comment": "Also add a loading spinner" }
	]
}
```

Agent prompt includes full history:

```
You're working on task SAAS-142: Add Stripe billing integration.

Previous feedback applied:
  Round 1: "Fix the mobile layout"
  Round 2: "Also add a loading spinner"

New feedback (Round 3):
  "The form validation is too strict, allow + in email addresses"
  This comment is on file src/components/BillingForm.tsx, line 42.

Apply the requested changes without regressing on previous fixes.
```

GitHub events to listen for:

- `issue_comment` — general PR comment (broad feedback)
- `pull_request_review_comment` — line-specific comment (file path + line number)
- `pull_request_review` — full review with "Request Changes" (batch)

Filter out bot's own comments via `ignoreUsers` config.

---

## Background Daemon

### Daemonization

Uses `node:child_process` fork with `detached: true` to survive terminal close:

```typescript
export function startDaemon() {
	if (isRunning()) {
		console.log("Pergentic is already running");
		process.exit(1);
	}

	const out = openSync(LOG_FILE, "a");
	const err = openSync(LOG_FILE, "a");

	const child = fork(resolve(__dirname, "../daemon.ts"), [], {
		detached: true,
		stdio: ["ignore", out, err, "ipc"],
	});

	child.unref();
	writeFileSync(PID_FILE, String(child.pid));

	console.log(`🚀 Pergentic running in background (PID: ${child.pid})`);
	console.log(`   Logs: ~/.pergentic/daemon.log`);
	console.log(`   Stop: pergentic stop`);

	process.exit(0);
}
```

### Stop

```typescript
export function stopDaemon() {
	if (!existsSync(PID_FILE)) {
		console.log("Pergentic is not running");
		return;
	}

	const pid = parseInt(readFileSync(PID_FILE, "utf-8"));

	try {
		process.kill(pid, "SIGTERM");
		unlinkSync(PID_FILE);
		console.log("Pergentic stopped");
	} catch {
		unlinkSync(PID_FILE);
		console.log("Pergentic was not running (stale PID file cleaned up)");
	}
}
```

### Graceful Shutdown

```typescript
let shuttingDown = false;

process.on("SIGTERM", async () => {
	logger.info("Shutting down gracefully...");
	shuttingDown = true;
	await waitForActiveTasks(300_000); // max 5 min
	process.exit(0);
});
```

### Health Check

```typescript
function isRunning(): boolean {
	if (!existsSync(PID_FILE)) return false;

	const pid = parseInt(readFileSync(PID_FILE, "utf-8"));

	try {
		process.kill(pid, 0); // signal 0 = check if alive
		return true;
	} catch {
		unlinkSync(PID_FILE); // clean stale PID
		return false;
	}
}
```

### State File

Daemon writes `~/.pergentic/state.json` every few seconds for dashboard consumption:

```typescript
async function updateState() {
	await writeFile(
		STATE_FILE,
		JSON.stringify({
			status: "running",
			uptime: process.uptime(),
			projects: projects.map((p) => ({
				name: p.name,
				agent: p.agent,
				status: p.currentTask ? "working" : "idle",
				lastActivity: p.lastActivity,
			})),
			activeTasks: queue.active(),
			recentTasks: taskHistory.last(20),
			todayStats: {
				tasks: stats.tasksToday,
				prs: stats.prsToday,
				failed: stats.failedToday,
				estimatedCost: stats.costToday,
			},
		}),
	);
}
```

### Status Endpoint (for Remote Monitoring)

Lightweight HTTP server, localhost only:

```typescript
createServer((req, res) => {
	if (req.url === "/status") {
		res.setHeader("Content-Type", "application/json");
		res.end(readFileSync(STATE_FILE, "utf-8"));
		return;
	}
	res.writeHead(404).end();
}).listen(config.statusPort || 7890, "127.0.0.1");
```

### Remote Status

```bash
pergentic status --remote production
# SSH tunnel to remote's localhost:7890, fetches state.json
```

```typescript
if (options.remote) {
	const remote = config.remotes[options.remote];
	const tunnel = spawn("ssh", [
		"-L",
		`${localPort}:127.0.0.1:${remote.port}`,
		remote.host,
		"-N",
	]);
	const state = await fetch(`http://localhost:${localPort}/status`);
	tunnel.kill();
	renderStatus(state);
}
```

### Service Installation (systemd / launchd)

```bash
pergentic service install
```

Generates platform-specific service config:

- Linux: `~/.config/systemd/user/pergentic.service`
- macOS: `~/Library/LaunchAgents/com.pergentic.plist`

Enables auto-restart on crash and start on login.

---

## Notifications

```typescript
async function notify(event: TaskEvent) {
	const { notifications } = config;

	if (notifications.slack?.on[event.type]) {
		await fetch(notifications.slack.webhook, {
			method: "POST",
			body: JSON.stringify({ text: formatSlackMessage(event) }),
		});
	}

	if (notifications.discord?.on[event.type]) {
		await fetch(notifications.discord.webhook, {
			method: "POST",
			body: JSON.stringify({ content: formatDiscordMessage(event) }),
		});
	}
}
```

### Notification Formats

```
✅ SAAS-142: Add Stripe billing
   PR created: github.com/ademir/my-saas/47
   Preview: my-saas-pr-47.vercel.app
   Duration: 3m 22s

❌ SAAS-143: Fix mobile nav
   Failed: yarn build exited with code 1
   Run `pergentic retry SAAS-143` to retry
```

---

## Cost Tracking

Each task logs estimated API cost based on agent usage:

```typescript
interface TaskResult {
	taskId: string;
	status: "completed" | "failed";
	prUrl?: string;
	duration: number; // seconds
	estimatedCost: number; // dollars
}
```

Accumulated in `~/.pergentic/stats.json` and displayed in dashboard:

```
Today: 7 tasks · 5 PRs · 1 failed · $12.40 API cost
```

---

## TUI Dashboard

Built with Ink (React for the terminal). Reads from `~/.pergentic/state.json` on a 1-second interval. Zero coupling between dashboard and daemon.

### Main View

```
┌─ Pergentic ──────────────────────────────────────────────────────┐
│  ● Running  ·  Uptime 3h 42m  ·  Polling every 30s             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Projects                                                        │
│  ┌────────────┬──────────┬───────────┬─────────────────────┐    │
│  │ Project    │ Agent    │ Status    │ Last Activity       │    │
│  ├────────────┼──────────┼───────────┼─────────────────────┤    │
│  │ my-saas    │ claude   │ ● working │ SAAS-142 (2m ago)   │    │
│  │ client-app │ codex    │ ○ idle    │ CLI-38 (1h ago)     │    │
│  │ landing    │ claude   │ ○ idle    │ LAND-12 (3h ago)    │    │
│  └────────────┴──────────┴───────────┴─────────────────────┘    │
│                                                                  │
│  Active Tasks                                                    │
│  ┌──────────┬───────────────────────┬────────┬──────────┐       │
│  │ Task     │ Title                 │ Status │ Duration │       │
│  ├──────────┼───────────────────────┼────────┼──────────┤       │
│  │ SAAS-142 │ Add Stripe billing    │ ██░░░  │ 2m 14s   │       │
│  │ SAAS-143 │ Fix mobile nav        │ queued │ —        │       │
│  └──────────┴───────────────────────┴────────┴──────────┘       │
│                                                                  │
│  Recent                                                          │
│  ✓ SAAS-140  Fix auth redirect       PR #45   3m 22s   $1.20   │
│  ✓ CLI-38    Add search endpoint     PR #12   4m 51s   $2.10   │
│  ✗ LAND-11   Redesign hero section   Failed   2m 07s   $0.80   │
│  ✓ SAAS-139  Update Stripe webhook   PR #44   1m 43s   $0.60   │
│                                                                  │
│  Today: 7 tasks · 5 PRs · 1 failed · $12.40 API cost           │
├─────────────────────────────────────────────────────────────────┤
│  [L]ogs  [R]etry failed  [P]ause  [Q]uit                       │
└─────────────────────────────────────────────────────────────────┘
```

### Task Drill-Down (press Enter on a task)

```
┌─ SAAS-142: Add Stripe billing ──────────────────────────────────┐
│                                                                  │
│  Status:    ● Running (Claude Code)                              │
│  Branch:    saas-142-add-stripe-billing                          │
│  Duration:  2m 14s                                               │
│  Worktree:  ~/.pergentic/workspaces/my-saas/worktrees/SAAS-142   │
│                                                                  │
│  Agent Output (live):                                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Reading src/lib/stripe.ts...                              │   │
│  │ Creating src/app/api/webhooks/stripe/route.ts...          │   │
│  │ Editing src/app/settings/billing/page.tsx...              │   │
│  │ Running yarn lint... ✓                                    │   │
│  │ Running yarn build... ✓                                   │   │
│  │ █                                                         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Feedback Rounds: 0                                              │
│  Estimated cost: $1.20                                           │
│                                                                  │
│  [B]ack  [C]ancel task  [O]pen worktree in editor                │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation

```typescript
// commands/dashboard.tsx
import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput } from "ink";

function Dashboard() {
	const [state, setState] = useState(readState());

	useEffect(() => {
		const interval = setInterval(() => {
			setState(readState());
		}, 1000);
		return () => clearInterval(interval);
	}, []);

	useInput((input) => {
		if (input === "q") process.exit(0);
		if (input === "l") showLogs();
		if (input === "r") retryFailed();
		if (input === "p") togglePause();
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Header status={state.status} uptime={state.uptime} />
			<ProjectTable projects={state.projects} />
			<ActiveTasks tasks={state.activeTasks} />
			<RecentTasks tasks={state.recentTasks} />
			<StatusBar stats={state.todayStats} />
			<Hotkeys />
		</Box>
	);
}

render(<Dashboard />);
```

---

## Git Operations

### New Task

```bash
git pull origin main
git worktree add -b {task-id}-{slug} ./worktrees/{task-id} main
cd ./worktrees/{task-id}
# agent runs here
git add -A
git commit -m "feat: {task title} [{task-id}]"
git push origin {task-id}-{slug}
gh pr create --title "{title}" --body "{body}" --label "ai-generated"
```

### Feedback Round

```bash
cd ./worktrees/{task-id}           # already exists
git pull origin {branch}           # sync any remote changes
# agent runs with feedback context
git add -A
git commit --amend --no-edit
git push --force origin {branch}
# Vercel auto-redeploys from force push
```

---

## Concurrency

### Resource Requirements Per Agent Process

```
Agent process: ~500MB - 2GB RAM each
(mostly repo + node_modules + build artifacts)

Laptop (16GB RAM):     3-4 concurrent
VPS 4GB:               2 concurrent
VPS 8GB:               3-4 concurrent
EC2 t3.large (8GB):    3-4 concurrent
EC2 t3.xlarge (16GB):  5-6 concurrent
```

### Same-Project Parallel Tasks

Safe — worktrees isolate file systems. Each task pushes to its own branch. Default `maxConcurrent: 2` is the safe starting point.

---

## Multi-Project Support

One daemon manages all registered projects:

```bash
pergentic add ~/projects/my-saas
pergentic add ~/projects/client-app
pergentic add ~/projects/landing-page
pergentic start
```

Each project has its own `.pergentic/config.yaml`. API keys live in global config. One poll cycle covers all projects.

### `pergentic list`

```
$ pergentic list

  Project          Branch   Active Tasks   Status
  my-saas          main     2              ● running
  client-app       main     0              ● idle
  landing-page     develop  1              ● running
```

### `pergentic start`

```
$ pergentic start

🚀 Pergentic running in background (PID: 48291)
   Watching 3 projects
   Logs: ~/.pergentic/daemon.log
   Stop: pergentic stop
```

---

## Monitoring

### Local

```bash
pergentic status              # quick one-line check
pergentic logs                # tail log file
pergentic logs --project my-saas -n 50
pergentic dashboard           # full TUI
```

### Remote (SSH)

```bash
ssh ec2-user@server pergentic dashboard
# or with persistent session:
ssh ec2-user@server -t tmux attach -t pergentic
# or via status endpoint:
pergentic status --remote production
```

### Push Notifications (Primary Method)

Slack/Discord webhooks handle 90% of monitoring needs. User gets pinged when tasks complete or fail.

---

## Tech Stack

| Component           | Choice                | Reason                                    |
| ------------------- | --------------------- | ----------------------------------------- |
| Language            | TypeScript            | Type safety, ecosystem                    |
| Runtime             | Node.js               | Widest compatibility for CLI distribution |
| CLI framework       | Commander.js          | Clean, lightweight, most popular          |
| Interactive prompts | @inquirer/prompts     | Modular, no bloat                         |
| Agent execution     | child_process (spawn) | Each agent is a separate OS process       |
| Git operations      | simple-git            | Typed wrappers, proper error handling     |
| HTTP client         | Built-in fetch        | Just a few API calls                      |
| Config format       | YAML + zod            | Human-friendly, validated with types      |
| Logging             | pino                  | Fast, structured, JSON logs               |
| TUI                 | Ink                   | React for the terminal                    |
| Build tool          | tsup                  | Fast, zero-config, clean ESM output       |
| Dev runner          | tsx                   | Run TypeScript directly                   |

### Not in the Stack

| Skipped              | Why                                                               |
| -------------------- | ----------------------------------------------------------------- |
| Express/Hono/Fastify | Polling, not webhooks. Localhost status endpoint uses `node:http` |
| Redis/BullMQ         | In-memory queue sufficient for single process                     |
| Any database         | File-based config in `~/.pergentic/`                              |
| React/Next.js        | CLI tool, no web UI                                               |
| Docker               | User's choice, not a requirement                                  |
| Any ORM              | No database                                                       |
| Axios/got/ky         | Built-in fetch is enough                                          |

Target: `node_modules` under 20MB, built binary under 1MB.

---

## Project Structure

```
pergentic/
├── src/
│   ├── cli.ts                     # Entry point, Commander setup
│   ├── daemon.ts                  # Background process entry point
│   ├── commands/
│   │   ├── init.ts                # Interactive setup wizard
│   │   ├── init-slack.ts          # Slack-specific setup
│   │   ├── start.ts               # Start daemon (fork + detach)
│   │   ├── stop.ts                # Kill daemon via PID file
│   │   ├── restart.ts             # Stop + start
│   │   ├── status.ts              # One-line status + remote support
│   │   ├── add.ts                 # Register a project
│   │   ├── remove.ts              # Unregister a project
│   │   ├── list.ts                # Show all projects + status
│   │   ├── logs.ts                # Tail daemon log file
│   │   ├── retry.ts              # Retry a failed task
│   │   ├── cancel.ts              # Cancel a running task
│   │   ├── dashboard.tsx          # TUI dashboard (Ink)
│   │   └── service.ts             # Generate systemd/launchd config
│   ├── providers/
│   │   ├── types.ts               # TaskProvider interface
│   │   ├── linear.ts              # Poll Linear API
│   │   ├── github.ts              # Poll GitHub Issues + PR comments
│   │   └── slack.ts               # Slack Socket Mode (WebSocket)
│   ├── agents/
│   │   ├── types.ts               # Agent interface
│   │   ├── claude-code.ts         # Spawn claude CLI
│   │   ├── codex.ts               # Spawn codex CLI
│   │   ├── aider.ts               # Spawn aider CLI
│   │   └── opencode.ts            # Spawn opencode CLI
│   ├── core/
│   │   ├── worktree.ts            # Git worktree lifecycle + cleanup
│   │   ├── git.ts                 # Commit, push, PR creation
│   │   ├── queue.ts               # In-memory priority task queue
│   │   ├── runner.ts              # Worker pool, concurrency control
│   │   ├── poller.ts              # Main poll loop across providers
│   │   ├── notify.ts              # Slack/Discord webhook notifications
│   │   ├── feedback.ts            # .claude-history.json management
│   │   └── cost.ts                # Per-task cost tracking
│   ├── config/
│   │   ├── schema.ts              # Zod schemas for all config
│   │   ├── loader.ts              # Read YAML, validate, merge global + project
│   │   └── paths.ts               # ~/.pergentic/ path resolution
│   └── utils/
│       ├── logger.ts              # Pino setup
│       ├── process.ts             # Spawn helpers with timeout
│       └── health.ts              # PID file management, isRunning check
├── bin/
│   └── pergentic.ts                # #!/usr/bin/env node
├── package.json
├── tsconfig.json
├── Dockerfile.example             # Convenience for Docker users
└── README.md
```

---

## Distribution

```json
{
	"name": "pergentic",
	"version": "1.0.0",
	"bin": { "pergentic": "./dist/bin/pergentic.js" },
	"scripts": {
		"build": "tsup src/cli.ts src/bin/pergentic.ts --format esm",
		"dev": "tsx src/bin/pergentic.ts"
	}
}
```

```bash
yarn install -g pergentic
```

---

## User Quickstart

```bash
# Install
yarn install -g pergentic

# Setup
pergentic init

# Register projects
pergentic add ~/projects/my-saas
pergentic add ~/projects/client-app

# Start
pergentic start

# Monitor
pergentic dashboard

# Move a ticket to "In Progress" in Linear → PR appears in minutes
# Leave a PR comment → changes applied automatically
```

---

## Testing Plan

### Testing Stack

| Component    | Choice                           | Reason                                                          |
| ------------ | -------------------------------- | --------------------------------------------------------------- |
| Test runner  | Vitest                           | Fast, native TypeScript, ESM support, same ecosystem as tsup    |
| Mocking      | vitest built-in (vi.mock, vi.fn) | No extra dependency, deep module mocking                        |
| Git testing  | tmp directories + real git       | simple-git against actual repos, no mocking git internals       |
| HTTP mocking | msw (Mock Service Worker)        | Intercepts fetch at network level, realistic API simulation     |
| CLI testing  | execa                            | Spawn real `pergentic` process, capture stdout/stderr/exit code |
| Filesystem   | tmp-promise                      | Isolated temp directories per test, auto-cleanup                |
| Snapshot     | vitest snapshots                 | Config schema validation, CLI output formatting                 |
| Coverage     | v8 (via vitest)                  | Built-in, no extra tooling                                      |

### Test Directory Structure

```
tests/
├── unit/
│   ├── config/
│   │   ├── schema.test.ts           # Zod schema validation
│   │   ├── loader.test.ts           # YAML parsing, merge logic
│   │   └── paths.test.ts            # Path resolution
│   ├── core/
│   │   ├── queue.test.ts            # Priority queue logic
│   │   ├── runner.test.ts           # Worker pool, concurrency
│   │   ├── worktree.test.ts         # Worktree lifecycle
│   │   ├── git.test.ts              # Commit, push, PR helpers
│   │   ├── poller.test.ts           # Poll loop orchestration
│   │   ├── notify.test.ts           # Notification formatting + dispatch
│   │   ├── feedback.test.ts         # History file management
│   │   └── cost.test.ts             # Cost tracking logic
│   ├── providers/
│   │   ├── linear.test.ts           # Linear API response parsing
│   │   ├── github.test.ts           # GitHub API response parsing
│   │   └── slack.test.ts            # Slack message parsing
│   ├── agents/
│   │   ├── claude-code.test.ts      # Command building, install check
│   │   ├── codex.test.ts
│   │   ├── aider.test.ts
│   │   └── opencode.test.ts
│   └── utils/
│       ├── logger.test.ts           # Log formatting
│       ├── process.test.ts          # Spawn helpers, timeout
│       └── health.test.ts           # PID management, isRunning
├── integration/
│   ├── config/
│   │   └── config-lifecycle.test.ts # Init → load → validate full cycle
│   ├── providers/
│   │   ├── linear-poll.test.ts      # Linear API poll with msw
│   │   ├── github-poll.test.ts      # GitHub API poll with msw
│   │   ├── github-feedback.test.ts  # PR comment detection with msw
│   │   └── slack-socket.test.ts     # Slack Socket Mode connection
│   ├── core/
│   │   ├── worktree-git.test.ts     # Real git worktree operations
│   │   ├── task-pipeline.test.ts    # Queue → runner → agent spawn
│   │   ├── feedback-loop.test.ts    # Feedback → rerun → amend push
│   │   └── notification.test.ts     # Notify with msw webhook capture
│   ├── agents/
│   │   └── agent-spawn.test.ts      # Spawn mock agents, verify behavior
│   └── daemon/
│       ├── daemon-lifecycle.test.ts  # Fork, PID, stop, restart
│       ├── state-file.test.ts       # State.json write/read cycle
│       └── status-endpoint.test.ts  # Localhost HTTP status
├── e2e/
│   ├── commands/
│   │   ├── init.test.ts             # Full interactive init flow
│   │   ├── add-remove.test.ts       # Project registration lifecycle
│   │   ├── start-stop.test.ts       # Daemon start/stop/restart
│   │   ├── status.test.ts           # Status output
│   │   ├── list.test.ts             # Project listing
│   │   ├── logs.test.ts             # Log tailing
│   │   ├── retry-cancel.test.ts     # Task retry and cancel
│   │   └── dashboard.test.ts        # TUI renders without crash
│   ├── workflows/
│   │   ├── new-task.test.ts         # Linear task → PR creation (full flow)
│   │   ├── github-issue.test.ts     # GitHub issue → PR creation
│   │   ├── feedback-round.test.ts   # PR comment → agent rerun → force push
│   │   ├── multi-project.test.ts    # Multiple projects, concurrent tasks
│   │   ├── slack-trigger.test.ts    # Slack message → PR creation
│   │   └── error-recovery.test.ts   # Agent failure → notification → retry
│   └── lifecycle/
│       ├── cold-start.test.ts       # Fresh install → init → first task
│       └── long-running.test.ts     # Daemon stability over many tasks
├── fixtures/
│   ├── repos/
│   │   ├── setup.ts                 # Create test git repos with history
│   │   └── nextjs-template/         # Minimal Next.js project for testing
│   ├── api-responses/
│   │   ├── linear/                  # Linear API response fixtures
│   │   │   ├── issues-in-progress.json
│   │   │   ├── issue-detail.json
│   │   │   └── status-update.json
│   │   ├── github/                  # GitHub API response fixtures
│   │   │   ├── issues-assigned.json
│   │   │   ├── pr-comments.json
│   │   │   ├── pr-review-comments.json
│   │   │   ├── pr-created.json
│   │   │   └── pr-review.json
│   │   └── slack/                   # Slack event fixtures
│   │       ├── app-mention.json
│   │       └── message.json
│   ├── configs/
│   │   ├── valid-global.yaml
│   │   ├── valid-project.yaml
│   │   ├── minimal.yaml
│   │   ├── invalid-missing-repo.yaml
│   │   ├── invalid-bad-agent.yaml
│   │   └── invalid-bad-yaml.yaml
│   └── agents/
│       └── mock-agent.sh            # Fake agent that creates files and exits
└── helpers/
    ├── setup.ts                     # Global test setup
    ├── git.ts                       # Create temp repos, assert branch state
    ├── msw-handlers.ts              # Shared API mock handlers
    ├── daemon.ts                    # Start/stop daemon in tests, wait for ready
    ├── cli.ts                       # Run pergentic commands, parse output
    └── cleanup.ts                   # Kill orphan processes, remove temp dirs
```

---

### Unit Tests

Pure logic testing. No filesystem, no network, no child processes. Fast, isolated, deterministic.

#### Config — `tests/unit/config/`

**schema.test.ts**

```typescript
describe("Config Schema", () => {
	describe("Global config", () => {
		it("validates a complete global config");
		it("accepts minimal config with only required fields");
		it("rejects missing anthropicApiKey");
		it("rejects missing githubToken");
		it("rejects invalid pollInterval (negative)");
		it("rejects invalid pollInterval (zero)");
		it("rejects invalid maxConcurrent (zero)");
		it("rejects invalid maxConcurrent (negative)");
		it("defaults pollInterval to 30 when omitted");
		it("defaults maxConcurrent to 2 when omitted");
		it("validates notification webhook URLs");
		it("rejects notification config with invalid event types");
		it("validates remote config structure");
	});

	describe("Project config", () => {
		it("validates a complete project config");
		it("accepts minimal project config (repo + branch only)");
		it("rejects missing repo URL");
		it("rejects invalid agent name");
		it("accepts all valid agent names: claude-code, codex, aider, opencode");
		it("defaults agent to claude-code when omitted");
		it("defaults branch to main when omitted");
		it("validates PR template variables");
		it("validates feedback config");
		it("rejects maxRounds less than 1");
		it("rejects maxCostPerTask as negative");
		it("validates linear status mapping");
		it("validates slack channel binding structure");
		it("validates allowedTools array");
	});

	describe("Projects registry", () => {
		it("validates projects array");
		it("accepts empty projects list");
		it("rejects duplicate project paths");
		it("rejects non-absolute paths");
	});
});
```

**loader.test.ts**

```typescript
describe("Config Loader", () => {
	it("loads and parses valid YAML");
	it("throws on invalid YAML syntax");
	it("throws on empty config file");
	it("merges global config with project config");
	it("project config overrides global defaults");
	it("does not leak API keys into project config");
	it("resolves ~ in paths to home directory");
	it("handles missing optional config sections gracefully");
	it("reads .env file and merges environment variables");
	it("environment variables override YAML values");
});
```

**paths.test.ts**

```typescript
describe("Config Paths", () => {
	it("resolves global config dir to ~/.pergentic/");
	it("resolves PID file path");
	it("resolves log file path");
	it("resolves state file path");
	it("resolves stats file path");
	it("resolves project config from project directory");
	it("resolves workspace root for a project");
	it("resolves worktree path for a task");
});
```

#### Core — `tests/unit/core/`

**queue.test.ts**

```typescript
describe("TaskQueue", () => {
	it("adds and retrieves tasks in FIFO order");
	it("sorts by priority (lower number = higher priority)");
	it("returns undefined when queue is empty");
	it("reports correct length");
	it("feedback tasks (priority 1) are dequeued before new tasks (priority 2)");
	it("retries (priority 3) are dequeued last");
	it("tasks with same priority maintain insertion order");
	it("handles adding tasks while queue is being drained");
	it("peek returns next task without removing it");
	it("remove deletes a specific task by ID");
	it("hasPendingForTask returns true if task has queued feedback");
	it("returns all active task IDs");
	it("clear empties the queue");
});
```

**runner.test.ts**

```typescript
describe("TaskRunner", () => {
	it("runs a task when slots are available");
	it("returns false when all slots are full");
	it("reports correct availableSlots count");
	it("respects maxConcurrent limit");
	it("releases slot when child process exits with code 0");
	it("releases slot when child process exits with non-zero code");
	it("calls commitAndPush on successful exit");
	it("calls createPR on successful exit");
	it("calls notify with taskCompleted on success");
	it("calls notify with taskFailed on failure");
	it("does not call commitAndPush on failure");
	it("does not call createPR on failure");
	it("spawns child process with correct cwd (worktree path)");
	it("passes ANTHROPIC_API_KEY in child env");
	it("passes correct agent command based on project config");
	it("handles agent process crash (SIGKILL)");
	it("handles agent process timeout");
	it("cancels a running task by killing child process");
	it("tracks active tasks with their IDs");
});
```

**worktree.test.ts**

```typescript
describe("Worktree Manager", () => {
	it("generates correct branch name from task ID and title");
	it("sanitizes special characters from branch names");
	it("truncates long branch names");
	it("generates correct worktree path");
	it("determines if worktree exists for a task");
	it("builds cleanup list of stale worktrees older than threshold");
	it("tracks worktree-to-task mapping");
});
```

**git.test.ts**

```typescript
describe("Git Operations", () => {
	it("builds correct commit message from task template");
	it("builds correct PR title from template");
	it("builds correct PR body with variable substitution");
	it("includes configured labels in PR creation args");
	it("includes configured reviewers in PR creation args");
	it("generates force push args for feedback rounds");
	it("generates amend commit args");
});
```

**poller.test.ts**

```typescript
describe("Poller", () => {
	it("iterates over all registered projects each cycle");
	it("calls poll on each active provider for a project");
	it("adds discovered tasks to queue");
	it("respects pollInterval between cycles");
	it("stops polling when shuttingDown is true");
	it("skips a project if its provider poll throws");
	it("logs errors from failed provider polls");
	it("does not add duplicate tasks already in queue");
	it("does not add tasks already being processed");
	it("fills available runner slots after polling");
});
```

**notify.test.ts**

```typescript
describe("Notifications", () => {
	it("formats Slack message for completed task");
	it("formats Slack message for failed task");
	it("formats Discord message for completed task");
	it("formats Discord message for failed task");
	it("includes PR URL in completion message");
	it("includes error details in failure message");
	it("includes duration in message");
	it("includes cost estimate in message");
	it("skips Slack if not configured");
	it("skips Discord if not configured");
	it("skips event types not enabled in config");
	it("does not throw if webhook fetch fails");
});
```

**feedback.test.ts**

```typescript
describe("Feedback Manager", () => {
	it("creates new history file for first feedback round");
	it("appends to existing history file");
	it("reads full history from file");
	it("increments round number");
	it("builds prompt with original description + all rounds");
	it("includes file path and line number for review comments");
	it("distinguishes issue comments from review comments");
	it("handles missing history file gracefully");
	it("respects maxRounds limit");
	it("returns shouldProcess=false when maxRounds exceeded");
});
```

**cost.test.ts**

```typescript
describe("Cost Tracker", () => {
	it("records cost for a completed task");
	it("accumulates daily totals");
	it("resets daily totals at midnight");
	it("persists stats to stats.json");
	it("loads existing stats on startup");
	it("handles corrupted stats file");
	it("tracks task count, PR count, failure count");
	it("calculates cost per task average");
});
```

#### Providers — `tests/unit/providers/`

**linear.test.ts**

```typescript
describe("Linear Provider", () => {
	it("parses issue list response into IncomingTask array");
	it("filters issues by team ID");
	it('filters issues by "In Progress" status');
	it("extracts task ID, title, description from issue");
	it("ignores issues already seen (dedup by ID)");
	it("handles empty response");
	it("handles pagination token");
	it("builds GraphQL query correctly");
	it("builds status update mutation for onComplete");
	it("maps configured status names to Linear state IDs");
});
```

**github.test.ts**

```typescript
describe("GitHub Provider", () => {
	describe("Issue polling", () => {
		it("parses assigned issues into IncomingTask array");
		it("filters by repo");
		it("ignores issues without assignee");
		it("ignores issues already processed");
		it("extracts issue number, title, body");
	});

	describe("PR comment polling", () => {
		it("detects new issue_comment on Pergentic-managed PRs");
		it("detects new pull_request_review_comment");
		it('detects pull_request_review with "request changes"');
		it("extracts comment body, file path, line number");
		it("ignores comments from users in ignoreUsers list");
		it("ignores comments from bot itself");
		it("maps PR branch name back to task ID");
		it("handles comments on PRs not managed by Pergentic");
	});

	describe("PR creation", () => {
		it("builds gh pr create command with title and body");
		it("adds labels flag");
		it("adds reviewers flag");
		it("parses PR URL from command output");
	});

	describe("Comment reply", () => {
		it("builds reply body for feedback applied");
		it("builds reply body for feedback failed");
	});
});
```

**slack.test.ts**

```typescript
describe("Slack Provider", () => {
	it("parses app_mention event into IncomingTask");
	it('extracts project name from "in {project}" syntax');
	it("resolves project from channel binding config");
	it("returns ambiguous result when no project resolved");
	it("ignores messages from bots");
	it("ignores messages not mentioning @pergentic");
	it("extracts task description from message text");
	it("strips @pergentic mention from description");
	it("builds Slack reply for task started");
	it("builds Slack reply for PR created");
	it("builds Slack reply for task failed");
	it("builds Slack reply asking which project");
});
```

#### Agents — `tests/unit/agents/`

**claude-code.test.ts**

```typescript
describe("Claude Code Agent", () => {
	it("builds correct command string");
	it("includes --allowedTools from config");
	it("includes -p flag with prompt");
	it("escapes special characters in prompt");
	it("checks installation by running claude --version");
	it("reports not installed when command not found");
	it("respects maxCostPerTask config");
});
```

**codex.test.ts / aider.test.ts / opencode.test.ts**

```typescript
// Same pattern for each agent:
describe("{Agent} Agent", () => {
	it("builds correct command string");
	it("includes agent-specific flags");
	it("escapes special characters in prompt");
	it("checks installation by running {command} --version");
	it("reports not installed when command not found");
});
```

#### Utils — `tests/unit/utils/`

**health.test.ts**

```typescript
describe("Health Utils", () => {
	it("isRunning returns false when no PID file");
	it("isRunning returns true when process exists");
	it("isRunning cleans up stale PID file when process dead");
	it("writePid creates PID file with correct content");
	it("removePid deletes PID file");
});
```

**process.test.ts**

```typescript
describe("Process Utils", () => {
	it("spawns command and resolves with stdout on success");
	it("rejects with stderr on non-zero exit");
	it("kills process after timeout");
	it("handles ENOENT when command not found");
	it("passes environment variables to child");
	it("sets correct working directory");
});
```

---

### Integration Tests

Tests that combine multiple modules and touch real resources (filesystem, git, network via msw). Slower but validate real interactions.

#### Config Lifecycle — `tests/integration/config/`

**config-lifecycle.test.ts**

```typescript
describe("Config Lifecycle", () => {
	// Uses tmp directories, real YAML files

	it("init creates ~/.pergentic/ directory structure");
	it("init writes valid global config YAML");
	it("init writes .env file with API keys");
	it("init appends .pergentic/.env to .gitignore");
	it("loader reads config created by init");
	it("loader merges global + project configs correctly");
	it("adding a project updates projects.yaml");
	it("removing a project updates projects.yaml");
	it("removing last project leaves empty projects array");
	it("config changes on disk are picked up on next read");
});
```

#### Providers with API Mocking — `tests/integration/providers/`

**linear-poll.test.ts**

```typescript
describe("Linear Polling Integration", () => {
	// Uses msw to mock Linear GraphQL API

	beforeAll(() => {
		server.listen(); // msw server
	});

	it('polls Linear and returns tasks in "In Progress"');
	it("returns empty array when no tasks match");
	it("handles Linear API rate limit (429) gracefully");
	it("handles Linear API server error (500) gracefully");
	it("handles network timeout");
	it("respects team ID filter");
	it("updates task status after completion");
	it("handles invalid API key (401)");
	it("paginates through large result sets");
});
```

**github-poll.test.ts**

```typescript
describe("GitHub Polling Integration", () => {
	// Uses msw to mock GitHub REST API

	it("polls for assigned issues and returns tasks");
	it("returns empty array when no new issues");
	it("handles GitHub rate limit with retry-after header");
	it("handles GitHub server error (500)");
	it("filters issues by repository");
	it("handles invalid token (401)");
});
```

**github-feedback.test.ts**

```typescript
describe("GitHub Feedback Integration", () => {
	// Uses msw to mock GitHub REST API

	it("detects new issue comment on Pergentic PR");
	it("detects review comment with file + line context");
	it('detects "request changes" review');
	it("ignores comments from ignored users");
	it("maps PR branch to task ID correctly");
	it("ignores comments on non-Pergentic PRs");
	it("handles multiple new comments in single poll");
	it("replies to comment after feedback applied");
	it("replies to comment after feedback failed");
});
```

**slack-socket.test.ts**

```typescript
describe("Slack Socket Mode Integration", () => {
	// Uses mock WebSocket server

	it("connects to Slack via Socket Mode");
	it("receives app_mention event and creates task");
	it("reconnects after connection drop");
	it("sends reply in thread after task started");
	it("sends reply in thread after PR created");
	it("handles invalid token");
	it("asks for project clarification when ambiguous");
});
```

#### Git Operations — `tests/integration/core/`

**worktree-git.test.ts**

```typescript
describe("Worktree + Git Integration", () => {
	// Creates real git repos in tmp directories

	let repoDir: string;
	let workspaceDir: string;

	beforeEach(async () => {
		// Create a temp git repo with a few commits
		repoDir = await createTestRepo({
			files: { "src/index.ts": 'console.log("hello")', "package.json": "{}" },
			commits: ["initial commit"],
		});
		workspaceDir = await mkdtemp("pergentic-test-");
	});

	it("clones repo into workspace");
	it("creates worktree for a new task");
	it("worktree has correct branch checked out");
	it("worktree is isolated from main repo");
	it("creates multiple worktrees for parallel tasks");
	it("commits changes in worktree");
	it("commits with correct message format");
	it("amends commit for feedback rounds");
	it("deletes worktree and branch on cleanup");
	it("handles worktree creation when branch already exists");
	it("pulls latest main before creating worktree");
	it("handles merge conflicts on pull gracefully");
	it("lists all active worktrees for a project");
	it("detects stale worktrees older than threshold");
	it("force push works after amend");
});
```

**task-pipeline.test.ts**

```typescript
describe("Task Pipeline Integration", () => {
	// Uses mock agent (shell script that creates files)
	// Uses real git, real filesystem, msw for API

	it(
		"full pipeline: task queued → worktree created → agent spawned → commit → push → PR",
	);
	it("agent receives correct prompt with task description");
	it("agent runs in correct worktree directory");
	it("agent environment has API key");
	it("PR is created with configured title template");
	it("PR is created with configured labels");
	it("notification sent on completion");
	it("notification sent on failure");
	it("failed task does not create PR");
	it("failed task does not push");
	it("task result includes duration");
	it("task result includes cost estimate");
	it("concurrent tasks run in separate worktrees");
	it("queue respects maxConcurrent limit");
	it("queued tasks are picked up when slots free");
});
```

**feedback-loop.test.ts**

```typescript
describe("Feedback Loop Integration", () => {
	// Uses mock agent, real git, real filesystem

	it("detects feedback comment → creates feedback task with priority 1");
	it("feedback reuses existing worktree");
	it("agent receives prompt with original task + feedback history");
	it("agent receives file path + line for review comments");
	it("commit is amended (not new commit) after feedback");
	it("force push updates the branch");
	it("reply posted to PR comment");
	it("history file updated with new round");
	it("multiple feedback rounds accumulate in history");
	it("feedback stops after maxRounds exceeded");
	it("feedback queued while task is still running gets processed after");
});
```

**notification.test.ts**

```typescript
describe("Notification Integration", () => {
	// Uses msw to capture webhook requests

	it("sends Slack webhook on task completed");
	it("sends Discord webhook on task failed");
	it("webhook payload contains correct task details");
	it("handles webhook delivery failure without crashing");
	it("respects per-event-type enable/disable config");
	it("does not send notification when no webhooks configured");
});
```

#### Daemon — `tests/integration/daemon/`

**daemon-lifecycle.test.ts**

```typescript
describe("Daemon Lifecycle Integration", () => {
	// Spawns real daemon process, manages PID files

	afterEach(async () => {
		await killDaemonIfRunning();
		await cleanupTempDirs();
	});

	it("start creates daemon process and PID file");
	it("start exits parent process immediately");
	it("daemon continues running after parent exits");
	it("daemon writes to log file");
	it("stop sends SIGTERM and removes PID file");
	it("stop waits for active tasks before exiting");
	it("restart stops then starts daemon");
	it("start rejects if daemon already running");
	it("stop handles already stopped daemon");
	it("daemon cleans up stale PID on startup");
	it("daemon survives SIGHUP (terminal close)");
});
```

**state-file.test.ts**

```typescript
describe("State File Integration", () => {
	it("daemon writes state.json periodically");
	it("state.json contains project list with status");
	it("state.json contains active tasks");
	it("state.json contains recent task history");
	it("state.json contains today stats");
	it("state.json updates when task starts");
	it("state.json updates when task completes");
	it("dashboard can read state.json while daemon writes it");
});
```

**status-endpoint.test.ts**

```typescript
describe("Status Endpoint Integration", () => {
	it("daemon starts HTTP server on configured port");
	it("/status returns current state as JSON");
	it("server only listens on 127.0.0.1");
	it("server returns 404 for unknown routes");
	it("server handles concurrent requests");
});
```

---

### End-to-End Tests

Full CLI commands executed as a real user would. Spawn the actual `pergentic` binary, assert output and side effects.

#### Commands — `tests/e2e/commands/`

**init.test.ts**

```typescript
describe("E2E: pergentic init", () => {
	it("creates ~/.pergentic/ directory", async () => {
		const { stdout, exitCode } = await runCli("init", {
			inputs: [
				"git@github.com:user/repo.git", // repo URL
				"main", // branch
				"sk-ant-test123", // anthropic key
				"ghp_test456", // github token
				"lin_api_test789", // linear key
				"30", // poll interval
			],
		});

		expect(exitCode).toBe(0);
		expect(stdout).toContain("Created .pergentic/config.yaml");
		expect(await fileExists("~/.pergentic/config.yaml")).toBe(true);
		expect(await fileExists("~/.pergentic/.env")).toBe(true);

		const config = await readYaml("~/.pergentic/config.yaml");
		expect(config.pollInterval).toBe(30);
	});

	it("refuses to overwrite existing config without --force");
	it("overwrites existing config with --force flag");
});
```

**add-remove.test.ts**

```typescript
describe("E2E: pergentic add / remove", () => {
	it("registers a project directory", async () => {
		const { stdout, exitCode } = await runCli("add", ["/tmp/test-project"]);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("Registered");

		const projects = await readYaml("~/.pergentic/projects.yaml");
		expect(projects.projects).toContainEqual({ path: "/tmp/test-project" });
	});

	it("rejects non-existent directory");
	it("rejects directory without .pergentic/config.yaml");
	it("rejects duplicate registration");
	it("removes a registered project");
	it("handles removing unregistered project gracefully");
});
```

**start-stop.test.ts**

```typescript
describe("E2E: pergentic start / stop / restart", () => {
	afterEach(async () => {
		await runCli("stop");
	});

	it("starts daemon and shows PID", async () => {
		const { stdout, exitCode } = await runCli("start");

		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/Pergentic running in background \(PID: \d+\)/);
		expect(await fileExists("~/.pergentic/daemon.pid")).toBe(true);
	});

	it("rejects start when already running");

	it("stops running daemon", async () => {
		await runCli("start");
		const { stdout, exitCode } = await runCli("stop");

		expect(exitCode).toBe(0);
		expect(stdout).toContain("Pergentic stopped");
		expect(await fileExists("~/.pergentic/daemon.pid")).toBe(false);
	});

	it("handles stop when not running");

	it("restart cycles the daemon", async () => {
		await runCli("start");
		const pidBefore = await readPid();

		const { exitCode } = await runCli("restart");

		expect(exitCode).toBe(0);
		const pidAfter = await readPid();
		expect(pidAfter).not.toBe(pidBefore);
	});
});
```

**status.test.ts**

```typescript
describe("E2E: pergentic status", () => {
	it("shows running status when daemon is active", async () => {
		await runCli("start");
		const { stdout } = await runCli("status");

		expect(stdout).toContain("● Pergentic is running");
		expect(stdout).toMatch(/PID: \d+/);
		expect(stdout).toContain("Uptime");
	});

	it("shows not running when daemon is stopped", async () => {
		const { stdout } = await runCli("status");
		expect(stdout).toContain("⭘ Pergentic is not running");
	});

	it("cleans up stale PID and reports not running");
});
```

**list.test.ts**

```typescript
describe("E2E: pergentic list", () => {
	it("shows registered projects in table format");
	it('shows "No projects registered" when empty');
	it("shows active task count per project when daemon running");
	it("shows idle status when no tasks");
});
```

**logs.test.ts**

```typescript
describe("E2E: pergentic logs", () => {
	it("tails daemon log file");
	it("shows last N lines with -n flag");
	it("filters by project with --project flag");
	it('shows "No logs yet" when log file empty');
	it("shows error when daemon has never been started");
});
```

**retry-cancel.test.ts**

```typescript
describe("E2E: pergentic retry / cancel", () => {
	it("retries a failed task by ID");
	it("shows error for unknown task ID");
	it("shows error when task is not in failed state");
	it("cancels a running task by ID");
	it("shows error when task is not running");
});
```

**dashboard.test.ts**

```typescript
describe("E2E: pergentic dashboard", () => {
	it("renders without crashing when daemon running");
	it("renders without crashing when daemon stopped");
	it("shows project list");
	it("shows active tasks");
	it("shows recent tasks");
	it("exits cleanly on Q keypress");
});
```

#### Workflows — `tests/e2e/workflows/`

These are the most important tests. They validate the complete user-visible behavior.

**new-task.test.ts**

```typescript
describe("E2E Workflow: Linear Task → PR", () => {
	// msw mocks Linear + GitHub APIs
	// Mock agent creates a real file
	// Real git operations

	let testRepo: TestRepo;
	let mswServer: SetupServer;

	beforeAll(async () => {
		testRepo = await createTestRepo();
		mswServer = setupMswServer([
			linearHandlers.issueInProgress("SAAS-142", "Add billing page"),
			linearHandlers.statusUpdate(),
			githubHandlers.createPR(),
		]);
		mswServer.listen();
	});

	it("detects Linear task, runs agent, creates PR", async () => {
		// 1. Start daemon with mock agent and test repo
		await startTestDaemon({
			agent: "mock-agent",
			repo: testRepo.url,
			linearTeamId: "SAAS",
		});

		// 2. Wait for task to be picked up (poll cycle)
		await waitFor(() => getState().activeTasks.length > 0, { timeout: 10_000 });

		// 3. Wait for task to complete
		await waitFor(
			() =>
				getState().recentTasks.some(
					(t) => t.id === "SAAS-142" && t.status === "completed",
				),
			{ timeout: 30_000 },
		);

		// 4. Verify git state
		const branches = await testRepo.branches();
		expect(branches).toContain("saas-142-add-billing-page");

		const commits = await testRepo.log("saas-142-add-billing-page");
		expect(commits[0].message).toContain("SAAS-142");

		// 5. Verify PR was created (msw captured the request)
		const prRequest = mswServer.getCapturedRequest("POST /repos/*/pulls");
		expect(prRequest.body.title).toContain("Add billing page");
		expect(prRequest.body.labels).toContain("ai-generated");

		// 6. Verify Linear status was updated
		const statusRequest = mswServer.getCapturedRequest("POST /graphql");
		expect(statusRequest.body).toContain("issueUpdate");

		// 7. Verify notification was sent
		const webhookRequest = mswServer.getCapturedRequest("POST /slack-webhook");
		expect(webhookRequest.body.text).toContain("SAAS-142");
		expect(webhookRequest.body.text).toContain("PR");
	});
});
```

**github-issue.test.ts**

```typescript
describe("E2E Workflow: GitHub Issue → PR", () => {
	it("detects assigned issue, runs agent, creates PR");
	it("updates issue with PR link comment");
});
```

**feedback-round.test.ts**

```typescript
describe("E2E Workflow: PR Comment → Agent Rerun", () => {
	it("full feedback cycle", async () => {
		// Setup: task already completed, PR exists
		// 1. Mock a new PR comment
		// 2. Wait for feedback to be detected
		// 3. Verify agent ran in existing worktree
		// 4. Verify commit was amended
		// 5. Verify force push happened
		// 6. Verify reply was posted on PR
		// 7. Verify .claude-history.json updated
	});

	it("handles multiple sequential feedback rounds");
	it("stops after maxRounds");
	it("includes file + line context for review comments");
});
```

**multi-project.test.ts**

```typescript
describe("E2E Workflow: Multiple Projects", () => {
	it("processes tasks from different projects concurrently");
	it("isolates worktrees per project");
	it("routes feedback to correct project");
	it("respects maxConcurrent across all projects");
});
```

**slack-trigger.test.ts**

```typescript
describe("E2E Workflow: Slack Message → PR", () => {
	it("receives Slack mention, creates task, creates PR");
	it("replies in thread with PR link");
	it("asks for project clarification when ambiguous");
});
```

**error-recovery.test.ts**

```typescript
describe("E2E Workflow: Error Recovery", () => {
	it("agent failure → notification → retry succeeds");
	it("agent timeout → task marked failed → retry");
	it("git push failure → task marked failed with error details");
	it("API poll failure → logs error → continues next cycle");
	it("daemon crash → restart → resumes queued tasks");
	it("malformed task data → skip with error log");
	it("disk full during clone → graceful error");
});
```

#### Lifecycle — `tests/e2e/lifecycle/`

**cold-start.test.ts**

```typescript
describe("E2E Lifecycle: Cold Start", () => {
	it("fresh install → init → add project → start → processes first task");
});
```

**long-running.test.ts**

```typescript
describe("E2E Lifecycle: Long Running", () => {
	it("processes 20 tasks sequentially without memory leak", async () => {
		const startMemory = process.memoryUsage().heapUsed;

		for (let i = 0; i < 20; i++) {
			await triggerMockTask(`TASK-${i}`);
			await waitForTaskComplete(`TASK-${i}`);
		}

		const endMemory = process.memoryUsage().heapUsed;
		const growth = endMemory - startMemory;

		// Memory should not grow more than 50MB over 20 tasks
		expect(growth).toBeLessThan(50 * 1024 * 1024);
	});

	it("handles rapid task submission without dropping tasks");
	it("worktree cleanup prevents disk bloat");
});
```

---

### Test Helpers

#### `tests/helpers/git.ts`

```typescript
import { simpleGit } from "simple-git";
import { mkdtemp, writeFile } from "fs/promises";
import { join } from "path";

interface TestRepoOptions {
	files?: Record<string, string>;
	commits?: string[];
}

export async function createTestRepo(
	options?: TestRepoOptions,
): Promise<TestRepo> {
	const dir = await mkdtemp("/tmp/pergentic-test-repo-");
	const git = simpleGit(dir);

	await git.init();
	await git.addConfig("user.email", "test@pergentic.dev");
	await git.addConfig("user.name", "Pergentic Test");

	const files = options?.files ?? { "README.md": "# Test" };
	for (const [path, content] of Object.entries(files)) {
		await writeFile(join(dir, path), content);
	}

	await git.add(".");
	await git.commit(options?.commits?.[0] ?? "initial commit");

	return {
		dir,
		url: dir, // local path works as git remote
		git,
		branches: () => git.branch().then((b) => b.all),
		log: (branch?: string) => git.log(branch ? [branch] : []),
		cleanup: () => rm(dir, { recursive: true }),
	};
}
```

#### `tests/helpers/msw-handlers.ts`

```typescript
import { http, HttpResponse } from "msw";

export const linearHandlers = {
	issueInProgress: (id: string, title: string) =>
		http.post("https://api.linear.app/graphql", () => {
			return HttpResponse.json({
				data: {
					issues: {
						nodes: [
							{
								id,
								title,
								identifier: id,
								description: `Task: ${title}`,
								state: { name: "In Progress" },
							},
						],
					},
				},
			});
		}),

	statusUpdate: () =>
		http.post("https://api.linear.app/graphql", ({ request }) => {
			// Capture for assertion
			return HttpResponse.json({ data: { issueUpdate: { success: true } } });
		}),
};

export const githubHandlers = {
	createPR: () =>
		http.post("https://api.github.com/repos/:owner/:repo/pulls", () => {
			return HttpResponse.json({
				html_url: "https://github.com/user/repo/pull/42",
				number: 42,
			});
		}),

	prComments: (comments: any[]) =>
		http.get(
			"https://api.github.com/repos/:owner/:repo/issues/:number/comments",
			() => {
				return HttpResponse.json(comments);
			},
		),
};
```

#### `tests/helpers/cli.ts`

```typescript
import { execaCommand } from "execa";

interface CliResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export async function runCli(
	command: string,
	args?: string[] | { inputs?: string[] },
): Promise<CliResult> {
	const cliPath = resolve(__dirname, "../../dist/bin/pergentic.js");
	const argString = Array.isArray(args) ? args.join(" ") : "";

	try {
		const result = await execaCommand(
			`node ${cliPath} ${command} ${argString}`,
			{
				env: {
					...process.env,
					HOME: testHomeDir, // isolated home per test
					PERGENTIC_TEST: "true",
				},
				input: Array.isArray(args) ? undefined : args?.inputs?.join("\n"),
				timeout: 30_000,
			},
		);
		return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
	} catch (error: any) {
		return {
			stdout: error.stdout ?? "",
			stderr: error.stderr ?? "",
			exitCode: error.exitCode ?? 1,
		};
	}
}
```

#### `tests/helpers/daemon.ts`

```typescript
export async function startTestDaemon(config: TestDaemonConfig) {
	// Write test config to isolated home dir
	await writeTestConfig(config);

	// Start daemon
	await runCli("start");

	// Wait for daemon to be ready (state.json exists)
	await waitFor(() => fileExists(stateFilePath), { timeout: 5_000 });
}

export async function killDaemonIfRunning() {
	try {
		await runCli("stop");
	} catch {
		// Already stopped
	}
}

export function getState(): DaemonState {
	return JSON.parse(readFileSync(stateFilePath, "utf-8"));
}

export async function waitFor(
	condition: () => boolean | Promise<boolean>,
	options: { timeout: number; interval?: number } = { timeout: 10_000 },
) {
	const start = Date.now();
	while (Date.now() - start < options.timeout) {
		if (await condition()) return;
		await sleep(options.interval ?? 500);
	}
	throw new Error(`waitFor timed out after ${options.timeout}ms`);
}
```

#### `tests/fixtures/agents/mock-agent.sh`

```bash
#!/bin/bash
# Mock agent that creates a file and exits
# Simulates what a real agent would do

echo "Reading codebase..."
sleep 1

echo "Creating new file..."
cat > src/billing.ts << 'EOF'
export function calculateBilling() {
  return { amount: 0, currency: 'usd' }
}
EOF

echo "Done."
exit 0
```

---

### Test Configuration

#### `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		testTimeout: 10_000,

		// Run test suites in the correct order
		projects: [
			{
				// Unit tests: fast, parallel
				test: {
					name: "unit",
					include: ["tests/unit/**/*.test.ts"],
					testTimeout: 5_000,
					pool: "threads",
				},
			},
			{
				// Integration tests: medium speed, sequential filesystem access
				test: {
					name: "integration",
					include: ["tests/integration/**/*.test.ts"],
					testTimeout: 30_000,
					pool: "forks", // isolated process per test file
					maxConcurrency: 1, // sequential — filesystem conflicts
				},
			},
			{
				// E2E tests: slow, fully sequential
				test: {
					name: "e2e",
					include: ["tests/e2e/**/*.test.ts"],
					testTimeout: 60_000,
					pool: "forks",
					maxConcurrency: 1,
					retry: 1, // flaky tolerance for daemon tests
				},
			},
		],

		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/cli.ts", "src/bin/**"],
			thresholds: {
				statements: 80,
				branches: 75,
				functions: 80,
				lines: 80,
			},
		},
	},
});
```

#### `package.json` scripts

```json
{
	"scripts": {
		"test": "vitest run",
		"test:unit": "vitest run --project unit",
		"test:integration": "vitest run --project integration",
		"test:e2e": "vitest run --project e2e",
		"test:watch": "vitest --project unit",
		"test:coverage": "vitest run --coverage",
		"test:ci": "vitest run --reporter=junit --outputFile=test-results.xml"
	}
}
```

---

### CI Pipeline

```yaml
# .github/workflows/test.yml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: yarn install
      - run: yarn test:unit

  integration:
    runs-on: ubuntu-latest
    needs: unit
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: yarn install
      - run: yarn test:integration

  e2e:
    runs-on: ubuntu-latest
    needs: integration
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: sudo apt-get install -y gh # GitHub CLI for PR tests
      - run: yarn install
      - run: yarn build # E2E runs compiled binary
      - run: chmod +x tests/fixtures/agents/mock-agent.sh
      - run: yarn test:e2e

  coverage:
    runs-on: ubuntu-latest
    needs: [unit, integration]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: yarn install
      - run: yarn test:coverage
      - uses: codecov/codecov-action@v4
```

---

### Coverage Targets

```
Module                Target    Rationale
─────────────────────────────────────────────────────────────
config/schema.ts      95%       Critical — bad config = silent failures
config/loader.ts      90%       File I/O edge cases
core/queue.ts         95%       Core data structure, must be bulletproof
core/runner.ts        85%       Process lifecycle hard to cover fully
core/worktree.ts      85%       Git operations have many edge cases
core/feedback.ts      90%       Prompt construction must be reliable
core/poller.ts        80%       Loop logic, error handling paths
core/notify.ts        85%       Network failures need graceful handling
providers/*           85%       API parsing must handle edge cases
agents/*              90%       Command construction must be correct
utils/health.ts       95%       PID management must be reliable
utils/process.ts      80%       OS-level edge cases
─────────────────────────────────────────────────────────────
Overall minimum       80%       Enforced in CI
```

---

### Testing Principles

1. **Mock at the boundary, not in the middle.** Mock HTTP (msw), mock the filesystem (tmp dirs), mock child processes (mock-agent.sh). Don't mock internal module imports unless absolutely necessary.

2. **Each test owns its state.** Every test creates its own temp directory, config files, and git repos. No shared mutable state between tests. `afterEach` cleans everything up.

3. **E2E tests use the compiled binary.** Run `yarn build` before E2E. Tests invoke `node dist/bin/pergentic.js`, not source files. This catches build issues.

4. **Integration tests use real git.** Don't mock `simple-git`. Create real repos, make real commits, verify real branch state. Git is core to the product — mock it and you test nothing.

5. **Unit tests never touch disk or network.** If a unit test needs a config object, construct it in memory. If it needs an API response, import the fixture JSON directly.

6. **Flaky E2E tests get one retry in CI.** Daemon startup timing, port binding, and process forking can be flaky. One retry catches transient failures. Two consecutive failures = real bug.

7. **The mock agent is a real shell script.** It creates actual files on disk, simulating what Claude Code would do. This validates the full contract between the runner and agent without needing a real API key.
