# launchd Service (macOS)

Run pergentic as a launch agent on macOS.

## Install

```bash
pergentic service install
```

This generates a launchd plist file at `~/Library/LaunchAgents/com.pergentic.plist` and prints the load command.

Example generated plist:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.pergentic</string>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/node</string>
    <string>/path/to/pergentic.js</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/you/.pergentic/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/you/.pergentic/daemon.log</string>
</dict>
</plist>
```

Both stdout and stderr are directed to `~/.pergentic/daemon.log`.

## Load

```bash
launchctl load ~/Library/LaunchAgents/com.pergentic.plist
```

## Unload

```bash
launchctl unload ~/Library/LaunchAgents/com.pergentic.plist
```

## Logs

```bash
pergentic logs -f
```

Daemon logs are written to `~/.pergentic/daemon.log` (JSONL format, one JSON object per line).

## Restart Behavior

The plist sets `KeepAlive` to `true`, so launchd restarts the daemon whenever it exits, including crashes and clean exits. To stop the daemon without it being restarted, unload the plist first.

## Environment

The launch agent runs in the user's login context. API keys in `~/.pergentic/.env` and project `.pergentic/.env` files are loaded by the daemon at startup.

Make sure `node` (>= 20) is in the PATH available to launchd. If using nvm, the nvm-managed node binary may not be on launchd's `PATH`. In that case, add an `EnvironmentVariables` key to the plist pointing to your node binary's directory, or edit `ProgramArguments` to use the absolute path to node.

Example `EnvironmentVariables` addition:

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>PATH</key>
  <string>/Users/you/.nvm/versions/node/v20.0.0/bin:/usr/local/bin:/usr/bin:/bin</string>
</dict>
```

## Updating the Plist

If you reinstall or move pergentic, regenerate the plist:

```bash
launchctl unload ~/Library/LaunchAgents/com.pergentic.plist
pergentic service install
launchctl load ~/Library/LaunchAgents/com.pergentic.plist
```

## Limitations

The `pergentic service install` command on macOS only generates user-level launch agents (`~/Library/LaunchAgents/`). System-level daemons (`/Library/LaunchDaemons/`) are not supported.
