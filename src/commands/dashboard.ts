// TUI Dashboard - placeholder for Ink React implementation (task 8.3)
import { readState } from "../utils/daemon-state";

export async function dashboard(): Promise<void> {
	// For now, simple polling display. Full Ink TUI in task 8.3.
	const render = () => {
		const state = readState();
		if (!state) {
			console.log("No state file. Is the daemon running?");
			return false;
		}

		try {
			console.clear();
			console.log("┌─ Pergentic ────────────────────────────────────┐");
			console.log(
				`│  ● ${state.status}  ·  Uptime ${Math.floor(
					state.uptime / 60
				)}m`.padEnd(49) + "│"
			);
			console.log("├────────────────────────────────────────────────┤");

			if (state.projects?.length) {
				console.log("│  Projects:".padEnd(49) + "│");
				for (const p of state.projects) {
					const icon = p.status === "working" ? "●" : "○";
					console.log(`│    ${icon} ${p.name} (${p.agent})`.padEnd(49) + "│");
				}
			}

			if (state.todayStats) {
				const s = state.todayStats;
				console.log("├────────────────────────────────────────────────┤");
				console.log(
					`│  Today: ${s.tasks} tasks · ${
						s.prs
					} PRs · $${s.estimatedCost?.toFixed(2)}`.padEnd(49) + "│"
				);
			}

			console.log("├────────────────────────────────────────────────┤");
			console.log("│  Press Ctrl+C to exit".padEnd(49) + "│");
			console.log("└────────────────────────────────────────────────┘");
			return true;
		} catch {
			console.log("Error reading state file.");
			return false;
		}
	};

	if (!render()) return;

	let consecutiveFailures = 0;
	const maxFailures = 3;

	await new Promise<void>((resolve) => {
		const interval = setInterval(() => {
			if (render()) {
				consecutiveFailures = 0;
			} else {
				consecutiveFailures++;
				if (consecutiveFailures >= maxFailures) {
					clearInterval(interval);
					resolve();
				}
			}
		}, 1000);

		const cleanup = () => {
			clearInterval(interval);
			resolve();
		};
		process.once("SIGINT", cleanup);
	});
}
