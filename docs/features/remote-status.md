# Remote Status

Monitor pergentic daemons running on other machines.

## Configuration

In global config (`~/.pergentic/config.yaml`):

```yaml
remotes:
  staging:
    host: staging.example.com
    port: 7890
  production:
    host: prod.example.com
```

| Field | Type | Default | Constraints |
|-------|------|---------|-------------|
| `host` | string | — | Alphanumeric, dots, hyphens only. Must not start or end with a hyphen or dot. Max 253 characters. |
| `port` | number | `7890` | Range: 1–65535. |

Remote names are arbitrary string keys used to reference the remote with `--remote`.

## Usage

```bash
pergentic status --remote staging
```

## How It Works

The local daemon exposes a status endpoint over HTTP on `127.0.0.1:<statusPort>`. When `--remote` is specified, the CLI connects to the remote daemon's equivalent endpoint via the configured host and port.

The remote machine must have pergentic running and the daemon's HTTP port reachable from the local machine. Firewall rules or SSH port forwarding may be required depending on your network setup.
