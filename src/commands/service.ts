import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { success } from "../utils/ui";
import { escapeXml } from "../utils/format";

function escapeSystemdValue(str: string): string {
	return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function generateSystemdUnit(): string {
	const nodePath = escapeSystemdValue(process.execPath);
	const pergentic = escapeSystemdValue(
		join(dirname(process.argv[1] ?? ""), "pergentic.js")
	);
	return `[Unit]
Description=Pergentic - Autonomous PR Generator
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${pergentic} start --foreground
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

function generateLaunchdPlist(): string {
	const nodePath = escapeXml(process.execPath);
	const pergentic = escapeXml(
		join(dirname(process.argv[1] ?? ""), "pergentic.js")
	);
	const logPath = escapeXml(join(homedir(), ".pergentic", "daemon.log"));
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.pergentic</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${pergentic}</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
}

export async function serviceInstall(): Promise<void> {
	const os = platform();

	if (os === "linux") {
		const unitPath = join(
			homedir(),
			".config",
			"systemd",
			"user",
			"pergentic.service"
		);
		const dir = dirname(unitPath);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(unitPath, generateSystemdUnit());
		success(`Created ${unitPath}`);
		console.log("   Enable with: systemctl --user enable pergentic");
		console.log("   Start with:  systemctl --user start pergentic");
	} else if (os === "darwin") {
		const plistPath = join(
			homedir(),
			"Library",
			"LaunchAgents",
			"com.pergentic.plist"
		);
		const dir = dirname(plistPath);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(plistPath, generateLaunchdPlist());
		success(`Created ${plistPath}`);
		console.log("   Load with: launchctl load " + plistPath);
	} else {
		console.log(`Service installation not supported on ${os}.`);
		console.log("Use your OS service manager to run: pergentic start");
	}
}
