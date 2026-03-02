import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/cli.ts", "src/daemon.ts", "src/bin/pergentic.ts"],
	format: ["esm"],
	target: "node20",
	outDir: "dist",
	clean: true,
	splitting: true,
	sourcemap: true,
	dts: false,
	banner: {
		js: "",
	},
	external: ["ink", "react"],
});
