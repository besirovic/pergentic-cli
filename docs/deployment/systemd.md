# systemd Service (Linux)

Run pergentic as a system service on Linux.

## Install

```bash
pergentic service install
```

This generates a systemd unit file at `~/.config/systemd/user/pergentic.service` and prints the path. The generated unit runs `pergentic start --foreground` under the current user account.

Example generated unit:

```ini
[Unit]
Description=Pergentic - Autonomous PR Generator
After=network.target

[Service]
Type=simple
ExecStart=/path/to/node /path/to/pergentic.js start --foreground
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

## Enable and Start

```bash
systemctl --user enable pergentic
systemctl --user start pergentic
```

## Stop and Disable

```bash
systemctl --user stop pergentic
systemctl --user disable pergentic
```

## Status

```bash
systemctl --user status pergentic
```

## Logs

```bash
journalctl --user -u pergentic -f
```

Or use pergentic's built-in log viewer:

```bash
pergentic logs -f
```

Daemon logs are also written to `~/.pergentic/daemon.log` (JSONL format, one JSON object per line).

## Restart Behavior

The generated unit file sets `Restart=on-failure` and `RestartSec=10`. If the daemon crashes, systemd waits 10 seconds before restarting it.

## Environment

The service runs as the current user. The unit hardcodes `NODE_ENV=production` but does not inherit your interactive shell's environment. API keys stored in `~/.pergentic/.env` and project-level `.pergentic/.env` files are loaded by the daemon at startup — they do not need to be in the unit file.

Make sure `node` (>= 20) is available at the path used by `ExecStart`. If you manage Node versions with nvm or similar, you may need to hardcode the full path to the node binary (e.g., `/home/user/.nvm/versions/node/v20.0.0/bin/node`).

## Updating the Unit File

If you reinstall or move pergentic, regenerate the unit file:

```bash
pergentic service install
systemctl --user daemon-reload
systemctl --user restart pergentic
```

## Limitations

System-wide service installation (writing to `/etc/systemd/system/`) is not supported by `pergentic service install`. Only user-level services (`~/.config/systemd/user/`) are generated. To run pergentic as a system service, write the unit file manually.
