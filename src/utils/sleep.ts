export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cancellableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (!signal) return sleep(ms);
	if (signal.aborted) return Promise.resolve();

	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		function onAbort() {
			clearTimeout(timer);
			resolve();
		}

		signal.addEventListener("abort", onAbort, { once: true });
	});
}
