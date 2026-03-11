/** Daemon process timing and capacity constants. */
export const DAEMON = {
  STATE_UPDATE_INTERVAL_MS: 3_000,
  SHUTDOWN_TIMEOUT_MS: 300_000,
  STATS_CACHE_TTL_MS: 30_000,
} as const;

/** Timeout durations for various operations. */
export const TIMEOUTS = {
  SSH_TUNNEL_ESTABLISH_MS: 2_000,
  DASHBOARD_REFRESH_MS: 1_000,
  PID_CLEANUP_MS: 500,
} as const;

/** Thresholds and sizing limits. */
export const LIMITS = {
  COMMENT_POLL_WINDOW_MS: 120_000,
  MAX_BODY_BYTES: 1_048_576,
  MAX_EVENT_ENTRIES: 10_000,
  STATS_RETENTION_DAYS: 90,
} as const;
