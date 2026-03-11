import { describe, it, expect } from "vitest";
import { isValidHostname, isValidPort } from "./project-validation";

describe("isValidHostname", () => {
	it("accepts valid hostnames", () => {
		expect(isValidHostname("example.com")).toBe(true);
		expect(isValidHostname("my-server.internal")).toBe(true);
		expect(isValidHostname("192.168.1.1")).toBe(true);
		expect(isValidHostname("a")).toBe(true);
		expect(isValidHostname("host123")).toBe(true);
	});

	it("rejects hostnames starting with '-'", () => {
		expect(isValidHostname("-oProxyCommand=malicious")).toBe(false);
		expect(isValidHostname("-R")).toBe(false);
	});

	it("rejects empty or overly long hostnames", () => {
		expect(isValidHostname("")).toBe(false);
		expect(isValidHostname("a".repeat(254))).toBe(false);
	});

	it("rejects hostnames with spaces or shell metacharacters", () => {
		expect(isValidHostname("host name")).toBe(false);
		expect(isValidHostname("host;rm -rf /")).toBe(false);
		expect(isValidHostname("host$(whoami)")).toBe(false);
		expect(isValidHostname("attacker.com -R 8080:localhost:22")).toBe(false);
	});
});

describe("isValidPort", () => {
	it("accepts valid ports", () => {
		expect(isValidPort(1)).toBe(true);
		expect(isValidPort(80)).toBe(true);
		expect(isValidPort(443)).toBe(true);
		expect(isValidPort(65535)).toBe(true);
	});

	it("rejects port 0", () => {
		expect(isValidPort(0)).toBe(false);
	});

	it("rejects port above 65535", () => {
		expect(isValidPort(70000)).toBe(false);
	});

	it("rejects non-numeric port", () => {
		expect(isValidPort("abc")).toBe(false);
	});

	it("rejects fractional port", () => {
		expect(isValidPort(80.5)).toBe(false);
	});

	it("accepts numeric string ports", () => {
		expect(isValidPort("443")).toBe(true);
	});
});
