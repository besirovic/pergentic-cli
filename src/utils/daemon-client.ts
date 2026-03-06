import { isRunning } from "./health";
import { loadGlobalConfig } from "../config/loader";

export interface DaemonResponse {
	ok: boolean;
	body: string;
}

export async function daemonRequest(
	endpoint: string,
	body: Record<string, unknown>,
): Promise<DaemonResponse> {
	if (!isRunning()) {
		return {
			ok: false,
			body: "Pergentic is not running. Start it with `pergentic start`.",
		};
	}

	const config = loadGlobalConfig();
	const port = config.statusPort;

	try {
		const res = await fetch(`http://127.0.0.1:${port}/${endpoint}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		const text = await res.text();
		return { ok: res.ok, body: text };
	} catch {
		return { ok: false, body: "Failed to connect to daemon." };
	}
}
