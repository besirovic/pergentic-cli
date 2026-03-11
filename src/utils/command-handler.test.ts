import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleCommand } from "./command-handler";

vi.mock("./ui", () => ({ error: vi.fn() }));

describe("handleCommand", () => {
	let originalExitCode: number | undefined;

	beforeEach(() => {
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
	});

	afterEach(() => {
		process.exitCode = originalExitCode;
	});

	it("sets exitCode to 1 when the wrapped function throws", async () => {
		const fn = handleCommand(async () => {
			throw new Error("boom");
		});
		await fn();
		expect(process.exitCode).toBe(1);
	});

	it("does not set exitCode when the wrapped function succeeds", async () => {
		const fn = handleCommand(async () => {});
		await fn();
		expect(process.exitCode).toBeUndefined();
	});

	it("calls process.exit(0) for ExitPromptError", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		const err = new Error("User cancelled");
		err.name = "ExitPromptError";

		const fn = handleCommand(async () => {
			throw err;
		});
		await fn();
		expect(exitSpy).toHaveBeenCalledWith(0);
		exitSpy.mockRestore();
	});

	it("shows rebuild guidance for ERR_MODULE_NOT_FOUND errors", async () => {
		const { error: errorMock } = await import("./ui");
		const err = Object.assign(new Error("Cannot find module './commands/init/index.js'"), {
			code: "ERR_MODULE_NOT_FOUND",
		});

		const fn = handleCommand(async () => {
			throw err;
		});
		await fn();
		expect(process.exitCode).toBe(1);
		expect(errorMock).toHaveBeenCalledWith("Command module not found. Try rebuilding: yarn build");
	});

	it("shows rebuild guidance for MODULE_NOT_FOUND errors", async () => {
		const { error: errorMock } = await import("./ui");
		const err = Object.assign(new Error("Cannot find module './commands/add.js'"), {
			code: "MODULE_NOT_FOUND",
		});

		const fn = handleCommand(async () => {
			throw err;
		});
		await fn();
		expect(process.exitCode).toBe(1);
		expect(errorMock).toHaveBeenCalledWith("Command module not found. Try rebuilding: yarn build");
	});
});
