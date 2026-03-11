import { describe, it, expect } from "vitest";
import { maskKey } from "./ui-helpers";

describe("maskKey", () => {
	it("fully masks keys under 20 chars", () => {
		expect(maskKey("short")).toBe("***");
		expect(maskKey("1234567890")).toBe("***"); // 10 chars
		expect(maskKey("12345678901")).toBe("***"); // 11 chars
		expect(maskKey("1234567890123456789")).toBe("***"); // 19 chars
	});

	it("shows prefix and suffix for keys 20+ chars", () => {
		expect(maskKey("12345678901234567890")).toBe("123456***7890"); // 20 chars
		expect(maskKey("123456789012345678901")).toBe("123456***8901"); // 21 chars
	});

	it("fully masks empty string", () => {
		expect(maskKey("")).toBe("***");
	});
});
